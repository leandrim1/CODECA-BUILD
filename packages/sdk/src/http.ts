import { CodecaError } from './errors.js';

/**
 * Transporte do SDK.
 *
 * Tres cuidados que um cliente ingenuo nao tem:
 *
 * - **Prazo.** Sem ele, uma plataforma lenta trava a renderizacao do site do
 *   cliente ate o navegador desistir sozinho.
 * - **Erro tipado.** A resposta de erro da API tem envelope; uma falha de rede
 *   nao tem. Os dois precisam chegar ao site como o mesmo tipo.
 * - **`fetch` injetavel.** Para testar sem rede e para runtimes que exigem o
 *   proprio.
 */

export interface TransportOptions {
  baseUrl: string;
  token: string;
  /** Padrao: 10 segundos. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export type QueryValue = string | number | boolean | undefined | null;

export function buildQuery(params: Record<string, QueryValue> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const texto = search.toString();
  return texto ? `?${texto}` : '';
}

export function createTransport(options: TransportOptions) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetch ?? globalThis.fetch;

  if (typeof doFetch !== 'function') {
    throw new CodecaError(
      'fetch_indisponivel',
      'Nenhuma implementacao de fetch disponivel. Informe `fetch` ao criar o cliente.',
      0,
    );
  }

  return async function request<T>(
    path: string,
    init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Respeita um cancelamento vindo de fora sem perder o prazo proprio.
    init.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${options.token}`,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
    } catch (causa) {
      throw new CodecaError(
        'falha_de_rede',
        causa instanceof Error && causa.name === 'AbortError'
          ? `A plataforma nao respondeu em ${timeoutMs} ms.`
          : 'Nao foi possivel contatar a plataforma.',
        0,
        causa,
      );
    } finally {
      clearTimeout(timer);
    }

    const texto = await response.text();
    let corpo: unknown = null;
    if (texto) {
      try {
        corpo = JSON.parse(texto);
      } catch {
        corpo = texto;
      }
    }

    if (!response.ok) {
      const erro = (corpo as { error?: { code?: string; message?: string; details?: unknown } })?.error;
      throw new CodecaError(
        erro?.code ?? 'erro_http',
        erro?.message ?? `A plataforma respondeu ${response.status}.`,
        response.status,
        erro?.details,
      );
    }

    // A API responde `{ data: ... }`; o site recebe o conteudo direto.
    return (corpo as { data?: T })?.data as T;
  };
}

export type Transport = ReturnType<typeof createTransport>;
