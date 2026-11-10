import type { AppErrorCode } from '@codeca/shared';

/**
 * Cliente da API.
 *
 * Responsabilidades: enviar o cookie de sessao, acrescentar o token anti-CSRF
 * lido do cookie legivel e transformar o envelope de erro do servidor em uma
 * excecao com codigo e mensagens por campo.
 *
 * Nenhum segredo vive aqui: a autenticacao e feita por cookie HttpOnly que o
 * JavaScript nao consegue ler.
 */

const CSRF_COOKIE = 'codeca_csrf';
const CSRF_HEADER = 'x-csrf-token';

export interface FieldErrors {
  [field: string]: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: AppErrorCode | 'network_error',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Mensagens por campo devolvidas pela validacao do servidor. */
  get fieldErrors(): FieldErrors {
    const fields = (this.details as { fields?: FieldErrors } | undefined)?.fields;
    return fields ?? {};
  }

  get isUnauthenticated(): boolean {
    return this.code === 'unauthenticated';
  }

  get isPlanLimit(): boolean {
    return this.code === 'plan_limit_reached' || this.code === 'storage_limit_reached';
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Observadores da camada de rede.
 *
 * Moram aqui, e nao no cache, para a dependencia correr num sentido so: o
 * cache conhece o cliente da API, e o cliente da API nao conhece o cache.
 */
type Listener = () => void;
const writeListeners = new Set<Listener>();
let unauthenticatedHandler: Listener | null = null;

/** Avisa a cada escrita bem-sucedida (POST, PATCH, PUT, DELETE). */
export function subscribeToWrites(listener: Listener): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

/**
 * Chamado quando uma consulta autenticada volta como "sem sessao".
 *
 * E a unica forma de a interface saber que a sessao expirou no meio do uso:
 * sem isto, cada tela mostraria o proprio erro e a moldura do painel
 * continuaria de pe, oferecendo um menu que nao leva a lugar nenhum.
 */
export function setUnauthenticatedHandler(handler: Listener | null): void {
  unauthenticatedHandler = handler;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Envia FormData em vez de JSON (upload de arquivos). */
  formData?: FormData;
  signal?: AbortSignal;
  /** Resposta em texto puro (CSV, XML). */
  raw?: boolean;
}

/** Leituras repetidas quando a API esta sobrecarregada ou a rede falhou. */
const GET_RETRIES = 2;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * Quanto esperar antes de repetir uma leitura.
 *
 * Respeita `Retry-After` (segundos) quando o servidor o manda, limitado a 5 s, e
 * soma um sorteio: sem ele, todos os navegadores recusados voltariam no mesmo
 * instante e recriariam a sobrecarga que provocou a recusa.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null, random = Math.random): number {
  const asked = retryAfter && /^\d+$/.test(retryAfter) ? Math.min(5, Number(retryAfter)) * 1000 : 0;
  const exponential = 250 * 2 ** attempt;
  return Math.round(Math.max(asked, exponential) + random() * 400);
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};

  if (method !== 'GET') {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  // So leituras sao repetidas: repetir uma escrita pode grava-la duas vezes.
  const retries = method === 'GET' ? GET_RETRIES : 0;
  let response: Response | undefined;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(path, {
        method,
        headers,
        body,
        // Necessario para que o cookie de sessao acompanhe a requisicao.
        credentials: 'include',
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (attempt < retries) {
        await wait(retryDelayMs(attempt, null), options.signal);
        continue;
      }
      throw new ApiError(0, 'network_error', 'Falha de conexão. Verifique sua internet e tente novamente.');
    }
    if (attempt < retries && RETRYABLE_STATUS.has(response.status)) {
      const delay = retryDelayMs(attempt, response.headers.get('retry-after'));
      await response.body?.cancel().catch(() => undefined);
      await wait(delay, options.signal);
      continue;
    }
    break;
  }

  if (response.ok && method !== 'GET') for (const listener of writeListeners) listener();

  if (response.status === 204) return undefined as T;

  if (options.raw) {
    const text = await response.text();
    if (!response.ok) {
      throw new ApiError(response.status, 'internal_error', opaqueErrorMessage(response.status));
    }
    return text as T;
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: AppErrorCode; message?: string; details?: unknown } } | null)
      ?.error;
    const failure = new ApiError(
      response.status,
      error?.code ?? 'internal_error',
      error?.message ?? opaqueErrorMessage(response.status),
      error?.details,
    );
    // Consultar a sessao e entrar respondem "sem sessao" de forma esperada; em
    // qualquer outra rota isso significa que a sessao acabou no meio do uso.
    // Erro de codigo e senha errada tambem chegam como 401, e nao significam sessao expirada.
    const expected =
      path === '/api/auth/session' || path === '/api/auth/login' || path.startsWith('/api/auth/code/');
    if (failure.isUnauthenticated && !expected) unauthenticatedHandler?.();
    throw failure;
  }

  return (payload as { data?: T })?.data as T;
}

/** Monta a query string ignorando valores vazios. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', ...(body !== undefined ? { body } : {}) }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', ...(body !== undefined ? { body } : {}) }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', ...(body !== undefined ? { body } : {}) }),
  /**
   * `DELETE` com corpo opcional.
   *
   * A exclusao da empresa manda o nome digitado e a senha. Em query string
   * isso cairia no log de acesso do servidor; no corpo, nao.
   */
  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE', ...(body !== undefined ? { body } : {}) }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
};

/**
 * Mensagem para uma resposta de erro que nao traz o nosso envelope JSON.
 *
 * Acontece quando a falha e anterior a aplicacao: funcao que nao iniciou,
 * rota inexistente, proxy ou limite da plataforma. Sem o codigo HTTP a tela
 * vira um beco sem saida ("nao foi possivel") e nao ha o que investigar, por
 * isso ele entra na mensagem junto de uma pista do que costuma causar.
 */
function opaqueErrorMessage(status: number): string {
  if (status === 404) {
    return 'Endereço não encontrado no servidor (404). Verifique a implantação da API.';
  }
  if (status === 413) {
    return 'O envio excedeu o tamanho aceito pelo servidor (413).';
  }
  if (status === 504 || status === 408) {
    return `O servidor demorou demais para responder (${status}). Tente novamente.`;
  }
  if (status >= 500) {
    return (
      `O servidor respondeu ${status} sem detalhes. Isso costuma indicar configuração `
      + 'incompleta na implantação; consulte /api/health.'
    );
  }
  return `Não foi possível concluir a operação (HTTP ${status}).`;
}
