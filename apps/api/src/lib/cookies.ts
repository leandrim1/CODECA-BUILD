import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cookieSecure, type Env } from '../env.js';

/**
 * Cookies da sessao.
 *
 * `codeca_session` guarda o token opaco e e HttpOnly, portanto inacessivel a
 * qualquer script. `codeca_csrf` precisa ser legivel pelo painel para que o
 * valor seja reenviado no cabecalho `x-csrf-token` (padrao double submit).
 */

export const SESSION_COOKIE = 'codeca_session';
export const CSRF_COOKIE = 'codeca_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function setSessionCookies(
  c: Context,
  env: Env,
  input: { sessionToken: string; csrfToken: string; expiresAt: Date },
): void {
  const secure = cookieSecure(env);
  const maxAge = Math.max(1, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000));

  setCookie(c, SESSION_COOKIE, input.sessionToken, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge,
  });

  setCookie(c, CSRF_COOKIE, input.csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookies(c: Context, env: Env): void {
  const secure = cookieSecure(env);
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure, sameSite: 'Lax' });
  deleteCookie(c, CSRF_COOKIE, { path: '/', secure, sameSite: 'Lax' });
}

export function readSessionToken(c: Context): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null;
}

export function readCsrfCookie(c: Context): string | null {
  return getCookie(c, CSRF_COOKIE) ?? null;
}
