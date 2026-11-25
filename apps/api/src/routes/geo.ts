import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { AppError, MINIMO_DA_BUSCA_TEXTO } from '@codeca/shared';
import { clientIp, parseParams, parseQuery } from '../lib/http.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { criarProvedoresDeGeo } from '../lib/geo/registry.js';
import { consultarBusca, consultarCep, consultarReverso } from '../lib/geo/servico.js';
import { requireAuth, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Consulta de endereco para o painel.
 *
 * Tres leituras, nenhuma escrita. O navegador nunca fala com ViaCEP ou
 * Nominatim: passa por aqui, e por tres razoes que nao sao intercambiaveis.
 *
 * 1. A CSP do painel e `connect-src 'self'`. Abri-la para dominios de
 *    terceiros vale para a pagina inteira.
 * 2. O Nominatim exige `User-Agent` identificando a aplicacao, cabecalho que
 *    navegador nenhum deixa o JavaScript definir.
 * 3. O cache e a cota so existem se houver um lugar por onde todo mundo passa.
 *
 * ## Formato da resposta
 *
 * `{ ok, data }` ou `{ ok: false, error }`, diferente do resto da API (que
 * devolve o recurso direto). E deliberado: estas rotas falham o tempo todo por
 * motivos que NAO sao erro do cliente -- provedor fora do ar, CEP que nao
 * existe --, e a tela precisa distinguir "deu errado, preencha a mao" de
 * "voce digitou algo invalido". Um envelope com `ok` diz isso sem depender do
 * codigo HTTP.
 */
export function geoRoutes() {
  const app = new Hono<AppBindings>();

  // Painel apenas: a sessao e a fronteira. Sem ela, a rota seria um proxy
  // aberto de geocodificacao -- e a conta do abuso cairia na nossa reputacao
  // com o provedor, nao na de quem abusou.
  app.use('*', requireAuth());

  /** Cota por IP e cota global, nesta ordem: a primeira protege a segunda. */
  async function cobrarCota(c: Context<AppBindings>) {
    const ctx = c.get('ctx');
    const sessao = sessionOf(c);
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.geoPorUsuario,
      `user:${sessao.user.id}`,
      ctx.now(),
    );
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.geoPorIp,
      rateLimitSubjectFromIp(clientIp(c), ctx.env.AUTH_SECRET),
      ctx.now(),
    );
    /*
      Cota GLOBAL, com assunto fixo: 60 por minuto e o teto de 1 req/s da
      politica do Nominatim. A fila em processo espaca os pedidos dentro de
      uma instancia; esta linha e o que conta entre instancias, que e onde a
      funcao serverless multiplicaria o limite sem ninguem perceber.
    */
    await enforceRateLimit(ctx.db, RATE_LIMITS.geoProvedor, 'global', ctx.now());
  }

  function contexto(c: Context<AppBindings>) {
    const ctx = c.get('ctx');
    return { db: ctx.db, provedores: criarProvedoresDeGeo(ctx.env), agora: () => ctx.now() };
  }

  app.get('/cep/:cep', async (c) => {
    await cobrarCota(c);
    const { cep } = parseParams(c, z.object({ cep: z.string().max(12) }));
    const endereco = await consultarCep(contexto(c), cep);
    if (!endereco) {
      return c.json(
        { ok: false, error: { code: 'not_found', message: 'CEP não encontrado. Confira o número ou preencha o endereço à mão.' } },
        200,
      );
    }
    return c.json({ ok: true, data: endereco });
  });

  app.get('/reverse', async (c) => {
    await cobrarCota(c);
    const { lat, lng } = parseQuery(
      c,
      z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
    );
    const endereco = await consultarReverso(contexto(c), lat, lng);
    if (!endereco) {
      return c.json(
        { ok: false, error: { code: 'not_found', message: 'Não encontramos um endereço neste ponto. Arraste o pino ou preencha à mão.' } },
        200,
      );
    }
    return c.json({ ok: true, data: endereco });
  });

  app.get('/search', async (c) => {
    const { q } = parseQuery(c, z.object({ q: z.string().trim().max(200).default('') }));
    // Abaixo do minimo nem cobra cota: nao ha consulta a fazer.
    if (q.length < MINIMO_DA_BUSCA_TEXTO) return c.json({ ok: true, data: [] });
    await cobrarCota(c);
    return c.json({ ok: true, data: await consultarBusca(contexto(c), q) });
  });

  /** Erro do provedor vira `{ ok: false }`, e nao 5xx: a tela segue viva. */
  app.onError((erro, c) => {
    if (erro instanceof AppError && (erro.code === 'upstream_error' || erro.code === 'not_found')) {
      return c.json({ ok: false, error: { code: erro.code, message: erro.message } }, 200);
    }
    throw erro;
  });

  return app;
}
