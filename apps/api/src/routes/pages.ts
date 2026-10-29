import { and, asc, desc, eq, publishPage, restorePageVersion, schema, sql } from '@codeca/database';
import {
  AppError,
  coercePageLayout,
  isReservedPageSlug,
  navigationMenuSchema,
  pageInputSchema,
  pageUpdateSchema,
  publishPageSchema,
  redirectSchema,
  restoreVersionSchema,
  saveDraftSchema,
  slugify,
  uuidSchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { created, noContent, ok, parseJsonBody, parseParams } from '../lib/http.js';
import { assertFeature, assertWithinLimit, loadEffectivePlan } from '../lib/plan-limits.js';
import { buildUniqueSlug } from '../lib/slugs.js';
import { requireCapability, requireVerifiedEmail, sessionOf, tenantMiddleware } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Paginas, rascunhos, versoes e publicacao.
 *
 * O site publico le exclusivamente a versao publicada (`page_versions`), nunca
 * `draft_layout`. Salvar rascunho nao altera o site; publicar cria uma nova
 * versao em transacao e incrementa o contador que invalida o cache.
 */

const pageParams = z.object({ tenantId: uuidSchema, pageId: uuidSchema });

export function pageRoutes() {
  const app = new Hono<AppBindings>();
  app.use('/:tenantId/*', tenantMiddleware());

  // ------------------------------------------------------------- listagem
  app.get('/:tenantId/pages', requireCapability('site:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const rows = await ctx.db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        title: schema.pages.title,
        isHome: schema.pages.isHome,
        status: schema.pages.status,
        showInNavigation: schema.pages.showInNavigation,
        sortOrder: schema.pages.sortOrder,
        draftRevision: schema.pages.draftRevision,
        draftUpdatedAt: schema.pages.draftUpdatedAt,
        publishedAt: schema.pages.publishedAt,
        publishedVersionId: schema.pages.publishedVersionId,
        updatedAt: schema.pages.updatedAt,
      })
      .from(schema.pages)
      .where(eq(schema.pages.tenantId, tenant.tenantId))
      .orderBy(desc(schema.pages.isHome), asc(schema.pages.sortOrder), asc(schema.pages.title));

    return ok(c, { pages: rows });
  });

  app.get('/:tenantId/pages/:pageId', requireCapability('site:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { pageId } = parseParams(c, pageParams);

    const [page] = await ctx.db
      .select()
      .from(schema.pages)
      .where(and(eq(schema.pages.id, pageId), eq(schema.pages.tenantId, tenant.tenantId)));

    if (!page) throw AppError.notFound('Pagina nao encontrada.');

    let publishedLayout = null;
    if (page.publishedVersionId) {
      const [version] = await ctx.db
        .select({ layout: schema.pageVersions.layout, version: schema.pageVersions.version })
        .from(schema.pageVersions)
        .where(
          and(
            eq(schema.pageVersions.id, page.publishedVersionId),
            eq(schema.pageVersions.tenantId, tenant.tenantId),
          ),
        );
      publishedLayout = version ?? null;
    }

    return ok(c, {
      page: { ...page, draftLayout: coercePageLayout(page.draftLayout) },
      published: publishedLayout,
    });
  });

  // -------------------------------------------------------------- criacao
  app.post('/:tenantId/pages', requireCapability('site:edit'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, pageInputSchema);

    const plan = await loadEffectivePlan(ctx.db, tenant.tenantId);
    assertFeature(plan, 'multi_page');
    await assertWithinLimit(ctx.db, tenant.tenantId, 'maxPages', { plan });

    const slug = slugify(input.slug);
    if (isReservedPageSlug(slug)) {
      throw AppError.validation('Este endereco e reservado pela plataforma. Escolha outro.', {
        fields: { slug: 'Endereco reservado.' },
      });
    }
    const uniqueSlugValue = await buildUniqueSlug(ctx.db, 'pages', {
      tenantId: tenant.tenantId,
      desired: slug,
    });

    const [page] = await ctx.db
      .insert(schema.pages)
      .values({
        tenantId: tenant.tenantId,
        slug: uniqueSlugValue,
        title: input.title,
        isHome: false,
        status: 'draft',
        draftLayout: { schemaVersion: 1, sections: [] },
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        seoImageUrl: input.seoImageUrl,
        canonicalUrl: input.canonicalUrl,
        robots: input.robots,
        showInNavigation: input.showInNavigation,
        sortOrder: input.sortOrder,
      })
      .returning();

    if (!page) throw AppError.internal('Nao foi possivel criar a pagina.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.pageCreated,
      entityType: 'page',
      entityId: page.id,
      metadata: { slug: page.slug, title: page.title },
    });

    return created(c, { page });
  });

  // ---------------------------------------------------------- metadados
  app.patch('/:tenantId/pages/:pageId', requireCapability('site:edit'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { pageId } = parseParams(c, pageParams);
    const input = await parseJsonBody(c, pageUpdateSchema);

    const [page] = await ctx.db
      .select({ id: schema.pages.id, isHome: schema.pages.isHome, slug: schema.pages.slug })
      .from(schema.pages)
      .where(and(eq(schema.pages.id, pageId), eq(schema.pages.tenantId, tenant.tenantId)));
    if (!page) throw AppError.notFound('Pagina nao encontrada.');

    const updates: Record<string, unknown> = { updatedAt: ctx.now() };
    for (const key of [
      'title',
      'seoTitle',
      'seoDescription',
      'seoImageUrl',
      'canonicalUrl',
      'robots',
      'showInNavigation',
      'sortOrder',
    ] as const) {
      if (input[key] !== undefined) updates[key] = input[key];
    }

    if (input.slug !== undefined && input.slug !== page.slug) {
      if (page.isHome) {
        throw AppError.badRequest('O endereco da pagina inicial nao pode ser alterado.');
      }
      const slug = slugify(input.slug);
      if (isReservedPageSlug(slug)) {
        throw AppError.validation('Este endereco e reservado pela plataforma.', {
          fields: { slug: 'Endereco reservado.' },
        });
      }
      updates.slug = await buildUniqueSlug(ctx.db, 'pages', {
        tenantId: tenant.tenantId,
        desired: slug,
        excludeId: pageId,
      });
    }

    const [updated] = await ctx.db
      .update(schema.pages)
      .set(updates)
      .where(and(eq(schema.pages.id, pageId), eq(schema.pages.tenantId, tenant.tenantId)))
      .returning();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.pageUpdated,
      entityType: 'page',
      entityId: pageId,
      metadata: { slug: updated?.slug },
    });

    return ok(c, { page: updated ?? null });
  });

  app.delete('/:tenantId/pages/:pageId', requireCapability('site:edit'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { pageId } = parseParams(c, pageParams);

    const [page] = await ctx.db
      .select({ id: schema.pages.id, isHome: schema.pages.isHome, slug: schema.pages.slug })
      .from(schema.pages)
      .where(and(eq(schema.pages.id, pageId), eq(schema.pages.tenantId, tenant.tenantId)));
    if (!page) throw AppError.notFound('Pagina nao encontrada.');
    if (page.isHome) throw AppError.badRequest('A pagina inicial nao pode ser excluida.');

    await ctx.db
      .delete(schema.pages)
      .where(and(eq(schema.pages.id, pageId), eq(schema.pages.tenantId, tenant.tenantId)));

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.pageDeleted,
      entityType: 'page',
      entityId: pageId,
      metadata: { slug: page.slug },
    });

    return noContent(c);
  });

  // --------------------------------------------------------- rascunho
  app.put('/:tenantId/pages/:pageId/draft', requireCapability('site:edit'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { pageId } = parseParams(c, pageParams);
    const input = await parseJsonBody(c, saveDraftSchema);

    const [page] = await ctx.db
      .select({ id: schema.pages.id, draftRevision: schema.pages.draftRevision })
      .from(schema.pages)
      .where(and(eq(schema.pages.id, pageId), eq(schema.pages.tenantId, tenant.tenantId)));
    if (!page) throw AppError.notFound('Pagina nao encontrada.');

    // Evita que duas abas sobrescrevam o trabalho uma da outra.
    if (input.baseRevision !== undefined && input.baseRevision !== page.draftRevision) {
      throw AppError.conflict(
        'Esta pagina foi alterada em outro lugar depois que voce abriu o editor. '
          + 'Recarregue para ver a versao mais recente.',
        { currentRevision: page.draftRevision, sentRevision: input.baseRevision },
      );
    }

    const [updated] = await ctx.db
      .update(schema.pages)
      .set({
        draftLayout: input.layout,
        draftRevision: sql`${schema.pages.draftRevision} + 1`,
        draftUpdatedAt: ctx.now(),
        updatedAt: ctx.now(),
      })
      .where(and(eq(schema.pages.id, pageId), eq(schema.pages.tenantId, tenant.tenantId)))
      .returning({
        draftRevision: schema.pages.draftRevision,
        draftUpdatedAt: schema.pages.draftUpdatedAt,
      });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.pageDraftSaved,
      entityType: 'page',
      entityId: pageId,
      metadata: { sections: input.layout.sections.length },
    });

    return ok(c, {
      draftRevision: updated?.draftRevision ?? page.draftRevision + 1,
      draftUpdatedAt: updated?.draftUpdatedAt ?? ctx.now(),
    });
  });

  // -------------------------------------------------------- publicacao
  app.post(
    '/:tenantId/pages/:pageId/publish',
    requireVerifiedEmail(),
    requireCapability('site:publish'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const session = sessionOf(c);
      const { pageId } = parseParams(c, pageParams);
      const input = await parseJsonBody(c, publishPageSchema);

      const result = await publishPage(ctx.db, {
        tenantId: tenant.tenantId,
        pageId,
        userId: session.user.id,
        note: input.note,
      });

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.pagePublished,
        entityType: 'page',
        entityId: pageId,
        metadata: { version: result.version, siteVersion: result.siteVersion },
      });

      return ok(c, {
        version: result.version,
        versionId: result.versionId,
        siteVersion: result.siteVersion,
        publishedAt: result.publishedAt.toISOString(),
      });
    },
  );

  // ----------------------------------------------------------- versoes
  app.get('/:tenantId/pages/:pageId/versions', requireCapability('site:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { pageId } = parseParams(c, pageParams);

    const plan = await loadEffectivePlan(ctx.db, tenant.tenantId);
    const historyEnabled = plan.limits.features.includes('version_history');

    const rows = await ctx.db
      .select({
        id: schema.pageVersions.id,
        version: schema.pageVersions.version,
        note: schema.pageVersions.note,
        createdAt: schema.pageVersions.createdAt,
        publishedByUserId: schema.pageVersions.publishedByUserId,
        authorName: schema.users.name,
        authorEmail: schema.users.email,
      })
      .from(schema.pageVersions)
      .leftJoin(schema.users, eq(schema.users.id, schema.pageVersions.publishedByUserId))
      .where(
        and(eq(schema.pageVersions.pageId, pageId), eq(schema.pageVersions.tenantId, tenant.tenantId)),
      )
      .orderBy(desc(schema.pageVersions.version))
      .limit(historyEnabled ? 50 : 1);

    return ok(c, { versions: rows, historyEnabled, planName: plan.planName });
  });

  app.post('/:tenantId/pages/:pageId/restore', requireCapability('site:restore'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const { pageId } = parseParams(c, pageParams);
    const input = await parseJsonBody(c, restoreVersionSchema);

    const plan = await loadEffectivePlan(ctx.db, tenant.tenantId);
    assertFeature(plan, 'version_history');

    const result = await restorePageVersion(ctx.db, {
      tenantId: tenant.tenantId,
      pageId,
      versionId: input.versionId,
      userId: session.user.id,
      publish: input.publish,
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.pageVersionRestored,
      entityType: 'page',
      entityId: pageId,
      metadata: { versionId: input.versionId, published: input.publish },
    });

    return ok(c, {
      layout: result.layout,
      published: result.published
        ? { version: result.published.version, siteVersion: result.published.siteVersion }
        : null,
    });
  });

  // -------------------------------------------------------- navegacao
  app.get('/:tenantId/navigation', requireCapability('site:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const rows = await ctx.db
      .select()
      .from(schema.navigationMenus)
      .where(eq(schema.navigationMenus.tenantId, tenant.tenantId))
      .orderBy(asc(schema.navigationMenus.key));
    return ok(c, { menus: rows });
  });

  app.put('/:tenantId/navigation/:key', requireCapability('site:edit'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { key } = parseParams(c, z.object({ tenantId: uuidSchema, key: z.string().min(1).max(60) }));
    const input = await parseJsonBody(c, navigationMenuSchema);

    const [menu] = await ctx.db
      .insert(schema.navigationMenus)
      .values({ tenantId: tenant.tenantId, key, label: input.label, items: input.items })
      .onConflictDoUpdate({
        target: [schema.navigationMenus.tenantId, schema.navigationMenus.key],
        set: { label: input.label, items: input.items, updatedAt: ctx.now() },
      })
      .returning();

    return ok(c, { menu: menu ?? null });
  });

  // ----------------------------------------------------- redirecionamentos
  app.get('/:tenantId/redirects', requireCapability('site:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const rows = await ctx.db
      .select()
      .from(schema.redirects)
      .where(eq(schema.redirects.tenantId, tenant.tenantId))
      .orderBy(asc(schema.redirects.fromPath));
    return ok(c, { redirects: rows });
  });

  app.post('/:tenantId/redirects', requireCapability('site:edit'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, redirectSchema);

    if (input.fromPath === input.toPath) {
      throw AppError.validation('A origem e o destino do redirecionamento nao podem ser iguais.', {
        fields: { toPath: 'Informe um destino diferente da origem.' },
      });
    }

    const [row] = await ctx.db
      .insert(schema.redirects)
      .values({ tenantId: tenant.tenantId, ...input })
      .onConflictDoUpdate({
        target: [schema.redirects.tenantId, schema.redirects.fromPath],
        set: { toPath: input.toPath, statusCode: input.statusCode, enabled: input.enabled, updatedAt: ctx.now() },
      })
      .returning();

    return created(c, { redirect: row ?? null });
  });

  app.delete('/:tenantId/redirects/:redirectId', requireCapability('site:edit'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { redirectId } = parseParams(c, z.object({ tenantId: uuidSchema, redirectId: uuidSchema }));

    await ctx.db
      .delete(schema.redirects)
      .where(and(eq(schema.redirects.id, redirectId), eq(schema.redirects.tenantId, tenant.tenantId)));

    return noContent(c);
  });

  return app;
}
