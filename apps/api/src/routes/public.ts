import { and, eq, schema, type Database } from '@codeca/database';
import {
  AppError,
  LEAD_INTEREST_LABELS,
  publicLeadSchema,
  uuidSchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js';
import { clientIp, created, ok, parseJsonBody, parseParams, requestHost, requestOrigin, userAgent } from '../lib/http.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { buildPublicSiteData, buildSitemapEntries, findRedirect, resolveTenantByHost } from '../lib/site-data.js';
import { isProduction, platformHosts } from '../env.js';
import { resolveTenantContext } from '../lib/authz.js';
import { sessionMiddleware } from '../middleware/auth.js';
import { hashIp } from '@codeca/shared/server';
import type { AppBindings } from '../types.js';

/**
 * Endpoints publicos dos sites das construtoras.
 *
 * A empresa e sempre identificada pelo dominio da requisicao. O corpo da
 * requisicao nunca informa a empresa, o que impede que um visitante grave um
 * interessado na base de outra construtora.
 */

export function publicRoutes() {
  const app = new Hono<AppBindings>();

  /** Dados do site para o host atual; usado pelo renderizador. */
  app.get('/site', async (c) => {
    const ctx = c.get('ctx');
    const host = requestHost(c);
    const path = c.req.query('path') ?? '/';

    const resolved = await resolveTenantByHost(ctx.db, host, {
      platformHosts: platformHosts(ctx.env),
      allowDevSlug: !isProduction(ctx.env),
    });
    if (!resolved) {
      throw AppError.notFound('Nenhum site publicado responde por este endereco.');
    }

    const redirect = await findRedirect(ctx.db, resolved.tenantId, path);
    if (redirect) {
      return ok(c, { redirect });
    }

    const data = await buildPublicSiteData(ctx.db, ctx.env, {
      tenantId: resolved.tenantId,
      origin: requestOrigin(c) || `https://${resolved.hostname}`,
      path,
    });
    if (!data) throw AppError.notFound('Site nao encontrado.');

    c.header('cache-control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    c.header('etag', `W/"${resolved.tenantId}-${data.context.siteVersion}-${path}"`);
    return ok(c, data);
  });

  /**
   * Previa autenticada: usa o rascunho da pagina. Exige sessao com vinculo na
   * empresa e capacidade de leitura do site.
   */
  app.use('/preview/*', sessionMiddleware());
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
    const [primaryDomain] = await ctx.db
      .select({ hostname: schema.domains.hostname })
      .from(schema.domains)
      .where(and(eq(schema.domains.tenantId, tenantId), eq(schema.domains.isPrimary, true)));

    const data = await buildPublicSiteData(ctx.db, ctx.env, {
      tenantId,
      origin: primaryDomain ? `https://${primaryDomain.hostname}` : requestOrigin(c),
      path,
      preview: true,
    });
    if (!data) throw AppError.notFound('Site nao encontrado.');

    c.header('cache-control', 'no-store');
    return ok(c, data);
  });

  /** Recebe um interessado pelo formulario publico. */
  app.post('/leads', async (c) => {
    const ctx = c.get('ctx');
    const host = requestHost(c);
    const ip = clientIp(c);

    const resolved = await resolveTenantByHost(ctx.db, host, {
      platformHosts: platformHosts(ctx.env),
      allowDevSlug: !isProduction(ctx.env),
    });
    if (!resolved) {
      throw AppError.notFound('Formulario indisponivel para este endereco.');
    }

    const subject = rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET);
    await enforceRateLimit(ctx.db, RATE_LIMITS.publicLead, subject, ctx.now());
    await enforceRateLimit(ctx.db, RATE_LIMITS.publicLeadDaily, `${resolved.tenantId}:${subject}`, ctx.now());

    const input = await parseJsonBody(c, publicLeadSchema);

    // Campo oculto preenchido indica envio automatizado: responde 201 sem gravar.
    if (input.honeypot && input.honeypot.trim().length > 0) {
      return created(c, { received: true });
    }

    // Os vinculos opcionais precisam pertencer a esta empresa e estar publicados.
    const propertyId = await validateReference(ctx.db, resolved.tenantId, 'property', input.propertyId);
    const projectId = await validateReference(ctx.db, resolved.tenantId, 'project', input.projectId);
    const serviceId = await validateReference(ctx.db, resolved.tenantId, 'service', input.serviceId);

    const [lead] = await ctx.db
      .insert(schema.leads)
      .values({
        tenantId: resolved.tenantId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        interestType: input.interestType,
        message: input.message,
        propertyId,
        projectId,
        serviceId,
        sourcePath: input.sourcePath.slice(0, 512),
        status: 'novo',
        consentAt: ctx.now(),
        ipHash: hashIp(ip, ctx.env.AUTH_SECRET),
        userAgent: userAgent(c),
      })
      .returning({ id: schema.leads.id });

    if (!lead) throw AppError.internal('Nao foi possivel registrar a sua mensagem.');

    await recordAudit(ctx.db, ctx.env, {
      tenantId: resolved.tenantId,
      action: AUDIT_ACTIONS.leadReceived,
      entityType: 'lead',
      entityId: lead.id,
      // Sem nome, telefone ou mensagem: a auditoria registra o evento, nao o dado.
      metadata: { interestType: input.interestType, hasEmail: input.email.length > 0 },
      ip,
      userAgent: userAgent(c),
    });

    const [tenantRow] = await ctx.db
      .select({ email: schema.tenants.contactEmail, name: schema.tenants.displayName })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, resolved.tenantId));

    if (tenantRow?.email) {
      await ctx.mailer.send({
        to: tenantRow.email,
        kind: 'lead_notification',
        subject: `Novo interessado no site da ${tenantRow.name}`,
        text:
          `Um novo contato chegou pelo site.\n\n`
          + `Interesse: ${LEAD_INTEREST_LABELS[input.interestType]}\n`
          + `Nome: ${input.name}\nTelefone: ${input.phone}\n`
          + (input.email ? `E-mail: ${input.email}\n` : '')
          + `\nAcesse o painel para responder.`,
      });
    }

    return created(c, { received: true });
  });

  /** Sitemap do site publicado no host atual. */
  app.get('/sitemap.xml', async (c) => {
    const ctx = c.get('ctx');
    const resolved = await resolveTenantByHost(ctx.db, requestHost(c), {
      platformHosts: platformHosts(ctx.env),
      allowDevSlug: !isProduction(ctx.env),
    });
    if (!resolved) throw AppError.notFound('Sitemap indisponivel.');

    const [settings] = await ctx.db
      .select({ seo: schema.siteSettings.seo })
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.tenantId, resolved.tenantId));

    if (settings?.seo && settings.seo.sitemapEnabled === false) {
      throw AppError.notFound('Sitemap desativado para este site.');
    }

    const origin = requestOrigin(c) || `https://${resolved.hostname}`;
    const entries = await buildSitemapEntries(ctx.db, resolved.tenantId, origin);

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + entries
        .map((entry) => `  <url><loc>${escapeXml(entry.loc)}</loc><lastmod>${entry.lastmod}</lastmod></url>`)
        .join('\n')
      + '\n</urlset>\n';

    return c.body(xml, 200, {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600',
    });
  });

  /** robots.txt do site publicado no host atual. */
  app.get('/robots.txt', async (c) => {
    const ctx = c.get('ctx');
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
    const noindex = settings?.seo?.robots === 'noindex';
    const body = noindex
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;

    return c.body(body, 200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=3600',
    });
  });

  return app;
}

/** Confere que o conteudo relacionado pertence a empresa e esta publicado. */
async function validateReference(
  db: Database,
  tenantId: string,
  kind: 'property' | 'project' | 'service',
  id: string | null,
): Promise<string | null> {
  if (!id) return null;

  if (kind === 'property') {
    const [row] = await db
      .select({ id: schema.properties.id })
      .from(schema.properties)
      .where(
        and(
          eq(schema.properties.id, id),
          eq(schema.properties.tenantId, tenantId),
          eq(schema.properties.publicationStatus, 'published'),
        ),
      );
    return row ? row.id : null;
  }

  if (kind === 'project') {
    const [row] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.id, id),
          eq(schema.projects.tenantId, tenantId),
          eq(schema.projects.publicationStatus, 'published'),
        ),
      );
    return row ? row.id : null;
  }

  const [row] = await db
    .select({ id: schema.services.id })
    .from(schema.services)
    .where(
      and(
        eq(schema.services.id, id),
        eq(schema.services.tenantId, tenantId),
        eq(schema.services.publicationStatus, 'published'),
      ),
    );
  return row ? row.id : null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
