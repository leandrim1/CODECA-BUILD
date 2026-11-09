import { desc, eq, schema } from '@codeca/database';
import {
  AppError,
  LOGIN_CODE_INVALID_MESSAGE,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
  requestLoginCodeSchema,
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
 * O codigo enviado por e-mail: como segunda etapa, e como forma de entrar.
 *
 * ## Dois caminhos chegam aqui
 *
 * - **Depois da senha, ou do Google**: o codigo e a segunda etapa. Quem chega ja
 *   provou algo; o codigo prova que tambem controla a caixa de entrada.
 * - **Direto, so com o e-mail** (`POST /start`): o codigo E a autenticacao.
 *   Nao e um enfraquecimento: provar controle da caixa de entrada ja basta hoje
 *   para TROCAR a senha pela recuperacao, entao esta rota nao abre porta que nao
 *   existisse -- ela so evita a volta pelo e-mail de redefinicao.
 *
 * Os dois abusos que uma rota publica de codigo traria estao fechados:
 *
 * 1. **Descobrir quais e-mails tem conta**: a resposta de `/start` e identica
 *    exista ou nao a conta. Um e-mail sem conta tambem gera codigo (que ninguem
 *    recebe) e tambem consome cota, para que intervalo de reenvio e recusa por
 *    cota nao denunciem a diferenca. A unica diferenca observavel que resta e o
 *    tempo da chamada ao provedor de e-mail, a mesma que `/forgot-password` ja
 *    tem.
 * 2. **Encher a caixa de entrada de terceiros**: cota por IP e por e-mail,
 *    intervalo minimo de 60 s entre envios, e reenvio que NAO envia nada quando
 *    o e-mail nao tem conta.
 *
 * ## O codigo nunca aparece
 *
 * Nem na resposta, nem em log (o mailer de console o omite), nem na auditoria.
 *
 * ## O e-mail vem do comprovante, nunca do corpo
 *
 * `/verify` le o e-mail do cookie HttpOnly assinado. Sem isso, trocar o e-mail
 * no corpo usaria o codigo de outra pessoa.
 *
 * ## Mesma sessao
 *
 * Vencido o codigo, a sessao nasce em `createSession`, o mesmo caminho de
 * qualquer entrada: mesmo cookie, mesma expiracao, mesmo logout.
 */

export function codeAuthRoutes() {
  const app = new Hono<AppBindings>();

  // ------------------------------------------------- entrar so com o e-mail
  /**
   * Pede um codigo de acesso informando apenas o e-mail.
   *
   * Responde SEMPRE a mesma coisa: nao diz se existe conta, nao diz se o e-mail
   * saiu. Quem tem conta recebe o codigo; quem nao tem recebe silencio, e a
   * digitacao do codigo falha com a mensagem unica de codigo invalido.
   */
  app.post('/start', async (c) => {
    const ctx = c.get('ctx');
    assertSameOrigin(c, ctx.env);
    if (!ctx.features.emailCodeAuth) {
      throw AppError.notConfigured(
        'A entrada por código de e-mail depende do envio de e-mail, que não está configurado nesta instalação.',
      );
    }

    const input = await parseJsonBody(c, requestLoginCodeSchema);
    const now = ctx.now();
    const ip = clientIp(c);

    // As cotas sao aplicadas ANTES de saber se a conta existe, e por isso valem
    // igual nos dois casos: e o que impede usar a recusa por cota para descobrir
    // quais e-mails tem conta.
    await enforceRateLimit(ctx.db, RATE_LIMITS.loginCodeRequestIp, rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET), now);
    await enforceRateLimit(ctx.db, RATE_LIMITS.loginCodeRequestEmail, hashToken(input.email, ctx.env.AUTH_SECRET), now);

    const [user] = await ctx.db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.email, input.email));

    // Conta bloqueada por erros de SENHA continua podendo entrar por aqui, de
    // proposito: o bloqueio existe contra forca bruta de senha, e o codigo tem
    // os seus proprios limites. A recuperacao de senha ja funciona assim.
    const info = await startLoginChallenge(
      c,
      {
        email: input.email,
        // Vazio quando nao existe conta: o codigo nasce, mas nao abre sessao.
        userId: user?.id ?? '',
        method: 'email',
        rememberMe: input.rememberMe,
        next: '',
      },
      { reuseRecentCode: true, alreadyRateLimited: true, deliver: user !== undefined },
    );

    c.header('cache-control', 'no-store');
    return ok(c, { sent: true, email: input.email, ...info });
  });

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
    // Comprovante de e-mail sem conta: reenviar enviaria mensagem da plataforma
    // para um endereco qualquer, a pedido de quem o digitou. Nada sai.
    const info = await startLoginChallenge(c, pending, {
      reuseRecentCode: false,
      deliver: pending.userId !== '',
    });
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
      if (result.reason === 'exhausted' && pending.userId !== '') {
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

    // Comprovante de e-mail sem conta: o codigo conferiu, mas nao ha quem
    // autenticar. Mesma mensagem de codigo invalido -- a resposta nao revela que
    // a diferenca estava na existencia da conta, e nao no codigo.
    if (pending.userId === '') {
      clearPending(c);
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
    ctx.caches.invalidateUser(user.id);
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
