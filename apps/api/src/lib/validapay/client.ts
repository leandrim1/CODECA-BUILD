import { AppError } from '@codeca/shared';
import type { Env } from '../../env.js';
import type { TokenResponse } from './types.js';

/**
 * Cliente HTTP da ValidaPay.
 *
 * Autenticacao OAuth2 `client_credentials`: o par client_id/client_secret e
 * trocado por um `access_token` em `POST /auth/token`, num host proprio
 * (`oauth2.validapay.com.br`), diferente do host da API. O token fica em
 * memoria do processo, com margem antes do vencimento -- e so cache: se a
 * funcao serverless for reciclada, o proximo pedido obtem outro.
 *
 * Nada aqui registra o client_secret, o token ou o corpo das respostas: os logs
 * trazem metodo, caminho, status e o codigo de erro devolvido pela API.
 */

export interface ValidaPayCredentials {
  clientId: string;
  clientSecret: string;
  /** Host da API: `https://api.validapay.com.br` ou o de sandbox. */
  baseUrl: string;
  /** Host do OAuth2, quando diferente do padrao derivado de `baseUrl`. */
  authUrl: string;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** Escopos exigidos pela rota; entram no pedido do token. */
  scope: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Tentativas totais para falhas transitorias. Padrao 3. */
  attempts?: number;
  timeoutMs?: number;
}

/** Erro devolvido pela API, no envelope documentado. */
export interface ProviderErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

export class ValidaPayError extends Error {
  constructor(
    readonly status: number,
    readonly providerCode: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ValidaPayError';
  }

  /** `true` para falhas em que repetir a chamada pode funcionar. */
  get transient(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
/** Espera entre tentativas, em ms. Curta: o limite do webhook e de 5 s. */
const BACKOFF_MS = [250, 750];

interface CachedToken {
  token: string;
  expiresAt: number;
  scope: string;
}

export class ValidaPayClient {
  private tokens = new Map<string, CachedToken>();

  constructor(private readonly credentials: ValidaPayCredentials) {}

  /** Troca as credenciais por um token com os escopos pedidos. */
  private async accessToken(scope: string): Promise<string> {
    const cached = this.tokens.get(scope);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      scope,
    });

    const response = await this.fetchWithTimeout(`${this.credentials.authUrl}/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    }, DEFAULT_TIMEOUT_MS);

    if (!response.ok) {
      // Nunca repetir o corpo: ele pode ecoar a credencial enviada.
      throw new ValidaPayError(
        response.status,
        'AUTH_FAILED',
        `Nao foi possivel autenticar na ValidaPay (HTTP ${response.status}). `
          + 'Confira VALIDAPAY_CLIENT_ID, VALIDAPAY_CLIENT_SECRET e os escopos da credencial.',
      );
    }

    const data = (await response.json()) as TokenResponse;
    if (!data.access_token) {
      throw new ValidaPayError(502, 'AUTH_INVALID_RESPONSE', 'A ValidaPay nao devolveu um token.');
    }

    const ttlMs = Math.max(0, (data.expires_in ?? 3600) * 1000 - TOKEN_EXPIRY_MARGIN_MS);
    this.tokens.set(scope, { token: data.access_token, expiresAt: Date.now() + ttlMs, scope });
    return data.access_token;
  }

  /** Descarta o token de um escopo: usado quando a API responde 401. */
  private forgetToken(scope: string): void {
    this.tokens.delete(scope);
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const attempts = Math.max(1, options.attempts ?? 3);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const url = this.buildUrl(options.path, options.query);

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const token = await this.accessToken(options.scope);
        const response = await this.fetchWithTimeout(
          url,
          {
            method: options.method,
            headers: {
              authorization: `Bearer ${token}`,
              accept: 'application/json',
              ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
            },
            ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
          },
          timeoutMs,
        );

        if (response.status === 401 && attempt < attempts) {
          // Token vencido antes da margem: renova e tenta de novo.
          this.forgetToken(options.scope);
          lastError = new ValidaPayError(401, 'UNAUTHORIZED', 'Token recusado pela ValidaPay.');
          continue;
        }

        if (!response.ok) {
          const error = await this.readError(response);
          if (error.transient && attempt < attempts) {
            lastError = error;
            await this.wait(attempt, response.headers.get('retry-after'));
            continue;
          }
          throw error;
        }

        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      } catch (error) {
        const retriable =
          error instanceof ValidaPayError
            ? error.transient
            : isNetworkError(error);
        if (!retriable || attempt >= attempts) {
          this.logFailure(options, error);
          throw toAppError(error);
        }
        lastError = error;
        await this.wait(attempt, null);
      }
    }

    this.logFailure(options, lastError);
    throw toAppError(lastError);
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, this.credentials.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async readError(response: Response): Promise<ValidaPayError> {
    let code = `HTTP_${response.status}`;
    let message = `A ValidaPay respondeu HTTP ${response.status}.`;
    let details: unknown;
    try {
      const body = (await response.json()) as ProviderErrorBody;
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
      details = body.error?.details ?? undefined;
    } catch {
      // Resposta sem JSON: a mensagem generica acima e suficiente.
    }
    return new ValidaPayError(response.status, code, message, details);
  }

  private async wait(attempt: number, retryAfter: string | null): Promise<void> {
    const headerMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
    const delay = Number.isFinite(headerMs) && headerMs > 0
      ? Math.min(headerMs, 5_000)
      : (BACKOFF_MS[attempt - 1] ?? 1_500);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Log operacional: rota e codigo do erro, nunca credencial ou payload. */
  private logFailure(options: RequestOptions, error: unknown): void {
    const code = error instanceof ValidaPayError ? `${error.status} ${error.providerCode}` : 'network';
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[validapay] ${options.method} ${options.path} falhou: ${code} -- ${message}`);
  }
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof ValidaPayError) return error.transient;
  if (error instanceof Error) {
    // `AbortError` (timeout) e falhas de DNS/conexao valem nova tentativa.
    return error.name === 'AbortError' || error.name === 'TypeError' || error.name === 'FetchError';
  }
  return false;
}

/** Traduz a falha do provedor para o erro padronizado da plataforma. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ValidaPayError) {
    // Erros de negocio documentados ganham mensagem propria em portugues.
    switch (error.providerCode) {
      case 'PRICE_INACTIVE':
        return AppError.conflict(
          'O plano escolhido esta inativo no provedor de pagamento. Sincronize o plano antes de contratar.',
          { providerCode: error.providerCode },
        );
      case 'PRICE_NOT_FOUND':
        return AppError.conflict(
          'O plano ainda nao foi sincronizado com o provedor de pagamento.',
          { providerCode: error.providerCode },
        );
      case 'PIX_AUTOMATICO_PJ_ONLY':
        return AppError.badRequest(
          'O Pix Automatico exige que a conta ValidaPay da plataforma seja PJ (CNPJ). '
            + 'Escolha outra forma de pagamento.',
          { providerCode: error.providerCode },
        );
      case 'PIX_AUTOMATICO_MIN_AMOUNT':
        return AppError.badRequest(
          'O Pix Automatico exige valor minimo de R$ 4,99 por cobranca.',
          { providerCode: error.providerCode },
        );
      case 'PIX_AUTOMATICO_FIXED_AMOUNT':
        return AppError.conflict(
          'A autorizacao de Pix Automatico deste cliente e de valor fixo: a troca de plano exige uma '
            + 'nova autorizacao. Troque a forma de pagamento para continuar.',
          { providerCode: error.providerCode },
        );
      case 'RECURRENCE_CHANGE_REQUIRES_NEW_ADHESION':
        return AppError.conflict(
          'Mudar a periodicidade no Pix Automatico exige uma nova autorizacao do pagador.',
          { providerCode: error.providerCode },
        );
      case 'SUBSCRIPTION_ALREADY_CANCELED':
        return AppError.conflict('Esta assinatura ja esta cancelada.', {
          providerCode: error.providerCode,
        });
      case 'SUBSCRIPTION_NOT_FOUND':
        return AppError.notFound('Assinatura nao encontrada no provedor de pagamento.');
      case 'CHARGE_NOT_FOUND':
        return AppError.notFound('Cobranca nao encontrada no provedor de pagamento.');
      case 'PAYMENT_DECLINED':
      case 'PAYMENT_FAILED':
        return AppError.badRequest(
          'O pagamento foi recusado. Tente outra forma de pagamento ou outro cartao.',
          { providerCode: error.providerCode },
        );
      case 'AUTH_FAILED':
        return AppError.notConfigured(error.message);
      default:
        break;
    }

    if (error.status === 403) {
      return AppError.notConfigured(
        'A credencial da ValidaPay nao tem permissao para esta operacao. Revise os escopos '
          + '(products, checkouts, subscriptions e charges) na credencial configurada.',
      );
    }
    if (error.status >= 400 && error.status < 500) {
      return AppError.badRequest(error.message, { providerCode: error.providerCode });
    }
    return new AppError(
      'upstream_error',
      'O provedor de pagamento esta indisponivel agora. Tente novamente em instantes.',
      { providerCode: error.providerCode },
    );
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new AppError(
      'upstream_error',
      'O provedor de pagamento nao respondeu no tempo esperado. Tente novamente.',
    );
  }

  return new AppError('upstream_error', 'Falha de comunicacao com o provedor de pagamento.');
}

/** Hosts padrao por ambiente, conforme a documentacao. */
export const VALIDAPAY_HOSTS = {
  production: { api: 'https://api.validapay.com.br', auth: 'https://oauth2.validapay.com.br' },
  sandbox: { api: 'https://sandbox.validapay.com.br', auth: 'https://oauth2-sandbox.validapay.com.br' },
} as const;

/**
 * Deriva o host do OAuth2 a partir do host da API quando `VALIDAPAY_AUTH_URL`
 * nao e informado: sandbox e producao usam hosts diferentes para cada um.
 */
export function resolveAuthUrl(env: Env): string {
  if (env.VALIDAPAY_AUTH_URL) return env.VALIDAPAY_AUTH_URL.replace(/\/$/, '');
  const base = (env.VALIDAPAY_BASE_URL ?? VALIDAPAY_HOSTS.production.api).replace(/\/$/, '');
  if (base === VALIDAPAY_HOSTS.sandbox.api) return VALIDAPAY_HOSTS.sandbox.auth;
  if (base === VALIDAPAY_HOSTS.production.api) return VALIDAPAY_HOSTS.production.auth;
  // Host personalizado: exige a variavel explicita, em vez de adivinhar.
  throw new AppError(
    'integration_not_configured',
    `VALIDAPAY_BASE_URL aponta para ${base}: defina tambem VALIDAPAY_AUTH_URL com o host do OAuth2.`,
  );
}
