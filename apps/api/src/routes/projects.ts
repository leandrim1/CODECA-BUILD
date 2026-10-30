import { and, asc, desc, eq, ilike, inArray, or, schema, sql } from '@codeca/database';
import {
  AppError,
  paginate,
  projectInputSchema,
  projectQuerySchema,
  projectUpdateEntrySchema,
  projectUpdateSchema,
  reorderSchema,
  slugify,
  uuidSchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { created, noContent, ok, parseJsonBody, parseParams, parseQuery } from '../lib/http.js';
import { assertMediaBelongsToTenant, loadGallery, loadMediaByIds, syncGallery } from '../lib/media-refs.js';
import { assertWithinLimit } from '../lib/plan-limits.js';
import { buildUniqueSlug } from '../lib/slugs.js';
import { requireCapability, sessionOf, tenantMiddleware } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Obras e projetos.
 *
 * O percentual de evolucao e sempre informado pela construtora. Quando nao e
 * preenchido, permanece nulo e o site publico nao exibe barra de progresso --
 * a plataforma nunca estima esse numero.
 */

const projectParams = z.object({ tenantId: uuidSchema, projectId: uuidSchema });

export function projectRoutes() {
  const app = new Hono<AppBindings>();
  app.use('/:tenantId/*', tenantMiddleware());

  app.get('/:tenantId/projects', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const query = parseQuery(c, projectQuerySchema);

    const conditions = [eq(schema.projects.tenantId, tenant.tenantId)];
    if (query.search) {
      const term = `%${query.search}%`;
      const clause = or(ilike(schema.projects.title, term), ilike(schema.projects.shortDescription, term));
      if (clause) conditions.push(clause);
    }
    if (query.category) conditions.push(eq(schema.projects.category, query.category));
    if (query.status) conditions.push(eq(schema.projects.status, query.status));
    if (query.stage) conditions.push(eq(schema.projects.stage, query.stage));
    if (query.publicationStatus) {
      conditions.push(eq(schema.projects.publicationStatus, query.publicationStatus));
    }

    const where = and(...conditions);
    const direction = query.sortDir === 'asc' ? asc : desc;
    const orderBy =
      query.sortBy === 'title'
        ? direction(schema.projects.title)
        : query.sortBy === 'manual'
          ? asc(schema.projects.sortOrder)
          : direction(schema.projects.createdAt);

    const rows = await ctx.db
      .select()
      .from(schema.projects)
      .where(where)
      .orderBy(orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.projects)
      .where(where);

    const covers = await loadMediaByIds(ctx.db, tenant.tenantId, rows.map((r) => r.coverImageId));

    return ok(
      c,
      paginate(
        rows.map((row) => ({
          ...row,
          coverImage: row.coverImageId ? covers.get(row.coverImageId) ?? null : null,
        })),
        totals?.total ?? 0,
        query,
      ),
    );
  });

  app.get('/:tenantId/projects/:projectId', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { projectId } = parseParams(c, projectParams);

    const [row] = await ctx.db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.tenantId, tenant.tenantId)));
    if (!row) throw AppError.notFound('Obra nao encontrada.');

    const gallery = await loadGallery(ctx.db, 'project', {
      tenantId: tenant.tenantId,
      entityIds: [projectId],
    });
    const covers = await loadMediaByIds(ctx.db, tenant.tenantId, [row.coverImageId]);

    const updates = await ctx.db
      .select()
      .from(schema.projectUpdates)
      .where(
        and(
          eq(schema.projectUpdates.projectId, projectId),
          eq(schema.projectUpdates.tenantId, tenant.tenantId),
        ),
      )
      .orderBy(desc(schema.projectUpdates.recordedAt), desc(schema.projectUpdates.createdAt));

    const updateImages = await loadGallery(ctx.db, 'projectUpdate', {
      tenantId: tenant.tenantId,
      entityIds: updates.map((u) => u.id),
    });

    return ok(c, {
      project: {
        ...row,
        coverImage: row.coverImageId ? covers.get(row.coverImageId) ?? null : null,
        gallery: gallery.get(projectId) ?? [],
      },
      updates: updates.map((update) => ({ ...update, images: updateImages.get(update.id) ?? [] })),
    });
  });

  app.post('/:tenantId/projects', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, projectInputSchema);

    await assertWithinLimit(ctx.db, tenant.tenantId, 'maxProjects');
    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [input.coverImageId, ...input.galleryImageIds]);

    const slug = await buildUniqueSlug(ctx.db, 'projects', {
      tenantId: tenant.tenantId,
      desired: input.slug ?? input.title,
    });

    const [row] = await ctx.db
      .insert(schema.projects)
      .values({
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        slug,
        title: input.title,
        description: input.description,
        shortDescription: input.shortDescription,
        category: input.category,
        status: input.status,
        stage: input.stage,
        progressPercent: input.progressPercent,
        city: input.city,
        state: input.state,
        neighborhood: input.neighborhood,
        showLocation: input.showLocation,
        startDate: input.startDate,
        expectedCompletionDate: input.expectedCompletionDate,
        completedDate: input.completedDate,
        coverImageId: input.coverImageId,
        publicationStatus: input.publicationStatus,
        featured: input.featured,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        sortOrder: input.sortOrder,
        publishedAt: input.publicationStatus === 'published' ? ctx.now() : null,
      })
      .returning();
    if (!row) throw AppError.internal('Nao foi possivel cadastrar a obra.');

    await syncGallery(ctx.db, 'project', {
      tenantId: tenant.tenantId,
      entityId: row.id,
      mediaIds: input.galleryImageIds,
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.projectCreated,
      entityType: 'project',
      entityId: row.id,
      metadata: { title: row.title, slug: row.slug },
    });

    return created(c, { project: row });
  });

  app.patch('/:tenantId/projects/:projectId', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { projectId } = parseParams(c, projectParams);
    const input = await parseJsonBody(c, projectUpdateSchema);

    const [current] = await ctx.db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.tenantId, tenant.tenantId)));
    if (!current) throw AppError.notFound('Obra nao encontrada.');

    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [
      input.coverImageId ?? null,
      ...(input.galleryImageIds ?? []),
    ]);

    const updates: Record<string, unknown> = { updatedAt: ctx.now() };
    for (const key of [
      'title','description','shortDescription','category','status','stage','progressPercent','city','state',
      'neighborhood','showLocation','startDate','expectedCompletionDate','completedDate','coverImageId',
      'featured','seoTitle','seoDescription','sortOrder',
    ] as const) {
      if (input[key] !== undefined) updates[key] = input[key];
    }

    if (input.publicationStatus !== undefined) {
      updates.publicationStatus = input.publicationStatus;
      if (input.publicationStatus === 'published' && !current.publishedAt) updates.publishedAt = ctx.now();
      updates.archivedAt = input.publicationStatus === 'archived' ? ctx.now() : null;
    }

    if (input.slug !== undefined) {
      updates.slug = await buildUniqueSlug(ctx.db, 'projects', {
        tenantId: tenant.tenantId,
        desired: slugify(input.slug),
        excludeId: projectId,
      });
    }

    const [row] = await ctx.db
      .update(schema.projects)
      .set(updates)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.tenantId, tenant.tenantId)))
      .returning();

    if (input.galleryImageIds !== undefined) {
      await syncGallery(ctx.db, 'project', {
        tenantId: tenant.tenantId,
        entityId: projectId,
        mediaIds: input.galleryImageIds,
      });
    }

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.projectUpdated,
      entityType: 'project',
      entityId: projectId,
      metadata: { stage: row?.stage, status: row?.status },
    });

    return ok(c, { project: row ?? null });
  });

  app.delete('/:tenantId/projects/:projectId', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { projectId } = parseParams(c, projectParams);

    const [current] = await ctx.db
      .select({ id: schema.projects.id, title: schema.projects.title })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.tenantId, tenant.tenantId)));
    if (!current) throw AppError.notFound('Obra nao encontrada.');

    await ctx.db
      .delete(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.tenantId, tenant.tenantId)));

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.projectDeleted,
      entityType: 'project',
      entityId: projectId,
      metadata: { title: current.title },
    });

    return noContent(c);
  });

  // ------------------------------------------------- evolucao da obra
  app.post('/:tenantId/projects/:projectId/updates', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const { projectId } = parseParams(c, projectParams);
    const input = await parseJsonBody(c, projectUpdateEntrySchema);

    const [project] = await ctx.db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.tenantId, tenant.tenantId)));
    if (!project) throw AppError.notFound('Obra nao encontrada.');

    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, input.imageIds);

    const [row] = await ctx.db
      .insert(schema.projectUpdates)
      .values({
        tenantId: tenant.tenantId,
        projectId,
        title: input.title,
        note: input.note,
        stage: input.stage ?? null,
        progressPercent: input.progressPercent,
        recordedAt: input.recordedAt,
        createdByUserId: session.user.id,
      })
      .returning();
    if (!row) throw AppError.internal('Nao foi possivel registrar a evolucao.');

    await syncGallery(ctx.db, 'projectUpdate', {
      tenantId: tenant.tenantId,
      entityId: row.id,
      mediaIds: input.imageIds,
    });

    // O registro mais recente atualiza a etapa e o percentual da obra.
    const projectPatch: Record<string, unknown> = { updatedAt: ctx.now() };
    if (input.stage) projectPatch.stage = input.stage;
    if (input.progressPercent !== null) projectPatch.progressPercent = input.progressPercent;
    await ctx.db
      .update(schema.projects)
      .set(projectPatch)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.tenantId, tenant.tenantId)));

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.projectUpdated,
      entityType: 'project_update',
      entityId: row.id,
      metadata: { projectId, stage: input.stage ?? null },
    });

    return created(c, { update: row });
  });

  app.delete(
    '/:tenantId/projects/:projectId/updates/:updateId',
    requireCapability('content:delete'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const { projectId, updateId } = parseParams(
        c,
        z.object({ tenantId: uuidSchema, projectId: uuidSchema, updateId: uuidSchema }),
      );

      const result = await ctx.db
        .delete(schema.projectUpdates)
        .where(
          and(
            eq(schema.projectUpdates.id, updateId),
            eq(schema.projectUpdates.projectId, projectId),
            eq(schema.projectUpdates.tenantId, tenant.tenantId),
          ),
        )
        .returning({ id: schema.projectUpdates.id });

      if (result.length === 0) throw AppError.notFound('Registro de evolucao nao encontrado.');
      return noContent(c);
    },
  );

  app.post('/:tenantId/projects/reorder', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, reorderSchema);

    const rows = await ctx.db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.tenantId, tenant.tenantId), inArray(schema.projects.id, input.ids)));
    if (rows.length !== input.ids.length) {
      throw AppError.notFound('Uma ou mais obras informadas nao pertencem a esta empresa.');
    }

    await ctx.db.transaction(async (tx) => {
      for (const [index, id] of input.ids.entries()) {
        await tx
          .update(schema.projects)
          .set({ sortOrder: index, updatedAt: ctx.now() })
          .where(and(eq(schema.projects.id, id), eq(schema.projects.tenantId, tenant.tenantId)));
      }
    });

    return ok(c, { reordered: input.ids.length });
  });

  return app;
}
