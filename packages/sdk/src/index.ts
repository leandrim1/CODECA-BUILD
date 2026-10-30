import { CodecaError } from './errors.js';
import { createTransport } from './http.js';
import { createResources, type CodecaResources } from './resources.js';

export * from './types.js';
export { CodecaError } from './errors.js';
export type { CodecaResources } from './resources.js';

/**
 * Cliente para o navegador.
 *
 * Usa a chave **publicavel**, que nao e segredo: ela so le conteudo publicado
 * e so a partir de uma origem autorizada no painel da plataforma. Pode ficar
 * no codigo do site, inclusive em `VITE_*`.
 */

export interface ClientOptions {
  /** Endereco do painel, por exemplo `https://app.codecabuild.com.br`. */
  baseUrl: string;
  publishableKey: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export function createClient(options: ClientOptions): CodecaResources {
  if (!options.baseUrl) {
    throw new CodecaError('configuracao_invalida', 'Informe `baseUrl` da plataforma.', 0);
  }

  /*
   * Recusar a chave secreta aqui e o ponto mais importante deste arquivo.
   *
   * Trocar uma chave pela outra e o erro mais facil de cometer e o mais caro:
   * a secreta le rascunho e, no navegador, fica visivel para qualquer
   * visitante. Falhar na criacao do cliente -- em desenvolvimento, na primeira
   * execucao -- custa um minuto; descobrir depois custa uma rotacao e a
   * duvida sobre quem ja copiou a chave.
   */
  if (options.publishableKey.startsWith('cb_sec_')) {
    throw new CodecaError(
      'chave_secreta_no_navegador',
      'Esta e uma chave secreta e ela nao pode ir para o navegador. '
        + 'Use a chave publicavel (cb_pub_...) aqui, ou `createServerClient` no servidor.',
      0,
    );
  }
  if (!options.publishableKey.startsWith('cb_pub_')) {
    throw new CodecaError(
      'chave_invalida',
      'A chave publicavel comeca com `cb_pub_`. Copie-a no painel da plataforma.',
      0,
    );
  }

  return createResources(
    createTransport({
      baseUrl: options.baseUrl,
      token: options.publishableKey,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
  );
}
