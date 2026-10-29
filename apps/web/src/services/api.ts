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

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Envia FormData em vez de JSON (upload de arquivos). */
  formData?: FormData;
  signal?: AbortSignal;
  /** Resposta em texto puro (CSV, XML). */
  raw?: boolean;
}

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

  let response: Response;
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
    throw new ApiError(0, 'network_error', 'Falha de conexao. Verifique sua internet e tente novamente.');
  }

  if (response.status === 204) return undefined as T;

  if (options.raw) {
    const text = await response.text();
    if (!response.ok) {
      throw new ApiError(response.status, 'internal_error', 'Nao foi possivel concluir a operacao.');
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
    throw new ApiError(
      response.status,
      error?.code ?? 'internal_error',
      error?.message ?? 'Nao foi possivel concluir a operacao.',
      error?.details,
    );
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
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
};
