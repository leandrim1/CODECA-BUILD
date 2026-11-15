import { describe, expect, it } from 'vitest';
import { createMonitor, redact, redactText, type SanitizedOpsEvent } from '@codeca/api';

/**
 * O monitor operacional: avisa quem opera, e não vaza nada no caminho.
 *
 * Duas propriedades importam aqui, e são opostas: o alerta precisa SAIR quando
 * algo quebra, e o que sai não pode carregar senha, token, código de acesso ou
 * e-mail de cliente. Estes testes cobrem as duas.
 */

interface Recebido {
  url: string;
  body: { text: string; content: string; event: SanitizedOpsEvent };
}

function montar(opcoes: { status?: number; janelaSegundos?: number; email?: boolean; falhaDeRede?: boolean } = {}) {
  const recebidos: Recebido[] = [];
  const emails: Array<{ subject: string; text: string }> = [];
  const linhas: string[] = [];
  let agora = new Date('2026-11-14T12:00:00Z');

  const monitor = createMonitor({
    alertWebhookUrl: 'https://alertas.exemplo.test/entrada',
    alertWindowSeconds: opcoes.janelaSegundos ?? 1800,
    environment: 'test',
    now: () => agora,
    fetch: (async (url: unknown, init?: RequestInit) => {
      if (opcoes.falhaDeRede) throw new Error('ECONNRESET');
      recebidos.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: opcoes.status ?? 200 });
    }) as typeof fetch,
    sendAlertEmail: opcoes.email
      ? async (alerta) => {
          emails.push(alerta);
        }
      : undefined,
    log: (linha) => void linhas.push(linha),
  });

  return {
    monitor,
    recebidos,
    emails,
    linhas,
    avancar: (segundos: number) => {
      agora = new Date(agora.getTime() + segundos * 1000);
    },
  };
}

const falha = {
  kind: 'webhook_failed' as const,
  severity: 'critical' as const,
  message: 'Um evento de cobrança foi recebido e não pôde ser aplicado.',
  context: { eventId: '3f1c2a9e-5b7d-4c11-9a2e-0d4f6b8a1c33', attempts: 3 },
};

describe('alerta diante de uma falha', () => {
  it('falha crítica dispara o alerta, com o que quem opera precisa saber', async () => {
    const { monitor, recebidos } = montar();

    const resultado = await monitor.report(falha);

    expect(resultado.alerted).toBe(true);
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0]!.url).toBe('https://alertas.exemplo.test/entrada');
    // O mesmo texto nos dois campos: `text` (Slack, Teams) e `content` (Discord).
    expect(recebidos[0]!.body.text).toContain('não pôde ser aplicado');
    expect(recebidos[0]!.body.content).toBe(recebidos[0]!.body.text);
    expect(recebidos[0]!.body.text).toContain('webhook_failed');
    // O identificador técnico chega inteiro: é o que permite achar o evento.
    expect(recebidos[0]!.body.text).toContain('3f1c2a9e-5b7d-4c11-9a2e-0d4f6b8a1c33');
  });

  it('o mesmo problema repetido vira um alerta por janela, não mil', async () => {
    const { monitor, recebidos, avancar } = montar({ janelaSegundos: 600 });

    for (let i = 0; i < 50; i += 1) await monitor.report(falha);
    expect(recebidos).toHaveLength(1);

    // Passada a janela, se o problema continua, avisa de novo.
    avancar(601);
    await monitor.report(falha);
    expect(recebidos).toHaveLength(2);
  });

  it('problemas diferentes não se escondem um atrás do outro', async () => {
    const { monitor, recebidos } = montar();

    await monitor.report(falha);
    await monitor.report({ ...falha, kind: 'reconcile_failed', message: 'A conciliação falhou.' });
    await monitor.report({ ...falha, alertKey: 'webhook_failed:payment.success' });

    expect(recebidos).toHaveLength(3);
  });

  it('aviso e informação vão para o log, e não acordam ninguém', async () => {
    const { monitor, recebidos, linhas } = montar();

    const aviso = await monitor.report({ ...falha, severity: 'warning' });
    const info = await monitor.report({ ...falha, severity: 'info' });

    expect(aviso.alerted).toBe(false);
    expect(info.alerted).toBe(false);
    expect(recebidos).toHaveLength(0);
    expect(linhas).toHaveLength(2);
  });

  it('também avisa por e-mail quando configurado', async () => {
    const { monitor, emails } = montar({ email: true });

    await monitor.report(falha);

    expect(emails).toHaveLength(1);
    expect(emails[0]!.subject).toContain('CODECA Build');
    expect(emails[0]!.text).toContain('webhook_failed');
  });

  it('não avisa por e-mail que o e-mail parou de funcionar', async () => {
    const { monitor, emails, recebidos } = montar({ email: true });

    await monitor.report({
      kind: 'email_failed',
      severity: 'critical',
      message: 'O provedor de e-mail não aceitou uma mensagem.',
    });

    // O canal que funciona recebe; o que está quebrado não é usado para avisar de si mesmo.
    expect(recebidos).toHaveLength(1);
    expect(emails).toHaveLength(0);
  });
});

describe('o monitor nunca derruba quem o chamou', () => {
  it('receptor de alertas fora do ar: registra e segue', async () => {
    const { monitor, linhas } = montar({ falhaDeRede: true });

    const resultado = await monitor.report(falha);

    expect(resultado.alerted).toBe(false);
    expect(linhas.join('\n')).toContain('ops_alert_undelivered');
  });

  it('receptor que responde erro: registra e segue', async () => {
    const { monitor, linhas } = montar({ status: 500 });

    const resultado = await monitor.report(falha);

    expect(resultado.alerted).toBe(false);
    expect(linhas.join('\n')).toContain('ops_alert_undelivered');
  });

  it('erro que não é Error, contexto estranho: nada lança', async () => {
    const { monitor } = montar();

    await expect(
      monitor.report({ ...falha, error: { qualquer: 'coisa' }, context: { a: undefined, b: null, c: 0 } }),
    ).resolves.toBeDefined();
    await expect(monitor.report({ ...falha, error: 'texto solto' })).resolves.toBeDefined();
  });
});

describe('o que nunca sai', () => {
  it('campos com nome de segredo perdem o valor', () => {
    const limpo = redact({
      password: 'hunter2',
      senha: 'abc12345',
      accessToken: 'tok_123',
      intentToken: 'abcdef',
      authorization: 'Bearer xyz',
      apiKey: 're_123',
      clientSecret: 'shh',
      loginCode: '482913',
      cardNumber: '4111111111111111',
      signature: 't=1,v1=aa',
      // Estes são identificadores técnicos, e ficam.
      eventId: 'evt_123',
      attempts: 3,
      errorCode: 'SUBSCRIPTION_ALREADY_CANCELED',
      statusCode: 502,
      route: '/api/webhooks/validapay',
    });

    for (const chave of [
      'password', 'senha', 'accessToken', 'intentToken', 'authorization',
      'apiKey', 'clientSecret', 'loginCode', 'cardNumber', 'signature',
    ]) {
      expect(limpo[chave], chave).toBe('[removido]');
    }
    expect(limpo).toMatchObject({
      eventId: 'evt_123',
      attempts: 3,
      errorCode: 'SUBSCRIPTION_ALREADY_CANCELED',
      statusCode: 502,
      route: '/api/webhooks/validapay',
    });
  });

  it('texto livre perde e-mail e o que parece chave', () => {
    const texto = redactText(
      'Falha ao enviar para maria.silva@padaria.com.br usando re_AbCdEf123456789 e Bearer eyJhbGciOiJIUzI1NiJ9.abc',
    );

    expect(texto).not.toContain('maria.silva');
    // O domínio fica: ajuda a diagnosticar (provedor do destinatário) sem identificar a pessoa.
    expect(texto).toContain('***@padaria.com.br');
    expect(texto).not.toContain('re_AbCdEf123456789');
    expect(texto).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('um identificador comum (UUID) não é confundido com segredo', () => {
    const id = '3f1c2a9e-5b7d-4c11-9a2e-0d4f6b8a1c33';
    expect(redactText(`evento ${id} falhou`)).toContain(id);
  });

  it('o alerta que sai não leva o que foi posto no contexto por engano', async () => {
    const { monitor, recebidos, linhas } = montar();

    await monitor.report({
      kind: 'api_error',
      severity: 'critical',
      message: 'Erro ao autenticar cliente@empresa.com.br',
      context: { password: 'segredo-do-cliente', loginCode: '482913', requestId: 'req_1' },
      error: new Error('token re_ChaveSuperSecreta123456 recusado para joao@empresa.com.br'),
    });

    const tudo = JSON.stringify(recebidos) + linhas.join('\n');
    expect(tudo).not.toContain('segredo-do-cliente');
    expect(tudo).not.toContain('482913');
    expect(tudo).not.toContain('re_ChaveSuperSecreta123456');
    expect(tudo).not.toContain('cliente@empresa.com.br');
    expect(tudo).not.toContain('joao@empresa.com.br');
    expect(tudo).toContain('req_1');
  });
});
