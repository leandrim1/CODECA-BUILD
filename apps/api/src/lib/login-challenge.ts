import { AppError, LOGIN_CODE_RESEND_SECONDS, LOGIN_CODE_TTL_MINUTES } from '@codeca/shared';
import { hashIp, hashToken } from '@codeca/shared/server';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { cookieSecure } from '../env.js';
import { clientIp } from './http.js';
import {
  LOGIN_PENDING_COOKIE,
  LOGIN_PENDING_COOKIE_PATH,
  LOGIN_PENDING_TTL_MINUTES,
  createPendingLogin,
  discardLoginCode,
  issueLoginCode,
  loginCodeMessage,
  type PendingLogin,
} from './login-code.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from './ratelimit.js';
import type { AppBindings } from '../types.js';

/**
 * Emite o codigo por e-mail e abre o comprovante da etapa.
 *
 * Dois usos, e o chamador escolhe:
 *
 * - depois da PRIMEIRA etapa vencida (senha correta, ou Google autorizado): o
 *   codigo prova que quem acertou a senha tambem controla a caixa de entrada;
 * - no login so com o e-mail: o codigo E a autenticacao. Nesse caso a rota
 *   publica ja aplicou as cotas e diz, por `deliver`, se existe conta para
 *   receber a mensagem.
 */

export interface ChallengeInfo {
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

export async function startLoginChallenge(
  c: Context<AppBindings>,
  pending: PendingLogin,
  options: {
    /**
     * Pedido logo depois de outro (menos de 60 s): o codigo anterior continua
     * valendo, entao nao reenvia e apenas segue para a digitacao. E o caso de
     * quem entra duas vezes seguidas. No reenvio manual (`false`), o intervalo
     * minimo vira erro com a espera.
     */
    reuseRecentCode: boolean;
    /** As cotas por IP e por e-mail ja foram aplicadas pelo chamador. */
    alreadyRateLimited?: boolean;
    /**
     * `false` emite o codigo mas NAO envia e-mail: e o caso do e-mail sem conta
     * na rota publica, em que o codigo existe apenas para que o intervalo de
     * reenvio, as cotas e a resposta sejam identicos aos de uma conta real.
     * Padrao `true`.
     */
    deliver?: boolean;
  },
): Promise<ChallengeInfo> {
  const ctx = c.get('ctx');
  const now = ctx.now();
  const ip = clientIp(c);

  if (options.alreadyRateLimited !== true) {
    await enforceRateLimit(ctx.db, RATE_LIMITS.loginCodeRequestIp, rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET), now);
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.loginCodeRequestEmail,
      hashToken(pending.email, ctx.env.AUTH_SECRET),
      now,
    );
  }

  const issued = await issueLoginCode(ctx.db, ctx.env, {
    email: pending.email,
    ipHash: hashIp(ip, ctx.env.AUTH_SECRET),
    now,
  });

  let resendAfterSeconds = LOGIN_CODE_RESEND_SECONDS;
  if (!issued.ok) {
    if (!options.reuseRecentCode) {
      throw new AppError('rate_limited', `Aguarde ${issued.retryAfterSeconds} segundo(s) para pedir um novo código.`, {
        retryAfterSeconds: issued.retryAfterSeconds,
      });
    }
    resendAfterSeconds = issued.retryAfterSeconds;
  } else if (options.deliver === false) {
    // Nada sai. O codigo fica valendo no banco so para o intervalo de reenvio e
    // as cotas se comportarem como em uma conta real; ninguem o recebe, e a
    // validacao nao encontra usuario para abrir sessao.
    resendAfterSeconds = LOGIN_CODE_RESEND_SECONDS;
  } else {
    const message = loginCodeMessage(issued.code);
    const delivery = await ctx.mailer.send({
      to: pending.email,
      kind: 'login_code',
      subject: message.subject,
      text: message.text,
    });
    if (!delivery.delivered) {
      // Ninguem recebeu: o codigo nao pode ficar valendo, e a pessoa precisa saber.
      await discardLoginCode(ctx.db, issued.id);
      throw new AppError('upstream_error', 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.');
    }
  }

  setCookie(c, LOGIN_PENDING_COOKIE, createPendingLogin(ctx.env, pending, now), {
    httpOnly: true,
    secure: cookieSecure(ctx.env),
    // Lax: o retorno do Google e uma navegacao de topo, que o Lax deixa passar.
    sameSite: 'Lax',
    path: LOGIN_PENDING_COOKIE_PATH,
    maxAge: LOGIN_PENDING_TTL_MINUTES * 60,
  });
  c.header('cache-control', 'no-store');

  return { resendAfterSeconds, expiresInSeconds: LOGIN_CODE_TTL_MINUTES * 60 };
}
