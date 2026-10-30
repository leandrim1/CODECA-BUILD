import { CodecaError } from './errors.js';
import { createTransport } from './http.js';
import { createResources, type CodecaResources } from './resources.js';

export * from './types.js';
export { CodecaError } from './errors.js';

/**
 * Cliente para o servidor do site.
 *
 * Usa a chave **secreta**, que le tambem rascunho e previa. Ela nunca pode ir
 * para o navegador: nao use em componente de cliente, nem em variavel
 * `VITE_*`, nem no repositorio.
 *
 * O ponto de entrada e separado de proposito. Importar
 * `@codeca/sdk/server` em codigo que vai para o navegador e visivel na
 * revisao e no bundle -- bem mais do que um argumento trocado.
 */

export interface ServerClientOptions {
  baseUrl: string;
  secretKey: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export function createServerClient(options: ServerClientOptions): CodecaResources {
  if (!options.baseUrl) {
    throw new CodecaError('configuracao_invalida', 'Informe `baseUrl` da plataforma.', 0);
  }
  if (!options.secretKey.startsWith('cb_sec_')) {
    throw new CodecaError(
      'chave_invalida',
      'A chave secreta comeca com `cb_sec_`. A publicavel nao le rascunho; '
        + 'use `createClient` para ela.',
      0,
    );
  }

  return createResources(
    createTransport({
      baseUrl: options.baseUrl,
      token: options.secretKey,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
  );
}
