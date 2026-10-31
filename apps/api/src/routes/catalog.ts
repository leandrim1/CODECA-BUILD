import { and, asc, desc, eq, ilike, schema, sql } from '@codeca/database';
import {
  AppError,
  categoryInputSchema,
  categoryUpdateSchema,
  galleryInputSchema,
  galleryUpdateSchema,
  paginate,
  productInputSchema,
  productQuerySchema,
  productUpdateSchema,
  slugify,
  uniqueSlug,
  uuidSchema,
  type CategorizedModuleKey,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import {
  created,
  noContent,
  ok,
  parseJsonBody,
  parseJsonBodyWithRaw,
  parseParams,
  parseQuery,
} from '../lib/http.js';
import {
  assertMediaBelongsToTenant,
  loadGallery,
  loadGalleryIds,
  loadMediaByIds,
  syncGallery,
} from '../lib/media-refs.js';
import { buildUniqueSlug } from '../lib/slugs.js';
import { assertEditableCreate, assertEditablePatch, loadSiteModules } from '../lib/modules.js';
import { queueContentPublished, visibilityChanged } from '../lib/integration/outbound.js';
import { requireCapability } from '../middleware/auth.js';
import { requireModule } from '../middleware/modules.js';
import type { AppBindings } from '../types.js';

/**
 * Produtos, categorias e galerias.
 *
 * Tres modulos que abrem varejo, restaurante e clinica. Seguem o mesmo
 * desenho das colecoes que ja existiam -- tabela tipada, politica de campos
 * conferida na escrita, aviso de publicacao ao site -- e as decisoes de
 * modelagem estao no schema do banco.
 */

const produtoParams = z.object({ tenantId: uuidSchema, productId: uuidSchema });
const categoriaParams = z.object({ tenantId: uuidSchema, categoryId: uuidSchema });
const galeriaParams = z.object({ tenantId: uuidSchema, galleryId: uuidSchema });

const categoriaQuery = z.object({
  moduleKey: z.enum(['produtos']).default('produtos'),
});

/**
 * Slug de categoria, unico dentro do modulo.
 *
 * `buildUniqueSlug` nao serve aqui: ele desempata por empresa, e a unicidade
 * da categoria e por `(site, modulo)` -- `bebidas` pode existir em produtos e
 * em outro modulo sem conflito.
 */
async function slugDeCategoria(
  db: Parameters<typeof loadSiteModules>[0],
  input: { siteId: string; moduleKey: string; desired: string; excludeId?: string },
): Promise<string> {
  const linhas = await db
    .select({ id: schema.categories.id, slug: schema.categories.slug })
    .from(schema.categories)
    .where(
      and(
        eq(schema.categories.siteId, input.siteId),
        eq(schema.categories.moduleKey, input.moduleKey),
      ),
    );

  const usados = linhas
    .filter((linha) => linha.id !== input.excludeId)
    .map((linha) => linha.slug);
  return uniqueSlug(slugify(input.desired) || 'categoria', usados);
}

export function catalogRoutes() {
  const app = new Hono<AppBindings>();

  app.use('/:tenantId/products', requireModule('produtos'));
  app.use('/:tenantId/products/*', requireModule('produtos'));
  app.use('/:tenantId/categories', requireModule('categorias'));
  app.use('/:tenantId/categories/*', requireModule('categorias'));
  app.use('/:tenantId/galleries', requireModule('galerias'));
  app.use('/:tenantId/galleries/*', requireModule('galerias'));

  // ------------------------------------------------------------- produtos

  app.get('/:tenantId/products', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const query = parseQuery(c, productQuerySchema);

    const conditions = [eq(schema.products.siteId, tenant.siteId)];
    if (query.search) conditions.push(ilike(schema.products.title, `%${query.search}%`));
    if (query.publicationStatus) {
      conditions.push(eq(schema.products.publicationStatus, query.publicationStatus));
    }
    if (query.categoryId) conditions.push(eq(schema.products.categoryId, query.categoryId));
    if (query.availableOnly) conditions.push(eq(schema.products.isAvailable, true));
    const where = and(...conditions);

    const rows = await ctx.db
      .select()
      .from(schema.products)
      .where(where)
      .orderBy(asc(schema.products.sortOrder), desc(schema.products.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totais] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.products)
      .where(where);

    const capas = await loadMediaByIds(ctx.db, tenant.tenantId, rows.map((r) => r.coverImageId));
    const galerias = await loadGallery(ctx.db, 'product', {
      tenantId: tenant.tenantId,
      entityIds: rows.map((r) => r.id),
    });

    return ok(
      c,
      paginate(
        rows.map((row) => ({
          ...row,
          cover: row.coverImageId ? capas.get(row.coverImageId) ?? null : null,
          gallery: galerias.get(row.id) ?? [],
        })),
        totais?.total ?? 0,
        query,
      ),
    );
  });

  app.get('/:tenantId/products/:productId', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { productId } = parseParams(c, produtoParams);

    const row = await carregarProduto(ctx.db, tenant.siteId, productId);
    const capas = await loadMediaByIds(ctx.db, tenant.tenantId, [row.coverImageId]);
    const galeria = await loadGalleryIds(ctx.db, 'product', tenant.tenantId, row.id);

    return ok(c, {
      product: {
        ...row,
        cover: row.coverImageId ? capas.get(row.coverImageId) ?? null : null,
        galleryImageIds: galeria,
      },
    });
  });

  app.post('/:tenantId/products', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { data: input, raw } = await parseJsonBodyWithRaw(c, productInputSchema);

    const { overrides } = await loadSiteModules(ctx.db, tenant.siteId);
    assertEditableCreate('produtos', raw, overrides);

    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [
      input.coverImageId,
      ...input.galleryImageIds,
    ]);
    await assertCategoria(ctx.db, tenant.siteId, input.categoryId);

    const slug = await buildUniqueSlug(ctx.db, 'products', {
      tenantId: tenant.tenantId,
      desired: input.slug ?? input.title,
    });

    const [row] = await ctx.db
      .insert(schema.products)
      .values({
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        slug,
        title: input.title,
        summary: input.summary,
        description: input.description,
        code: input.code,
        categoryId: input.categoryId,
        price: input.price,
        priceOnRequest: input.priceOnRequest,
        currency: input.currency,
        unit: input.unit,
        isAvailable: input.isAvailable,
        coverImageId: input.coverImageId,
        publicationStatus: input.publicationStatus,
        sortOrder: input.sortOrder,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
      })
      .returning();
    if (!row) throw AppError.conflict('Nao foi possivel criar o produto.');

    await syncGallery(ctx.db, 'product', {
      tenantId: tenant.tenantId,
      entityId: row.id,
      mediaIds: input.galleryImageIds,
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentCreated,
      entityType: 'product',
      entityId: row.id,
      metadata: { title: input.title },
    });

    if (visibilityChanged(null, row.publicationStatus)) {
      await queueContentPublished(ctx, {
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey: 'produtos',
        action: 'created',
        entityId: row.id,
        slug: row.slug,
      });
    }

    return created(c, { product: row });
  });

  app.patch('/:tenantId/products/:productId', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { productId } = parseParams(c, produtoParams);
    const input = await parseJsonBody(c, productUpdateSchema);

    const atual = await carregarProduto(ctx.db, tenant.siteId, productId);
    const { overrides } = await loadSiteModules(ctx.db, tenant.siteId);
    assertEditablePatch('produtos', atual, input as Record<string, unknown>, overrides);

    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [
      input.coverImageId ?? null,
      ...(input.galleryImageIds ?? []),
    ]);
    if (input.categoryId !== undefined) {
      await assertCategoria(ctx.db, tenant.siteId, input.categoryId);
    }

    const updates: Record<string, unknown> = { updatedAt: ctx.now() };
    for (const key of [
      'title', 'summary', 'description', 'code', 'categoryId', 'price', 'priceOnRequest',
      'unit', 'isAvailable', 'coverImageId', 'publicationStatus', 'sortOrder',
      'seoTitle', 'seoDescription',
    ] as const) {
      if (input[key] !== undefined) updates[key] = input[key];
    }
    if (input.slug !== undefined) {
      updates.slug = await buildUniqueSlug(ctx.db, 'products', {
        tenantId: tenant.tenantId,
        desired: slugify(input.slug),
        excludeId: productId,
      });
    }

    const [row] = await ctx.db
      .update(schema.products)
      .set(updates)
      .where(and(eq(schema.products.id, productId), eq(schema.products.siteId, tenant.siteId)))
      .returning();
    if (!row) throw AppError.notFound('Produto nao encontrado.');

    if (input.galleryImageIds !== undefined) {
      await syncGallery(ctx.db, 'product', {
        tenantId: tenant.tenantId,
        entityId: productId,
        mediaIds: input.galleryImageIds,
      });
    }

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentUpdated,
      entityType: 'product',
      entityId: productId,
      metadata: {},
    });

    if (visibilityChanged(atual.publicationStatus, row.publicationStatus)) {
      await queueContentPublished(ctx, {
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey: 'produtos',
        action: 'updated',
        entityId: productId,
        slug: row.slug,
      });
    }

    return ok(c, { product: row });
  });

  app.delete('/:tenantId/products/:productId', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { productId } = parseParams(c, produtoParams);

    const [apagado] = await ctx.db
      .delete(schema.products)
      .where(and(eq(schema.products.id, productId), eq(schema.products.siteId, tenant.siteId)))
      .returning({
        id: schema.products.id,
        slug: schema.products.slug,
        publicationStatus: schema.products.publicationStatus,
      });
    if (!apagado) throw AppError.notFound('Produto nao encontrado.');

    if (visibilityChanged(apagado.publicationStatus, null)) {
      await queueContentPublished(ctx, {
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey: 'produtos',
        action: 'removed',
        entityId: productId,
        slug: apagado.slug,
      });
    }

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentDeleted,
      entityType: 'product',
      entityId: productId,
      metadata: {},
    });

    return noContent(c);
  });

  // ----------------------------------------------------------- categorias

  app.get('/:tenantId/categories', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { moduleKey } = parseQuery(c, categoriaQuery);

    const rows = await ctx.db
      .select({
        id: schema.categories.id,
        moduleKey: schema.categories.moduleKey,
        name: schema.categories.name,
        slug: schema.categories.slug,
        description: schema.categories.description,
        publicationStatus: schema.categories.publicationStatus,
        sortOrder: schema.categories.sortOrder,
        createdAt: schema.categories.createdAt,
        /**
         * Quantos produtos usam a categoria.
         *
         * A tela usa para avisar antes de remover: a chave e `set null`, entao
         * remover nao apaga produto -- deixa produto sem agrupamento, o que o
         * cliente precisa saber antes de confirmar.
         */
        productCount: sql<number>`cast(count(${schema.products.id}) as int)`,
      })
      .from(schema.categories)
      .leftJoin(schema.products, eq(schema.products.categoryId, schema.categories.id))
      .where(
        and(
          eq(schema.categories.siteId, tenant.siteId),
          eq(schema.categories.moduleKey, moduleKey),
        ),
      )
      .groupBy(schema.categories.id)
      .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));

    return ok(c, { items: rows });
  });

  app.post('/:tenantId/categories', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { data: input, raw } = await parseJsonBodyWithRaw(c, categoryInputSchema);

    const { overrides } = await loadSiteModules(ctx.db, tenant.siteId);
    assertEditableCreate('categorias', raw, overrides);

    const slug = await slugDeCategoria(ctx.db, {
      siteId: tenant.siteId,
      moduleKey: input.moduleKey,
      desired: input.slug ?? input.name,
    });

    const [row] = await ctx.db
      .insert(schema.categories)
      .values({
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey: input.moduleKey,
        name: input.name,
        slug,
        description: input.description,
        publicationStatus: input.publicationStatus,
        sortOrder: input.sortOrder,
      })
      .returning();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentCreated,
      entityType: 'category',
      entityId: row?.id ?? '',
      metadata: { name: input.name, moduleKey: input.moduleKey },
    });

    return created(c, { category: row ?? null });
  });

  app.patch('/:tenantId/categories/:categoryId', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { categoryId } = parseParams(c, categoriaParams);
    const input = await parseJsonBody(c, categoryUpdateSchema);

    const [atual] = await ctx.db
      .select()
      .from(schema.categories)
      .where(
        and(eq(schema.categories.id, categoryId), eq(schema.categories.siteId, tenant.siteId)),
      );
    if (!atual) throw AppError.notFound('Categoria nao encontrada.');

    const { overrides } = await loadSiteModules(ctx.db, tenant.siteId);
    assertEditablePatch('categorias', atual, input as Record<string, unknown>, overrides);

    const updates: Record<string, unknown> = { updatedAt: ctx.now() };
    for (const key of ['name', 'description', 'publicationStatus', 'sortOrder'] as const) {
      if (input[key] !== undefined) updates[key] = input[key];
    }
    if (input.slug !== undefined) {
      updates.slug = await slugDeCategoria(ctx.db, {
        siteId: tenant.siteId,
        moduleKey: atual.moduleKey,
        desired: slugify(input.slug),
        excludeId: categoryId,
      });
    }

    const [row] = await ctx.db
      .update(schema.categories)
      .set(updates)
      .where(and(eq(schema.categories.id, categoryId), eq(schema.categories.siteId, tenant.siteId)))
      .returning();
    if (!row) throw AppError.notFound('Categoria nao encontrada.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentUpdated,
      entityType: 'category',
      entityId: categoryId,
      metadata: {},
    });

    return ok(c, { category: row });
  });

  app.delete('/:tenantId/categories/:categoryId', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { categoryId } = parseParams(c, categoriaParams);

    // Nenhum produto e apagado: a chave estrangeira e `set null`, e o produto
    // fica sem agrupamento. A tela avisa quantos antes de confirmar.
    const [apagado] = await ctx.db
      .delete(schema.categories)
      .where(and(eq(schema.categories.id, categoryId), eq(schema.categories.siteId, tenant.siteId)))
      .returning({ id: schema.categories.id, name: schema.categories.name });
    if (!apagado) throw AppError.notFound('Categoria nao encontrada.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentDeleted,
      entityType: 'category',
      entityId: categoryId,
      metadata: { name: apagado.name },
    });

    return noContent(c);
  });

  // ------------------------------------------------------------- galerias

  app.get('/:tenantId/galleries', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const rows = await ctx.db
      .select()
      .from(schema.galleries)
      .where(eq(schema.galleries.siteId, tenant.siteId))
      .orderBy(asc(schema.galleries.sortOrder), asc(schema.galleries.title));

    const imagens = await loadGallery(ctx.db, 'gallery', {
      tenantId: tenant.tenantId,
      entityIds: rows.map((r) => r.id),
    });

    return ok(c, {
      items: rows.map((row) => ({ ...row, images: imagens.get(row.id) ?? [] })),
    });
  });

  app.post('/:tenantId/galleries', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { data: input, raw } = await parseJsonBodyWithRaw(c, galleryInputSchema);

    const { overrides } = await loadSiteModules(ctx.db, tenant.siteId);
    assertEditableCreate('galerias', raw, overrides);

    const slug = await buildUniqueSlug(ctx.db, 'galleries', {
      tenantId: tenant.tenantId,
      desired: input.slug ?? input.title,
    });

    const [row] = await ctx.db
      .insert(schema.galleries)
      .values({
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        slug,
        title: input.title,
        description: input.description,
        publicationStatus: input.publicationStatus,
        sortOrder: input.sortOrder,
      })
      .returning();
    if (!row) throw AppError.conflict('Nao foi possivel criar a galeria.');

    await syncGallery(ctx.db, 'gallery', {
      tenantId: tenant.tenantId,
      entityId: row.id,
      mediaIds: input.imageIds,
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentCreated,
      entityType: 'gallery',
      entityId: row.id,
      metadata: { title: input.title, images: input.imageIds.length },
    });

    if (visibilityChanged(null, row.publicationStatus)) {
      await queueContentPublished(ctx, {
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey: 'galerias',
        action: 'created',
        entityId: row.id,
        slug: row.slug,
      });
    }

    return created(c, { gallery: row });
  });

  app.patch('/:tenantId/galleries/:galleryId', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { galleryId } = parseParams(c, galeriaParams);
    const input = await parseJsonBody(c, galleryUpdateSchema);

    const [atual] = await ctx.db
      .select()
      .from(schema.galleries)
      .where(and(eq(schema.galleries.id, galleryId), eq(schema.galleries.siteId, tenant.siteId)));
    if (!atual) throw AppError.notFound('Galeria nao encontrada.');

    const { overrides } = await loadSiteModules(ctx.db, tenant.siteId);
    assertEditablePatch('galerias', atual, input as Record<string, unknown>, overrides);

    const updates: Record<string, unknown> = { updatedAt: ctx.now() };
    for (const key of ['title', 'description', 'publicationStatus', 'sortOrder'] as const) {
      if (input[key] !== undefined) updates[key] = input[key];
    }
    if (input.slug !== undefined) {
      updates.slug = await buildUniqueSlug(ctx.db, 'galleries', {
        tenantId: tenant.tenantId,
        desired: slugify(input.slug),
        excludeId: galleryId,
      });
    }

    const [row] = await ctx.db
      .update(schema.galleries)
      .set(updates)
      .where(and(eq(schema.galleries.id, galleryId), eq(schema.galleries.siteId, tenant.siteId)))
      .returning();
    if (!row) throw AppError.notFound('Galeria nao encontrada.');

    if (input.imageIds !== undefined) {
      await syncGallery(ctx.db, 'gallery', {
        tenantId: tenant.tenantId,
        entityId: galleryId,
        mediaIds: input.imageIds,
      });
    }

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentUpdated,
      entityType: 'gallery',
      entityId: galleryId,
      metadata: {},
    });

    if (visibilityChanged(atual.publicationStatus, row.publicationStatus)) {
      await queueContentPublished(ctx, {
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey: 'galerias',
        action: 'updated',
        entityId: galleryId,
        slug: row.slug,
      });
    }

    return ok(c, { gallery: row });
  });

  app.delete('/:tenantId/galleries/:galleryId', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { galleryId } = parseParams(c, galeriaParams);

    // As imagens continuam na biblioteca: apagar a galeria desfaz o conjunto,
    // nao o arquivo. `gallery_images` cai em cascata.
    const [apagada] = await ctx.db
      .delete(schema.galleries)
      .where(and(eq(schema.galleries.id, galleryId), eq(schema.galleries.siteId, tenant.siteId)))
      .returning({
        id: schema.galleries.id,
        slug: schema.galleries.slug,
        publicationStatus: schema.galleries.publicationStatus,
      });
    if (!apagada) throw AppError.notFound('Galeria nao encontrada.');

    if (visibilityChanged(apagada.publicationStatus, null)) {
      await queueContentPublished(ctx, {
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey: 'galerias',
        action: 'removed',
        entityId: galleryId,
        slug: apagada.slug,
      });
    }

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentDeleted,
      entityType: 'gallery',
      entityId: galleryId,
      metadata: {},
    });

    return noContent(c);
  });

  return app;
}

async function carregarProduto(
  db: Parameters<typeof loadSiteModules>[0],
  siteId: string,
  productId: string,
) {
  const [row] = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.id, productId), eq(schema.products.siteId, siteId)));
  if (!row) throw AppError.notFound('Produto nao encontrado.');
  return row;
}

/**
 * Recusa categoria que nao e deste site.
 *
 * O `category_id` chega do navegador. Sem esta conferencia um produto poderia
 * apontar para a categoria de outra empresa -- a chave estrangeira aponta so
 * para `categories(id)`, sem o par com o site.
 */
async function assertCategoria(
  db: Parameters<typeof loadSiteModules>[0],
  siteId: string,
  categoryId: string | null,
): Promise<void> {
  if (!categoryId) return;
  const [row] = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(and(eq(schema.categories.id, categoryId), eq(schema.categories.siteId, siteId)));
  if (!row) throw AppError.notFound('Categoria nao encontrada neste site.');
}
