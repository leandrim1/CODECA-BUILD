import type { MiddlewareHandler } from 'hono';
import { allowedOrigins, isProduction, type Env } from '../env.js';
import type { AppBindings } from '../types.js';

/**
 * Cabecalhos de seguranca e CORS restritivo.
 *
 * O painel roda em `APP_URL`; apenas essa origem (e os enderecos locais em
 * desenvolvimento) recebem cabecalhos CORS com credenciais. Os sites publicos
 * chamam a API no proprio dominio, portanto nao precisam de CORS.
 */

export function securityHeaders(env: Env): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    await next();
    const headers = c.res.headers;
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    headers.set('x-frame-options', 'DENY');
    headers.set('cross-origin-opener-policy', 'same-origin');
    headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    if (isProduction(env)) {
      headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    // Respostas da API nunca devem ser cacheadas por intermediarios.
    if (!headers.has('cache-control')) {
      headers.set('cache-control', 'no-store');
    }
  };
}

export function cors(env: Env): MiddlewareHandler<AppBindings> {
  const allowed = allowedOrigins(env);

  return async (c, next) => {
    const origin = c.req.header('origin');
    const isAllowed = Boolean(origin && allowed.includes(origin));

    if (c.req.method === 'OPTIONS') {
      if (!isAllowed) return c.body(null, 403);
      return c.body(null, 204, {
        'access-control-allow-origin': origin as string,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type,x-csrf-token',
        'access-control-max-age': '600',
        vary: 'origin',
      });
    }

    await next();

    if (isAllowed && origin) {
      c.res.headers.set('access-control-allow-origin', origin);
      c.res.headers.set('access-control-allow-credentials', 'true');
      c.res.headers.append('vary', 'origin');
    }
  };
}
