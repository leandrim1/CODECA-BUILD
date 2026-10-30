import { and, asc, desc, eq, ilike, inArray, schema, sql, type Database } from '@codeca/database';
import {
  AppError,
  contentQuerySchema,
  faqInputSchema,
  paginate,
  reorderSchema,
  serviceInputSchema,
  serviceUpdateSchema,
  slugify,
  teamMemberInputSchema,
  testimonialInputSchema,
  uuidSchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { created, noContent, ok, parseJsonBody, parseParams, parseQuery } from '../lib/http.js';
import { assertMediaBelongsToTenant, loadMediaByIds } from '../lib/media-refs.js';
import { buildUniqueSlug } from '../lib/slugs.js';
import { requireCapability, tenantMiddleware } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Servicos, depoimentos, equipe e perguntas frequentes.
 *
 * Depoimento so pode ser publicado com a declaracao de autorizacao do autor --
 * regra garantida pelo schema de validacao e conferida outra vez aqui.
 */

export function contentRoutes() {
  const app = new Hono<AppBindings>();
  app.use('/:tenantId/*', tenantMiddleware());

  // ----------------------------------------------------------- servicos
  app.get('/:tenantId/services', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const query = parseQuery(c, contentQuerySchema);

    const conditions = [eq(schema.services.tenantId, tenant.tenantId)];
    if (query.search) conditions.push(ilike(schema.services.title, `%${query.search}%`));
    if (query.publicationStatus) {
      conditions.push(eq(schema.services.publicationStatus, query.publicationStatus));
    }
    const where = and(...conditions);

    const rows = await ctx.db
      .select()
      .from(schema.services)
      .where(where)
      .orderBy(asc(schema.services.sortOrder), asc(schema.services.title))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.services)
      .where(where);

    const images = await loadMediaByIds(ctx.db, tenant.tenantId, rows.map((r) => r.imageId));

    return ok(
      c,
      paginate(
        rows.map((row) => ({ ...row, image: row.imageId ? images.get(row.imageId) ?? null : null })),
        totals?.total ?? 0,
        query,
      ),
    );
  });

  app.post('/:tenantId/services', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, serviceInputSchema);
    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [input.imageId]);

    const slug = await buildUniqueSlug(ctx.db, 'services', {
      tenantId: tenant.tenantId,
      desired: input.slug ?? input.title,
    });

    const [row] = await ctx.db
      .insert(schema.services)
      .values({
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        slug,
        title: input.title,
        summary: input.summary,
        description: input.description,
        icon: input.icon,
        imageId: input.imageId,
        highlights: input.highlights,
        publicationStatus: input.publicationStatus,
        sortOrder: input.sortOrder,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
      })
      .returning();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentCreated,
      entityType: 'service',
      entityId: row?.id ?? '',
      metadata: { title: input.title },
    });

    return created(c, { service: row ?? null });
  });

  app.patch('/:tenantId/services/:serviceId', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { serviceId } = parseParams(c, z.object({ tenantId: uuidSchema, serviceId: uuidSchema }));
    const input = await parseJsonBody(c, serviceUpdateSchema);
    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [input.imageId ?? null]);

    const updates: Record<string, unknown> = { updatedAt: ctx.now() };
    for (const key of [
      'title','summary','description','icon','imageId','highlights','publicationStatus','sortOrder',
      'seoTitle','seoDescription',
    ] as const) {
      if (input[key] !== undefined) updates[key] = input[key];
    }
    if (input.slug !== undefined) {
      updates.slug = await buildUniqueSlug(ctx.db, 'services', {
        tenantId: tenant.tenantId,
        desired: slugify(input.slug),
        excludeId: serviceId,
      });
    }

    const [row] = await ctx.db
      .update(schema.services)
      .set(updates)
      .where(and(eq(schema.services.id, serviceId), eq(schema.services.tenantId, tenant.tenantId)))
      .returning();
    if (!row) throw AppError.notFound('Servico nao encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentUpdated,
      entityType: 'service',
      entityId: serviceId,
      metadata: {},
    });

    return ok(c, { service: row });
  });

  app.delete('/:tenantId/services/:serviceId', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { serviceId } = parseParams(c, z.object({ tenantId: uuidSchema, serviceId: uuidSchema }));

    const removed = await ctx.db
      .delete(schema.services)
      .where(and(eq(schema.services.id, serviceId), eq(schema.services.tenantId, tenant.tenantId)))
      .returning({ id: schema.services.id });
    if (removed.length === 0) throw AppError.notFound('Servico nao encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentDeleted,
      entityType: 'service',
      entityId: serviceId,
      metadata: {},
    });

    return noContent(c);
  });

  // -------------------------------------------------------- depoimentos
  app.get('/:tenantId/testimonials', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const query = parseQuery(c, contentQuerySchema);

    const conditions = [eq(schema.testimonials.tenantId, tenant.tenantId)];
    if (query.publicationStatus) {
      conditions.push(eq(schema.testimonials.publicationStatus, query.publicationStatus));
    }
    if (query.search) conditions.push(ilike(schema.testimonials.authorName, `%${query.search}%`));
    const where = and(...conditions);

    const rows = await ctx.db
      .select()
      .from(schema.testimonials)
      .where(where)
      .orderBy(asc(schema.testimonials.sortOrder), desc(schema.testimonials.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.testimonials)
      .where(where);

    const photos = await loadMediaByIds(ctx.db, tenant.tenantId, rows.map((r) => r.photoId));

    return ok(
      c,
      paginate(
        rows.map((row) => ({ ...row, photo: row.photoId ? photos.get(row.photoId) ?? null : null })),
        totals?.total ?? 0,
        query,
      ),
    );
  });

  app.post('/:tenantId/testimonials', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, testimonialInputSchema);
    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [input.photoId]);
    await assertProjectBelongsToTenant(ctx.db, tenant.tenantId, input.relatedProjectId);

    const [row] = await ctx.db
      .insert(schema.testimonials)
      .values({ tenantId: tenant.tenantId, siteId: tenant.siteId, ...input })
      .returning();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentCreated,
      entityType: 'testimonial',
      entityId: row?.id ?? '',
      metadata: { authorName: input.authorName, authorized: input.authorizationConfirmed },
    });

    return created(c, { testimonial: row ?? null });
  });

  app.patch('/:tenantId/testimonials/:testimonialId', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { testimonialId } = parseParams(c, z.object({ tenantId: uuidSchema, testimonialId: uuidSchema }));
    const input = await parseJsonBody(c, testimonialInputSchema);
    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [input.photoId]);
    await assertProjectBelongsToTenant(ctx.db, tenant.tenantId, input.relatedProjectId);

    const [row] = await ctx.db
      .update(schema.testimonials)
      .set({ ...input, updatedAt: ctx.now() })
      .where(
        and(eq(schema.testimonials.id, testimonialId), eq(schema.testimonials.tenantId, tenant.tenantId)),
      )
      .returning();
    if (!row) throw AppError.notFound('Depoimento nao encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentUpdated,
      entityType: 'testimonial',
      entityId: testimonialId,
      metadata: { authorized: input.authorizationConfirmed },
    });

    return ok(c, { testimonial: row });
  });

  app.delete('/:tenantId/testimonials/:testimonialId', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { testimonialId } = parseParams(c, z.object({ tenantId: uuidSchema, testimonialId: uuidSchema }));

    const removed = await ctx.db
      .delete(schema.testimonials)
      .where(
        and(eq(schema.testimonials.id, testimonialId), eq(schema.testimonials.tenantId, tenant.tenantId)),
      )
      .returning({ id: schema.testimonials.id });
    if (removed.length === 0) throw AppError.notFound('Depoimento nao encontrado.');

    return noContent(c);
  });

  // ------------------------------------------------------------- equipe
  app.get('/:tenantId/team', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const rows = await ctx.db
      .select()
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.tenantId, tenant.tenantId))
      .orderBy(asc(schema.teamMembers.sortOrder), asc(schema.teamMembers.name));

    const photos = await loadMediaByIds(ctx.db, tenant.tenantId, rows.map((r) => r.photoId));

    return ok(c, {
      members: rows.map((row) => ({ ...row, photo: row.photoId ? photos.get(row.photoId) ?? null : null })),
    });
  });

  app.post('/:tenantId/team', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, teamMemberInputSchema);
    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [input.photoId]);

    const [row] = await ctx.db
      .insert(schema.teamMembers)
      .values({ tenantId: tenant.tenantId, siteId: tenant.siteId, ...input })
      .returning();

    return created(c, { member: row ?? null });
  });

  app.patch('/:tenantId/team/:memberId', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { memberId } = parseParams(c, z.object({ tenantId: uuidSchema, memberId: uuidSchema }));
    const input = await parseJsonBody(c, teamMemberInputSchema);
    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [input.photoId]);

    const [row] = await ctx.db
      .update(schema.teamMembers)
      .set({ ...input, updatedAt: ctx.now() })
      .where(and(eq(schema.teamMembers.id, memberId), eq(schema.teamMembers.tenantId, tenant.tenantId)))
      .returning();
    if (!row) throw AppError.notFound('Integrante nao encontrado.');

    return ok(c, { member: row });
  });

  app.delete('/:tenantId/team/:memberId', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { memberId } = parseParams(c, z.object({ tenantId: uuidSchema, memberId: uuidSchema }));

    const removed = await ctx.db
      .delete(schema.teamMembers)
      .where(and(eq(schema.teamMembers.id, memberId), eq(schema.teamMembers.tenantId, tenant.tenantId)))
      .returning({ id: schema.teamMembers.id });
    if (removed.length === 0) throw AppError.notFound('Integrante nao encontrado.');

    return noContent(c);
  });

  // ------------------------------------------------ perguntas frequentes
  app.get('/:tenantId/faqs', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const rows = await ctx.db
      .select()
      .from(schema.faqs)
      .where(eq(schema.faqs.tenantId, tenant.tenantId))
      .orderBy(asc(schema.faqs.sortOrder), asc(schema.faqs.createdAt));
    return ok(c, { faqs: rows });
  });

  app.post('/:tenantId/faqs', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, faqInputSchema);
    const [row] = await ctx.db
      .insert(schema.faqs)
      .values({ tenantId: tenant.tenantId, siteId: tenant.siteId, ...input })
      .returning();
    return created(c, { faq: row ?? null });
  });

  app.patch('/:tenantId/faqs/:faqId', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { faqId } = parseParams(c, z.object({ tenantId: uuidSchema, faqId: uuidSchema }));
    const input = await parseJsonBody(c, faqInputSchema);

    const [row] = await ctx.db
      .update(schema.faqs)
      .set({ ...input, updatedAt: ctx.now() })
      .where(and(eq(schema.faqs.id, faqId), eq(schema.faqs.tenantId, tenant.tenantId)))
      .returning();
    if (!row) throw AppError.notFound('Pergunta nao encontrada.');

    return ok(c, { faq: row });
  });

  app.delete('/:tenantId/faqs/:faqId', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { faqId } = parseParams(c, z.object({ tenantId: uuidSchema, faqId: uuidSchema }));

    const removed = await ctx.db
      .delete(schema.faqs)
      .where(and(eq(schema.faqs.id, faqId), eq(schema.faqs.tenantId, tenant.tenantId)))
      .returning({ id: schema.faqs.id });
    if (removed.length === 0) throw AppError.notFound('Pergunta nao encontrada.');

    return noContent(c);
  });

  // ------------------------------------------------------- reordenacao
  app.post('/:tenantId/content/:entity/reorder', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { entity } = parseParams(
      c,
      z.object({ tenantId: uuidSchema, entity: z.enum(['services', 'testimonials', 'team', 'faqs']) }),
    );
    const input = await parseJsonBody(c, reorderSchema);

    const table =
      entity === 'services'
        ? schema.services
        : entity === 'testimonials'
          ? schema.testimonials
          : entity === 'team'
            ? schema.teamMembers
            : schema.faqs;

    const rows = await ctx.db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.tenantId, tenant.tenantId), inArray(table.id, input.ids)));
    if (rows.length !== input.ids.length) {
      throw AppError.notFound('Um ou mais registros informados nao pertencem a esta empresa.');
    }

    await ctx.db.transaction(async (tx) => {
      for (const [index, id] of input.ids.entries()) {
        await tx
          .update(table)
          .set({ sortOrder: index, updatedAt: ctx.now() })
          .where(and(eq(table.id, id), eq(table.tenantId, tenant.tenantId)));
      }
    });

    return ok(c, { reordered: input.ids.length });
  });

  return app;
}

/** Garante que um projeto relacionado pertence a mesma empresa. */
async function assertProjectBelongsToTenant(
  db: Database,
  tenantId: string,
  projectId: string | null,
): Promise<void> {
  if (!projectId) return;
  const [row] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.tenantId, tenantId)));
  if (!row) throw AppError.notFound('Obra relacionada nao encontrada.');
}
