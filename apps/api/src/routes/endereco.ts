import { z } from 'zod';
import { Hono } from 'hono';
import { clientIp, ok, parseParams, parseQuery } from '../lib/http.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { buscarCep, buscarEnderecos, enderecoPorCoordenada } from '../lib/endereco.js';
import { requireCapability } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Consulta de endereco para o formulario de contato.
 *
 * Tres leituras, nenhuma escrita: CEP, coordenada -> endereco, e texto ->
 * lista de enderecos. Exigem a mesma permissao de quem edita conteudo, porque
 * e dali que saem -- e isso tambem impede que a rota vire um proxy aberto de
 * geocodificacao para quem achar a URL.
 *
 * O limite de uso e por empresa e segue a politica do Nominatim (1 req/s):
 * `enderecoBusca` deixa 60 por minuto, que e o teto deles, e o painel ainda
 * espera 500 ms entre teclas antes de perguntar qualquer coisa.
 */
export function enderecoRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/:tenantId/endereco/cep/:cep', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.enderecoBusca,
      rateLimitSubjectFromIp(clientIp(c), ctx.env.AUTH_SECRET),
      ctx.now(),
    );
    const { cep } = parseParams(c, z.object({ cep: z.string().max(12) }));
    return ok(c, await buscarCep(cep));
  });

  app.get('/:tenantId/endereco/coordenada', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.enderecoBusca,
      rateLimitSubjectFromIp(clientIp(c), ctx.env.AUTH_SECRET),
      ctx.now(),
    );
    const { lat, lon } = parseQuery(
      c,
      z.object({
        lat: z.coerce.number().min(-90).max(90),
        lon: z.coerce.number().min(-180).max(180),
      }),
    );
    return ok(c, await enderecoPorCoordenada(lat, lon));
  });

  app.get('/:tenantId/endereco/busca', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.enderecoBusca,
      rateLimitSubjectFromIp(clientIp(c), ctx.env.AUTH_SECRET),
      ctx.now(),
    );
    const { q } = parseQuery(c, z.object({ q: z.string().trim().max(200).default('') }));
    return ok(c, { items: await buscarEnderecos(q) });
  });

  return app;
}
