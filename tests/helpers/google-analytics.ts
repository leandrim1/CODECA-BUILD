import { createHash, randomBytes } from 'node:crypto';

/**
 * Google falso para os testes do Analytics.
 *
 * Reproduz o que importa: confere cliente, segredo, URL de retorno e PKCE na
 * troca do codigo; codigo de uso unico; escopo concedido configuravel (o
 * consentimento e granular); refresh token revogavel; contas com propriedades
 * proprias (a Data API recusa propriedade que a conta nao enxerga). Nenhuma
 * chamada de rede real acontece.
 */

export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
export const ANALYTICS_KEY = Buffer.alloc(32, 7).toString('base64');

export interface FakeProperty {
  id: string;
  name: string;
}

export interface FakeAccount {
  name: string;
  properties: FakeProperty[];
}

interface PendingCode {
  account: FakeAccount;
  challenge: string;
  redirectUri: string;
  scope: string;
  withRefresh: boolean;
  used: boolean;
}

export function createFakeAnalytics(options: { clientId: string; clientSecret: string }) {
  const codes = new Map<string, PendingCode>();
  const accessTokens = new Map<string, FakeAccount>();
  const refreshTokens = new Map<string, FakeAccount>();
  const revoked = new Set<string>();
  const calls: string[] = [];
  const state = {
    /** Responde "API desativada" nas APIs de dados. */
    apiDisabled: false,
    /** Desliga a renovacao (como se a pessoa tivesse revogado o acesso). */
    refreshFails: false,
    issuedAccessTokens: 0,
  };

  /** Simula a pessoa autorizando na tela do Google: devolve o `code` do retorno. */
  function authorize(
    authorizationUrl: string,
    account: FakeAccount,
    behavior: { scope?: string; withRefresh?: boolean } = {},
  ): { code: string; state: string } {
    const url = new URL(authorizationUrl);
    const code = randomBytes(12).toString('hex');
    codes.set(code, {
      account,
      challenge: url.searchParams.get('code_challenge') ?? '',
      redirectUri: url.searchParams.get('redirect_uri') ?? '',
      scope: behavior.scope ?? url.searchParams.get('scope') ?? '',
      withRefresh: behavior.withRefresh ?? true,
      used: false,
    });
    return { code, state: url.searchParams.get('state') ?? '' };
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const googleError = (status: number, body: Record<string, unknown>) => json({ error: body }, status);

  function accountOf(init: RequestInit | undefined): FakeAccount | null {
    const header = new Headers(init?.headers).get('authorization') ?? '';
    return accessTokens.get(header.replace(/^Bearer\s+/i, '')) ?? null;
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);

    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init?.body ?? ''));
      if (form.get('client_id') !== options.clientId || form.get('client_secret') !== options.clientSecret) {
        return json({ error: 'invalid_client' }, 401);
      }
      if (form.get('grant_type') === 'authorization_code') {
        const pending = codes.get(form.get('code') ?? '');
        if (!pending || pending.used) return json({ error: 'invalid_grant' }, 400);
        pending.used = true;
        const verifier = form.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        if (challenge !== pending.challenge || form.get('redirect_uri') !== pending.redirectUri) {
          return json({ error: 'invalid_grant' }, 400);
        }
        const access = `at-${(state.issuedAccessTokens += 1)}`;
        accessTokens.set(access, pending.account);
        const refresh = pending.withRefresh ? `rt-${randomBytes(8).toString('hex')}` : undefined;
        if (refresh) refreshTokens.set(refresh, pending.account);
        return json({
          access_token: access,
          expires_in: 3599,
          scope: pending.scope,
          token_type: 'Bearer',
          ...(refresh ? { refresh_token: refresh } : {}),
        });
      }
      if (form.get('grant_type') === 'refresh_token') {
        const token = form.get('refresh_token') ?? '';
        const account = refreshTokens.get(token);
        if (!account || revoked.has(token) || state.refreshFails) return json({ error: 'invalid_grant' }, 400);
        const access = `at-${(state.issuedAccessTokens += 1)}`;
        accessTokens.set(access, account);
        return json({ access_token: access, expires_in: 3599, token_type: 'Bearer' });
      }
      return json({ error: 'unsupported_grant_type' }, 400);
    }

    if (url === 'https://oauth2.googleapis.com/revoke') {
      const token = new URLSearchParams(String(init?.body ?? '')).get('token') ?? '';
      revoked.add(token);
      return json({});
    }

    if (url.startsWith('https://analyticsadmin.googleapis.com/v1beta/accountSummaries')) {
      const account = accountOf(init);
      if (!account) return googleError(401, { status: 'UNAUTHENTICATED' });
      if (state.apiDisabled) {
        return googleError(403, { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] });
      }
      return json({
        accountSummaries: [
          {
            displayName: account.name,
            propertySummaries: account.properties.map((p) => ({ property: `properties/${p.id}`, displayName: p.name })),
          },
        ],
      });
    }

    const report = /^https:\/\/analyticsdata\.googleapis\.com\/v1beta\/properties\/(\d+):batchRunReports$/.exec(url);
    if (report) {
      const account = accountOf(init);
      if (!account) return googleError(401, { status: 'UNAUTHENTICATED' });
      if (state.apiDisabled) {
        return googleError(403, { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] });
      }
      const propertyId = report[1]!;
      if (!account.properties.some((p) => p.id === propertyId)) {
        return googleError(403, { status: 'PERMISSION_DENIED' });
      }
      // Os numeros carregam o id da propriedade: um vazamento entre empresas
      // apareceria como o numero errado.
      const base = Number(propertyId.slice(-4)) || 1;
      const metric = (value: number) => ({ value: String(value) });
      return json({
        reports: [
          { rows: [{ metricValues: [metric(base), metric(base * 2), metric(base * 5), metric(0.62), metric(95.4)] }] },
          {
            rows: [
              { dimensionValues: [{ value: '20260314' }], metricValues: [metric(3), metric(4), metric(9)] },
              { dimensionValues: [{ value: '20260315' }], metricValues: [metric(5), metric(6), metric(11)] },
            ],
          },
          { rows: [{ dimensionValues: [{ value: `/propriedade-${propertyId}` }], metricValues: [metric(base)] }] },
          { rows: [{ dimensionValues: [{ value: 'Organic Search' }], metricValues: [metric(base)] }] },
          { rows: [{ dimensionValues: [{ value: 'mobile' }], metricValues: [metric(base)] }] },
        ],
      });
    }

    return new Response('not found', { status: 404 });
  };

  return { fetch, authorize, calls, state, revoked, refreshTokens, accessTokens };
}

export type FakeAnalytics = ReturnType<typeof createFakeAnalytics>;
