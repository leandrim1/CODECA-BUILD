import { AppError, uuidSchema } from '@codeca/shared';
import { renderSiteDocument } from '@codeca/site-renderer';
import { and, eq, schema } from '@codeca/database';
import { Hono } from 'hono';
import { z } from 'zod';
import { resolveTenantContext } from '../lib/authz.js';
import { parseParams, requestOrigin } from '../lib/http.js';
import { buildPublicSiteData } from '../lib/site-data.js';
import { sessionMiddleware } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Previa do site para o editor.
 *
 * Usa exatamente o mesmo renderizador do site publicado, servido no dominio do
 * painel e protegido por sessao. Como o editor exibe esta pagina em um iframe,
 * as media queries respondem a largura escolhida (desktop, tablet, celular) do
 * mesmo jeito que responderiam em um aparelho real.
 */
export function renderRoutes() {
  const app = new Hono<AppBindings>();
  app.use('*', sessionMiddleware());

  app.get('/preview/:tenantId', async (c) => {
    const ctx = c.get('ctx');
    const session = c.get('session');
    if (!session) throw AppError.unauthenticated('Faca login para visualizar a previa.');

    const { tenantId } = parseParams(c, z.object({ tenantId: uuidSchema }));
    const tenant = await resolveTenantContext(ctx.db, session, tenantId, ctx.now());
    if (!tenant.capabilities.has('site:read')) {
      throw AppError.forbidden('Seu papel nao permite visualizar a previa do site.');
    }

    const path = c.req.query('path') ?? '/';
    // `published=1` mostra o que esta no ar; o padrao e o rascunho em edicao.
    const preview = c.req.query('published') !== '1';

    const [primaryDomain] = await ctx.db
      .select({ hostname: schema.domains.hostname })
      .from(schema.domains)
      .where(and(eq(schema.domains.tenantId, tenantId), eq(schema.domains.isPrimary, true)));

    const data = await buildPublicSiteData(ctx.db, ctx.env, {
      tenantId,
      origin: primaryDomain ? `https://${primaryDomain.hostname}` : requestOrigin(c),
      path,
      preview,
    });
    if (!data) throw AppError.notFound('Site nao encontrado.');

    const rendered = renderSiteDocument(data);

    return c.html(rendered.html, 200, {
      // A previa nunca e cacheada nem indexada.
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    });
  });

  return app;
}
