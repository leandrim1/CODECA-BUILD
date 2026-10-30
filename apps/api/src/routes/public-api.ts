import { eq, schema } from '@codeca/database';
import { MODULE_REGISTRY } from '@codeca/shared';
import { Hono } from 'hono';
import { ok } from '../lib/http.js';
import { enabledModuleKeys, loadSiteModules } from '../lib/modules.js';
import { apiKeyMiddleware } from '../middleware/api-key.js';
import type { AppBindings } from '../types.js';

/**
 * API publica consumida pelos sites desenvolvidos pela CODECA IA.
 *
 * Versionada em `/v1` desde a primeira rota: o site do cliente e codigo que
 * nao controlamos de perto, e quebrar o contrato quebra o site dele.
 *
 * O conteudo em si chega na proxima etapa. O que existe aqui ja prova o
 * caminho inteiro: credencial conferida, origem autorizada e escopo aplicado.
 */

export function publicApiRoutes() {
  const app = new Hono<AppBindings>();

  /**
   * Preflight.
   *
   * O navegador envia o OPTIONS **sem** o cabecalho de autorizacao, entao nao
   * ha o que autenticar aqui. Responder de forma permissiva nao abre nada: a
   * requisicao real que vem depois passa pela conferencia completa, e sem ela
   * o navegador nao entrega resposta nenhuma a pagina.
   */
  app.options('/*', (c) => {
    const origin = c.req.header('origin');
    if (origin) {
      c.header('access-control-allow-origin', origin);
      c.header('vary', 'origin');
    }
    c.header('access-control-allow-methods', 'GET, POST, OPTIONS');
    c.header('access-control-allow-headers', 'authorization, content-type');
    c.header('access-control-max-age', '600');
    return c.body(null, 204);
  });

  app.use('/*', apiKeyMiddleware());

  /** Identidade do site e modulos disponiveis. E o `getSite()` do SDK. */
  app.get('/site', async (c) => {
    const ctx = c.get('ctx');
    const credencial = c.get('apiKey');

    const [site] = await ctx.db
      .select({
        id: schema.sites.id,
        name: schema.sites.name,
        slug: schema.sites.slug,
        status: schema.sites.status,
        segment: schema.segments.code,
      })
      .from(schema.sites)
      .leftJoin(schema.segments, eq(schema.segments.id, schema.sites.segmentId))
      .where(eq(schema.sites.id, credencial.siteId));

    const state = await loadSiteModules(ctx.db, credencial.siteId);

    return ok(c, {
      site,
      // Nomes e tipos dos modulos, sem a politica de campos: ela diz o que o
      // cliente pode editar no painel, e nao interessa a quem le o site.
      modules: enabledModuleKeys(state).map((key) => ({
        key,
        name: MODULE_REGISTRY[key].name,
        kind: MODULE_REGISTRY[key].kind,
      })),
      scopes: credencial.scopes,
    });
  });

  return app;
}
