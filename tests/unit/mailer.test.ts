import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResendMailer } from '@codeca/api';

/**
 * Envio de e-mail no caminho do cadastro.
 *
 * A confirmacao e enviada dentro da requisicao que cria a conta. Duas regras
 * saem disso: o envio tem prazo, para nao prender a funcao ate o limite da
 * plataforma; e uma falha de envio nao derruba o cadastro, porque a conta ja
 * foi criada no banco e a confirmacao pode ser reenviada.
 */

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('mailer do provedor', () => {
  it('envia com prazo, para nao prender a requisicao', async () => {
    let recebido: RequestInit | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      recebido = init;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const mailer = createResendMailer('chave-de-teste', 'Codeca <nao-responda@exemplo.com>');
    const resultado = await mailer.send({
      to: 'contato@construtora.com.br',
      kind: 'verify_email',
      subject: 'Confirme seu e-mail',
      text: 'link',
    });

    expect(resultado.delivered).toBe(true);
    expect(recebido?.signal).toBeInstanceOf(AbortSignal);
  });

  it('provedor que nao responde nao derruba o cadastro', async () => {
    // O cadastro ja esta gravado quando o e-mail sai. Lancar aqui perderia a
    // conta por causa de um servico de terceiro.
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      await new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'TimeoutError'));
        });
      });
      throw new Error('inalcancavel');
    }) as typeof fetch;

    const mailer = createResendMailer('chave-de-teste', 'Codeca <nao-responda@exemplo.com>');
    const envio = mailer.send({
      to: 'contato@construtora.com.br',
      kind: 'verify_email',
      subject: 'Confirme seu e-mail',
      text: 'link',
    });

    await expect(envio).resolves.toMatchObject({ delivered: false });
  }, 15_000);

  it('erro do provedor vira motivo legivel, sem vazar a chave', async () => {
    globalThis.fetch = (async () =>
      new Response('{"message":"invalid api key"}', { status: 401 })) as typeof fetch;

    const mailer = createResendMailer('chave-secreta-de-teste', 'Codeca <nao-responda@exemplo.com>');
    const resultado = await mailer.send({
      to: 'contato@construtora.com.br',
      kind: 'verify_email',
      subject: 'Confirme seu e-mail',
      text: 'link',
    });

    expect(resultado.delivered).toBe(false);
    expect(resultado.reason).toContain('401');
    expect(JSON.stringify(resultado)).not.toContain('chave-secreta-de-teste');
  });
});
