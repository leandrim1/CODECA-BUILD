import { and, asc, eq, schema } from '@codeca/database';
import { AppError, bannerInputSchema, uuidSchema } from '@codeca/shared';
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
} from '../lib/http.js';
import { assertMediaBelongsToTenant } from '../lib/media-refs.js';
import {
  assertEditableChanges,
  assertEditableCreate,
  assertModuleEnabled,
  loadSiteModules,
} from '../lib/modules.js';
import { queueContentPublished } from '../lib/integration/outbound.js';
import { requireCapability } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Banners da abertura do site.
 *
 * Toda operacao confere que o modulo esta habilitado para este site: um site
 * cujo projeto nao tem banners nao ganha banners por alguem chamar a rota.
 */

const bannerParamSchema = z.object({ tenantId: uuidSchema, bannerId: uuidSchema });

export function bannerRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/:tenantId/banners', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    await assertModuleEnabled(ctx.db, tenant.siteId, 'banners');

    const rows = await ctx.db
      .select()
      .from(schema.banners)
      .where(eq(schema.banners.siteId, tenant.siteId))
      .orderBy(asc(schema.banners.sortOrder), asc(schema.banners.createdAt));

    return ok(c, { items: rows });
  });

  app.post('/:tenantId/banners', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    await assertModuleEnabled(ctx.db, tenant.siteId, 'banners');

    const { data: input, raw } = await parseJsonBodyWithRaw(c, bannerInputSchema);
    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [input.imageId]);

    const { overrides } = await loadSiteModules(ctx.db, tenant.siteId);
    assertEditableCreate('banners', raw, overrides);

    const [row] = await ctx.db
      .insert(schema.banners)
      .values({ tenantId: tenant.tenantId, siteId: tenant.siteId, ...input })
      .returning();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentCreated,
      entityType: 'banner',
      entityId: row?.id ?? '',
      metadata: { title: input.title },
    });

    await queueContentPublished(ctx, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      moduleKey: 'banners',
      action: 'created',
      entityId: row?.id ?? null,
    });

    return created(c, { banner: row ?? null });
  });

  app.patch('/:tenantId/banners/:bannerId', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { bannerId } = parseParams(c, bannerParamSchema);
    await assertModuleEnabled(ctx.db, tenant.siteId, 'banners');

    const [atual] = await ctx.db
      .select()
      .from(schema.banners)
      .where(and(eq(schema.banners.id, bannerId), eq(schema.banners.siteId, tenant.siteId)));
    if (!atual) throw AppError.notFound('Banner nao encontrado.');

    const input = await parseJsonBody(c, bannerInputSchema);
    await assertMediaBelongsToTenant(ctx.db, tenant.tenantId, [input.imageId]);

    const { overrides } = await loadSiteModules(ctx.db, tenant.siteId);
    const alterados = assertEditableChanges(
      'banners',
      atual as unknown as Record<string, unknown>,
      input as unknown as Record<string, unknown>,
      overrides,
    );

    const [row] = await ctx.db
      .update(schema.banners)
      .set({ ...input, updatedAt: ctx.now() })
      .where(eq(schema.banners.id, bannerId))
      .returning();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentUpdated,
      entityType: 'banner',
      entityId: bannerId,
      metadata: { changed: alterados },
    });

    await queueContentPublished(ctx, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      moduleKey: 'banners',
      action: 'updated',
      entityId: bannerId,
    });

    return ok(c, { banner: row ?? null });
  });

  app.delete('/:tenantId/banners/:bannerId', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { bannerId } = parseParams(c, bannerParamSchema);
    await assertModuleEnabled(ctx.db, tenant.siteId, 'banners');

    const [removido] = await ctx.db
      .delete(schema.banners)
      .where(and(eq(schema.banners.id, bannerId), eq(schema.banners.siteId, tenant.siteId)))
      .returning({ id: schema.banners.id });
    if (!removido) throw AppError.notFound('Banner nao encontrado.');

    await queueContentPublished(ctx, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      moduleKey: 'banners',
      action: 'removed',
      entityId: bannerId,
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentDeleted,
      entityType: 'banner',
      entityId: bannerId,
      metadata: {},
    });

    return noContent(c);
  });

  return app;
}
