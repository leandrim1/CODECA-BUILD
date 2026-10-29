import { AppError, type PlatformCapability, type TenantCapability } from '@codeca/shared';
import type { MiddlewareHandler } from 'hono';
import { readSessionToken } from '../lib/cookies.js';
import { assertCsrfToken, assertSameOrigin, isStateChanging } from '../lib/csrf.js';
import { resolveSession, touchSession } from '../lib/session.js';
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
      session = await resolveSession(ctx.db, ctx.env, token, ctx.now());
    }
    c.set('session', session);

    if (session && isStateChanging(c.req.method)) {
      assertSameOrigin(c, ctx.env);
      assertCsrfToken(c, ctx.env, session.csrfTokenHash);
    }

    await next();

    // Atualiza o ultimo uso somente em requisicoes bem-sucedidas.
    if (session && c.res.status < 400) {
      await touchSession(ctx.db, session.sessionId, ctx.now());
    }
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
        'Confirme o seu e-mail para liberar esta operacao. Reenvie a confirmacao pelo painel.',
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
    const tenant = await resolveTenantContext(ctx.db, session, tenantId, ctx.now());
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
