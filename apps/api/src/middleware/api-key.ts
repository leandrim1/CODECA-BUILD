import { AppError, originAllowed } from '@codeca/shared';
import type { MiddlewareHandler } from 'hono';
import { authenticateApiKey, touchApiKey } from '../lib/integration/keys.js';
import { RATE_LIMITS, consumeRateLimit } from '../lib/ratelimit.js';
import type { AppBindings } from '../types.js';

/**
 * Autentica a credencial de integracao de um site.
 *
 * A chave publicavel viaja no navegador, a vista de qualquer um. O que impede
 * um terceiro de usa-la no proprio site e a origem: o navegador envia `Origin`
 * e nao deixa a pagina mentir sobre ele. A chave secreta nao passa por essa
 * conferencia -- ela roda no servidor, onde `Origin` nao existe.
 */

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [esquema, valor] = header.split(' ');
  if (!valor || esquema?.toLowerCase() !== 'bearer') return null;
  return valor.trim();
}

export function apiKeyMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const ctx = c.get('ctx');
    const token = bearerToken(c.req.header('authorization'));
    const origin = c.req.header('origin') ?? null;

    const credencial = await authenticateApiKey(ctx.db, { token, origin, now: ctx.now() });

    if (credencial.kind === 'publishable') {
      if (credencial.origins.length === 0) {
        throw AppError.forbidden(
          'Este site ainda nao tem origem autorizada. Cadastre o endereco do site antes de usar a chave publicavel.',
        );
      }
      if (!originAllowed(origin, credencial.origins)) {
        throw AppError.forbidden(
          'Origem nao autorizada para esta chave. Cadastre o endereco do site no painel da plataforma.',
        );
      }
      // A origem foi conferida: o navegador pode ler a resposta.
      c.header('access-control-allow-origin', origin ?? '');
      c.header('vary', 'origin');
    }

    const cota = await consumeRateLimit(
      ctx.db,
      RATE_LIMITS.publicApi,
      credencial.keyId,
      ctx.now(),
    );
    if (!cota.allowed) {
      c.header('retry-after', String(cota.retryAfterSeconds));
      throw AppError.rateLimited('Limite de requisicoes atingido para esta credencial.');
    }

    // Depois de autorizar: registrar uso de uma chave recusada nao serve a
    // ninguem e daria a quem tenta um sinal de que a chave existe.
    await touchApiKey(ctx.db, credencial.keyId, ctx.now());

    c.set('apiKey', {
      keyId: credencial.keyId,
      kind: credencial.kind,
      tenantId: credencial.tenantId,
      siteId: credencial.siteId,
      scopes: credencial.scopes,
    });

    await next();
  };
}
