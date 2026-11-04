import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsoleMailer, createResendMailer } from '../../apps/api/src/lib/mailer.js';
import { generateLoginCode, hashLoginCode, loginCodeMessage } from '../../apps/api/src/lib/login-code.js';
import { parseEnv } from '../../apps/api/src/env.js';

const env = parseEnv({ DATABASE_URL: 'postgres://x/y', AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres' });

afterEach(() => vi.restoreAllMocks());

describe('geracao do codigo', () => {
  it('sempre 6 digitos, com zeros a esquerda preservados, e bem distribuido', () => {
    const seen = new Set<string>();
    let leadingZero = 0;
    for (let i = 0; i < 5000; i += 1) {
      const code = generateLoginCode();
      expect(code).toMatch(/^\d{6}$/);
      if (code.startsWith('0')) leadingZero += 1;
      seen.add(code);
    }
    // 5000 sorteios entre 1.000.000 de opcoes: praticamente nenhuma repeticao.
    expect(seen.size).toBeGreaterThan(4900);
    // ~10% comecam com zero; se estivessem sendo cortados (Number), seria 0.
    expect(leadingZero).toBeGreaterThan(300);
  });

  it('o hash depende do segredo, do e-mail e do codigo', () => {
    const base = hashLoginCode(env, 'a@x.com', '123456');
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(base).not.toContain('123456');
    expect(hashLoginCode(env, 'a@x.com', '123457')).not.toBe(base);
    expect(hashLoginCode(env, 'b@x.com', '123456')).not.toBe(base);
    const outro = parseEnv({ DATABASE_URL: 'postgres://x/y', AUTH_SECRET: 'outro-segredo-de-teste-com-32-caracteres!' });
    expect(hashLoginCode(outro, 'a@x.com', '123456')).not.toBe(base);
  });
});

describe('texto do e-mail', () => {
  it('traz o assunto e o conteudo combinados, com o codigo no lugar do exemplo', () => {
    const message = loginCodeMessage('482913');
    expect(message.subject).toBe('Seu código de acesso ao CODECA Build');
    expect(message.text).toContain('Olá!');
    expect(message.text).toContain('Você solicitou um código para acessar sua conta no CODECA Build.');
    expect(message.text).toContain('Seu código de verificação é:\n\n482913\n');
    expect(message.text).toContain('Esse código expira em 10 minutos e só pode ser utilizado uma vez.');
    expect(message.text).toContain('Se você não solicitou esse acesso, ignore esta mensagem.');
    expect(message.text).toContain('CODECA Build\nTecnologia desenvolvida pela CODECA IA.');
    // O codigo de exemplo do enunciado nao fica fixo no texto.
    expect(loginCodeMessage('000001').text).not.toContain('123456');
  });
});

describe('log do servidor', () => {
  it('o mailer de console omite o codigo (e so ele): o resto das mensagens continua legivel', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const mailer = createConsoleMailer();

    await mailer.send({ to: 'a@x.com', kind: 'login_code', ...loginCodeMessage('482913') });
    await mailer.send({ to: 'a@x.com', kind: 'reset_password', subject: 'Redefinição', text: 'link: https://x/y?token=abc' });

    const logged = info.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toContain('482913');
    expect(logged).toContain('login_code -> a@x.com');
    expect(logged).toContain('conteúdo omitido');
    expect(logged).toContain('token=abc');
  });
});

describe('envio pelo Resend (o que sai pela rede)', () => {
  it('chama a API com a chave no cabecalho, remetente, destino, assunto e texto', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"id":"msg_1"}', { status: 200 });
    });
    const mailer = createResendMailer('re_chave_de_teste', 'CODECA Build <acesso@codecabuild.com>');

    const result = await mailer.send({ to: 'cliente@empresa.com.br', kind: 'login_code', ...loginCodeMessage('482913') });

    expect(result).toEqual({ delivered: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_chave_de_teste');
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: 'CODECA Build <acesso@codecabuild.com>',
      to: ['cliente@empresa.com.br'],
      subject: 'Seu código de acesso ao CODECA Build',
    });
    expect(String(body.text)).toContain('482913');
    vi.unstubAllGlobals();
  });

  it('se o provedor recusa, informa que nao entregou e nao registra o codigo no log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => new Response('{"message":"domain not verified"}', { status: 403 }));
    const mailer = createResendMailer('re_chave_de_teste', 'CODECA Build <acesso@exemplo.com>');

    const result = await mailer.send({ to: 'cliente@empresa.com.br', kind: 'login_code', ...loginCodeMessage('482913') });

    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/403/);
    expect(error.mock.calls.map((c) => c.join(' ')).join('\n')).not.toContain('482913');
    vi.unstubAllGlobals();
  });

  it('rede fora do ar: nao entregou, sem estourar a requisicao', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNRESET');
    });
    const result = await createResendMailer('k', 'a@b.c').send({ to: 'a@x.com', kind: 'login_code', subject: 's', text: 't' });
    expect(result.delivered).toBe(false);
    vi.unstubAllGlobals();
  });
});
