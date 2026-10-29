import { and, asc, desc, eq, ilike, inArray, or, schema, sql } from '@codeca/database';
import {
  AppError,
  paginate,
  propertyInputSchema,
  propertyQuerySchema,
  propertyUpdateSchema,
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
import { assertWithinLimit, loadEffectivePlan } from '../lib/plan-limits.js';
import { buildUniqueSlug } from '../lib/slugs.js';
import { requireCapability, tenantMiddleware } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Imoveis.
 *
 * O estado editorial (`publicationStatus`) e o estado comercial
 * (`commercialStatus`) sao independentes: um imovel pode estar publicado e
 * vendido, ou em rascunho e disponivel. O limite do plano conta apenas os
 * imoveis publicados, conferido no momento da publicacao.
 */

const propertyParams = z.object({ tenantId: uuidSchema, propertyId: uuidSchema });

export function propertyRoutes() {
  const app = new Hono<AppBindings>();
  app.use('/:tenantId/*', tenantMiddleware());

  // ------------------------------------------------------------ listagem
  app.get('/:tenantId/properties', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const query = parseQuery(c, propertyQuerySchema);

    const conditions = [eq(schema.properties.tenantId, tenant.tenantId)];
    if (query.search) {
      const term = `%${query.search}%`;
      const clause = or(
        ilike(schema.properties.title, term),
        ilike(schema.properties.reference, term),
        ilike(schema.properties.shortDescription, term),
      );
      if (clause) conditions.push(clause);
    }
    if (query.type) conditions.push(eq(schema.properties.type, query.type));
    if (query.purpose) conditions.push(eq(schema.properties.purpose, query.purpose));
    if (query.publicationStatus) {
      conditions.push(eq(schema.properties.publicationStatus, query.publicationStatus));
    }
    if (query.commercialStatus) {
      conditions.push(eq(schema.properties.commercialStatus, query.commercialStatus));
    }
    if (query.featured !== undefined) conditions.push(eq(schema.properties.featured, query.featured));
    if (query.city) conditions.push(sql`${schema.properties.address}->>'city' ilike ${`%${query.city}%`}`);
    if (query.neighborhood) {
      conditions.push(sql`${schema.properties.address}->>'neighborhood' ilike ${`%${query.neighborhood}%`}`);
    }
    if (query.minPrice !== undefined) conditions.push(sql`${schema.properties.price} >= ${query.minPrice}`);
    if (query.maxPrice !== undefined) conditions.push(sql`${schema.properties.price} <= ${query.maxPrice}`);
    if (query.bedrooms !== undefined) conditions.push(sql`${schema.properties.bedrooms} >= ${query.bedrooms}`);

    const where = and(...conditions);
    const direction = query.sortDir === 'asc' ? asc : desc;
    const orderBy =
      query.sortBy === 'price'
        ? direction(schema.properties.price)
        : query.sortBy === 'title'
          ? direction(schema.properties.title)
          : query.sortBy === 'manual'
            ? asc(schema.properties.sortOrder)
            : direction(schema.properties.createdAt);

    const rows = await ctx.db
      .select()
      .from(schema.properties)
      .where(where)
      .orderBy(orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.properties)
      .where(where);

    const covers = await loadMediaByIds(ctx.db, tenant.tenantId, rows.map((row) => row.coverImageId));

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

  // -------------------------------------------- cidades para filtros
  app.get('/:tenantId/properties/facets', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const cities = await ctx.db
      .select({ value: sql<string>`distinct ${schema.properties.address}->>'city'` })
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.tenantId));

    const neighborhoods = await ctx.db
      .select({ value: sql<string>`distinct ${schema.properties.address}->>'neighborhood'` })
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenant.tenantId));

    const plan = await loadEffectivePlan(ctx.db, tenant.tenantId);

    return ok(c, {
      cities: cities.map((r) => r.value).filter((v): v is string => Boolean(v)).sort(),
      neighborhoods: neighborhoods.map((r) => r.value).filter((v): v is string => Boolean(v)).sort(),
      maxPublishedProperties: plan.limits.maxPublishedProperties,
    });
  });

  // ------------------------------------------------------------- detalhe
  app.get('/:tenantId/properties/:propertyId', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { propertyId } = parseParams(c, propertyParams);

    const [row] = await ctx.db
      .select()
      .from(schema.properties)
      .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.tenantId, tenant.tenantId)));
    if (!row) throw AppError.notFound('Imovel nao encontrado.');

    const gallery = await loadGallery(ctx.db, 'property', {
      tenantId: tenant.tenantId,
      entityIds: [propertyId],
    });
    const covers = await loadMediaByIds(ctx.db, tenant.tenantId, [row.coverImageId]);

    return ok(c, {
      property: {
        ...row,
        coverImage: row.coverImageId ? covers.get(row.coverImageId) ?? null : null,
        gallery: gallery.get(propertyId) ?? [],
      },
    });
  });

  // ------------------------------------------------------------- criacao
  app.post('/:tenantId/properties', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, propertyInputSchema);

    if (input.publicationStatus === 'published') {
      await assertWithinLimit(ctx.db, tenant.tenantId, 'maxPublishedProperties');
    }
    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [input.coverImageId, ...input.galleryImageIds]);

    const slug = await buildUniqueSlug(ctx.db, 'properties', {
      tenantId: tenant.tenantId,
      desired: input.slug ?? input.title,
    });

    const [row] = await ctx.db
      .insert(schema.properties)
      .values({
        tenantId: tenant.tenantId,
        slug,
        title: input.title,
        reference: input.reference,
        description: input.description,
        shortDescription: input.shortDescription,
        type: input.type,
        purpose: input.purpose,
        price: input.price,
        priceOnRequest: input.priceOnRequest,
        condoFee: input.condoFee,
        iptu: input.iptu,
        currency: input.currency,
        address: input.address,
        builtAreaM2: input.builtAreaM2,
        landAreaM2: input.landAreaM2,
        bedrooms: input.bedrooms,
        suites: input.suites,
        bathrooms: input.bathrooms,
        parkingSpots: input.parkingSpots,
        floor: input.floor,
        features: input.features,
        coverImageId: input.coverImageId,
        publicationStatus: input.publicationStatus,
        commercialStatus: input.commercialStatus,
        featured: input.featured,
        deliveryDate: input.deliveryDate,
        videoUrl: input.videoUrl,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        sortOrder: input.sortOrder,
        publishedAt: input.publicationStatus === 'published' ? ctx.now() : null,
      })
      .returning();

    if (!row) throw AppError.internal('Nao foi possivel cadastrar o imovel.');

    await syncGallery(ctx.db, 'property', {
      tenantId: tenant.tenantId,
      entityId: row.id,
      mediaIds: input.galleryImageIds,
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.propertyCreated,
      entityType: 'property',
      entityId: row.id,
      metadata: { title: row.title, slug: row.slug, status: row.publicationStatus },
    });

    return created(c, { property: row });
  });

  // ----------------------------------------------------------- alteracao
  app.patch('/:tenantId/properties/:propertyId', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { propertyId } = parseParams(c, propertyParams);
    const input = await parseJsonBody(c, propertyUpdateSchema);

    const [current] = await ctx.db
      .select()
      .from(schema.properties)
      .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.tenantId, tenant.tenantId)));
    if (!current) throw AppError.notFound('Imovel nao encontrado.');

    // Publicar um imovel que estava em rascunho consome uma vaga do plano.
    if (input.publicationStatus === 'published' && current.publicationStatus !== 'published') {
      await assertWithinLimit(ctx.db, tenant.tenantId, 'maxPublishedProperties');
    }

    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [
      input.coverImageId ?? null,
      ...(input.galleryImageIds ?? []),
    ]);

    const updates: Record<string, unknown> = { updatedAt: ctx.now() };
    for (const key of [
      'title','reference','description','shortDescription','type','purpose','price','priceOnRequest',
      'condoFee','iptu','currency','address','builtAreaM2','landAreaM2','bedrooms','suites','bathrooms',
      'parkingSpots','floor','features','coverImageId','commercialStatus','featured','deliveryDate',
      'videoUrl','seoTitle','seoDescription','sortOrder',
    ] as const) {
      if (input[key] !== undefined) updates[key] = input[key];
    }

    if (input.publicationStatus !== undefined) {
      updates.publicationStatus = input.publicationStatus;
      if (input.publicationStatus === 'published' && !current.publishedAt) {
        updates.publishedAt = ctx.now();
      }
      if (input.publicationStatus === 'archived') updates.archivedAt = ctx.now();
      if (input.publicationStatus !== 'archived') updates.archivedAt = null;
    }

    if (input.slug !== undefined) {
      updates.slug = await buildUniqueSlug(ctx.db, 'properties', {
        tenantId: tenant.tenantId,
        desired: slugify(input.slug),
        excludeId: propertyId,
      });
    }

    const [row] = await ctx.db
      .update(schema.properties)
      .set(updates)
      .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.tenantId, tenant.tenantId)))
      .returning();

    if (input.galleryImageIds !== undefined) {
      await syncGallery(ctx.db, 'property', {
        tenantId: tenant.tenantId,
        entityId: propertyId,
        mediaIds: input.galleryImageIds,
      });
    }

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.propertyUpdated,
      entityType: 'property',
      entityId: propertyId,
      metadata: { status: row?.publicationStatus, commercialStatus: row?.commercialStatus },
    });

    return ok(c, { property: row ?? null });
  });

  // ------------------------------------------------------------ exclusao
  app.delete('/:tenantId/properties/:propertyId', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { propertyId } = parseParams(c, propertyParams);

    const [current] = await ctx.db
      .select({ id: schema.properties.id, title: schema.properties.title })
      .from(schema.properties)
      .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.tenantId, tenant.tenantId)));
    if (!current) throw AppError.notFound('Imovel nao encontrado.');

    // `property_images` cai em cascata; os arquivos permanecem na biblioteca de
    // midia e podem ser removidos pela tela de biblioteca, que lista os arquivos
    // sem referencia ativa.
    await ctx.db
      .delete(schema.properties)
      .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.tenantId, tenant.tenantId)));

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.propertyDeleted,
      entityType: 'property',
      entityId: propertyId,
      metadata: { title: current.title },
    });

    return noContent(c);
  });

  // -------------------------------------------------------- reordenacao
  app.post('/:tenantId/properties/reorder', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, reorderSchema);

    const rows = await ctx.db
      .select({ id: schema.properties.id })
      .from(schema.properties)
      .where(
        and(eq(schema.properties.tenantId, tenant.tenantId), inArray(schema.properties.id, input.ids)),
      );
    if (rows.length !== input.ids.length) {
      throw AppError.notFound('Um ou mais imoveis informados nao pertencem a esta empresa.');
    }

    await ctx.db.transaction(async (tx) => {
      for (const [index, id] of input.ids.entries()) {
        await tx
          .update(schema.properties)
          .set({ sortOrder: index, updatedAt: ctx.now() })
          .where(and(eq(schema.properties.id, id), eq(schema.properties.tenantId, tenant.tenantId)));
      }
    });

    return ok(c, { reordered: input.ids.length });
  });

  return app;
}
