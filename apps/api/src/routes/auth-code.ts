import { desc, eq, schema } from '@codeca/database';
import {
  AppError,
  LOGIN_CODE_INVALID_MESSAGE,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
  verifyLoginCodeSchema,
} from '@codeca/shared';
import { hashToken } from '@codeca/shared/server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { cookieSecure } from '../env.js';
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js';
import { setSessionCookies } from '../lib/cookies.js';
import { assertSameOrigin } from '../lib/csrf.js';
import { clientIp, noContent, ok, parseJsonBody, userAgent } from '../lib/http.js';
import { startLoginChallenge } from '../lib/login-challenge.js';
import {
  LOGIN_PENDING_COOKIE,
  LOGIN_PENDING_COOKIE_PATH,
  readPendingLogin,
  verifyLoginCode,
  type PendingLogin,
} from '../lib/login-code.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { createSession, resolveSession, serializeSession } from '../lib/session.js';
import type { AppBindings } from '../types.js';

/**
 * Segunda etapa do login: o codigo enviado por e-mail.
 *
 * ## O codigo NAO e uma porta de entrada
 *
 * Toda rota daqui exige o comprovante da primeira etapa (cookie HttpOnly emitido
 * depois da senha correta, ou do Google). Sem ele nada funciona: nao ha rota
 * publica para "pedir um codigo para este e-mail" e "e-mail + codigo" nunca
 * autentica. Isso tambem fecha os dois abusos que um pedido publico de codigo
 * traria: encher a caixa de entrada de qualquer pessoa e testar quais e-mails
 * tem conta.
 *
 * ## O codigo nunca aparece
 *
 * Nem na resposta, nem em log (o mailer de console o omite), nem na auditoria.
 *
 * ## Mesma sessao
 *
 * Vencida a segunda etapa, a sessao nasce em `createSession`, o mesmo caminho de
 * qualquer entrada: mesmo cookie, mesma expiracao, mesmo logout.
 */

export function codeAuthRoutes() {
  const app = new Hono<AppBindings>();

  // ---------------------------------------------------------- situacao atual
  // A tela chega aqui vindo do Google (um redirecionamento, sem corpo de resposta
  // que carregue o e-mail) e precisa saber o que mostrar.
  app.get('/pending', async (c) => {
    const ctx = c.get('ctx');
    const pending = requirePending(c);

    const [latest] = await ctx.db
      .select({ createdAt: schema.loginCodes.createdAt })
      .from(schema.loginCodes)
      .where(eq(schema.loginCodes.email, pending.email))
      .orderBy(desc(schema.loginCodes.createdAt))
      .limit(1);
    const elapsed = latest ? (ctx.now().getTime() - latest.createdAt.getTime()) / 1000 : LOGIN_CODE_RESEND_SECONDS;

    c.header('cache-control', 'no-store');
    return ok(c, {
      email: pending.email,
      resendAfterSeconds: Math.max(0, Math.ceil(LOGIN_CODE_RESEND_SECONDS - elapsed)),
      expiresInSeconds: LOGIN_CODE_TTL_MINUTES * 60,
    });
  });

  // ------------------------------------------------------------------ reenviar
  app.post('/resend', async (c) => {
    const ctx = c.get('ctx');
    assertSameOrigin(c, ctx.env);
    const pending = requirePending(c);
    const info = await startLoginChallenge(c, pending, { reuseRecentCode: false });
    return ok(c, { sent: true, ...info });
  });

  // ------------------------------------------------------------------ verificar
  app.post('/verify', async (c) => {
    const ctx = c.get('ctx');
    assertSameOrigin(c, ctx.env);
    const now = ctx.now();
    const ip = clientIp(c);
    const pending = requirePending(c);
    const input = await parseJsonBody(c, verifyLoginCodeSchema);

    await enforceRateLimit(ctx.db, RATE_LIMITS.loginCodeVerifyIp, rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET), now);
    await enforceRateLimit(ctx.db, RATE_LIMITS.loginCodeVerifyEmail, hashToken(pending.email, ctx.env.AUTH_SECRET), now);

    const result = await verifyLoginCode(ctx.db, ctx.env, { email: pending.email, code: input.code, now });
    if (!result.ok) {
      if (result.reason === 'exhausted') {
        await recordAudit(ctx.db, ctx.env, {
          actorUserId: pending.userId,
          actorEmail: pending.email,
          action: AUDIT_ACTIONS.userCodeBlocked,
          entityType: 'user',
          entityId: pending.userId,
          metadata: { reason: 'attempts_exhausted', method: pending.method },
          ip,
          userAgent: userAgent(c),
        });
      }
      // A mesma mensagem para codigo errado, vencido, usado ou inexistente.
      throw AppError.unauthenticated(LOGIN_CODE_INVALID_MESSAGE);
    }

    const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, pending.userId));
    if (!user || user.email !== pending.email) {
      clearPending(c);
      throw AppError.unauthenticated(LOGIN_CODE_INVALID_MESSAGE);
    }

    // O codigo acabou de provar que a pessoa controla esta caixa de entrada: so
    // agora o e-mail passa a ser "verificado".
    const patch: { lastLoginAt: Date; updatedAt: Date; emailVerifiedAt?: Date } = { lastLoginAt: now, updatedAt: now };
    if (!user.emailVerifiedAt) patch.emailVerifiedAt = now;
    await ctx.db.update(schema.users).set(patch).where(eq(schema.users.id, user.id));
    if (!user.emailVerifiedAt) {
      await recordAudit(ctx.db, ctx.env, {
        actorUserId: user.id,
        actorEmail: user.email,
        action: AUDIT_ACTIONS.userEmailVerified,
        entityType: 'user',
        entityId: user.id,
        metadata: { via: 'login_code' },
        ip,
      });
    }

    const issued = await createSession(ctx.db, ctx.env, {
      userId: user.id,
      rememberMe: pending.rememberMe,
      ip,
      userAgent: userAgent(c),
      now,
    });
    setSessionCookies(c, ctx.env, issued);
    clearPending(c);

    await recordAudit(ctx.db, ctx.env, {
      actorUserId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.userCodeLoggedIn,
      entityType: 'user',
      entityId: user.id,
      metadata: { method: pending.method },
      ip,
      userAgent: userAgent(c),
    });

    const resolved = await resolveSession(ctx.db, ctx.env, issued.sessionToken, now);
    c.header('cache-control', 'no-store');
    return ok(c, {
      status: 'authenticated' as const,
      session: resolved ? serializeSession(resolved) : null,
      csrfToken: issued.csrfToken,
      /** Destino pedido antes do login (so caminho interno, ja validado). */
      next: pending.next,
    });
  });

  // ------------------------------------------------------------------ cancelar
  // "Voltar" / "Entrar com outro e-mail": descarta a primeira etapa. Nao exige o
  // comprovante -- limpar o cookie nao concede nada a ninguem.
  app.post('/cancel', async (c) => {
    assertSameOrigin(c, c.get('ctx').env);
    clearPending(c);
    return noContent(c);
  });

  return app;
}

function requirePending(c: Context<AppBindings>): PendingLogin {
  const ctx = c.get('ctx');
  const pending = readPendingLogin(ctx.env, getCookie(c, LOGIN_PENDING_COOKIE), ctx.now());
  if (!pending) {
    throw AppError.unauthenticated('Sua verificação expirou. Entre novamente com o e-mail e a senha.');
  }
  return pending;
}

function clearPending(c: Context<AppBindings>): void {
  deleteCookie(c, LOGIN_PENDING_COOKIE, {
    path: LOGIN_PENDING_COOKIE_PATH,
    secure: cookieSecure(c.get('ctx').env),
  });
}
