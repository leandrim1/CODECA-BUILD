import { AppError } from '@codeca/shared';
import { constantTimeEquals, hashToken } from '@codeca/shared/server';
import type { Context } from 'hono';
import { allowedOrigins, type Env } from '../env.js';
import { CSRF_HEADER, readCsrfCookie } from './cookies.js';

/**
 * Protecao contra CSRF em duas camadas:
 *
 * 1. Verificacao de origem: requisicoes que alteram estado precisam vir de uma
 *    origem conhecida (o painel) ou do proprio host da requisicao.
 * 2. Double submit: o token entregue no cookie legivel precisa ser reenviado no
 *    cabecalho `x-csrf-token` e conferir com o hash guardado na sessao.
 *
 * Endpoints publicos sem sessao (como o formulario de contato) nao usam cookie
 * de autenticacao e por isso sao protegidos por rate limiting, nao por CSRF.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function assertSameOrigin(c: Context, env: Env): void {
  const origin = c.req.header('origin');
  if (!origin) {
    // Clientes nao-navegador nao enviam Origin; a checagem de token ainda vale.
    return;
  }
  const allowed = allowedOrigins(env);
  const selfOrigin = selfOriginOf(c);
  if (allowed.includes(origin) || (selfOrigin && origin === selfOrigin)) return;
  throw AppError.forbidden('Origem da requisicao nao autorizada.');
}

export function assertCsrfToken(c: Context, env: Env, sessionCsrfTokenHash: string): void {
  const header = c.req.header(CSRF_HEADER);
  const cookie = readCsrfCookie(c);

  if (!header) {
    throw AppError.forbidden(`Cabecalho ${CSRF_HEADER} ausente na requisicao.`);
  }
  if (!cookie || !constantTimeEquals(header, cookie)) {
    throw AppError.forbidden('Token anti-CSRF invalido. Recarregue a pagina e tente novamente.');
  }
  if (!constantTimeEquals(hashToken(header, env.AUTH_SECRET), sessionCsrfTokenHash)) {
    throw AppError.forbidden('Token anti-CSRF nao corresponde a sessao atual.');
  }
}

function selfOriginOf(c: Context): string | null {
  const proto = c.req.header('x-forwarded-proto') ?? 'https';
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
  return host ? `${proto}://${host}` : null;
}
