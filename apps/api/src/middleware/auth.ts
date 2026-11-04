import { AppError, type PlatformCapability, type TenantCapability } from '@codeca/shared';
import type { MiddlewareHandler } from 'hono';
import { readSessionToken } from '../lib/cookies.js';
import { assertCsrfToken, assertSameOrigin, isStateChanging } from '../lib/csrf.js';
import { hashToken } from '@codeca/shared/server';
import { resolveSession, sessionNeedsTouch, touchSession } from '../lib/session.js';
import {
  assertPlatformCapability,
  assertTenantCapability,
  resolveTenantContext,
} from '../lib/authz.js';
import { parseParams } from '../lib/http.js';
import { tenantIdParamSchema } from '@codeca/shared';
import type { AppBindings } from '../types.js';

/**
 * Autenticacao, CSRF e resolucao de empresa.
 *
 * A ordem importa: a sessao e resolvida primeiro, o CSRF e conferido contra a
 * sessao encontrada e so depois a empresa da rota e validada contra os vinculos
 * reais do usuario.
 */

/** Resolve a sessao quando houver cookie, sem exigir autenticacao. */
export function sessionMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const ctx = c.get('ctx');
    const token = readSessionToken(c);
    let session = null;

    if (token) {
      const tokenHash = hashToken(token, ctx.env.AUTH_SECRET);
      const now = ctx.now();
      // Uma consulta por sessao a cada `AUTH_CACHE_TTL`, e uma so mesmo com muitas
      // requisicoes simultaneas (o cache deduplica). Ver `lib/caches.ts`.
      session = await ctx.caches.session.getOrLoad(tokenHash, () => resolveSession(ctx.db, ctx.env, token, now));
      // Uma sessao guardada que venceu nao pode continuar valendo.
      if (session && session.expiresAt.getTime() <= now.getTime()) {
        ctx.caches.invalidateSession(tokenHash);
        session = null;
      }
    }
    c.set('session', session);

    if (session && isStateChanging(c.req.method)) {
      assertSameOrigin(c, ctx.env);
      assertCsrfToken(c, ctx.env, session.csrfTokenHash);
    }

    await next();

    // O "ultimo uso" e regravado so de tempos em tempos, nao a cada requisicao.
    if (session && c.res.status < 400 && sessionNeedsTouch(session, ctx.now())) {
      const now = ctx.now();
      await touchSession(ctx.db, session.sessionId, now);
      session.lastUsedAt = now;
    }
  };
}

/**
 * Descarta, ao fim de uma escrita bem-sucedida, o que os caches desta instancia
 * guardam sobre a empresa afetada.
 *
 * Fica num middleware unico, e nao em cada rota, para que **nenhuma** escrita
 * possa esquecer: nova rota, novo cache, mesma garantia. Escrita no painel mestre
 * (plano, segmento, chave, papel) pode afetar qualquer empresa, entao esvazia tudo.
 *
 * So alcanca esta instancia; as outras convergem em ate a validade dos caches.
 */
export function invalidateCachesOnWrite(scope: 'tenant' | 'platform'): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    await next();
    // 4xx = recusada antes de gravar, nada mudou. 5xx pode ter gravado parte
    // antes de falhar: invalidar e o lado seguro.
    if (!isStateChanging(c.req.method) || (c.res.status >= 400 && c.res.status < 500)) return;
    const { caches } = c.get('ctx');
    if (scope === 'platform') {
      caches.invalidateAll();
      return;
    }
    const tenant = c.get('tenant');
    if (tenant) caches.invalidateTenant(tenant.tenantId, tenant.siteId);
  };
}

export function requireAuth(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const session = c.get('session');
    if (!session) throw AppError.unauthenticated('Faca login para continuar.');
    await next();
  };
}

/**
 * Exige e-mail verificado. Aplicado a operacoes sensiveis (publicacao,
 * dominios, equipe) e nao a leitura do painel, para que o usuario possa
 * acompanhar o estado da conta antes de confirmar o e-mail.
 */
export function requireVerifiedEmail(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const session = c.get('session');
    if (!session) throw AppError.unauthenticated('Faca login para continuar.');
    if (!session.user.emailVerified) {
      throw new AppError(
        'email_not_verified',
        'Confirme o seu e-mail para liberar esta operação. Reenvie a confirmação pelo painel.',
      );
    }
    await next();
  };
}

/** Resolve `:tenantId` da rota e valida o vinculo do usuario. */
export function tenantMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const ctx = c.get('ctx');
    const session = c.get('session');
    if (!session) throw AppError.unauthenticated('Faca login para continuar.');

    const { tenantId } = parseParams(c, tenantIdParamSchema);
    // Chave = empresa + usuario: um usuario nunca recebe o vinculo de outro.
    const tenant = await ctx.caches.tenant.getOrLoad(`${tenantId}:${session.user.id}`, () =>
      resolveTenantContext(ctx.db, session, tenantId, ctx.now()),
    );
    c.set('tenant', tenant);
    await next();
  };
}

/** Exige uma capacidade dentro da empresa resolvida. */
export function requireCapability(capability: TenantCapability): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    assertTenantCapability(c.get('tenant'), capability);
    await next();
  };
}

/** Exige uma capacidade global do painel mestre. */
export function requirePlatform(capability: PlatformCapability): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const session = c.get('session');
    if (!session) throw AppError.unauthenticated('Faca login para continuar.');
    assertPlatformCapability(session, capability);
    await next();
  };
}

/** Sessao garantida pelas rotas que usam `requireAuth`. */
export function sessionOf(c: Parameters<MiddlewareHandler<AppBindings>>[0]) {
  const session = c.get('session');
  if (!session) throw AppError.unauthenticated('Faca login para continuar.');
  return session;
}
