import { and, desc, eq, schema } from '@codeca/database';
import {
  AppError,
  MODULE_KEYS,
  MODULE_REGISTRY,
  SITE_STATUSES,
  isModuleKey,
  uuidSchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { ok, parseJsonBody, parseParams } from '../lib/http.js';
import { loadSiteModules } from '../lib/modules.js';
import { requireAuth, requirePlatform } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Configuracao dos sites pelo painel mestre.
 *
 * E aqui que a CODECA IA diz o que cada projeto tem: quais modulos o cliente
 * enxerga e quais campos ele pode mexer. A permissao reaproveita
 * `platform:tenants:*` -- configurar um site e administrar a empresa dona
 * dele, e um papel novo so para isto separaria o que na pratica anda junto.
 */

const siteParamSchema = z.object({ siteId: uuidSchema });

const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(160),
  status: z.enum(SITE_STATUSES),
  internalNotes: z.string().trim().max(4_000).default(''),
});

const configureModulesSchema = z.object({
  modules: z
    .array(
      z.object({
        key: z.enum(MODULE_KEYS),
        enabled: z.boolean(),
        settings: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(MODULE_KEYS.length),
  fieldPolicies: z
    .array(
      z.object({
        moduleKey: z.enum(MODULE_KEYS),
        fieldKey: z.string().trim().min(1).max(80),
        editable: z.boolean(),
        note: z.string().trim().max(240).default(''),
      }),
    )
    .max(400)
    .default([]),
});

/** Carrega o site garantindo que ele existe antes de qualquer escrita. */
async function loadSite(db: Parameters<typeof loadSiteModules>[0], siteId: string) {
  const [site] = await db
    .select({
      id: schema.sites.id,
      tenantId: schema.sites.tenantId,
      name: schema.sites.name,
      slug: schema.sites.slug,
      status: schema.sites.status,
      isPrimary: schema.sites.isPrimary,
      internalNotes: schema.sites.internalNotes,
      segmentId: schema.sites.segmentId,
    })
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId));
  if (!site) throw AppError.notFound('Site nao encontrado.');
  return site;
}

export function platformSiteRoutes() {
  const app = new Hono<AppBindings>();
  app.use('*', requireAuth());

  app.get('/sites', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const rows = await ctx.db
      .select({
        id: schema.sites.id,
        name: schema.sites.name,
        slug: schema.sites.slug,
        status: schema.sites.status,
        isPrimary: schema.sites.isPrimary,
        tenantId: schema.sites.tenantId,
        tenantName: schema.tenants.displayName,
        segment: schema.segments.code,
        createdAt: schema.sites.createdAt,
      })
      .from(schema.sites)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.sites.tenantId))
      .leftJoin(schema.segments, eq(schema.segments.id, schema.sites.segmentId))
      .orderBy(desc(schema.sites.createdAt));

    return ok(c, { items: rows });
  });

  app.get('/sites/:siteId', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    const site = await loadSite(ctx.db, siteId);
    const state = await loadSiteModules(ctx.db, siteId);
    return ok(c, { site, modules: state.modules });
  });

  app.patch('/sites/:siteId', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    const site = await loadSite(ctx.db, siteId);
    const input = await parseJsonBody(c, updateSiteSchema);

    const [row] = await ctx.db
      .update(schema.sites)
      .set({ ...input, updatedAt: ctx.now() })
      .where(eq(schema.sites.id, siteId))
      .returning();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.tenantUpdated,
      entityType: 'site',
      entityId: siteId,
      tenantId: site.tenantId,
      metadata: { status: input.status },
    });

    return ok(c, { site: row ?? null });
  });

  /**
   * Define os modulos e a politica de campos do site.
   *
   * Substitui o conjunto inteiro em vez de aplicar diferencas: a tela do
   * painel mestre envia o estado completo, e aplicar diferencas faria duas
   * edicoes simultaneas se mesclarem em um estado que ninguem escolheu.
   *
   * Apenas as excecoes a politica padrao sao gravadas -- ver
   * `site_field_policies`.
   */
  app.put('/sites/:siteId/modules', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    const site = await loadSite(ctx.db, siteId);
    const input = await parseJsonBody(c, configureModulesSchema);

    for (const politica of input.fieldPolicies) {
      const definicao = MODULE_REGISTRY[politica.moduleKey];
      if (!definicao.fields.some((f) => f.key === politica.fieldKey)) {
        throw AppError.badRequest(
          `O campo ${politica.fieldKey} nao existe no modulo ${definicao.name}.`,
        );
      }
    }

    await ctx.db.transaction(async (tx) => {
      for (const modulo of input.modules) {
        await tx
          .insert(schema.siteModules)
          .values({
            tenantId: site.tenantId,
            siteId,
            moduleKey: modulo.key,
            enabled: modulo.enabled,
            settings: modulo.settings,
          })
          .onConflictDoUpdate({
            target: [schema.siteModules.siteId, schema.siteModules.moduleKey],
            set: { enabled: modulo.enabled, settings: modulo.settings, updatedAt: ctx.now() },
          });
      }

      await tx.delete(schema.siteFieldPolicies).where(eq(schema.siteFieldPolicies.siteId, siteId));

      // So gravamos o que difere do padrao do registro: repetir o padrao
      // congelaria os campos de hoje e esconderia os que vierem depois.
      const excecoes = input.fieldPolicies.filter((politica) => {
        const campo = MODULE_REGISTRY[politica.moduleKey].fields.find(
          (f) => f.key === politica.fieldKey,
        );
        return campo !== undefined && campo.editableByDefault !== politica.editable;
      });

      if (excecoes.length > 0) {
        await tx.insert(schema.siteFieldPolicies).values(
          excecoes.map((politica) => ({
            tenantId: site.tenantId,
            siteId,
            moduleKey: politica.moduleKey,
            fieldKey: politica.fieldKey,
            editable: politica.editable,
            note: politica.note,
          })),
        );
      }
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.tenantUpdated,
      entityType: 'site_modules',
      entityId: siteId,
      tenantId: site.tenantId,
      metadata: {
        enabled: input.modules.filter((m) => m.enabled).map((m) => m.key),
        excecoes: input.fieldPolicies.length,
      },
    });

    const state = await loadSiteModules(ctx.db, siteId);
    return ok(c, { modules: state.modules });
  });

  return app;
}

/** Chaves de modulo validas, para o painel mestre montar a tela. */
export const PLATFORM_MODULE_KEYS = MODULE_KEYS.filter(isModuleKey);
