import { eq, schema } from '@codeca/database';
import { AppError, normalizeOrigin, uuidSchema } from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { auditFromContext } from '../lib/audit-context.js';
import { demoTransitionPreview, endDemo, loadDemoCredential } from '../lib/demo.js';
import { ok, parseJsonBody } from '../lib/http.js';
import { requirePlatform } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Rotas do site de demonstracao.
 *
 * Tres publicos, tres conjuntos:
 *
 * - **o visitante** (`demoPublicRoutes`): le o conteudo da demonstracao;
 * - **o cliente** (`demoTenantRoutes`): descobre se tem uma, e onde ve-la;
 * - **a CODECA IA** (`demoPlatformRoutes`): encerra a demonstracao ao ligar o
 *   site real.
 */

/** O que a pagina de demonstracao pode ler. Lista fechada, so leitura. */
const LEITURAS_PERMITIDAS = new Set([
  'site',
  'content/institucional',
  'content/contato',
  'banners',
  'services',
  'products',
  'categories',
  'galleries',
  'testimonials',
  'team',
  'faqs',
]);

/**
 * Leitura publica da demonstracao.
 *
 * **Esta rota nao le conteudo nenhum.** Ela encaminha o pedido para a API
 * publica (`/v1/...`) com a chave publicavel do proprio site, e devolve o que
 * a API responder. O conteudo passa, portanto, pela mesma autenticacao, pela
 * mesma conferencia de assinatura (402 quando a avaliacao vence) e pelo mesmo
 * cache de um site real -- nao ha segundo caminho de leitura para manter nem
 * para esquecer de proteger.
 *
 * Existe porque a pagina de demonstracao mora no mesmo endereco da plataforma:
 * o navegador nao envia `Origin` em leitura de mesma origem, e a chave
 * publicavel exige uma. O encaminhamento, feito no servidor, informa a origem
 * da plataforma -- que e a unica autorizada para essa chave.
 *
 * O `siteId` do caminho so serve para ACHAR a chave. Quem decide o que e
 * devolvido e a chave: ela pertence a um site e a uma empresa, e a API publica
 * so entrega o que e deles.
 */
export function demoPublicRoutes(forward: (request: Request) => Response | Promise<Response>) {
  const app = new Hono<AppBindings>();

  app.get('/:siteId/*', async (c) => {
    const ctx = c.get('ctx');
    const siteId = uuidSchema.safeParse(c.req.param('siteId'));
    // Uma resposta so para tudo que nao e uma demonstracao em vigor: a rota
    // nao revela quais sites existem.
    const naoEncontrado = () => AppError.notFound('Demonstração não encontrada.');
    if (!siteId.success) throw naoEncontrado();

    const url = new URL(c.req.url);
    const marcador = `/demo/${c.req.param('siteId')}/`;
    const posicao = url.pathname.indexOf(marcador);
    const recurso = posicao >= 0 ? url.pathname.slice(posicao + marcador.length) : '';
    if (!LEITURAS_PERMITIDAS.has(recurso)) throw naoEncontrado();

    const credencial = await loadDemoCredential(ctx.db, siteId.data);
    if (!credencial) throw naoEncontrado();

    const destino = new URL(url.toString());
    destino.pathname = `${url.pathname.slice(0, posicao)}/v1/${recurso}`;
    destino.search = '';

    const resposta = await forward(
      new Request(destino.toString(), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${credencial.token}`,
          origin: normalizeOrigin(ctx.env.APP_URL) ?? '',
          accept: 'application/json',
        },
      }),
    );

    // So o corpo e o status seguem. Os cabecalhos de CORS da API publica nao
    // fazem sentido aqui (mesma origem), e a chave nunca volta ao navegador.
    return new Response(await resposta.text(), {
      status: resposta.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  });

  return app;
}

/** O que o painel precisa saber para oferecer "ver meu site de demonstração". */
export function demoTenantRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/:tenantId/demo', async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    // O site vem do vinculo ja conferido da sessao com a empresa, nunca de um
    // identificador enviado pelo navegador.
    const [site] = await ctx.db
      .select({ id: schema.sites.id, isDemo: schema.sites.isDemo, demoSeed: schema.sites.demoSeed })
      .from(schema.sites)
      .where(eq(schema.sites.id, tenant.siteId));

    const ativa = Boolean(site?.isDemo);

    // Fim da avaliacao, para o painel dizer quanto tempo resta. So leitura da
    // assinatura que ja existe: a demonstracao nao tem prazo proprio.
    const [assinatura] = await ctx.db
      .select({ status: schema.subscriptions.status, trialEndsAt: schema.subscriptions.trialEndsAt })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.siteId, tenant.siteId));

    return ok(c, {
      demo: {
        active: ativa,
        trialEndsAt: assinatura?.status === 'trialing' ? (assinatura.trialEndsAt?.toISOString() ?? null) : null,
        // Caminho dentro da plataforma; o painel monta o endereco completo.
        path: ativa && site ? `/demonstracao/${site.id}` : null,
        examples: ativa
          ? (site?.demoSeed?.records.banners.length ?? 0) + (site?.demoSeed?.records.services.length ?? 0)
          : 0,
        // Ja foi demonstracao e virou o site real.
        ended: Boolean(site && !site.isDemo && site.demoSeed?.endedAt),
      },
    });
  });

  return app;
}

const encerrarSchema = z.object({
  /** Precisa vir `true`: a transicao nunca acontece por omissao. */
  confirm: z.literal(true),
  /** `true` apaga os exemplos que o cliente nao editou. Nada mais e apagado. */
  removeUntouchedExamples: z.boolean(),
});

/** Transicao da demonstracao para o site real, pelo painel mestre. */
export function demoPlatformRoutes() {
  const app = new Hono<AppBindings>();

  /** O que a transicao faria, sem fazer nada. */
  app.get('/sites/:siteId/demo', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const siteId = uuidSchema.parse(c.req.param('siteId'));
    return ok(c, { transition: await demoTransitionPreview(ctx.db, siteId) });
  });

  app.post('/sites/:siteId/demo/end', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const siteId = uuidSchema.parse(c.req.param('siteId'));
    const input = await parseJsonBody(c, encerrarSchema);

    const resultado = await endDemo(ctx.db, {
      siteId,
      removeUntouchedExamples: input.removeUntouchedExamples,
      now: ctx.now(),
      appUrl: ctx.env.APP_URL,
    });

    // A chave da demonstracao foi revogada: nenhuma instancia pode continuar
    // servindo-a a partir do cache.
    ctx.caches.invalidateAll();

    await auditFromContext(c, {
      action: 'platform.demo_ended',
      entityType: 'site',
      entityId: siteId,
      metadata: {
        removeUntouchedExamples: input.removeUntouchedExamples,
        removed: resultado.removed,
        kept: resultado.kept,
      },
    });

    return ok(c, { result: resultado });
  });

  return app;
}
