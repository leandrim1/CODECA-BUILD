import { AppError } from '@codeca/shared';
import { renderSiteDocument } from '@codeca/site-renderer';
import { Hono } from 'hono';
import { createContext, type AppContext, type CreateContextOptions } from './context.js';
import { isProduction, platformHosts } from './env.js';
import { requestHost, requestOrigin } from './lib/http.js';
import { buildPublicSiteData, buildSitemapEntries, findRedirect, resolveTenantByHost } from './lib/site-data.js';
import { schema } from '@codeca/database';
import { eq } from 'drizzle-orm';
import type { AppBindings } from './types.js';

/**
 * Aplicacao que serve os sites publicos das construtoras.
 *
 * Roda nos dominios dos clientes e devolve HTML montado no servidor, com
 * titulo, descricao e dados estruturados prontos para os buscadores. O cache e
 * controlado por `s-maxage` e por um ETag que inclui a versao publicada do
 * site, de modo que publicar uma pagina invalida o conteudo em cache.
 */

export interface CreateSiteAppOptions extends CreateContextOptions {
  context?: AppContext;
}

/** Quanto tempo a borda guarda a pagina antes de revalidar. */
const EDGE_MAX_AGE_SECONDS = 300;
const STALE_WHILE_REVALIDATE_SECONDS = 86_400;

export function createSiteApp(options: CreateSiteAppOptions = {}) {
  const ctx = options.context ?? createContext(options);
  const app = new Hono<AppBindings>();

  app.use('*', async (c, next) => {
    c.set('ctx', ctx);
    c.set('requestId', crypto.randomUUID());
    await next();
    const headers = c.res.headers;
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'strict-origin-when-cross-origin');
    if (isProduction(ctx.env)) {
      headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
  });

  app.onError((error, c) => {
    if (error instanceof AppError && error.status < 500) {
      return c.html(errorPage(error.status, error.message), error.status as 404);
    }
    console.error(
      `[site:error] requestId=${c.get('requestId')} ${new URL(c.req.url).pathname}`,
      error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : error,
    );
    return c.html(
      errorPage(500, 'Nao foi possivel carregar a pagina agora. Tente novamente em instantes.'),
      500,
    );
  });

  /** Resolve a empresa a partir do host da requisicao. */
  async function resolve(host: string) {
    const resolved = await resolveTenantByHost(ctx.db, host, {
      platformHosts: platformHosts(ctx.env),
      allowDevSlug: !isProduction(ctx.env),
    });
    if (!resolved) {
      throw AppError.notFound('Nenhum site publicado responde por este endereco.');
    }
    return resolved;
  }

  app.get('/sitemap.xml', async (c) => {
    const resolved = await resolve(requestHost(c));
    const [settings] = await ctx.db
      .select({ seo: schema.siteSettings.seo })
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.tenantId, resolved.tenantId));

    if (settings?.seo.sitemapEnabled === false) {
      throw AppError.notFound('Sitemap desativado para este site.');
    }

    const origin = requestOrigin(c) || `https://${resolved.hostname}`;
    const entries = await buildSitemapEntries(ctx.db, resolved.tenantId, origin);
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + entries
        .map((entry) => `  <url><loc>${escapeXml(entry.loc)}</loc><lastmod>${entry.lastmod}</lastmod></url>`)
        .join('\n')
      + '\n</urlset>\n';

    return c.body(xml, 200, {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': `public, max-age=0, s-maxage=${EDGE_MAX_AGE_SECONDS}`,
    });
  });

  app.get('/robots.txt', async (c) => {
    const resolved = await resolveTenantByHost(ctx.db, requestHost(c), {
      platformHosts: platformHosts(ctx.env),
      allowDevSlug: !isProduction(ctx.env),
    });
    if (!resolved) {
      return c.body('User-agent: *\nDisallow: /\n', 200, { 'content-type': 'text/plain; charset=utf-8' });
    }

    const [settings] = await ctx.db
      .select({ seo: schema.siteSettings.seo })
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.tenantId, resolved.tenantId));

    const origin = requestOrigin(c) || `https://${resolved.hostname}`;
    const body =
      settings?.seo.robots === 'noindex'
        ? 'User-agent: *\nDisallow: /\n'
        : `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;

    return c.body(body, 200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': `public, max-age=0, s-maxage=${EDGE_MAX_AGE_SECONDS}`,
    });
  });

  app.get('*', async (c) => {
    const resolved = await resolve(requestHost(c));
    const url = new URL(c.req.url);
    const path = url.pathname || '/';

    const redirect = await findRedirect(ctx.db, resolved.tenantId, path);
    if (redirect) {
      return c.redirect(redirect.toPath, redirect.statusCode as 301);
    }

    const data = await buildPublicSiteData(ctx.db, ctx.env, {
      tenantId: resolved.tenantId,
      origin: requestOrigin(c) || `https://${resolved.hostname}`,
      path,
    });
    if (!data) throw AppError.notFound('Site nao encontrado.');

    const rendered = renderSiteDocument(data);

    // Revalidacao por ETag: evita reenviar o HTML quando nada mudou.
    if (c.req.header('if-none-match') === rendered.etag) {
      return c.body(null, 304, { etag: rendered.etag });
    }

    return c.html(rendered.html, rendered.status as 200, {
      etag: rendered.etag,
      'cache-control':
        rendered.status === 200
          ? `public, max-age=0, s-maxage=${EDGE_MAX_AGE_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`
          : 'public, max-age=0, s-maxage=30',
      vary: 'accept-encoding',
    });
  });

  return app;
}

export type SiteApp = ReturnType<typeof createSiteApp>;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Pagina simples para erros fora do escopo de um site resolvido. */
function errorPage(status: number, message: string): string {
  const safe = message.replace(/[<>&"]/g, (char) =>
    char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '&' ? '&amp;' : '&quot;',
  );
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${status === 404 ? 'Site nao encontrado' : 'Erro'}</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;
       font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a}
  main{max-width:34rem;text-align:center}
  h1{font-size:1.6rem;margin:0 0 .75rem}
  p{color:#475569;line-height:1.6;margin:0}
  code{background:#e2e8f0;padding:.15rem .4rem;border-radius:4px;font-size:.9em}
</style></head>
<body><main>
<h1>${status === 404 ? 'Nenhum site responde por este endereco' : 'Algo deu errado'}</h1>
<p>${safe}</p>
</main></body></html>
`;
}
