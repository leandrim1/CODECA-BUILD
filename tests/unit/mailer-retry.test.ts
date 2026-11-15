import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResendMailer } from '@codeca/api';

/**
 * Nova tentativa de envio: repete o que vale repetir, e nunca duplica.
 *
 * Uma falha passageira do provedor (rede, 5xx, 429) não pode custar o código
 * de acesso de quem está tentando entrar. Mas repetir às cegas é o caminho
 * para mandar o mesmo e-mail duas vezes -- por isso as duas tentativas levam a
 * mesma chave de idempotência.
 */

const mensagem = {
  to: 'cliente@empresa.com.br',
  kind: 'login_code' as const,
  subject: 'Seu código',
  text: 'Código: 482913',
};

function provedor(respostas: Array<number | Error>) {
  const chamadas: Array<{ chave: string | undefined; corpo: string }> = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const cabecalhos = init.headers as Record<string, string>;
    chamadas.push({ chave: cabecalhos['idempotency-key'], corpo: String(init.body) });
    const proxima = respostas[Math.min(chamadas.length - 1, respostas.length - 1)]!;
    if (proxima instanceof Error) throw proxima;
    return new Response(proxima === 200 ? '{"id":"msg_42"}' : '{"message":"erro"}', { status: proxima });
  });
  return chamadas;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('nova tentativa', () => {
  it('falha passageira e depois sucesso: entrega na segunda, com a mesma chave', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const chamadas = provedor([503, 200]);

    const resultado = await createResendMailer('re_teste', 'CODECA <a@exemplo.com>').send(mensagem);

    expect(resultado).toMatchObject({ delivered: true, providerMessageId: 'msg_42', attempts: 2 });
    expect(chamadas).toHaveLength(2);
    // A mesma chave nas duas: se a primeira chegou ao provedor e só a
    // resposta se perdeu, a segunda não vira outro e-mail.
    expect(chamadas[0]!.chave).toBeTruthy();
    expect(chamadas[1]!.chave).toBe(chamadas[0]!.chave);
    expect(chamadas[1]!.corpo).toBe(chamadas[0]!.corpo);
  });

  it('rede que cai e volta: entrega na segunda', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const chamadas = provedor([new Error('ECONNRESET'), 200]);

    const resultado = await createResendMailer('re_teste', 'CODECA <a@exemplo.com>').send(mensagem);

    expect(resultado.delivered).toBe(true);
    expect(chamadas).toHaveLength(2);
  });

  it('limite de requisições (429) também admite nova tentativa', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const chamadas = provedor([429, 200]);

    const resultado = await createResendMailer('re_teste', 'CODECA <a@exemplo.com>').send(mensagem);

    expect(resultado.delivered).toBe(true);
    expect(chamadas).toHaveLength(2);
  });

  it('para na segunda: não insiste contra um provedor fora do ar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const chamadas = provedor([503, 503, 200]);

    const resultado = await createResendMailer('re_teste', 'CODECA <a@exemplo.com>').send(mensagem);

    expect(resultado).toMatchObject({ delivered: false, attempts: 2 });
    expect(resultado.reason).toContain('503');
    expect(chamadas).toHaveLength(2);
  });

  it('recusa da mensagem (chave, remetente) não é repetida', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const status of [400, 401, 403, 422]) {
      const chamadas = provedor([status, 200]);
      const resultado = await createResendMailer('re_teste', 'CODECA <a@exemplo.com>').send(mensagem);
      expect(resultado.delivered, String(status)).toBe(false);
      expect(chamadas, String(status)).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it('mensagens diferentes têm chaves diferentes', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const chamadas = provedor([200]);
    const mailer = createResendMailer('re_teste', 'CODECA <a@exemplo.com>');

    await mailer.send(mensagem);
    await mailer.send(mensagem);

    // Duas mensagens pedidas são dois e-mails: a chave protege a repetição de
    // UMA mensagem, não impede o reenvio que a pessoa pediu.
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]!.chave).not.toBe(chamadas[1]!.chave);
  });
});

describe('registro do envio', () => {
  it('registra o tipo e o identificador no provedor, nunca o destinatário nem o código', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    provedor([200]);

    await createResendMailer('re_teste', 'CODECA <a@exemplo.com>').send(mensagem);

    const registros = info.mock.calls.map((chamada) => chamada.join(' ')).join('\n');
    expect(registros).toContain('email_accepted');
    expect(registros).toContain('msg_42');
    expect(registros).toContain('login_code');
    expect(registros).not.toContain('cliente@empresa.com.br');
    expect(registros).not.toContain('482913');
    expect(registros).not.toContain('re_teste');
  });
});
