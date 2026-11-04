import { and, eq, schema, type Database } from '@codeca/database';
import {
  AppError,
  LOGIN_CODE_INVALID_MESSAGE,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
  registerWithCodeSchema,
  requestLoginCodeSchema,
  verifyLoginCodeSchema,
} from '@codeca/shared';
import { hashIp, hashToken } from '@codeca/shared/server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cookieSecure } from '../env.js';
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js';
import { createCompanyForUser, loadTrialPlan, nextTenantSlug } from '../lib/company.js';
import { setSessionCookies } from '../lib/cookies.js';
import { assertSameOrigin } from '../lib/csrf.js';
import { clientIp, created, ok, parseJsonBody, userAgent } from '../lib/http.js';
import {
  SIGNUP_PROOF_COOKIE,
  SIGNUP_PROOF_COOKIE_PATH,
  SIGNUP_PROOF_TTL_MINUTES,
  createSignupProof,
  discardLoginCode,
  issueLoginCode,
  loginCodeMessage,
  readSignupProof,
  verifyLoginCode,
} from '../lib/login-code.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { createSession, resolveSession, revokeAllUserSessions, serializeSession } from '../lib/session.js';
import type { AppBindings } from '../types.js';

/**
 * Login por codigo enviado por e-mail (sem senha, sem Google).
 *
 * ## Anti-enumeracao
 *
 * `POST /request` faz exatamente o mesmo para qualquer endereco -- gera, guarda
 * e envia um codigo, exista conta ou nao -- e responde sempre igual. A unica
 * diferenca entre "tem conta" e "nao tem" aparece **depois de provar o codigo**
 * (entrar x concluir cadastro), e so para quem controla a caixa de entrada.
 * Todas as falhas de validacao devolvem a mesma mensagem.
 *
 * ## O codigo nunca aparece
 *
 * Nem na resposta da API, nem em log (o mailer de console o omite), nem na
 * auditoria. Quem o ve e a pessoa, no e-mail.
 *
 * ## Mesma sessao
 *
 * Depois de provar o codigo, a sessao e criada por `createSession`, o mesmo
 * caminho da senha e do Google: mesmo cookie, mesma expiracao, mesmo logout.
 */

export function codeAuthRoutes() {
  const app = new Hono<AppBindings>();

  // ---------------------------------------------------------------- pedir
  app.post('/request', async (c) => {
    const ctx = c.get('ctx');
    assertSameOrigin(c, ctx.env);
    if (!ctx.features.emailCodeAuth) {
      throw AppError.notConfigured(
        'O envio de e-mail não está configurado. Defina RESEND_API_KEY e MAIL_FROM no ambiente do servidor.',
      );
    }
    const now = ctx.now();
    const ip = clientIp(c);
    const input = await parseJsonBody(c, requestLoginCodeSchema);
    const emailKey = hashToken(input.email, ctx.env.AUTH_SECRET);

    await enforceRateLimit(ctx.db, RATE_LIMITS.loginCodeRequestIp, rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET), now);
    await enforceRateLimit(ctx.db, RATE_LIMITS.loginCodeRequestEmail, emailKey, now);

    const issued = await issueLoginCode(ctx.db, ctx.env, {
      email: input.email,
      ipHash: hashIp(ip, ctx.env.AUTH_SECRET),
      now,
    });
    if (!issued.ok) {
      throw new AppError(
        'rate_limited',
        `Aguarde ${issued.retryAfterSeconds} segundo(s) para pedir um novo código.`,
        { retryAfterSeconds: issued.retryAfterSeconds },
      );
    }

    const message = loginCodeMessage(issued.code);
    const delivery = await ctx.mailer.send({
      to: input.email,
      kind: 'login_code',
      subject: message.subject,
      text: message.text,
    });
    if (!delivery.delivered) {
      // Ninguem recebeu: o codigo nao pode ficar valendo, e a pessoa precisa saber.
      await discardLoginCode(ctx.db, issued.id);
      throw new AppError('upstream_error', 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.');
    }

    c.header('cache-control', 'no-store');
    return ok(c, {
      sent: true,
      resendAfterSeconds: LOGIN_CODE_RESEND_SECONDS,
      expiresInSeconds: LOGIN_CODE_TTL_MINUTES * 60,
    });
  });

  // ------------------------------------------------------------- verificar
  app.post('/verify', async (c) => {
    const ctx = c.get('ctx');
    assertSameOrigin(c, ctx.env);
    const now = ctx.now();
    const ip = clientIp(c);
    const input = await parseJsonBody(c, verifyLoginCodeSchema);

    await enforceRateLimit(ctx.db, RATE_LIMITS.loginCodeVerifyIp, rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET), now);
    await enforceRateLimit(ctx.db, RATE_LIMITS.loginCodeVerifyEmail, hashToken(input.email, ctx.env.AUTH_SECRET), now);

    const result = await verifyLoginCode(ctx.db, ctx.env, { email: input.email, code: input.code, now });
    if (!result.ok) {
      if (result.reason === 'exhausted') {
        await recordAudit(ctx.db, ctx.env, {
          action: AUDIT_ACTIONS.userCodeBlocked,
          entityType: 'user',
          metadata: { reason: 'attempts_exhausted' },
          ip,
          userAgent: userAgent(c),
        });
      }
      // A mesma mensagem para codigo errado, vencido, usado ou inexistente.
      throw AppError.unauthenticated(LOGIN_CODE_INVALID_MESSAGE);
    }

    const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.email, input.email));
    c.header('cache-control', 'no-store');

    // ---- e-mail novo: prova feita, falta o cadastro
    if (!user) {
      setCookie(c, SIGNUP_PROOF_COOKIE, createSignupProof(ctx.env, input.email, now), {
        httpOnly: true,
        secure: cookieSecure(ctx.env),
        sameSite: 'Lax',
        path: SIGNUP_PROOF_COOKIE_PATH,
        maxAge: SIGNUP_PROOF_TTL_MINUTES * 60,
      });
      return ok(c, { status: 'registration_required' as const, email: input.email });
    }

    // ---- e-mail ja cadastrado: entra na conta que existe
    let notice: string | null = null;
    if (!user.emailVerifiedAt) {
      // O e-mail so passa a ser "verificado" agora, porque agora foi provado.
      //
      // Conta que existia SEM e-mail verificado pode ter sido aberta por outra
      // pessoa com o endereco desta ("pre-sequestro"): ela guardaria a senha
      // dela e continuaria entrando junto com a dona do e-mail. Por isso, na
      // primeira prova, a senha antiga e removida e as sessoes antigas
      // encerradas. Dados, empresas e vinculos ficam intactos.
      const hadPassword = user.passwordHash !== null;
      await ctx.db
        .update(schema.users)
        .set({ emailVerifiedAt: now, passwordHash: null, updatedAt: now })
        .where(eq(schema.users.id, user.id));
      await revokeAllUserSessions(ctx.db, user.id, { now });
      if (hadPassword) {
        notice =
          'Por segurança, a senha antiga desta conta foi removida, porque o e-mail ainda não estava verificado. '
          + 'Você pode definir uma nova em "Esqueci minha senha".';
      }
      await recordAudit(ctx.db, ctx.env, {
        actorUserId: user.id,
        actorEmail: user.email,
        action: AUDIT_ACTIONS.userEmailVerified,
        entityType: 'user',
        entityId: user.id,
        metadata: { via: 'login_code', passwordRemoved: hadPassword },
        ip,
      });
    }

    await ctx.db.update(schema.users).set({ lastLoginAt: now, updatedAt: now }).where(eq(schema.users.id, user.id));

    const session = await openSession(c, user.id, now);
    await recordAudit(ctx.db, ctx.env, {
      actorUserId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.userCodeLoggedIn,
      entityType: 'user',
      entityId: user.id,
      ip,
      userAgent: userAgent(c),
    });

    return ok(c, {
      status: 'authenticated' as const,
      session: session.payload,
      csrfToken: session.csrfToken,
      notice,
    });
  });

  // ------------------------------------------------------------- cadastrar
  app.post('/register', async (c) => {
    const ctx = c.get('ctx');
    assertSameOrigin(c, ctx.env);
    const now = ctx.now();
    const ip = clientIp(c);
    const input = await parseJsonBody(c, registerWithCodeSchema);

    // O e-mail vem do comprovante, nunca do corpo.
    const email = readSignupProof(ctx.env, getCookie(c, SIGNUP_PROOF_COOKIE), now);
    if (!email) {
      throw AppError.unauthenticated('Confirme o código enviado ao seu e-mail para concluir o cadastro.');
    }

    const [existing] = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
    if (existing) {
      deleteProof(c);
      throw AppError.conflict('Já existe uma conta com este e-mail. Peça um novo código para entrar.');
    }

    const trialPlan = await loadTrialPlan(ctx.db);
    const slug = await nextTenantSlug(ctx.db, input.companySlug ?? input.companyName);

    // Conta e empresa nascem juntas, como no cadastro com senha. O e-mail ja esta
    // verificado (o codigo acabou de prova-lo) e NAO ha senha. Nenhum papel de
    // plataforma e concedido aqui, nem o de "primeira conta da instalacao".
    const result = await ctx.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({
          email,
          name: input.name,
          passwordHash: null,
          phone: input.phone,
          emailVerifiedAt: now,
          lastLoginAt: now,
        })
        .returning({ id: schema.users.id });
      if (!user) throw AppError.internal('Não foi possível criar a conta.');
      const company = await createCompanyForUser(tx as unknown as Database, {
        userId: user.id,
        contactEmail: email,
        companyName: input.companyName,
        phone: input.phone,
        slug,
        trialPlanId: trialPlan.id,
        now,
      });
      return { userId: user.id, tenantId: company.tenantId };
    });

    deleteProof(c);
    const session = await openSession(c, result.userId, now);
    await recordAudit(ctx.db, ctx.env, {
      tenantId: result.tenantId,
      actorUserId: result.userId,
      actorEmail: email,
      action: AUDIT_ACTIONS.userCodeRegistered,
      entityType: 'tenant',
      entityId: result.tenantId,
      metadata: { companyName: input.companyName, slug },
      ip,
      userAgent: userAgent(c),
    });

    return created(c, {
      status: 'authenticated' as const,
      session: session.payload,
      csrfToken: session.csrfToken,
      tenantId: result.tenantId,
    });
  });

  return app;
}

function deleteProof(c: Context<AppBindings>): void {
  deleteCookie(c, SIGNUP_PROOF_COOKIE, { path: SIGNUP_PROOF_COOKIE_PATH, secure: cookieSecure(c.get('ctx').env) });
}

/** Abre a sessao pelo caminho unico (`createSession`) e devolve o que a tela precisa. */
async function openSession(c: Context<AppBindings>, userId: string, now: Date) {
  const ctx = c.get('ctx');
  const issued = await createSession(ctx.db, ctx.env, {
    userId,
    rememberMe: false,
    ip: clientIp(c),
    userAgent: userAgent(c),
    now,
  });
  setSessionCookies(c, ctx.env, issued);
  const resolved = await resolveSession(ctx.db, ctx.env, issued.sessionToken, now);
  return { payload: resolved ? serializeSession(resolved) : null, csrfToken: issued.csrfToken };
}
