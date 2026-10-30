import { and, eq, isNull, schema, type Database } from '@codeca/database';
import {
  AppError,
  DEFAULT_GRACE_PERIOD_DAYS,
  TRIAL_PERIOD_DAYS,
  acceptInviteSchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  requestPasswordResetSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  slugify,
  uniqueSlug,
  updateProfileSchema,
  verifyEmailSchema,
} from '@codeca/shared';
import { hashPassword, verifyPassword } from '@codeca/shared/server';
import { Hono } from 'hono';
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js';
import { claimFirstPlatformAdmin } from '../lib/bootstrap.js';
import { clearSessionCookies, setSessionCookies } from '../lib/cookies.js';
import { assertSameOrigin } from '../lib/csrf.js';
import { clientIp, created, noContent, ok, parseJsonBody, userAgent } from '../lib/http.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { createSession, resolveSession, revokeAllUserSessions, revokeSession } from '../lib/session.js';
import { buildActionUrl, consumeUserToken, issueUserToken } from '../lib/tokens.js';
import { requireAuth, sessionMiddleware, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Autenticacao.
 *
 * Decisoes relevantes:
 * - A senha e guardada como hash scrypt com salt por senha.
 * - Login e cadastro tem rate limiting por IP e a conta e bloqueada
 *   temporariamente depois de varias tentativas erradas.
 * - As respostas de "esqueci minha senha" e de reenvio de confirmacao nao
 *   revelam se o e-mail existe.
 * - Trocar ou redefinir a senha encerra as outras sessoes do usuario.
 */

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export function authRoutes() {
  const app = new Hono<AppBindings>();
  app.use('*', sessionMiddleware());

  // ------------------------------------------------------------- cadastro
  app.post('/register', async (c) => {
    const ctx = c.get('ctx');
    const ip = clientIp(c);
    assertSameOrigin(c, ctx.env);
    await enforceRateLimit(ctx.db, RATE_LIMITS.register, rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET), ctx.now());

    const input = await parseJsonBody(c, registerSchema);

    const [existing] = await ctx.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, input.email));
    if (existing) {
      throw AppError.conflict('Ja existe uma conta com este e-mail. Faca login ou recupere a senha.');
    }

    const [trialPlan] = await ctx.db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(and(eq(schema.plans.code, 'trial'), eq(schema.plans.isActive, true)));
    if (!trialPlan) {
      throw AppError.internal('Nenhum plano inicial configurado. Rode o seed de planos.');
    }

    const slug = await nextTenantSlug(ctx.db, input.companySlug ?? input.companyName);
    const passwordHash = await hashPassword(input.password);

    const result = await ctx.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({ email: input.email, name: input.name, passwordHash, phone: input.phone })
        .returning({ id: schema.users.id, email: schema.users.email });
      if (!user) throw AppError.internal('Nao foi possivel criar a conta.');

      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          slug,
          legalName: input.companyName,
          displayName: input.companyName,
          planId: trialPlan.id,
          status: 'trialing',
          contactEmail: input.email,
          contactPhone: input.phone,
          address: {
            street: '',
            number: '',
            complement: '',
            neighborhood: '',
            city: '',
            state: '',
            postalCode: '',
            showFullAddress: true,
          },
        })
        .returning({ id: schema.tenants.id });
      if (!tenant) throw AppError.internal('Nao foi possivel criar a construtora.');

      await tx.insert(schema.memberships).values({
        tenantId: tenant.id,
        userId: user.id,
        role: 'owner',
        status: 'active',
        acceptedAt: ctx.now(),
      });

      // A avaliacao ja libera a publicacao: `accessUntil` e o campo que o
      // renderizador dos sites consulta, e vence sozinho quando o trial acaba.
      const trialEndsAt = new Date(ctx.now().getTime() + TRIAL_PERIOD_DAYS * 24 * 3600 * 1000);
      await tx.insert(schema.subscriptions).values({
        tenantId: tenant.id,
        planId: trialPlan.id,
        status: 'trialing',
        publicationState: 'allowed',
        trialEndsAt,
        accessUntil: trialEndsAt,
        currentPeriodStart: ctx.now(),
        currentPeriodEnd: trialEndsAt,
        gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
      });

      // Instalacao nova: a primeira conta assume o painel mestre. Dentro da
      // transacao, para que promocao e cadastro vivam ou morram juntos.
      const adminClaim = await claimFirstPlatformAdmin(
        tx as unknown as Database,
        { userId: user.id, email: user.email },
        ctx.env,
      );

      return {
        userId: user.id,
        tenantId: tenant.id,
        email: user.email,
        becamePlatformAdmin: adminClaim.claimed,
      };
    });

    const verification = await issueUserToken(ctx.db, ctx.env, {
      userId: result.userId,
      type: 'email_verification',
      now: ctx.now(),
    });
    const delivery = await ctx.mailer.send({
      to: result.email,
      kind: 'verify_email',
      subject: `Confirme seu e-mail - ${ctx.env.PLATFORM_NAME}`,
      text:
        `Ola, ${input.name}!\n\nConfirme seu e-mail para liberar a publicacao do site:\n`
        + `${buildActionUrl(ctx.env, '/confirmar-email', verification.token)}\n\n`
        + 'O link expira em 48 horas.',
    });

    const issued = await createSession(ctx.db, ctx.env, {
      userId: result.userId,
      rememberMe: false,
      ip,
      userAgent: userAgent(c),
      now: ctx.now(),
    });
    setSessionCookies(c, ctx.env, issued);

    await recordAudit(ctx.db, ctx.env, {
      tenantId: result.tenantId,
      actorUserId: result.userId,
      actorEmail: result.email,
      action: AUDIT_ACTIONS.userRegistered,
      entityType: 'tenant',
      entityId: result.tenantId,
      metadata: { companyName: input.companyName, slug },
      ip,
      userAgent: userAgent(c),
    });

    if (result.becamePlatformAdmin) {
      await recordAudit(ctx.db, ctx.env, {
        actorUserId: result.userId,
        actorEmail: result.email,
        action: AUDIT_ACTIONS.platformRoleChanged,
        entityType: 'user',
        entityId: result.userId,
        metadata: { platformRole: 'platform_admin', reason: 'primeira conta da instalacao' },
        ip,
        userAgent: userAgent(c),
      });
      console.info(
        `[bootstrap] ${result.email} assumiu o painel mestre por ser a primeira conta da instalacao.`,
      );
    }

    const session = await resolveSession(ctx.db, ctx.env, issued.sessionToken, ctx.now());
    return created(c, {
      session: session ? serializeSession(session) : null,
      csrfToken: issued.csrfToken,
      emailDelivery: { delivered: delivery.delivered, reason: delivery.reason ?? null },
      /** `true` quando esta conta assumiu o painel mestre da plataforma. */
      becamePlatformAdmin: result.becamePlatformAdmin,
    });
  });

  // ---------------------------------------------------------------- login
  app.post('/login', async (c) => {
    const ctx = c.get('ctx');
    const ip = clientIp(c);
    assertSameOrigin(c, ctx.env);
    await enforceRateLimit(ctx.db, RATE_LIMITS.login, rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET), ctx.now());

    const input = await parseJsonBody(c, loginSchema);
    const now = ctx.now();

    const [user] = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, input.email));

    const invalid = AppError.unauthenticated('E-mail ou senha incorretos.');

    if (!user) {
      // Executa um hash de mesmo custo para nao vazar a existencia do e-mail.
      await verifyPassword(input.password, null);
      throw invalid;
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
      throw new AppError(
        'rate_limited',
        `Conta temporariamente bloqueada por tentativas incorretas. Tente novamente em ${minutes} minuto(s).`,
      );
    }

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      const failed = user.failedLoginCount + 1;
      await ctx.db
        .update(schema.users)
        .set({
          failedLoginCount: failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null,
          updatedAt: now,
        })
        .where(eq(schema.users.id, user.id));

      await recordAudit(ctx.db, ctx.env, {
        actorUserId: user.id,
        actorEmail: user.email,
        action: AUDIT_ACTIONS.userLoginFailed,
        entityType: 'user',
        entityId: user.id,
        metadata: { attempt: failed },
        ip,
        userAgent: userAgent(c),
      });
      throw invalid;
    }

    await ctx.db
      .update(schema.users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now })
      .where(eq(schema.users.id, user.id));

    const issued = await createSession(ctx.db, ctx.env, {
      userId: user.id,
      rememberMe: input.rememberMe,
      ip,
      userAgent: userAgent(c),
      now,
    });
    setSessionCookies(c, ctx.env, issued);

    await recordAudit(ctx.db, ctx.env, {
      actorUserId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.userLoggedIn,
      entityType: 'user',
      entityId: user.id,
      ip,
      userAgent: userAgent(c),
    });

    const session = await resolveSession(ctx.db, ctx.env, issued.sessionToken, now);
    return ok(c, {
      session: session ? serializeSession(session) : null,
      csrfToken: issued.csrfToken,
    });
  });

  // --------------------------------------------------------------- logout
  app.post('/logout', async (c) => {
    const ctx = c.get('ctx');
    const session = c.get('session');
    if (session) {
      await revokeSession(ctx.db, session.sessionId, ctx.now());
      await recordAudit(ctx.db, ctx.env, {
        actorUserId: session.user.id,
        actorEmail: session.user.email,
        action: AUDIT_ACTIONS.userLoggedOut,
        entityType: 'user',
        entityId: session.user.id,
        ip: clientIp(c),
      });
    }
    clearSessionCookies(c, ctx.env);
    return noContent(c);
  });

  // -------------------------------------------------------------- sessao
  app.get('/session', async (c) => {
    const session = c.get('session');
    const ctx = c.get('ctx');
    return ok(c, {
      session: session ? serializeSession(session) : null,
      features: ctx.features,
      platform: { name: ctx.env.PLATFORM_NAME, url: ctx.env.PLATFORM_URL },
    });
  });

  // ------------------------------------------------- confirmacao de e-mail
  app.post('/verify-email', async (c) => {
    const ctx = c.get('ctx');
    const input = await parseJsonBody(c, verifyEmailSchema);
    const consumed = await consumeUserToken(ctx.db, ctx.env, {
      token: input.token,
      type: 'email_verification',
      now: ctx.now(),
    });

    const [user] = await ctx.db
      .update(schema.users)
      .set({ emailVerifiedAt: ctx.now(), updatedAt: ctx.now() })
      .where(eq(schema.users.id, consumed.userId))
      .returning({ id: schema.users.id, email: schema.users.email });

    await recordAudit(ctx.db, ctx.env, {
      actorUserId: user?.id ?? null,
      actorEmail: user?.email ?? '',
      action: AUDIT_ACTIONS.userEmailVerified,
      entityType: 'user',
      entityId: user?.id ?? '',
      ip: clientIp(c),
    });

    return ok(c, { verified: true });
  });

  app.post('/resend-verification', async (c) => {
    const ctx = c.get('ctx');
    const ip = clientIp(c);
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.emailVerification,
      rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET),
      ctx.now(),
    );
    const input = await parseJsonBody(c, resendVerificationSchema);

    const [user] = await ctx.db
      .select({ id: schema.users.id, name: schema.users.name, verifiedAt: schema.users.emailVerifiedAt })
      .from(schema.users)
      .where(eq(schema.users.email, input.email));

    if (user && !user.verifiedAt) {
      const token = await issueUserToken(ctx.db, ctx.env, {
        userId: user.id,
        type: 'email_verification',
        now: ctx.now(),
      });
      await ctx.mailer.send({
        to: input.email,
        kind: 'verify_email',
        subject: `Confirme seu e-mail - ${ctx.env.PLATFORM_NAME}`,
        text: `Ola, ${user.name}!\n\nConfirme seu e-mail:\n${buildActionUrl(ctx.env, '/confirmar-email', token.token)}`,
      });
    }

    // Resposta identica em todos os casos para nao revelar cadastros.
    return ok(c, { sent: true });
  });

  // ------------------------------------------------------ senha esquecida
  app.post('/forgot-password', async (c) => {
    const ctx = c.get('ctx');
    const ip = clientIp(c);
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.passwordReset,
      rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET),
      ctx.now(),
    );
    const input = await parseJsonBody(c, requestPasswordResetSchema);

    const [user] = await ctx.db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.email, input.email));

    if (user) {
      const token = await issueUserToken(ctx.db, ctx.env, {
        userId: user.id,
        type: 'password_reset',
        now: ctx.now(),
      });
      await ctx.mailer.send({
        to: input.email,
        kind: 'reset_password',
        subject: `Redefinicao de senha - ${ctx.env.PLATFORM_NAME}`,
        text:
          `Ola, ${user.name}!\n\nUse o link abaixo para definir uma nova senha:\n`
          + `${buildActionUrl(ctx.env, '/redefinir-senha', token.token)}\n\n`
          + 'O link expira em 2 horas. Se nao foi voce, ignore esta mensagem.',
      });
      await recordAudit(ctx.db, ctx.env, {
        actorUserId: user.id,
        actorEmail: input.email,
        action: AUDIT_ACTIONS.userPasswordResetRequested,
        entityType: 'user',
        entityId: user.id,
        ip,
      });
    }

    return ok(c, { sent: true });
  });

  app.post('/reset-password', async (c) => {
    const ctx = c.get('ctx');
    const input = await parseJsonBody(c, resetPasswordSchema);
    const consumed = await consumeUserToken(ctx.db, ctx.env, {
      token: input.token,
      type: 'password_reset',
      now: ctx.now(),
    });

    const passwordHash = await hashPassword(input.password);
    const [user] = await ctx.db
      .update(schema.users)
      .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: ctx.now() })
      .where(eq(schema.users.id, consumed.userId))
      .returning({ id: schema.users.id, email: schema.users.email });

    // Redefinir a senha encerra todas as sessoes existentes.
    await revokeAllUserSessions(ctx.db, consumed.userId, { now: ctx.now() });
    clearSessionCookies(c, ctx.env);

    await recordAudit(ctx.db, ctx.env, {
      actorUserId: user?.id ?? null,
      actorEmail: user?.email ?? '',
      action: AUDIT_ACTIONS.userPasswordReset,
      entityType: 'user',
      entityId: user?.id ?? '',
      ip: clientIp(c),
    });

    return ok(c, { reset: true });
  });

  // ------------------------------------------------------ aceitar convite
  app.post('/accept-invite', async (c) => {
    const ctx = c.get('ctx');
    const input = await parseJsonBody(c, acceptInviteSchema);
    const now = ctx.now();

    const consumed = await consumeUserToken(ctx.db, ctx.env, {
      token: input.token,
      type: 'invitation',
      now,
    });
    if (!consumed.tenantId) {
      throw AppError.badRequest('Convite invalido: empresa nao identificada.');
    }

    const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, consumed.userId));
    if (!user) throw AppError.badRequest('Convite invalido.');

    // Usuario novo precisa definir nome e senha ao aceitar.
    if (!user.passwordHash) {
      if (!input.password) {
        throw AppError.validation('Defina uma senha para concluir o convite.', {
          fields: { password: 'Informe uma senha.' },
        });
      }
      await ctx.db
        .update(schema.users)
        .set({
          passwordHash: await hashPassword(input.password),
          name: input.name ?? user.name,
          emailVerifiedAt: user.emailVerifiedAt ?? now,
          updatedAt: now,
        })
        .where(eq(schema.users.id, user.id));
    }

    await ctx.db
      .update(schema.memberships)
      .set({ status: 'active', acceptedAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.memberships.tenantId, consumed.tenantId),
          eq(schema.memberships.userId, user.id),
        ),
      );

    const issued = await createSession(ctx.db, ctx.env, {
      userId: user.id,
      rememberMe: false,
      ip: clientIp(c),
      userAgent: userAgent(c),
      now,
    });
    setSessionCookies(c, ctx.env, issued);

    await recordAudit(ctx.db, ctx.env, {
      tenantId: consumed.tenantId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.inviteAccepted,
      entityType: 'membership',
      entityId: consumed.tenantId,
      metadata: { role: consumed.role },
      ip: clientIp(c),
    });

    const session = await resolveSession(ctx.db, ctx.env, issued.sessionToken, now);
    return ok(c, {
      session: session ? serializeSession(session) : null,
      csrfToken: issued.csrfToken,
      tenantId: consumed.tenantId,
    });
  });

  // ------------------------------------------------------------- perfil
  app.patch('/profile', requireAuth(), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, updateProfileSchema);

    await ctx.db
      .update(schema.users)
      .set({ name: input.name, phone: input.phone, updatedAt: ctx.now() })
      .where(eq(schema.users.id, session.user.id));

    const refreshed = await ctx.db
      .select({ id: schema.users.id, name: schema.users.name, phone: schema.users.phone })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id));

    return ok(c, { user: refreshed[0] ?? null });
  });

  app.post('/change-password', requireAuth(), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, changePasswordSchema);

    const [user] = await ctx.db
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id));

    const valid = await verifyPassword(input.currentPassword, user?.passwordHash ?? null);
    if (!valid) {
      throw AppError.validation('Senha atual incorreta.', {
        fields: { currentPassword: 'Senha atual incorreta.' },
      });
    }

    await ctx.db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(input.newPassword), updatedAt: ctx.now() })
      .where(eq(schema.users.id, session.user.id));

    // Mantem a sessao atual e encerra as demais.
    await revokeAllUserSessions(ctx.db, session.user.id, {
      exceptSessionId: session.sessionId,
      now: ctx.now(),
    });

    await recordAudit(ctx.db, ctx.env, {
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      action: AUDIT_ACTIONS.userPasswordChanged,
      entityType: 'user',
      entityId: session.user.id,
      ip: clientIp(c),
    });

    return ok(c, { changed: true });
  });

  // ---------------------------------------------------- sessoes ativas
  app.get('/sessions', requireAuth(), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const rows = await ctx.db
      .select({
        id: schema.sessions.id,
        userAgent: schema.sessions.userAgent,
        createdAt: schema.sessions.createdAt,
        lastUsedAt: schema.sessions.lastUsedAt,
        expiresAt: schema.sessions.expiresAt,
      })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.userId, session.user.id), isNull(schema.sessions.revokedAt)));

    return ok(c, {
      sessions: rows.map((row) => ({ ...row, current: row.id === session.sessionId })),
    });
  });

  app.post('/sessions/revoke-others', requireAuth(), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    await revokeAllUserSessions(ctx.db, session.user.id, {
      exceptSessionId: session.sessionId,
      now: ctx.now(),
    });
    return ok(c, { revoked: true });
  });

  return app;
}

function serializeSession(session: {
  user: { id: string; email: string; name: string; phone: string; platformRole: string; emailVerified: boolean };
  memberships: Array<{ tenantId: string; tenantSlug: string; tenantName: string; tenantStatus: string; role: string }>;
  expiresAt: Date;
}) {
  return {
    user: session.user,
    memberships: session.memberships,
    expiresAt: session.expiresAt.toISOString(),
  };
}

async function nextTenantSlug(db: Database, desired: string): Promise<string> {
  const base = slugify(desired) || 'construtora';
  const rows = await db.select({ slug: schema.tenants.slug }).from(schema.tenants);
  return uniqueSlug(base, rows.map((row) => row.slug));
}
