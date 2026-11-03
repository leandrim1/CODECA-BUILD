import { Hono } from 'hono';
import { and, eq, schema } from '@codeca/database';
import { ok } from '../lib/http.js';
import type { AppBindings } from '../types.js';

/**
 * Planos oferecidos, para a pagina inicial.
 *
 * ## Por que existe
 *
 * A pagina inicial anunciava os planos a partir das constantes de semente
 * (`DEFAULT_PLANS`). Mas preco e limite sao **editaveis no painel mestre**:
 * no dia em que o superadmin mudasse um valor, a vitrine continuaria
 * anunciando o antigo -- uma proposta comercial diferente da que o sistema
 * cobra. Esta rota devolve o que esta no banco, e e a unica fonte dos numeros
 * que a pagina exibe.
 *
 * ## O que expoe, e o que nao
 *
 * Publica por natureza (nao exige sessao), entao devolve **somente** o que um
 * visitante ja leria na vitrine: codigo, nome, descricao, preco, limites e
 * recursos. Ficam de fora o identificador interno, os ids da ValidaPay, o erro
 * da ultima sincronizacao e a politica de suspensao. Planos inativos ou
 * marcados como nao publicos nao aparecem -- o mesmo criterio da tela de
 * contratacao dentro do painel.
 *
 * Resposta com cache curto: a vitrine nao precisa de um valor ao segundo, e
 * uma mudanca de preco chega a ela em minutos.
 */

/** Quanto tempo um navegador ou a borda podem reaproveitar a resposta. */
const CACHE_SECONDS = 300;

export function publicPlanRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/plans', async (c) => {
    const ctx = c.get('ctx');

    const rows = await ctx.db
      .select({
        code: schema.plans.code,
        name: schema.plans.name,
        description: schema.plans.description,
        priceCents: schema.plans.priceCents,
        limits: schema.plans.limits,
        billing: schema.plans.billing,
      })
      .from(schema.plans)
      .where(and(eq(schema.plans.isActive, true), eq(schema.plans.isPublic, true)))
      .orderBy(schema.plans.priceCents, schema.plans.name);

    c.header(
      'cache-control',
      `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`,
    );

    return ok(c, {
      currency: 'BRL',
      plans: rows.map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        // Dias de avaliacao gratuita, quando o plano os tem: a pagina precisa
        // dizer quanto dura em vez de repetir um numero escrito a mao.
        trialDays: plan.billing.trialDays ?? null,
        limits: plan.limits,
      })),
    });
  });

  return app;
}
