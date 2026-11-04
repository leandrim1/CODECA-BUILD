import { createHash, createHmac } from 'node:crypto';
import type {
  AnalyticsPropertyOption,
  AnalyticsRange,
  AnalyticsReport,
} from '@codeca/shared';
import { GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL } from '../google-oauth.js';

/**
 * Cliente do Google para a integracao com o Analytics 4.
 *
 * Independente de `google-oauth.ts` (login): este arquivo so reaproveita as
 * URLs dos endpoints do Google. Escopo, PKCE, `state` e callback sao proprios.
 *
 * Tudo roda no servidor. Nenhum token passa pelo navegador, e nenhum token e
 * escrito em log: as mensagens de erro carregam so o codigo/estado HTTP.
 */

export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const ADMIN_API = 'https://analyticsadmin.googleapis.com/v1beta';
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
const TIMEOUT_MS = 12_000;

export type AnalyticsFailure =
  /** O Google recusou o codigo ou o token (concessao revogada, vencida...). */
  | 'revoked'
  /** O consentimento nao incluiu a leitura do Analytics. */
  | 'scope_missing'
  | 'no_refresh_token'
  /** Analytics Data API / Admin API desativada no projeto do Google Cloud. */
  | 'api_disabled'
  /** A conta Google nao tem acesso a esta propriedade. */
  | 'no_access'
  | 'quota'
  | 'unavailable'
  | 'failed';

export class AnalyticsGoogleError extends Error {
  constructor(
    public readonly code: AnalyticsFailure,
    message: string,
  ) {
    super(message);
    this.name = 'AnalyticsGoogleError';
  }
}

// ------------------------------------------------------------------ PKCE

const b64url = (buffer: Buffer): string => buffer.toString('base64url');

/** Derivado do `state` e do segredo: nunca guardado nem enviado ao navegador. */
export function analyticsPkceVerifier(secret: string, state: string): string {
  return b64url(createHmac('sha256', secret).update(`analytics-pkce-verifier:${state}`).digest());
}

export function analyticsPkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

// -------------------------------------------------------- autorizacao

export function buildAnalyticsAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    // SOMENTE leitura do Analytics. Sem `openid`, e-mail ou perfil.
    scope: ANALYTICS_SCOPE,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    // `offline` + `consent`: o Google so devolve o refresh token quando a
    // pessoa consente de novo; sem ele a conexao morreria em 1 hora.
    access_type: 'offline',
    prompt: 'consent',
    // Nao mistura com o que o login ja obteve.
    include_granted_scopes: 'false',
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

async function postToken(
  fetchImpl: typeof globalThis.fetch,
  body: Record<string, string>,
): Promise<{ status: number; json: TokenResponse & { error?: unknown } }> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AnalyticsGoogleError('unavailable', 'O Google não respondeu.');
  }
  if (response.status >= 500) {
    throw new AnalyticsGoogleError('unavailable', `O Google está indisponível (HTTP ${response.status}).`);
  }
  const json = ((await response.json().catch(() => null)) ?? {}) as TokenResponse & { error?: unknown };
  return { status: response.status, json };
}

export interface AnalyticsTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scope: string;
}

export async function exchangeAnalyticsCode(
  fetchImpl: typeof globalThis.fetch,
  input: { clientId: string; clientSecret: string; redirectUri: string; code: string; codeVerifier: string },
): Promise<AnalyticsTokens> {
  const { status, json } = await postToken(fetchImpl, {
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: input.codeVerifier,
  });
  if (status < 200 || status >= 300) {
    throw new AnalyticsGoogleError('revoked', `O Google recusou o código (HTTP ${status}).`);
  }
  const scope = typeof json.scope === 'string' ? json.scope : '';
  if (typeof json.access_token !== 'string' || !json.access_token) {
    throw new AnalyticsGoogleError('failed', 'O Google não devolveu o token de acesso.');
  }
  // O consentimento e granular: a pessoa pode desmarcar a permissao.
  if (!scope.split(/\s+/).includes(ANALYTICS_SCOPE)) {
    throw new AnalyticsGoogleError('scope_missing', 'A leitura do Google Analytics não foi autorizada.');
  }
  if (typeof json.refresh_token !== 'string' || !json.refresh_token) {
    throw new AnalyticsGoogleError('no_refresh_token', 'O Google não concedeu o token de renovação.');
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSeconds: typeof json.expires_in === 'number' ? json.expires_in : 3600,
    scope,
  };
}

export async function refreshAnalyticsAccessToken(
  fetchImpl: typeof globalThis.fetch,
  input: { clientId: string; clientSecret: string; refreshToken: string },
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const { status, json } = await postToken(fetchImpl, {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: 'refresh_token',
  });
  if (status === 400 || status === 401) {
    // `invalid_grant`: acesso revogado pela pessoa, senha trocada, token vencido
    // (app em teste) ou desuso prolongado. A conexao precisa ser refeita.
    throw new AnalyticsGoogleError('revoked', `O Google recusou a renovação (${String(json.error ?? status)}).`);
  }
  if (status < 200 || status >= 300 || typeof json.access_token !== 'string' || !json.access_token) {
    throw new AnalyticsGoogleError('failed', `Falha ao renovar o acesso (HTTP ${status}).`);
  }
  return {
    accessToken: json.access_token,
    expiresInSeconds: typeof json.expires_in === 'number' ? json.expires_in : 3600,
  };
}

/** Revoga a concessao no Google. Melhor esforco: nunca impede a desconexao local. */
export async function revokeAnalyticsToken(fetchImpl: typeof globalThis.fetch, token: string): Promise<boolean> {
  try {
    const response = await fetchImpl(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- APIs

async function googleGet<T>(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  accessToken: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AnalyticsGoogleError('unavailable', 'O Google Analytics não respondeu.');
  }
  if (response.ok) return (await response.json()) as T;

  const body = (await response.json().catch(() => null)) as {
    error?: { status?: string; message?: string; details?: Array<{ reason?: string }> };
  } | null;
  const reason = body?.error?.details?.find((d) => d.reason)?.reason ?? '';
  const status = body?.error?.status ?? '';

  if (response.status === 401) throw new AnalyticsGoogleError('revoked', 'O acesso ao Google foi recusado.');
  if (reason === 'SERVICE_DISABLED' || reason === 'ACCESS_NOT_CONFIGURED') {
    throw new AnalyticsGoogleError('api_disabled', 'A API do Google Analytics está desativada no projeto.');
  }
  if (response.status === 403 || status === 'PERMISSION_DENIED') {
    throw new AnalyticsGoogleError('no_access', 'A conta Google não tem acesso a esta propriedade.');
  }
  if (response.status === 429 || status === 'RESOURCE_EXHAUSTED') {
    throw new AnalyticsGoogleError('quota', 'Limite de consultas do Google Analytics atingido. Tente em instantes.');
  }
  if (response.status >= 500) {
    throw new AnalyticsGoogleError('unavailable', `O Google Analytics está indisponível (HTTP ${response.status}).`);
  }
  throw new AnalyticsGoogleError('failed', `O Google Analytics recusou a consulta (HTTP ${response.status}).`);
}

/** Propriedades GA4 a que a conta conectada tem acesso. */
export async function listAnalyticsProperties(
  fetchImpl: typeof globalThis.fetch,
  accessToken: string,
): Promise<AnalyticsPropertyOption[]> {
  interface Summaries {
    accountSummaries?: Array<{
      displayName?: string;
      propertySummaries?: Array<{ property?: string; displayName?: string }>;
    }>;
    nextPageToken?: string;
  }
  const options: AnalyticsPropertyOption[] = [];
  let pageToken = '';
  // Teto de paginas: uma conta com milhares de propriedades nao trava a requisicao.
  for (let page = 0; page < 5; page += 1) {
    const url = `${ADMIN_API}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await googleGet<Summaries>(fetchImpl, url, accessToken);
    for (const account of data.accountSummaries ?? []) {
      for (const property of account.propertySummaries ?? []) {
        const id = /^properties\/(\d+)$/.exec(property.property ?? '')?.[1];
        if (!id) continue;
        options.push({
          propertyId: id,
          propertyName: (property.displayName ?? `Propriedade ${id}`).slice(0, 200),
          accountName: (account.displayName ?? '').slice(0, 200),
        });
      }
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return options;
}

const RANGE_DAYS: Record<AnalyticsRange, number> = { '7d': 7, '28d': 28, '90d': 90 };

interface RunReportResponse {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
}

const num = (value: string | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** `20260315` -> `2026-03-15`. */
const isoDate = (value: string): string => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

/**
 * Cinco relatorios numa unica chamada (`batchRunReports`): totais, serie diaria,
 * paginas, canais e dispositivos. Uma ida ao Google por tela, nao cinco.
 */
export async function fetchAnalyticsReport(
  fetchImpl: typeof globalThis.fetch,
  accessToken: string,
  input: { propertyId: string; propertyName: string; range: AnalyticsRange; now: Date },
): Promise<AnalyticsReport> {
  const dateRanges = [{ startDate: `${RANGE_DAYS[input.range]}daysAgo`, endDate: 'today' }];
  const data = await googleGet<{ reports?: RunReportResponse[] }>(
    fetchImpl,
    `${DATA_API}/properties/${input.propertyId}:batchRunReports`,
    accessToken,
    {
      method: 'POST',
      body: {
        requests: [
          {
            dateRanges,
            metrics: [
              { name: 'activeUsers' },
              { name: 'sessions' },
              { name: 'screenPageViews' },
              { name: 'engagementRate' },
              { name: 'averageSessionDuration' },
            ],
          },
          {
            dateRanges,
            dimensions: [{ name: 'date' }],
            metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
            orderBys: [{ dimension: { dimensionName: 'date' } }],
            limit: 100,
          },
          {
            dateRanges,
            dimensions: [{ name: 'pagePath' }],
            metrics: [{ name: 'screenPageViews' }],
            orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
            limit: 10,
          },
          {
            dateRanges,
            dimensions: [{ name: 'sessionDefaultChannelGroup' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 8,
          },
          {
            dateRanges,
            dimensions: [{ name: 'deviceCategory' }],
            metrics: [{ name: 'sessions' }],
            orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            limit: 5,
          },
        ],
      },
    },
  );

  const [totalsReport, dailyReport, pagesReport, channelsReport, devicesReport] = data.reports ?? [];
  const totalsRow = totalsReport?.rows?.[0]?.metricValues ?? [];

  return {
    range: input.range,
    propertyId: input.propertyId,
    propertyName: input.propertyName,
    totals: {
      activeUsers: num(totalsRow[0]?.value),
      sessions: num(totalsRow[1]?.value),
      pageViews: num(totalsRow[2]?.value),
      engagementRate: num(totalsRow[3]?.value),
      avgSessionSeconds: Math.round(num(totalsRow[4]?.value)),
    },
    daily: (dailyReport?.rows ?? []).map((row) => ({
      date: isoDate(row.dimensionValues?.[0]?.value ?? '00000000'),
      activeUsers: num(row.metricValues?.[0]?.value),
      sessions: num(row.metricValues?.[1]?.value),
      pageViews: num(row.metricValues?.[2]?.value),
    })),
    topPages: (pagesReport?.rows ?? []).map((row) => ({
      path: (row.dimensionValues?.[0]?.value ?? '/').slice(0, 300),
      views: num(row.metricValues?.[0]?.value),
    })),
    channels: (channelsReport?.rows ?? []).map((row) => ({
      channel: row.dimensionValues?.[0]?.value ?? '',
      sessions: num(row.metricValues?.[0]?.value),
    })),
    devices: (devicesReport?.rows ?? []).map((row) => ({
      device: row.dimensionValues?.[0]?.value ?? '',
      sessions: num(row.metricValues?.[0]?.value),
    })),
    generatedAt: input.now.toISOString(),
  };
}
