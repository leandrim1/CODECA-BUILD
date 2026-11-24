import { and, eq, isNull, schema, type Database } from '@codeca/database';
import {
  AppError,
  LEGAL_VERSION,
  formatarTelefone,
  acceptInviteSchema,
  changePasswordSchema,
  confirmTotpSchema,
  disableTotpSchema,
  loginSchema,
  registerSchema,
  requestPasswordResetSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  onboardingMarksSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@codeca/shared';
import {
  hashPassword,
  hashToken,
  precisaRehashDeSenha,
  verifyPassword,
} from '@codeca/shared/server';
import { Hono, type Context } from 'hono';
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js';
import { claimFirstPlatformAdmin } from '../lib/bootstrap.js';
import { createCompanyForUser, loadTrialPlan, nextTenantSlug } from '../lib/company.js';
import { startLoginChallenge } from '../lib/login-challenge.js';
import { clearSessionCookies, setSessionCookies } from '../lib/cookies.js';
import { assertSameOrigin, isStateChanging } from '../lib/csrf.js';
import { clientIp, created, noContent, ok, parseJsonBody, userAgent } from '../lib/http.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { verificarDesafioDeBot } from '../lib/bot-challenge.js';
import { createSession, resolveSession, revokeAllUserSessions, revokeSession, serializeSession } from '../lib/session.js';
import { buildActionUrl, consumeUserToken, issueUserToken } from '../lib/tokens.js';
import { requireAuth, sessionMiddleware, sessionOf } from '../middleware/auth.js';
import { codeAuthRoutes } from './auth-code.js';
import { createCompanyHandler, googleAuthRoutes } from './auth-google.js';
import {
  confirmTotpEnrollment,
  disableTotp,
  regenerateRecoveryCodes,
  startTotpEnrollment,
  totpState,
  verifySecondFactor,
} from '../lib/security/totp-store.js';
import { startTotpChallenge } from '../lib/login-challenge.js';
import { totpEnabled } from '../lib/security/totp-store.js';
import { enqueueWelcome } from '../lib/mail/notices.js';
import { processOutbox } from '../lib/mail/outbox.js';
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

/**
 * Recusa, de forma explicita, o que depende de um e-mail que ninguem vai receber.
 *
 * Sem provedor configurado o envio cai no log do servidor. Para o cadastro isso
 * e tolerave: a conta nasce com sessao e a confirmacao pode esperar. Para
 * "esqueci minha senha" nao e: a tela diria "verifique sua caixa de entrada", o
 * link ficaria no log de uma funcao serverless e a pessoa ficaria trancada fora
 * da propria conta sem nunca saber por que. Melhor dizer a verdade.
 *
 * A recusa nao revela cadastro nenhum: ela depende so da configuracao do
 * servidor, identica para qualquer e-mail digitado.
 */
function assertMailerConfigured(ctx: { features: { transactionalEmail: boolean } }): void {
  if (ctx.features.transactionalEmail) return;
  throw AppError.notConfigured(
    'O envio de e-mail ainda não está configurado nesta instalação, '
      + 'então não há como entregar o link. Procure o suporte da CODECA IA.',
  );
}

export function authRoutes() {
  const app = new Hono<AppBindings>();
  app.use('*', sessionMiddleware());
  // Toda escrita autenticada em /auth (logout, perfil, senha, sessoes, empresa)
  // descarta o que esta instancia guarda sobre o usuario: a sessao encerrada nao
  // pode continuar valendo por causa do cache.
  app.use('*', async (c, next) => {
    const session = c.get('session');
    await next();
    if (session && isStateChanging(c.req.method) && c.res.status < 400) {
      c.get('ctx').caches.invalidateUser(session.user.id);
    }
  });

  // Login com Google e cadastro da primeira empresa de quem entrou por ele.
  app.route('/google', googleAuthRoutes());
  // Login por codigo enviado por e-mail.
  app.route('/code', codeAuthRoutes());
  app.post('/company', requireAuth(), createCompanyHandler);

  // ------------------------------------------------------------- cadastro
  app.post('/register', async (c) => {
    const ctx = c.get('ctx');
    const ip = clientIp(c);
    assertSameOrigin(c, ctx.env);
    await enforceRateLimit(ctx.db, RATE_LIMITS.register, rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET), ctx.now());

    const input = await parseJsonBody(c, registerSchema);
    /*
      Desafio de bot, quando configurado.

      O limite por IP barra forca bruta de um endereco; nao barra cadastro em
      massa distribuido, que consome banco, cota de e-mail e a reputacao do
      remetente. Sem as chaves no ambiente isto nao faz nada.
    */
    await verificarDesafioDeBot(ctx.env, input.botToken, ip);

    const [existing] = await ctx.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, input.email));
    if (existing) {
      throw AppError.conflict('Já existe uma conta com este e-mail. Faca login ou recupere a senha.');
    }

    const trialPlan = await loadTrialPlan(ctx.db);

    const slug = await nextTenantSlug(ctx.db, input.companySlug ?? input.companyName);
    const passwordHash = await hashPassword(input.password);

    const result = await ctx.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({
          email: input.email,
          name: input.name,
          passwordHash,
          phone: input.phone,
          // O formulario so envia com o aceite marcado (`acceptedTerms: true`).
          termsAcceptedAt: ctx.now(),
          termsVersion: LEGAL_VERSION,
        })
        .returning({ id: schema.users.id, email: schema.users.email });
      if (!user) throw AppError.internal('Não foi possível criar a conta.');

      const tenant = await createCompanyForUser(tx as unknown as Database, {
        userId: user.id,
        contactEmail: input.email,
        companyName: input.companyName,
        /*
          Mascarado aqui, e so aqui.

          `users.phone` guarda digitos puros (`19999990000`): e dado de
          cadastro, e quem o mostra formata. Este outro campo e o
          `contactPhone` da EMPRESA, que sai impresso no bloco de contato do
          site do cliente e no painel, onde ninguem formata nada -- guardar
          digitos crus ali publicaria `19999990000` na cara do visitante.
        */
        phone: formatarTelefone(input.phone),
        slug,
        trialPlanId: trialPlan.id,
        ...(ctx.env.DEMO_SITE_ON_SIGNUP
          ? { demo: { appUrl: ctx.env.APP_URL, contentLimit: trialPlan.contentLimit } }
          : {}),
        now: ctx.now(),
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
        tenantId: tenant.tenantId,
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
        `Olá, ${input.name}!\n\nConfirme seu e-mail para liberar a publicação do site:\n`
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
        metadata: { platformRole: 'platform_admin', reason: 'primeira conta da instalação' },
        ip,
        userAgent: userAgent(c),
      });
      console.info(
        `[bootstrap] ${result.email} assumiu o painel mestre por ser a primeira conta da instalação.`,
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
    // Com a verificacao por e-mail obrigatoria e sem como envia-la, ninguem entra:
    // melhor recusar do que entrar sem a segunda etapa.
    if (ctx.env.LOGIN_CODE_REQUIRED && !ctx.features.emailCodeAuth) {
      throw AppError.notConfigured(
        'A verificação por e-mail é obrigatória, mas não está disponível. '
          + 'Defina RESEND_API_KEY, MAIL_FROM e LOGIN_CODE_ENABLED=true.',
      );
    }

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

    /*
      Senha correta: zera as tentativas erradas, e aproveita para regravar o
      hash quando ele foi gerado com custo menor do que o de hoje.

      Subir o custo do scrypt so protege senha nova; as que ja estao no banco
      continuam com o custo antigo ate alguem regrava-las. A senha em claro so
      existe neste instante -- depois daqui nao ha mais como refazer o hash
      sem pedir que a pessoa troque de senha.

      O contador de tentativas e da SENHA; o codigo da segunda etapa tem os
      proprios limites.
    */
    const senhaRegravada = precisaRehashDeSenha(user.passwordHash)
      ? await hashPassword(input.password)
      : null;

    await ctx.db
      .update(schema.users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        ...(senhaRegravada ? { passwordHash: senhaRegravada } : {}),
        updatedAt: now,
      })
      .where(eq(schema.users.id, user.id));

    /*
     * Segunda etapa.
     *
     * O aplicativo autenticador tem prioridade sobre o codigo por e-mail: quem
     * o ativou escolheu um fator que nao depende de a mensagem chegar. Ligar um
     * nao desliga o outro para quem nao ativou -- so troca o caminho de quem
     * ativou.
     */
    if (await totpEnabled(ctx.db, user.id)) {
      startTotpChallenge(c, {
        email: user.email,
        userId: user.id,
        method: 'password',
        rememberMe: input.rememberMe,
        next: '',
      });
      return ok(c, { status: 'totp_required' as const, email: user.email });
    }

    // Com e-mail configurado, a senha SOZINHA nao abre a conta. A sessao so
    // nasce quando o codigo enviado ao e-mail for digitado.
    if (ctx.features.emailCodeAuth) {
      const challenge = await startLoginChallenge(
        c,
        {
          email: user.email,
          userId: user.id,
          method: 'password',
          rememberMe: input.rememberMe,
          next: '',
        },
        { reuseRecentCode: true },
      );
      c.header('cache-control', 'no-store');
      return ok(c, { status: 'code_required' as const, email: user.email, ...challenge });
    }

    await ctx.db.update(schema.users).set({ lastLoginAt: now }).where(eq(schema.users.id, user.id));

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
      status: 'authenticated' as const,
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
      platform: {
        name: ctx.env.PLATFORM_NAME,
        url: ctx.env.PLATFORM_URL,
        /*
          Endereco do suporte, quando houver.
          `null` quando nao configurado, e o menu de ajuda entao NAO mostra o
          item: um "Falar com o suporte" que abre um e-mail para lugar nenhum
          e pior do que a ausencia dele.
        */
        supportEmail: ctx.env.SUPPORT_EMAIL ?? null,
      },
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
    ctx.caches.invalidateUser(consumed.userId);

    await recordAudit(ctx.db, ctx.env, {
      actorUserId: user?.id ?? null,
      actorEmail: user?.email ?? '',
      action: AUDIT_ACTIONS.userEmailVerified,
      entityType: 'user',
      entityId: user?.id ?? '',
      ip: clientIp(c),
    });

    // Boas-vindas: so agora, com o e-mail confirmado. Nunca impede a resposta.
    if (user) {
      ctx.background(
        enqueueWelcome(ctx, user.id)
          .then((criados) => (criados > 0 ? processOutbox(ctx) : null))
          .catch((error: unknown) =>
            console.error('[avisos] boas-vindas:', error instanceof Error ? error.message : error),
          ),
      );
    }

    return ok(c, { verified: true });
  });

  app.post('/resend-verification', async (c) => {
    const ctx = c.get('ctx');
    const ip = clientIp(c);
    assertMailerConfigured(ctx);
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
        text: `Olá, ${user.name}!\n\nConfirme seu e-mail:\n${buildActionUrl(ctx.env, '/confirmar-email', token.token)}`,
      });
    }

    // Resposta identica em todos os casos para nao revelar cadastros.
    return ok(c, { sent: true });
  });

  // ------------------------------------------------------ senha esquecida
  app.post('/forgot-password', async (c) => {
    const ctx = c.get('ctx');
    const ip = clientIp(c);
    assertMailerConfigured(ctx);
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.passwordReset,
      rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET),
      ctx.now(),
    );
    const input = await parseJsonBody(c, requestPasswordResetSchema);
    await verificarDesafioDeBot(ctx.env, input.botToken, ip);

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
        subject: `Redefinição de senha - ${ctx.env.PLATFORM_NAME}`,
        text:
          `Olá, ${user.name}!\n\nUse o link abaixo para definir uma nova senha:\n`
          + `${buildActionUrl(ctx.env, '/redefinir-senha', token.token)}\n\n`
          + 'O link expira em 2 horas. Se não foi você, ignore esta mensagem.',
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
    ctx.caches.invalidateUser(consumed.userId);
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
      throw AppError.badRequest('Convite inválido: empresa não identificada.');
    }

    const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, consumed.userId));
    if (!user) throw AppError.badRequest('Convite inválido.');

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

    ctx.caches.invalidateTenant(consumed.tenantId);
    ctx.caches.invalidateUser(user.id);

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
  // ------------------------------------------- verificacao em duas etapas
  /*
   * Segundo fator por aplicativo autenticador. Sempre opcional.
   *
   * Tres garantias, todas no servidor:
   * - o segredo so aparece em texto UMA vez, na resposta de `/totp/setup`;
   * - so vale no login depois de a pessoa confirmar um codigo (`/totp/confirm`);
   * - desligar exige provar a identidade de novo -- sessao aberta nao basta.
   */

  app.get('/totp', requireAuth(), async (c) => {
    const ctx = c.get('ctx');
    const estado = await totpState(ctx.db, sessionOf(c).user.id);
    c.header('cache-control', 'no-store');
    return ok(c, estado);
  });

  app.post('/totp/setup', requireAuth(), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    assertSameOrigin(c, ctx.env);
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.totpSetup,
      hashToken(session.user.id, ctx.env.AUTH_SECRET),
      ctx.now(),
    );

    const enrollment = await startTotpEnrollment(
      { db: ctx.db, env: ctx.env, now: ctx.now },
      { userId: session.user.id, email: session.user.email },
    );
    // Unica resposta da API que carrega o segredo. Nunca vai para log.
    c.header('cache-control', 'no-store');
    return ok(c, enrollment);
  });

  app.post('/totp/confirm', requireAuth(), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    assertSameOrigin(c, ctx.env);
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.totpSetup,
      hashToken(session.user.id, ctx.env.AUTH_SECRET),
      ctx.now(),
    );
    const input = await parseJsonBody(c, confirmTotpSchema);

    const { recoveryCodes } = await confirmTotpEnrollment(
      { db: ctx.db, env: ctx.env, now: ctx.now },
      { userId: session.user.id, code: input.code },
    );

    await recordAudit(ctx.db, ctx.env, {
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      action: AUDIT_ACTIONS.userTotpEnabled,
      entityType: 'user',
      entityId: session.user.id,
      ip: clientIp(c),
      userAgent: userAgent(c),
    });

    // Os codigos existem em texto so aqui. Quem fechar a tela sem copiar gera
    // outros com a senha.
    c.header('cache-control', 'no-store');
    return ok(c, { recoveryCodes });
  });

  app.post('/totp/disable', requireAuth(), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    assertSameOrigin(c, ctx.env);
    const input = await parseJsonBody(c, disableTotpSchema);
    await assertIdentity(c, input);

    await disableTotp(ctx.db, session.user.id);
    await recordAudit(ctx.db, ctx.env, {
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      action: AUDIT_ACTIONS.userTotpDisabled,
      entityType: 'user',
      entityId: session.user.id,
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    return ok(c, { enabled: false });
  });

  app.post('/totp/recovery-codes', requireAuth(), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    assertSameOrigin(c, ctx.env);
    const input = await parseJsonBody(c, disableTotpSchema);
    await assertIdentity(c, input);

    const recoveryCodes = await regenerateRecoveryCodes(
      { db: ctx.db, env: ctx.env, now: ctx.now },
      session.user.id,
    );
    await recordAudit(ctx.db, ctx.env, {
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      action: AUDIT_ACTIONS.userRecoveryCodesRegenerated,
      entityType: 'user',
      entityId: session.user.id,
      ip: clientIp(c),
      userAgent: userAgent(c),
    });
    c.header('cache-control', 'no-store');
    return ok(c, { recoveryCodes });
  });

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

  /**
   * Marcos do guia de primeiro acesso.
   *
   * Fica em `users` e nao em `localStorage` porque a promessa e "nao aparece
   * de novo" -- e o armazenamento do navegador quebra essa promessa a cada
   * troca de aparelho, de navegador ou de janela anonima. O menu de ajuda
   * desfaz os dois marcos pela mesma rota.
   */
  app.patch('/onboarding', requireAuth(), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, onboardingMarksSchema);
    const agora = ctx.now();

    const campos: Record<string, Date | null> = {};
    if (input.tourDone !== undefined) campos.onboardingTourDoneAt = input.tourDone ? agora : null;
    if (input.checklistDismissed !== undefined) {
      campos.onboardingChecklistDismissedAt = input.checklistDismissed ? agora : null;
    }

    await ctx.db
      .update(schema.users)
      .set({ ...campos, updatedAt: agora })
      .where(eq(schema.users.id, session.user.id));

    const [refreshed] = await ctx.db
      .select({
        tourDoneAt: schema.users.onboardingTourDoneAt,
        checklistDismissedAt: schema.users.onboardingChecklistDismissedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id));

    return ok(c, {
      onboarding: {
        tourDoneAt: refreshed?.tourDoneAt?.toISOString() ?? null,
        checklistDismissedAt: refreshed?.checklistDismissedAt?.toISOString() ?? null,
      },
    });
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

/**
 * Prova de identidade para mexer na protecao da conta.
 *
 * Desligar o segundo fator ou trocar os codigos de recuperacao sao justamente
 * as acoes que quem roubou uma sessao faria primeiro. Por isso **a sessao nao
 * basta**: ou a senha, ou um codigo do proprio aplicativo.
 *
 * Quem entrou pelo Google nao tem senha; para essas contas o codigo do
 * aplicativo e o unico caminho -- e e um caminho forte, porque exige o
 * aparelho.
 */
async function assertIdentity(
  c: Context<AppBindings>,
  input: { password?: string | undefined; code?: string | undefined },
): Promise<void> {
  const ctx = c.get('ctx');
  const session = sessionOf(c);
  const agora = ctx.now();

  await enforceRateLimit(
    ctx.db,
    RATE_LIMITS.totpVerifyUser,
    hashToken(`identity:${session.user.id}`, ctx.env.AUTH_SECRET),
    agora,
  );

  if (input.code) {
    const resultado = await verifySecondFactor(
      { db: ctx.db, env: ctx.env, now: ctx.now },
      { userId: session.user.id, code: input.code },
    );
    if (resultado.ok) return;
  }

  if (input.password) {
    const [user] = await ctx.db
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id));
    if (user?.passwordHash && (await verifyPassword(input.password, user.passwordHash))) return;
  }

  throw AppError.unauthenticated('Não foi possível confirmar sua identidade. Confira a senha ou o código.');
}
