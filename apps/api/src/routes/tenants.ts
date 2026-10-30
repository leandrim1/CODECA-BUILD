import { and, desc, eq, gte, schema, sql } from '@codeca/database';
import {
  AppError,
  updateSiteSectionsSchema,
  updateTenantContactSchema,
  updateTenantSchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { ok, parseJsonBody } from '../lib/http.js';
import { loadPlanStatus } from '../lib/plan-limits.js';
import { requireCapability, tenantMiddleware } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/** Dados da empresa, identidade visual, SEO e visao geral do painel. */
export function tenantRoutes() {
  const app = new Hono<AppBindings>();
  app.use('/:tenantId/*', tenantMiddleware());

  // ------------------------------------------------------------- resumo
  app.get('/:tenantId', requireCapability('tenant:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const [row] = await ctx.db
      .select({
        id: schema.tenants.id,
        slug: schema.tenants.slug,
        legalName: schema.tenants.legalName,
        displayName: schema.tenants.displayName,
        taxId: schema.tenants.taxId,
        description: schema.tenants.description,
        foundedYear: schema.tenants.foundedYear,
        creaNumber: schema.tenants.creaNumber,
        status: schema.tenants.status,
        contactEmail: schema.tenants.contactEmail,
        contactPhone: schema.tenants.contactPhone,
        whatsapp: schema.tenants.whatsapp,
        whatsappDefaultMessage: schema.tenants.whatsappDefaultMessage,
        address: schema.tenants.address,
        serviceArea: schema.tenants.serviceArea,
        businessHours: schema.tenants.businessHours,
        social: schema.tenants.social,
        createdAt: schema.tenants.createdAt,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenant.tenantId));

    if (!row) throw AppError.notFound('Empresa nao encontrada.');

    const planStatus = await loadPlanStatus(ctx.db, tenant.tenantId);

    return ok(c, {
      tenant: row,
      access: {
        role: tenant.role,
        capabilities: [...tenant.capabilities],
        readOnly: tenant.readOnly,
        viaSupportGrant: tenant.viaSupportGrant,
      },
      plan: planStatus.plan,
      usage: planStatus.usage,
    });
  });

  // ------------------------------------------------------- visao geral
  app.get('/:tenantId/overview', requireCapability('tenant:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const tenantId = tenant.tenantId;
    const countOf = sql<number>`cast(count(*) as int)`;
    const since30d = new Date(ctx.now().getTime() - 30 * 24 * 3600 * 1000);

    const [propertyStats] = await ctx.db
      .select({
        total: countOf,
        published: sql<number>`cast(count(*) filter (where ${schema.properties.publicationStatus} = 'published') as int)`,
        drafts: sql<number>`cast(count(*) filter (where ${schema.properties.publicationStatus} = 'draft') as int)`,
        available: sql<number>`cast(count(*) filter (where ${schema.properties.publicationStatus} = 'published' and ${schema.properties.commercialStatus} = 'disponivel') as int)`,
        sold: sql<number>`cast(count(*) filter (where ${schema.properties.commercialStatus} = 'vendido') as int)`,
      })
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, tenantId));

    const [projectStats] = await ctx.db
      .select({
        total: countOf,
        published: sql<number>`cast(count(*) filter (where ${schema.projects.publicationStatus} = 'published') as int)`,
        inProgress: sql<number>`cast(count(*) filter (where ${schema.projects.status} = 'em_andamento') as int)`,
        completed: sql<number>`cast(count(*) filter (where ${schema.projects.status} = 'concluida') as int)`,
      })
      .from(schema.projects)
      .where(eq(schema.projects.tenantId, tenantId));

    const [serviceStats] = await ctx.db
      .select({
        total: countOf,
        published: sql<number>`cast(count(*) filter (where ${schema.services.publicationStatus} = 'published') as int)`,
      })
      .from(schema.services)
      .where(eq(schema.services.tenantId, tenantId));

    const [leadStats] = await ctx.db
      .select({
        total: countOf,
        novos: sql<number>`cast(count(*) filter (where ${schema.leads.status} = 'novo') as int)`,
        emAtendimento: sql<number>`cast(count(*) filter (where ${schema.leads.status} = 'em_atendimento') as int)`,
        convertidos: sql<number>`cast(count(*) filter (where ${schema.leads.status} = 'convertido') as int)`,
      })
      .from(schema.leads)
      .where(eq(schema.leads.tenantId, tenantId));

    const [leads30d] = await ctx.db
      .select({ total: countOf })
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, tenantId), gte(schema.leads.createdAt, since30d)));

    const [mediaStats] = await ctx.db
      .select({ total: countOf, bytes: sql<number>`cast(coalesce(sum(${schema.mediaAssets.sizeBytes}), 0) as bigint)` })
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.tenantId, tenantId));

    const recentLeads = await ctx.db
      .select({
        id: schema.leads.id,
        name: schema.leads.name,
        interestType: schema.leads.interestType,
        status: schema.leads.status,
        createdAt: schema.leads.createdAt,
      })
      .from(schema.leads)
      .where(eq(schema.leads.tenantId, tenantId))
      .orderBy(desc(schema.leads.createdAt))
      .limit(5);

    const domains = await ctx.db
      .select({
        id: schema.domains.id,
        hostname: schema.domains.hostname,
        status: schema.domains.status,
        isPrimary: schema.domains.isPrimary,
        sslStatus: schema.domains.sslStatus,
      })
      .from(schema.domains)
      .where(eq(schema.domains.tenantId, tenantId))
      .orderBy(desc(schema.domains.isPrimary));

    const planStatus = await loadPlanStatus(ctx.db, tenantId);

    return ok(c, {
      properties: propertyStats ?? { total: 0, published: 0, drafts: 0, available: 0, sold: 0 },
      projects: projectStats ?? { total: 0, published: 0, inProgress: 0, completed: 0 },
      services: serviceStats ?? { total: 0, published: 0 },
      leads: {
        ...(leadStats ?? { total: 0, novos: 0, emAtendimento: 0, convertidos: 0 }),
        last30Days: leads30d?.total ?? 0,
      },
      media: { total: mediaStats?.total ?? 0, bytes: Number(mediaStats?.bytes ?? 0) },
      recentLeads,
      domains,
      plan: planStatus.plan,
      usage: planStatus.usage,
    });
  });

  // ------------------------------------------------- dados da empresa
  app.patch('/:tenantId', requireCapability('tenant:update'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, updateTenantSchema);

    const [row] = await ctx.db
      .update(schema.tenants)
      .set({ ...input, updatedAt: ctx.now() })
      .where(eq(schema.tenants.id, tenant.tenantId))
      .returning({ id: schema.tenants.id, displayName: schema.tenants.displayName });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.tenantUpdated,
      entityType: 'tenant',
      entityId: tenant.tenantId,
      metadata: { displayName: input.displayName },
    });
    return ok(c, { tenant: row ?? null });
  });

  app.patch('/:tenantId/contact', requireCapability('tenant:update'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, updateTenantContactSchema);

    await ctx.db
      .update(schema.tenants)
      .set({
        contactEmail: input.email,
        contactPhone: input.phone,
        whatsapp: input.whatsapp,
        whatsappDefaultMessage: input.whatsappDefaultMessage,
        address: input.address,
        serviceArea: input.serviceArea,
        businessHours: input.businessHours,
        social: input.social,
        updatedAt: ctx.now(),
      })
      .where(eq(schema.tenants.id, tenant.tenantId));

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.tenantUpdated,
      entityType: 'tenant',
      entityId: tenant.tenantId,
      metadata: { section: 'contato' },
    });
    return ok(c, { updated: true });
  });

  // ---------------------------------------------------- plano e limites
  app.get('/:tenantId/plan', requireCapability('billing:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const status = await loadPlanStatus(ctx.db, tenant.tenantId);

    const [subscription] = await ctx.db
      .select({
        status: schema.subscriptions.status,
        currentPeriodStart: schema.subscriptions.currentPeriodStart,
        currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
        trialEndsAt: schema.subscriptions.trialEndsAt,
      })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, tenant.tenantId));

    const availablePlans = await ctx.db
      .select({
        code: schema.plans.code,
        name: schema.plans.name,
        description: schema.plans.description,
        priceCents: schema.plans.priceCents,
        limits: schema.plans.limits,
      })
      .from(schema.plans)
      .where(and(eq(schema.plans.isActive, true), eq(schema.plans.isPublic, true)));

    return ok(c, {
      plan: status.plan,
      usage: status.usage,
      subscription: subscription ?? null,
      availablePlans,
      // A cobranca automatizada ainda nao esta implementada: a troca de plano e
      // feita pelo painel mestre da plataforma.
      selfServiceUpgrade: false,
    });
  });

  return app;
}
