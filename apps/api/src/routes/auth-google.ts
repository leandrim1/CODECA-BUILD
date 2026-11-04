import { and, eq, schema, type Database } from '@codeca/database';
import {
  AppError,
  GOOGLE_AUTH_ERRORS,
  createCompanySchema,
  googleStartSchema,
  unlinkGoogleSchema,
  type GoogleAuthResult,
} from '@codeca/shared';
import { constantTimeEquals, verifyPassword } from '@codeca/shared/server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cookieSecure, googleRedirectUri } from '../env.js';
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js';
import { createCompanyForUser, loadTrialPlan, nextTenantSlug } from '../lib/company.js';
import { startLoginChallenge } from '../lib/login-challenge.js';
import { readSessionToken, setSessionCookies } from '../lib/cookies.js';
import { assertSameOrigin } from '../lib/csrf.js';
import {
  GoogleAuthError,
  buildGoogleAuthorizationUrl,
  exchangeAuthorizationCode,
  oidcNonce,
  pkceChallenge,
  pkceVerifier,
  verifyGoogleIdToken,
  type GoogleClaims,
} from '../lib/google-oauth.js';
import { clientIp, created, noContent, ok, parseJsonBody, userAgent } from '../lib/http.js';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  OAUTH_STATE_TTL_MINUTES,
  consumeOAuthState,
  createOAuthState,
  safeNextPath,
  type OAuthStateRow,
} from '../lib/oauth-state.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { createSession, resolveSession } from '../lib/session.js';
import { requireAuth, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Login com Google.
 *
 * ## O desenho, em uma frase
 *
 * O navegador so vai ao Google e volta; quem fala com o Google, confere o
 * token e decide o que acontece e SEMPRE a API. Nenhum token do Google chega
 * ao navegador, e a sessao da plataforma continua sendo o cookie HttpOnly de
 * sempre.
 *
 * ## O que decide quem entra
 *
 * 1. **`sub` ja vinculado** -> entra no usuario dono daquele vinculo.
 * 2. **`sub` novo e e-mail livre** -> cria o USUARIO (sem senha, e-mail ja
 *    confirmado pelo Google). Nao cria empresa: a pessoa e levada ao cadastro
 *    da empresa, o mesmo do formulario de e-mail e senha.
 * 3. **`sub` novo e e-mail ja cadastrado** -> NAO entra e NAO vincula. Um
 *    e-mail igual nao prova que e a mesma pessoa: vincular automaticamente
 *    entregaria a conta a quem controla o Google, e deixaria de pe uma senha
 *    que um atacante tenha plantado antes. Quem ja tem conta prova que e dono
 *    dela entrando com a senha e vinculando o Google la dentro (`link`, que
 *    exige a senha de novo).
 *
 * Nada aqui concede acesso a empresa: o vinculo com empresas so nasce por
 * cadastro de empresa ou por convite aceito, e o papel de administrador da
 * plataforma NUNCA e concedido por este caminho.
 */

const PROVIDER = 'google' as const;

export function googleAuthRoutes() {
  const app = new Hono<AppBindings>();

  // ------------------------------------------------------------------ inicio
  app.post('/start', async (c) => {
    const ctx = c.get('ctx');
    assertSameOrigin(c, ctx.env);
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.oauthStart,
      rateLimitSubjectFromIp(clientIp(c), ctx.env.AUTH_SECRET),
      ctx.now(),
    );
    assertConfigured(c);

    const input = await parseJsonBody(c, googleStartSchema);
    const now = ctx.now();
    let userId: string | null = null;
    let nextPath = '';

    if (input.intent === 'link') {
      const session = c.get('session');
      if (!session) throw AppError.unauthenticated('Faça login para vincular o Google.');
      userId = session.user.id;
      await assertPasswordOfSessionUser(c, input.password);

      const [already] = await ctx.db
        .select({ id: schema.userIdentities.id })
        .from(schema.userIdentities)
        .where(and(eq(schema.userIdentities.userId, userId), eq(schema.userIdentities.provider, PROVIDER)));
      if (already) throw AppError.conflict(GOOGLE_AUTH_ERRORS.already_has_google);
    } else {
      nextPath = safeNextPath(input.next);
    }

    const state = await createOAuthState(ctx.db, ctx.env, {
      provider: PROVIDER,
      intent: input.intent,
      userId,
      nextPath,
      now,
    });

    setCookie(c, OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: cookieSecure(ctx.env),
      // Lax: o retorno do Google e uma navegacao de topo (GET), que o Lax deixa
      // passar. Strict derrubaria o cookie justamente no retorno.
      sameSite: 'Lax',
      path: OAUTH_STATE_COOKIE_PATH,
      maxAge: OAUTH_STATE_TTL_MINUTES * 60,
    });

    const authorizationUrl = buildGoogleAuthorizationUrl({
      clientId: ctx.env.GOOGLE_CLIENT_ID!,
      redirectUri: googleRedirectUri(ctx.env),
      state,
      nonce: oidcNonce(ctx.env.AUTH_SECRET, state),
      codeChallenge: pkceChallenge(pkceVerifier(ctx.env.AUTH_SECRET, state)),
    });

    c.header('cache-control', 'no-store');
    return ok(c, { authorizationUrl });
  });

  // ----------------------------------------------------------------- retorno
  app.get('/callback', async (c) => {
    const ctx = c.get('ctx');
    const ip = clientIp(c);
    c.header('cache-control', 'no-store');

    // Qualquer que seja o resultado, o cookie do `state` serve uma vez so.
    const cookieState = getCookie(c, OAUTH_STATE_COOKIE) ?? null;
    deleteCookie(c, OAUTH_STATE_COOKIE, { path: OAUTH_STATE_COOKIE_PATH, secure: cookieSecure(ctx.env) });

    try {
      await enforceRateLimit(
        ctx.db,
        RATE_LIMITS.oauthCallback,
        rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET),
        ctx.now(),
      );
    } catch {
      return c.redirect(failureUrl('continue', 'failed'), 302);
    }

    if (!ctx.features.googleAuth) return c.redirect(failureUrl('continue', 'not_configured'), 302);
    if (ctx.env.LOGIN_CODE_REQUIRED && !ctx.features.emailCodeAuth) {
      return c.redirect(failureUrl('continue', 'not_configured'), 302);
    }

    const query = c.req.query();
    const state = query.state ?? '';

    // 1. A tentativa e esta mesma, neste mesmo navegador.
    if (!state || !cookieState || !constantTimeEquals(state, cookieState)) {
      await auditBlocked(c, 'invalid_state', null);
      return c.redirect(failureUrl('continue', 'invalid_state'), 302);
    }
    const row = await consumeOAuthState(ctx.db, ctx.env, state, ctx.now());
    if (!row) {
      await auditBlocked(c, 'invalid_state', null);
      return c.redirect(failureUrl('continue', 'invalid_state'), 302);
    }
    const intent = row.intent === 'link' ? 'link' : 'continue';

    // 2. A pessoa desistiu (ou o Google recusou) na tela do Google.
    if (query.error) {
      return c.redirect(failureUrl(intent, query.error === 'access_denied' ? 'cancelled' : 'failed'), 302);
    }
    if (!query.code) return c.redirect(failureUrl(intent, 'failed'), 302);

    // 3. Troca o codigo e confere o token. Falha aqui nunca vira login.
    let claims: GoogleClaims;
    try {
      const idToken = await exchangeAuthorizationCode(ctx.fetch, {
        clientId: ctx.env.GOOGLE_CLIENT_ID!,
        clientSecret: ctx.env.GOOGLE_CLIENT_SECRET!,
        redirectUri: googleRedirectUri(ctx.env),
        code: query.code,
        codeVerifier: pkceVerifier(ctx.env.AUTH_SECRET, state),
      });
      claims = await verifyGoogleIdToken(ctx.fetch, idToken, {
        clientId: ctx.env.GOOGLE_CLIENT_ID!,
        nonce: oidcNonce(ctx.env.AUTH_SECRET, state),
        now: ctx.now(),
      });
    } catch (error) {
      const code: GoogleAuthResult = error instanceof GoogleAuthError ? error.code : 'failed';
      // So a causa tecnica, nunca o token nem o codigo.
      console.warn(`[auth:google] falha ao validar o retorno: ${error instanceof Error ? error.message : error}`);
      await auditBlocked(c, code, row.userId, error instanceof Error ? error.message : undefined);
      return c.redirect(failureUrl(intent, code), 302);
    }

    try {
      return intent === 'link'
        ? await linkGoogle(c, row, claims)
        : await continueWithGoogle(c, row, claims);
    } catch (error) {
      console.error(`[auth:google] erro inesperado: ${error instanceof Error ? error.message : error}`);
      return c.redirect(failureUrl(intent, 'failed'), 302);
    }
  });

  // ------------------------------------------------------------- desvincular
  app.post('/unlink', requireAuth(), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, unlinkGoogleSchema);
    // Sem senha, desvincular deixaria a conta sem nenhuma forma de entrar.
    await assertPasswordOfSessionUser(c, input.password);

    const removed = await ctx.db
      .delete(schema.userIdentities)
      .where(and(eq(schema.userIdentities.userId, session.user.id), eq(schema.userIdentities.provider, PROVIDER)))
      .returning({ id: schema.userIdentities.id });
    if (removed.length === 0) throw AppError.notFound('Nenhuma conta Google vinculada.');

    await recordAudit(ctx.db, ctx.env, {
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      action: AUDIT_ACTIONS.userGoogleUnlinked,
      entityType: 'user',
      entityId: session.user.id,
      ip: clientIp(c),
    });
    return noContent(c);
  });

  return app;
}

// ---------------------------------------------------------------- decisoes

async function continueWithGoogle(c: Context<AppBindings>, row: OAuthStateRow, claims: GoogleClaims): Promise<Response> {
  const ctx = c.get('ctx');
  const now = ctx.now();

  // 1. Conta Google ja vinculada: entra no usuario dono do vinculo.
  const [identity] = await ctx.db
    .select()
    .from(schema.userIdentities)
    .where(
      and(eq(schema.userIdentities.provider, PROVIDER), eq(schema.userIdentities.providerSubject, claims.sub)),
    );

  if (identity) {
    const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, identity.userId));
    if (!user) return c.redirect(failureUrl('continue', 'failed'), 302);

    await ctx.db
      .update(schema.userIdentities)
      .set({ email: claims.email, emailVerified: claims.emailVerified, lastLoginAt: now })
      .where(eq(schema.userIdentities.id, identity.id));
    // Verificacao por e-mail ativa: o Google e a primeira etapa; a sessao so
    // nasce depois do codigo enviado ao e-mail da conta.
    if (ctx.features.emailCodeAuth) return challengeAfterGoogle(c, user, row);

    await ctx.db.update(schema.users).set({ lastLoginAt: now, updatedAt: now }).where(eq(schema.users.id, user.id));

    await openSession(c, user.id);
    await recordAudit(ctx.db, ctx.env, {
      actorUserId: user.id,
      actorEmail: user.email,
      action: AUDIT_ACTIONS.userGoogleLoggedIn,
      entityType: 'user',
      entityId: user.id,
      ip: clientIp(c),
      userAgent: userAgent(c),
    });

    const hasCompany = await hasActiveMembership(ctx.db, user.id);
    const target = hasCompany || user.platformRole === 'platform_admin' ? safeNextPath(row.nextPath) : '/criar-empresa';
    return c.redirect(target, 302);
  }

  // 2. Conta Google nova. Sem e-mail verificado nao ha o que confiar.
  if (!claims.emailVerified) {
    await auditBlocked(c, 'unverified_email', null);
    return c.redirect(failureUrl('continue', 'unverified_email'), 302);
  }

  // 3. E-mail ja cadastrado: nao entra e nao vincula (ver o topo do arquivo).
  const [existing] = await ctx.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, claims.email));
  if (existing) {
    await auditBlocked(c, 'email_in_use', existing.id);
    return c.redirect(failureUrl('continue', 'email_in_use'), 302);
  }

  // 4. Usuario novo. Sem empresa, sem papel de plataforma, sem senha.
  let userId: string;
  try {
    userId = await ctx.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({
          email: claims.email,
          name: claims.name,
          passwordHash: null,
          // O proprio Google confirmou que a pessoa controla este e-mail.
          emailVerifiedAt: now,
          lastLoginAt: now,
        })
        .returning({ id: schema.users.id });
      if (!user) throw AppError.internal('Não foi possível criar a conta.');
      await tx.insert(schema.userIdentities).values({
        userId: user.id,
        provider: PROVIDER,
        providerSubject: claims.sub,
        email: claims.email,
        emailVerified: claims.emailVerified,
        lastLoginAt: now,
      });
      return user.id;
    });
  } catch (error) {
    // Duas entradas simultaneas da mesma pessoa: a segunda perde a corrida e
    // tenta de novo do inicio, caindo no caso 1 ou 3. Nunca cria duplicado.
    if (isUniqueViolation(error)) return c.redirect(failureUrl('continue', 'email_in_use'), 302);
    throw error;
  }

  await recordAudit(ctx.db, ctx.env, {
    actorUserId: userId,
    actorEmail: claims.email,
    action: AUDIT_ACTIONS.userGoogleRegistered,
    entityType: 'user',
    entityId: userId,
    ip: clientIp(c),
    userAgent: userAgent(c),
  });
  if (ctx.features.emailCodeAuth) {
    return challengeAfterGoogle(c, { id: userId, email: claims.email }, row);
  }
  await openSession(c, userId);
  return c.redirect('/criar-empresa', 302);
}

/**
 * Google autorizado, falta o codigo: envia o e-mail, abre o comprovante e leva a
 * tela do codigo. Nenhuma sessao existe ainda.
 */
async function challengeAfterGoogle(
  c: Context<AppBindings>,
  user: { id: string; email: string },
  row: OAuthStateRow,
): Promise<Response> {
  try {
    await startLoginChallenge(
      c,
      { email: user.email, userId: user.id, method: 'google', rememberMe: false, next: safeNextPath(row.nextPath) },
      { reuseRecentCode: true },
    );
  } catch (error) {
    console.warn(`[auth:google] não foi possível enviar o código: ${error instanceof Error ? error.message : error}`);
    return c.redirect(failureUrl('continue', 'code_send_failed'), 302);
  }
  return c.redirect('/entrar?etapa=codigo', 302);
}

async function linkGoogle(c: Context<AppBindings>, row: OAuthStateRow, claims: GoogleClaims): Promise<Response> {
  const ctx = c.get('ctx');
  const session = c.get('session');
  const back = (code: GoogleAuthResult) =>
    c.redirect(code === 'linked' ? '/painel/empresa?google=linked' : failureUrl('link', code), 302);

  // O fluxo foi aberto por UMA pessoa logada; precisa terminar nela.
  if (!row.userId || !session || session.user.id !== row.userId) {
    await auditBlocked(c, 'session_mismatch', row.userId);
    return back('session_mismatch');
  }
  if (!claims.emailVerified) return back('unverified_email');

  const [identity] = await ctx.db
    .select()
    .from(schema.userIdentities)
    .where(
      and(eq(schema.userIdentities.provider, PROVIDER), eq(schema.userIdentities.providerSubject, claims.sub)),
    );
  if (identity) {
    if (identity.userId !== session.user.id) {
      await auditBlocked(c, 'already_linked', session.user.id);
      return back('already_linked');
    }
    return back('linked');
  }

  try {
    await ctx.db.insert(schema.userIdentities).values({
      userId: session.user.id,
      provider: PROVIDER,
      providerSubject: claims.sub,
      email: claims.email,
      emailVerified: claims.emailVerified,
      lastLoginAt: ctx.now(),
    });
  } catch (error) {
    if (isUniqueViolation(error)) return back('already_has_google');
    throw error;
  }

  await recordAudit(ctx.db, ctx.env, {
    actorUserId: session.user.id,
    actorEmail: session.user.email,
    action: AUDIT_ACTIONS.userGoogleLinked,
    entityType: 'user',
    entityId: session.user.id,
    ip: clientIp(c),
    userAgent: userAgent(c),
  });
  return back('linked');
}

// ------------------------------------------------------ cadastro da empresa

/**
 * `POST /api/auth/company`: a primeira empresa de quem entrou pelo Google.
 *
 * Mesmo cadastro do formulario de e-mail e senha. So para quem ainda nao
 * pertence a nenhuma empresa: criar outra para quem ja tem vinculo seria um
 * caminho novo, fora do que esta tarefa autoriza.
 */
export async function createCompanyHandler(c: Context<AppBindings>): Promise<Response> {
  const ctx = c.get('ctx');
  const session = sessionOf(c);
  const input = await parseJsonBody(c, createCompanySchema);

  if (await hasActiveMembership(ctx.db, session.user.id)) {
    throw AppError.conflict('Sua conta já pertence a uma empresa.');
  }

  const trialPlan = await loadTrialPlan(ctx.db);
  const slug = await nextTenantSlug(ctx.db, input.companySlug ?? input.companyName);
  const now = ctx.now();

  const company = await ctx.db.transaction((tx) =>
    createCompanyForUser(tx as unknown as Database, {
      userId: session.user.id,
      contactEmail: session.user.email,
      companyName: input.companyName,
      phone: input.phone,
      slug,
      trialPlanId: trialPlan.id,
      now,
    }),
  );

  if (input.phone && !session.user.phone) {
    await ctx.db.update(schema.users).set({ phone: input.phone, updatedAt: now }).where(eq(schema.users.id, session.user.id));
  }

  await recordAudit(ctx.db, ctx.env, {
    tenantId: company.tenantId,
    actorUserId: session.user.id,
    actorEmail: session.user.email,
    action: AUDIT_ACTIONS.tenantCreated,
    entityType: 'tenant',
    entityId: company.tenantId,
    metadata: { companyName: input.companyName, slug, via: 'google' },
    ip: clientIp(c),
    userAgent: userAgent(c),
  });

  const token = readSessionToken(c);
  const refreshed = token ? await resolveSession(ctx.db, ctx.env, token, now) : null;
  return created(c, {
    tenantId: company.tenantId,
    session: refreshed
      ? {
          user: refreshed.user,
          memberships: refreshed.memberships,
          expiresAt: refreshed.expiresAt.toISOString(),
        }
      : null,
  });
}

// ----------------------------------------------------------------- apoio

function assertConfigured(c: Context<AppBindings>): void {
  if (!c.get('ctx').features.googleAuth) {
    throw AppError.notConfigured(
      'O login com Google não está configurado. Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no ambiente do servidor.',
    );
  }
}

/** Confere a senha de quem esta logado, sem encerrar nem bloquear a sessao. */
async function assertPasswordOfSessionUser(c: Context<AppBindings>, password: string): Promise<void> {
  const ctx = c.get('ctx');
  const session = sessionOf(c);
  await enforceRateLimit(ctx.db, RATE_LIMITS.login, `user:${session.user.id}`, ctx.now());

  const [user] = await ctx.db
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, session.user.id));
  const valid = await verifyPassword(password, user?.passwordHash ?? null);
  if (!valid) {
    throw AppError.validation('Senha incorreta.', { fields: { password: 'Senha incorreta.' } });
  }
}

async function openSession(c: Context<AppBindings>, userId: string): Promise<void> {
  const ctx = c.get('ctx');
  const issued = await createSession(ctx.db, ctx.env, {
    userId,
    rememberMe: false,
    ip: clientIp(c),
    userAgent: userAgent(c),
    now: ctx.now(),
  });
  setSessionCookies(c, ctx.env, issued);
}

async function hasActiveMembership(db: Database, userId: string): Promise<boolean> {
  const [membership] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active')))
    .limit(1);
  return Boolean(membership);
}

/** A tela le `?google=<codigo>` e mostra a mensagem; nada vindo do Google trafega aqui. */
function failureUrl(intent: 'continue' | 'link', code: GoogleAuthResult): string {
  const base = intent === 'link' ? '/painel/empresa' : '/entrar';
  return `${base}?google=${code}`;
}

async function auditBlocked(
  c: Context<AppBindings>,
  reason: string,
  userId: string | null,
  detail?: string,
): Promise<void> {
  const ctx = c.get('ctx');
  await recordAudit(ctx.db, ctx.env, {
    actorUserId: userId,
    action: AUDIT_ACTIONS.userGoogleLoginBlocked,
    entityType: 'user',
    entityId: userId ?? '',
    metadata: { reason, ...(detail ? { detail: detail.slice(0, 200) } : {}) },
    ip: clientIp(c),
    userAgent: userAgent(c),
  });
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
