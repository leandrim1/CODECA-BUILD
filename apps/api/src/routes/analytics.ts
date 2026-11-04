import { and, eq, schema } from '@codeca/database';
import {
  AppError,
  analyticsRangeQuerySchema,
  selectAnalyticsPropertySchema,
  type AnalyticsReport,
  type AnalyticsResult,
  type AnalyticsStatus,
} from '@codeca/shared';
import { constantTimeEquals } from '@codeca/shared/server';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { analyticsRedirectUri, cookieSecure } from '../env.js';
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { assertTenantCapability, resolveTenantContext, tenantCan } from '../lib/authz.js';
import { assertSameOrigin } from '../lib/csrf.js';
import { clientIp, noContent, ok, parseJsonBody, userAgent } from '../lib/http.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import {
  connectionAad,
  connectionView,
  dropConnectionCaches,
  encryptionKey,
  getAccessToken,
  loadConnection,
  mapGoogleError,
  sealRefreshToken,
} from '../lib/analytics/connection.js';
import {
  AnalyticsGoogleError,
  analyticsPkceChallenge,
  analyticsPkceVerifier,
  buildAnalyticsAuthorizationUrl,
  exchangeAnalyticsCode,
  fetchAnalyticsReport,
  listAnalyticsProperties,
  revokeAnalyticsToken,
} from '../lib/analytics/google.js';
import {
  ANALYTICS_STATE_COOKIE,
  ANALYTICS_STATE_COOKIE_PATH,
  ANALYTICS_STATE_TTL_MINUTES,
  consumeAnalyticsState,
  createAnalyticsState,
} from '../lib/analytics/oauth-state.js';
import { decryptSecret } from '../lib/secret-box.js';
import { requireCapability, requireVerifiedEmail, sessionMiddleware, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Integracao com o Google Analytics 4.
 *
 * ## Independente do login com Google
 *
 * Usa o mesmo cliente OAuth (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), mas
 * nada mais: fluxo, escopo (`analytics.readonly`), `state`, cookie, tabelas e
 * callback proprios. Nada em `routes/auth-google.ts` e tocado. A autorizacao so
 * e pedida quando o cliente clica em "Conectar Google Analytics".
 *
 * ## Quem e dono de que
 *
 * Uma conexao pertence a (empresa, site). A empresa vem SEMPRE da rota
 * autenticada (`/api/tenants/:tenantId/...`) e e conferida contra os vinculos do
 * usuario; no callback, que tem URL fixa, ela vem da linha de `state` gravada
 * quando o cliente clicou -- nunca da URL do retorno. O token fica cifrado no
 * banco, amarrado ao par (empresa, site).
 */

const PANEL_PATH = '/painel/estatisticas';

// -------------------------------------------------- rotas da empresa

export function analyticsRoutes() {
  const app = new Hono<AppBindings>();

  // Estado da integracao: o painel decide o que mostrar a partir daqui.
  app.get('/:tenantId/analytics', requireCapability('analytics:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const canManage = tenantCan(tenant, 'analytics:manage');
    const row = await loadConnection(ctx, tenant);

    const status: AnalyticsStatus = {
      available: ctx.features.googleAnalytics,
      canManage,
      redirectUri: canManage && ctx.features.googleAnalytics ? analyticsRedirectUri(ctx.env) : null,
      connection: row ? connectionView(row) : null,
    };
    return ok(c, status);
  });

  // Clique em "Conectar Google Analytics": so aqui a autorizacao e montada.
  app.post(
    '/:tenantId/analytics/connect/start',
    requireCapability('analytics:manage'),
    requireVerifiedEmail(),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const session = sessionOf(c);
      assertSameOrigin(c, ctx.env);
      encryptionKey(ctx); // 501 se a integracao nao esta configurada
      await enforceRateLimit(
        ctx.db,
        RATE_LIMITS.analyticsStart,
        rateLimitSubjectFromIp(clientIp(c), ctx.env.AUTH_SECRET),
        ctx.now(),
      );

      const state = await createAnalyticsState(ctx.db, ctx.env, {
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        userId: session.user.id,
        now: ctx.now(),
      });

      setCookie(c, ANALYTICS_STATE_COOKIE, state, {
        httpOnly: true,
        secure: cookieSecure(ctx.env),
        // Lax: o retorno do Google e uma navegacao de topo (GET).
        sameSite: 'Lax',
        path: ANALYTICS_STATE_COOKIE_PATH,
        maxAge: ANALYTICS_STATE_TTL_MINUTES * 60,
      });

      const authorizationUrl = buildAnalyticsAuthorizationUrl({
        clientId: ctx.env.GOOGLE_CLIENT_ID!,
        redirectUri: analyticsRedirectUri(ctx.env),
        state,
        codeChallenge: analyticsPkceChallenge(analyticsPkceVerifier(ctx.env.AUTH_SECRET, state)),
      });
      c.header('cache-control', 'no-store');
      return ok(c, { authorizationUrl });
    },
  );

  // Propriedades GA4 a que a conta conectada tem acesso.
  app.get('/:tenantId/analytics/properties', requireCapability('analytics:manage'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const row = await loadConnection(ctx, tenant);
    if (!row) throw AppError.notFound('Conecte o Google Analytics primeiro.');

    await enforceRateLimit(ctx.db, RATE_LIMITS.analyticsProperties, `tenant:${tenant.tenantId}`, ctx.now());
    try {
      const accessToken = await getAccessToken(ctx, row);
      return ok(c, { items: await listAnalyticsProperties(ctx.fetch, accessToken) });
    } catch (error) {
      throw mapGoogleError(error);
    }
  });

  // Vincula uma propriedade ao site. So aceita as que a conta de fato enxerga.
  app.put(
    '/:tenantId/analytics/property',
    requireCapability('analytics:manage'),
    requireVerifiedEmail(),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const input = await parseJsonBody(c, selectAnalyticsPropertySchema);
      const row = await loadConnection(ctx, tenant);
      if (!row) throw AppError.notFound('Conecte o Google Analytics primeiro.');

      await enforceRateLimit(ctx.db, RATE_LIMITS.analyticsProperties, `tenant:${tenant.tenantId}`, ctx.now());
      let chosen;
      try {
        const accessToken = await getAccessToken(ctx, row);
        const options = await listAnalyticsProperties(ctx.fetch, accessToken);
        chosen = options.find((option) => option.propertyId === input.propertyId);
      } catch (error) {
        throw mapGoogleError(error);
      }
      if (!chosen) throw AppError.validation('Esta propriedade não está disponível para a conta conectada.');

      const [updated] = await ctx.db
        .update(schema.analyticsConnections)
        .set({
          propertyId: chosen.propertyId,
          propertyName: chosen.propertyName,
          accountName: chosen.accountName,
          status: 'active',
          lastError: '',
          updatedAt: ctx.now(),
        })
        .where(
          and(
            eq(schema.analyticsConnections.id, row.id),
            eq(schema.analyticsConnections.tenantId, tenant.tenantId),
            eq(schema.analyticsConnections.siteId, tenant.siteId),
          ),
        )
        .returning();
      dropConnectionCaches(ctx, row);

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.analyticsPropertySelected,
        entityType: 'analytics_connection',
        entityId: row.id,
        metadata: { propertyId: chosen.propertyId, propertyName: chosen.propertyName },
      });
      return ok(c, { connection: updated ? connectionView(updated) : null });
    },
  );

  // Estatisticas do site. Uma ida ao Google por (conexao, propriedade, periodo)
  // a cada `ANALYTICS_CACHE_TTL_SECONDS`.
  app.get('/:tenantId/analytics/report', requireCapability('analytics:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { range } = analyticsRangeQuerySchema.parse(c.req.query());

    const row = await loadConnection(ctx, tenant);
    if (!row || row.status === 'pending_property' || !row.propertyId) {
      throw AppError.notFound('Nenhuma propriedade do Google Analytics foi escolhida para este site.');
    }
    const propertyId = row.propertyId;

    // A chave comeca por empresa e site: invalidar uma empresa nunca toca outra.
    const key = `${tenant.tenantId}:${tenant.siteId}:${propertyId}:${range}`;
    try {
      const report = await ctx.caches.analyticsReport.getOrLoad(key, async () => {
        await enforceRateLimit(ctx.db, RATE_LIMITS.analyticsReport, `tenant:${tenant.tenantId}`, ctx.now());
        const accessToken = await getAccessToken(ctx, row);
        return fetchAnalyticsReport(ctx.fetch, accessToken, {
          propertyId,
          propertyName: row.propertyName,
          range,
          now: ctx.now(),
        });
      });
      return ok(c, report as AnalyticsReport);
    } catch (error) {
      throw mapGoogleError(error);
    }
  });

  // Desconectar: revoga no Google (melhor esforco) e apaga a conexao.
  app.delete(
    '/:tenantId/analytics',
    requireCapability('analytics:manage'),
    requireVerifiedEmail(),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const row = await loadConnection(ctx, tenant);
      if (!row) throw AppError.notFound('Nenhuma conexão com o Google Analytics.');

      let revoked = false;
      try {
        const token = decryptSecret(encryptionKey(ctx), row.refreshTokenEnc, connectionAad(row));
        revoked = await revokeAnalyticsToken(ctx.fetch, token);
      } catch {
        // Sem chave ou token ilegivel: a conexao local e apagada de qualquer jeito.
      }

      await ctx.db
        .delete(schema.analyticsConnections)
        .where(
          and(
            eq(schema.analyticsConnections.id, row.id),
            eq(schema.analyticsConnections.tenantId, tenant.tenantId),
            eq(schema.analyticsConnections.siteId, tenant.siteId),
          ),
        );
      dropConnectionCaches(ctx, row);

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.analyticsDisconnected,
        entityType: 'analytics_connection',
        entityId: row.id,
        metadata: { propertyId: row.propertyId, revokedAtGoogle: revoked },
      });
      return noContent(c);
    },
  );

  return app;
}

// ------------------------------------------------------------ callback

/**
 * `GET /api/integrations/google-analytics/callback`: o retorno do Google.
 *
 * URL fixa (o Google exige), por isso fora de `/tenants/:tenantId`. Empresa e
 * site vem da linha de `state`; o usuario que volta tem que ser o mesmo que
 * clicou e ainda precisa poder gerenciar o Analytics naquela empresa.
 */
export function analyticsOAuthRoutes() {
  const app = new Hono<AppBindings>();
  app.use('*', sessionMiddleware());

  app.get('/callback', async (c) => {
    const ctx = c.get('ctx');
    const ip = clientIp(c);
    c.header('cache-control', 'no-store');

    // O cookie do `state` serve uma vez so, qualquer que seja o resultado.
    const cookieState = getCookie(c, ANALYTICS_STATE_COOKIE) ?? null;
    deleteCookie(c, ANALYTICS_STATE_COOKIE, { path: ANALYTICS_STATE_COOKIE_PATH, secure: cookieSecure(ctx.env) });

    const back = (code: AnalyticsResult) => c.redirect(`${PANEL_PATH}?analytics=${code}`, 302);

    try {
      await enforceRateLimit(
        ctx.db,
        RATE_LIMITS.analyticsCallback,
        rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET),
        ctx.now(),
      );
    } catch {
      return back('failed');
    }
    if (!ctx.features.googleAnalytics) return back('not_configured');

    const query = c.req.query();
    const state = query.state ?? '';

    // 1. A tentativa e esta mesma, neste mesmo navegador.
    if (!state || !cookieState || !constantTimeEquals(state, cookieState)) {
      return back('invalid_state');
    }
    const row = await consumeAnalyticsState(ctx.db, ctx.env, state, ctx.now());
    if (!row) return back('invalid_state');

    // 2. Quem volta e quem clicou, e ainda pode gerenciar esta empresa.
    const session = c.get('session');
    if (!session || session.user.id !== row.userId) {
      await blocked(c, row.tenantId, row.userId, 'session_mismatch');
      return back('session_mismatch');
    }
    try {
      const tenant = await resolveTenantContext(ctx.db, session, row.tenantId, ctx.now());
      assertTenantCapability(tenant, 'analytics:manage');
      if (tenant.siteId !== row.siteId) throw AppError.forbidden('Site diferente do que iniciou a conexão.');
    } catch {
      await blocked(c, row.tenantId, row.userId, 'forbidden');
      return back('forbidden');
    }

    // 3. A pessoa desistiu na tela do Google.
    if (query.error) return back(query.error === 'access_denied' ? 'cancelled' : 'failed');
    if (!query.code) return back('failed');

    // 4. Troca o codigo. Falha aqui nunca grava nada.
    try {
      const tokens = await exchangeAnalyticsCode(ctx.fetch, {
        clientId: ctx.env.GOOGLE_CLIENT_ID!,
        clientSecret: ctx.env.GOOGLE_CLIENT_SECRET!,
        redirectUri: analyticsRedirectUri(ctx.env),
        code: query.code,
        codeVerifier: analyticsPkceVerifier(ctx.env.AUTH_SECRET, state),
      });

      const scope = { tenantId: row.tenantId, siteId: row.siteId };
      const sealed = sealRefreshToken(ctx, scope, tokens.refreshToken);
      const existing = await loadConnection(ctx, scope);
      const now = ctx.now();

      // Reconectar depois de uma revogacao mantem a propriedade; conectar de novo
      // com a conexao ativa pode ser OUTRA conta Google, entao escolhe-se de novo.
      const keepProperty = existing?.status === 'needs_reconnect' && existing.propertyId !== null;

      const [saved] = await ctx.db
        .insert(schema.analyticsConnections)
        .values({
          tenantId: row.tenantId,
          siteId: row.siteId,
          status: 'pending_property',
          refreshTokenEnc: sealed,
          scope: tokens.scope,
          connectedByUserId: session.user.id,
          connectedAt: now,
          lastRefreshAt: now,
        })
        .onConflictDoUpdate({
          target: schema.analyticsConnections.siteId,
          set: {
            refreshTokenEnc: sealed,
            scope: tokens.scope,
            status: keepProperty ? 'active' : 'pending_property',
            ...(keepProperty ? {} : { propertyId: null, propertyName: '', accountName: '' }),
            connectedByUserId: session.user.id,
            connectedAt: now,
            lastRefreshAt: now,
            lastError: '',
            updatedAt: now,
          },
        })
        .returning({ id: schema.analyticsConnections.id });

      if (saved) dropConnectionCaches(ctx, { id: saved.id, ...scope });
      await recordAudit(ctx.db, ctx.env, {
        tenantId: row.tenantId,
        actorUserId: session.user.id,
        actorEmail: session.user.email,
        action: AUDIT_ACTIONS.analyticsConnected,
        entityType: 'analytics_connection',
        entityId: saved?.id ?? '',
        ip,
        userAgent: userAgent(c),
      });
      return back('connected');
    } catch (error) {
      // So a causa tecnica; nunca o codigo nem token.
      console.warn(`[analytics] falha ao concluir a conexão: ${error instanceof Error ? error.message : error}`);
      if (error instanceof AnalyticsGoogleError) {
        if (error.code === 'scope_missing') return back('scope_missing');
        if (error.code === 'no_refresh_token') return back('no_refresh_token');
      }
      return back('failed');
    }
  });

  return app;
}

async function blocked(
  c: import('hono').Context<AppBindings>,
  tenantId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const ctx = c.get('ctx');
  await recordAudit(ctx.db, ctx.env, {
    tenantId,
    actorUserId: userId,
    action: AUDIT_ACTIONS.analyticsBlocked,
    entityType: 'analytics_connection',
    entityId: '',
    metadata: { reason },
    ip: clientIp(c),
    userAgent: userAgent(c),
  });
}
