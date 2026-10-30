/**
 * Origens autorizadas de um site.
 *
 * A chave publicavel viaja no navegador, a vista de qualquer um. O que impede
 * um terceiro de usar a chave de um cliente no proprio site e a origem: o
 * navegador envia `Origin` e nao deixa a pagina mentir sobre ele.
 *
 * Nao e protecao contra um servidor determinado -- `Origin` so existe no
 * navegador, e quem chama por fora simplesmente nao o envia. E justamente por
 * isso que a chave publicavel nao le nada que ja nao seja publico.
 */

/** Origem normalizada: esquema e host, sem caminho, porta padrao removida. */
export function normalizeOrigin(value: string): string | null {
  const texto = value.trim();
  if (!texto) return null;

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // http so para desenvolvimento local; um site de cliente em producao e https.
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) return null;

  const porta = url.port && !isDefaultPort(url.protocol, url.port) ? `:${url.port}` : '';
  return `${url.protocol}//${url.hostname.toLowerCase()}${porta}`;
}

function isDefaultPort(protocol: string, port: string): boolean {
  return (protocol === 'https:' && port === '443') || (protocol === 'http:' && port === '80');
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * A origem da requisicao esta autorizada para este site?
 *
 * Comparacao exata sobre o valor normalizado. Nada de "termina com": um
 * curinga em `.exemplo.com.br` autorizaria `exemplo.com.br.invasor.com`.
 */
export function originAllowed(
  origin: string | null | undefined,
  allowed: readonly string[],
): boolean {
  if (!origin) return false;
  const normalizada = normalizeOrigin(origin);
  if (!normalizada) return false;
  return allowed.includes(normalizada);
}
