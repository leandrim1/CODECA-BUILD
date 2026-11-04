import { AppError, originAllowed } from '@codeca/shared';
import { sha256 } from '@codeca/shared/server';
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

    // Uma consulta por chave a cada `AUTH_CACHE_TTL` (e uma so sob concorrencia),
    // em vez de tres (chave, site, origens) em cada leitura de cada visitante.
    // Chave invalida nunca e guardada: o erro propaga e a proxima tenta de novo.
    const agora = ctx.now();
    const tokenKey = token ? sha256(token) : null;
    const credencial = tokenKey
      ? await ctx.caches.apiKey.getOrLoad(tokenKey, () =>
          authenticateApiKey(ctx.db, { token, origin, now: agora }),
        )
      : await authenticateApiKey(ctx.db, { token, origin, now: agora });
    // Uma chave guardada que venceu nao pode continuar valendo.
    if (tokenKey && credencial.expiresAt !== null && credencial.expiresAt <= agora.getTime()) {
      ctx.caches.apiKey.delete(tokenKey);
      throw AppError.unauthenticated('Credencial de integração inválida.');
    }

    if (credencial.kind === 'publishable') {
      if (credencial.origins.length === 0) {
        throw AppError.forbidden(
          'Este site ainda não tem origem autorizada. Cadastre o endereço do site antes de usar a chave publicável.',
        );
      }
      if (!originAllowed(origin, credencial.origins)) {
        throw AppError.forbidden(
          'Origem não autorizada para esta chave. Cadastre o endereço do site no painel da plataforma.',
        );
      }
      // A origem foi conferida: o navegador pode ler a resposta.
      c.header('access-control-allow-origin', origin ?? '');
      c.header('vary', 'origin');
    }

    // Limite por chave. Com os caches ligados a contagem e em MEMORIA (por
    // instancia): a alternativa, uma gravacao no banco por leitura publica, era
    // a consulta mais cara da plataforma sendo feita para o trafego mais volumoso
    // dela. O custo: o limite vale por instancia, entao o teto global cresce com
    // o numero de instancias -- aceitavel para proteger contra abuso (a
    // protecao de borda da Vercel cobre o resto). Sem cache (testes), vale o
    // contador do banco, exato.
    if (ctx.caches.enabled) {
      const cota = consumeLocalRateLimit(ctx.caches.publicRate, credencial.keyId, agora.getTime());
      if (!cota.allowed) {
        c.header('retry-after', String(cota.retryAfterSeconds));
        throw AppError.rateLimited('Limite de requisições atingido para esta credencial.');
      }
    } else {
      const cota = await consumeRateLimit(ctx.db, RATE_LIMITS.publicApi, credencial.keyId, agora);
      if (!cota.allowed) {
        c.header('retry-after', String(cota.retryAfterSeconds));
        throw AppError.rateLimited('Limite de requisições atingido para esta credencial.');
      }
    }

    // Depois de autorizar: registrar uso de uma chave recusada nao serve a
    // ninguem e daria a quem tenta um sinal de que a chave existe. Com cache, so
    // vai ao banco quando a janela de 5 min do ultimo registro desta instancia
    // acabou (era uma consulta por leitura, para gravar "nada mudou").
    if (!ctx.caches.enabled || shouldTouchLocally(credencial.keyId, agora.getTime())) {
      await touchApiKey(ctx.db, credencial.keyId, agora);
    }

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

/** Janela fixa de 1 minuto por chave, so em memoria. */
function consumeLocalRateLimit(
  windows: Map<string, { count: number; resetAt: number }>,
  keyId: string,
  nowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const rule = RATE_LIMITS.publicApi;
  let window = windows.get(keyId);
  if (!window || window.resetAt <= nowMs) {
    // Nao deixa o mapa crescer sem fim: chave nova com o mapa cheio varre as vencidas.
    if (windows.size >= 10_000) {
      for (const [id, w] of windows) if (w.resetAt <= nowMs) windows.delete(id);
    }
    window = { count: 0, resetAt: nowMs + rule.windowSeconds * 1000 };
    windows.set(keyId, window);
  }
  window.count += 1;
  return {
    allowed: window.count <= rule.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - nowMs) / 1000)),
  };
}

const lastTouched = new Map<string, number>();
const TOUCH_EVERY_MS = 5 * 60_000;

function shouldTouchLocally(keyId: string, nowMs: number): boolean {
  const last = lastTouched.get(keyId);
  if (last !== undefined && nowMs - last < TOUCH_EVERY_MS) return false;
  if (lastTouched.size >= 10_000) lastTouched.clear();
  lastTouched.set(keyId, nowMs);
  return true;
}
