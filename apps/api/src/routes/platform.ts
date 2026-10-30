import {
  and,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  gt,
  schema,
  sql,
  type Database,
} from '@codeca/database';
import {
  AppError,
  auditQuerySchema,
  paginate,
  planBillingSchema,
  planInputSchema,
  planUpdateSchema,
  platformCreateTenantSchema,
  platformTenantQuerySchema,
  platformUpdateTenantSchema,
  setPlatformRoleSchema,
  slugify,
  supportGrantSchema,
  uniqueSlug,
  uuidSchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS, listAuditLogs } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { created, noContent, ok, parseJsonBody, parseParams, parseQuery } from '../lib/http.js';
import { loadPlanStatus } from '../lib/plan-limits.js';
import { buildActionUrl, issueUserToken } from '../lib/tokens.js';
import { requireAuth, requirePlatform, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Painel mestre da plataforma.
 *
 * Todas as rotas exigem capacidades do papel `platform_admin`, que nao e
 * concedido por ter uma conta comum. Consultar dados de uma empresa exige uma
 * concessao de suporte explicita, com motivo, prazo e registro em auditoria --
 * ver `resolveTenantContext` em `lib/authz.ts`.
 */

export function platformRoutes() {
  const app = new Hono<AppBindings>();
  app.use('*', requireAuth());

  // ------------------------------------------------------------- resumo
  app.get('/overview', requirePlatform('platform:overview'), async (c) => {
    const ctx = c.get('ctx');
    const countOf = sql<number>`cast(count(*) as int)`;
    const since30d = new Date(ctx.now().getTime() - 30 * 24 * 3600 * 1000);

    const [tenants] = await ctx.db
      .select({
        total: countOf,
        active: sql<number>`cast(count(*) filter (where ${schema.tenants.status} = 'active') as int)`,
        trialing: sql<number>`cast(count(*) filter (where ${schema.tenants.status} = 'trialing') as int)`,
        suspended: sql<number>`cast(count(*) filter (where ${schema.tenants.status} = 'suspended') as int)`,
      })
      .from(schema.tenants);

    const [users] = await ctx.db.select({ total: countOf }).from(schema.users);
    const [domains] = await ctx.db
      .select({
        total: countOf,
        active: sql<number>`cast(count(*) filter (where ${schema.domains.status} = 'active') as int)`,
        pending: sql<number>`cast(count(*) filter (where ${schema.domains.status} <> 'active') as int)`,
      })
      .from(schema.domains);

    const [storage] = await ctx.db
      .select({ bytes: sql<number>`cast(coalesce(sum(${schema.mediaAssets.sizeBytes}), 0) as bigint)` })
      .from(schema.mediaAssets);

    const [leads] = await ctx.db
      .select({ total: countOf })
      .from(schema.leads)
      .where(gte(schema.leads.createdAt, since30d));

    const byPlan = await ctx.db
      .select({ planCode: schema.plans.code, planName: schema.plans.name, tenants: countOf })
      .from(schema.tenants)
      .innerJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
      .groupBy(schema.plans.code, schema.plans.name);

    const recentTenants = await ctx.db
      .select({
        id: schema.tenants.id,
        displayName: schema.tenants.displayName,
        slug: schema.tenants.slug,
        status: schema.tenants.status,
        createdAt: schema.tenants.createdAt,
      })
      .from(schema.tenants)
      .orderBy(desc(schema.tenants.createdAt))
      .limit(5);

    return ok(c, {
      tenants: tenants ?? { total: 0, active: 0, trialing: 0, suspended: 0 },
      users: users?.total ?? 0,
      domains: domains ?? { total: 0, active: 0, pending: 0 },
      storageBytes: Number(storage?.bytes ?? 0),
      leadsLast30Days: leads?.total ?? 0,
      byPlan,
      recentTenants,
    });
  });

  // ------------------------------------------------------------ empresas
  app.get('/tenants', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const query = parseQuery(c, platformTenantQuerySchema);

    const conditions = [];
    if (query.search) conditions.push(ilike(schema.tenants.displayName, `%${query.search}%`));
    if (query.status) conditions.push(eq(schema.tenants.status, query.status));
    if (query.planCode) conditions.push(eq(schema.plans.code, query.planCode));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await ctx.db
      .select({
        id: schema.tenants.id,
        slug: schema.tenants.slug,
        displayName: schema.tenants.displayName,
        legalName: schema.tenants.legalName,
        status: schema.tenants.status,
        createdAt: schema.tenants.createdAt,
        suspendedAt: schema.tenants.suspendedAt,
        planCode: schema.plans.code,
        planName: schema.plans.name,
        hasOverrides: sql<boolean>`${schema.tenants.limitOverrides} is not null`,
      })
      .from(schema.tenants)
      .innerJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
      .where(where)
      .orderBy(desc(schema.tenants.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.tenants)
      .innerJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
      .where(where);

    return ok(c, paginate(rows, totals?.total ?? 0, query));
  });

  app.get('/tenants/:tenantId', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const { tenantId } = parseParams(c, z.object({ tenantId: uuidSchema }));

    const [tenant] = await ctx.db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    if (!tenant) throw AppError.notFound('Empresa nao encontrada.');

    const planStatus = await loadPlanStatus(ctx.db, tenantId);

    const members = await ctx.db
      .select({
        role: schema.memberships.role,
        status: schema.memberships.status,
        email: schema.users.email,
        name: schema.users.name,
        lastLoginAt: schema.users.lastLoginAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.tenantId, tenantId));

    const domains = await ctx.db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.tenantId, tenantId));

    const [grant] = await ctx.db
      .select({
        id: schema.supportAccessGrants.id,
        reason: schema.supportAccessGrants.reason,
        expiresAt: schema.supportAccessGrants.expiresAt,
      })
      .from(schema.supportAccessGrants)
      .where(
        and(
          eq(schema.supportAccessGrants.tenantId, tenantId),
          eq(schema.supportAccessGrants.platformUserId, session.user.id),
          isNull(schema.supportAccessGrants.revokedAt),
          gt(schema.supportAccessGrants.expiresAt, ctx.now()),
        ),
      );

    // A ficha administrativa nao inclui conteudo da empresa: para isso e
    // necessaria uma concessao de suporte, listada aqui quando existir.
    return ok(c, {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        legalName: tenant.legalName,
        displayName: tenant.displayName,
        taxId: tenant.taxId,
        status: tenant.status,
        contactEmail: tenant.contactEmail,
        contactPhone: tenant.contactPhone,
        storageUsedBytes: tenant.storageUsedBytes,
        internalNotes: tenant.internalNotes,
        limitOverrides: tenant.limitOverrides,
        createdAt: tenant.createdAt,
        suspendedAt: tenant.suspendedAt,
      },
      plan: planStatus.plan,
      usage: planStatus.usage,
      members,
      domains,
      supportGrant: grant ?? null,
    });
  });

  app.post('/tenants', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const input = await parseJsonBody(c, platformCreateTenantSchema);

    const [plan] = await ctx.db.select().from(schema.plans).where(eq(schema.plans.code, input.planCode));
    if (!plan) throw AppError.badRequest('Plano informado nao existe.');

    const existingSlugs = await ctx.db.select({ slug: schema.tenants.slug }).from(schema.tenants);
    const slug = uniqueSlug(
      slugify(input.slug ?? input.displayName),
      existingSlugs.map((row) => row.slug),
    );

    const result = await ctx.db.transaction(async (tx) => {
      let [owner] = await tx.select().from(schema.users).where(eq(schema.users.email, input.ownerEmail));
      if (!owner) {
        [owner] = await tx
          .insert(schema.users)
          .values({ email: input.ownerEmail, name: input.ownerName })
          .returning();
      }
      if (!owner) throw AppError.internal('Nao foi possivel criar o proprietario.');

      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          slug,
          legalName: input.legalName,
          displayName: input.displayName,
          planId: plan.id,
          status: 'trialing',
          contactEmail: input.ownerEmail,
          address: {
            street: '', number: '', complement: '', neighborhood: '',
            city: '', state: '', postalCode: '', showFullAddress: true,
          },
        })
        .returning();
      if (!tenant) throw AppError.internal('Nao foi possivel criar a empresa.');

      await tx.insert(schema.memberships).values({
        tenantId: tenant.id,
        userId: owner.id,
        role: 'owner',
        status: 'invited',
      });

      await tx.insert(schema.subscriptions).values({
        tenantId: tenant.id,
        planId: plan.id,
        status: 'trialing',
      });

      return { tenantId: tenant.id, ownerId: owner.id };
    });

    const token = await issueUserToken(ctx.db, ctx.env, {
      userId: result.ownerId,
      type: 'invitation',
      tenantId: result.tenantId,
      role: 'owner',
      now: ctx.now(),
    });

    const delivery = await ctx.mailer.send({
      to: input.ownerEmail,
      kind: 'invitation',
      subject: `Acesso ao painel da ${input.displayName}`,
      text:
        `Sua conta na ${ctx.env.PLATFORM_NAME} foi criada.\n\n`
        + `Defina sua senha e acesse o painel:\n${buildActionUrl(ctx.env, '/aceitar-convite', token.token)}`,
    });

    await auditFromContext(c, {
      tenantId: result.tenantId,
      action: AUDIT_ACTIONS.tenantCreated,
      entityType: 'tenant',
      entityId: result.tenantId,
      metadata: { slug, planCode: input.planCode, byPlatformAdmin: true },
    });

    return created(c, {
      tenantId: result.tenantId,
      slug,
      emailDelivery: { delivered: delivery.delivered, reason: delivery.reason ?? null },
    });
  });

  app.patch('/tenants/:tenantId', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { tenantId } = parseParams(c, z.object({ tenantId: uuidSchema }));
    const input = await parseJsonBody(c, platformUpdateTenantSchema);

    const [current] = await ctx.db
      .select({ id: schema.tenants.id, status: schema.tenants.status, planId: schema.tenants.planId })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    if (!current) throw AppError.notFound('Empresa nao encontrada.');

    const updates: Record<string, unknown> = { updatedAt: ctx.now() };

    if (input.status !== undefined) {
      if ((input.status === 'suspended' || input.status === 'canceled')) {
        requirePlatformCapability(c, 'platform:tenants:suspend');
      }
      updates.status = input.status;
      updates.suspendedAt = input.status === 'suspended' ? ctx.now() : null;
    }

    if (input.planCode !== undefined) {
      const [plan] = await ctx.db.select().from(schema.plans).where(eq(schema.plans.code, input.planCode));
      if (!plan) throw AppError.badRequest('Plano informado nao existe.');
      updates.planId = plan.id;
      await ctx.db
        .update(schema.subscriptions)
        .set({ planId: plan.id, updatedAt: ctx.now() })
        .where(eq(schema.subscriptions.tenantId, tenantId));
    }

    if (input.limitOverrides !== undefined) updates.limitOverrides = input.limitOverrides;
    if (input.notes !== undefined) updates.internalNotes = input.notes;

    await ctx.db.update(schema.tenants).set(updates).where(eq(schema.tenants.id, tenantId));

    if (input.status !== undefined && input.status !== current.status) {
      await auditFromContext(c, {
        tenantId,
        action: AUDIT_ACTIONS.tenantStatusChanged,
        entityType: 'tenant',
        entityId: tenantId,
        metadata: { from: current.status, to: input.status },
      });
    }
    if (input.planCode !== undefined) {
      await auditFromContext(c, {
        tenantId,
        action: AUDIT_ACTIONS.tenantPlanChanged,
        entityType: 'tenant',
        entityId: tenantId,
        metadata: { planCode: input.planCode },
      });
    }

    return ok(c, { updated: true });
  });

  // -------------------------------------------------------------- planos
  app.get('/plans', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const rows = await ctx.db.select().from(schema.plans).orderBy(schema.plans.priceCents);

    const counts = await ctx.db
      .select({ planId: schema.tenants.planId, tenants: sql<number>`cast(count(*) as int)` })
      .from(schema.tenants)
      .groupBy(schema.tenants.planId);
    const byPlan = new Map(counts.map((row) => [row.planId, row.tenants]));

    return ok(c, {
      plans: rows.map((row) => ({
        ...row,
        tenantCount: byPlan.get(row.id) ?? 0,
        // Planos gratuitos nao viram preco na ValidaPay: a API exige valor > 0.
        billable: row.priceCents > 0,
        synced: Boolean(row.externalPriceId),
      })),
      provider: {
        configured: ctx.billing.configured,
        environment: ctx.billing.configured ? ctx.billing.environment : null,
      },
    });
  });

  app.post('/plans', requirePlatform('platform:plans:write'), async (c) => {
    const ctx = c.get('ctx');
    const input = await parseJsonBody(c, planInputSchema);

    const [existing] = await ctx.db.select().from(schema.plans).where(eq(schema.plans.code, input.code));
    if (existing) throw AppError.conflict('Ja existe um plano com este codigo.');

    const [row] = await ctx.db.insert(schema.plans).values(input).returning();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.planCreated,
      entityType: 'plan',
      entityId: row?.id ?? '',
      metadata: { code: input.code },
    });

    return created(c, { plan: row ?? null });
  });

  app.patch('/plans/:planId', requirePlatform('platform:plans:write'), async (c) => {
    const ctx = c.get('ctx');
    const { planId } = parseParams(c, z.object({ planId: uuidSchema }));
    const input = await parseJsonBody(c, planUpdateSchema);

    const [current] = await ctx.db.select().from(schema.plans).where(eq(schema.plans.id, planId));
    if (!current) throw AppError.notFound('Plano nao encontrado.');

    /**
     * Preco e periodicidade de um preco recorrente nao sao editaveis no
     * provedor: mudar o valor exige criar outro preco. Ao detectar essa
     * mudanca, desfazemos o vinculo para que a proxima sincronizacao crie o
     * preco novo. As assinaturas em vigor seguem no preco que contrataram ate
     * trocarem de plano -- o que tambem evita reajuste silencioso.
     */
    const currentBilling = planBillingSchema.parse(current.billing);
    const nextBilling = input.billing ? planBillingSchema.parse(input.billing) : currentBilling;
    const priceChanged =
      (input.priceCents !== undefined && input.priceCents !== current.priceCents) ||
      nextBilling.recurrenceType !== currentBilling.recurrenceType ||
      nextBilling.recurrenceInterval !== currentBilling.recurrenceInterval ||
      nextBilling.trialDays !== currentBilling.trialDays;
    const unlinkPrice = priceChanged && Boolean(current.externalPriceId);

    const [row] = await ctx.db
      .update(schema.plans)
      .set({
        ...input,
        ...(unlinkPrice
          ? {
              externalPriceId: null,
              externalCheckoutUrl: null,
              externalSyncedAt: null,
              externalSyncError:
                'Preco ou periodicidade alterados: sincronize o plano para criar o preco novo na ValidaPay.',
            }
          : {}),
        updatedAt: ctx.now(),
      })
      .where(eq(schema.plans.id, planId))
      .returning();
    if (!row) throw AppError.notFound('Plano nao encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.planUpdated,
      entityType: 'plan',
      entityId: planId,
      metadata: { code: row.code, priceChanged, unlinkPrice },
    });

    return ok(c, {
      plan: row,
      ...(unlinkPrice
        ? {
            notice:
              'O preco mudou: o vinculo com o preco anterior na ValidaPay foi desfeito. '
              + 'Sincronize o plano para criar o preco novo. Assinaturas em vigor continuam no preco contratado.',
          }
        : {}),
    });
  });

  // ------------------------------------------------------------ dominios
  app.get('/domains', requirePlatform('platform:domains:read'), async (c) => {
    const ctx = c.get('ctx');
    const rows = await ctx.db
      .select({
        id: schema.domains.id,
        hostname: schema.domains.hostname,
        status: schema.domains.status,
        sslStatus: schema.domains.sslStatus,
        isPrimary: schema.domains.isPrimary,
        lastError: schema.domains.lastError,
        lastCheckedAt: schema.domains.lastCheckedAt,
        tenantId: schema.domains.tenantId,
        tenantName: schema.tenants.displayName,
      })
      .from(schema.domains)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.domains.tenantId))
      .orderBy(desc(schema.domains.createdAt));

    return ok(c, { domains: rows, providerConfigured: ctx.domains.configured });
  });

  // ------------------------------------------------------------ usuarios
  app.post('/users/platform-role', requirePlatform('platform:users:write'), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, setPlatformRoleSchema);

    if (input.userId === session.user.id && input.platformRole === 'none') {
      throw AppError.badRequest('Voce nao pode remover o seu proprio acesso de administrador.');
    }

    const [row] = await ctx.db
      .update(schema.users)
      .set({ platformRole: input.platformRole, updatedAt: ctx.now() })
      .where(eq(schema.users.id, input.userId))
      .returning({ id: schema.users.id, email: schema.users.email });
    if (!row) throw AppError.notFound('Usuario nao encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.platformRoleChanged,
      entityType: 'user',
      entityId: input.userId,
      metadata: { platformRole: input.platformRole, targetEmail: row.email },
    });

    return ok(c, { updated: true });
  });

  // ------------------------------------------------- acesso de suporte
  app.post('/support-access', requirePlatform('platform:support:grant'), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, supportGrantSchema);

    const [tenant] = await ctx.db
      .select({ id: schema.tenants.id, displayName: schema.tenants.displayName })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, input.tenantId));
    if (!tenant) throw AppError.notFound('Empresa nao encontrada.');

    const expiresAt = new Date(ctx.now().getTime() + input.expiresInMinutes * 60_000);

    const [grant] = await ctx.db
      .insert(schema.supportAccessGrants)
      .values({
        tenantId: input.tenantId,
        platformUserId: session.user.id,
        reason: input.reason,
        readOnly: true,
        expiresAt,
      })
      .returning();

    await auditFromContext(c, {
      tenantId: input.tenantId,
      action: AUDIT_ACTIONS.supportAccessGranted,
      entityType: 'support_access_grant',
      entityId: grant?.id ?? '',
      metadata: { reason: input.reason, expiresAt: expiresAt.toISOString(), readOnly: true },
    });

    return created(c, {
      grant: grant ? { id: grant.id, expiresAt: grant.expiresAt, readOnly: grant.readOnly } : null,
    });
  });

  app.delete('/support-access/:grantId', requirePlatform('platform:support:grant'), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const { grantId } = parseParams(c, z.object({ grantId: uuidSchema }));

    const [grant] = await ctx.db
      .update(schema.supportAccessGrants)
      .set({ revokedAt: ctx.now() })
      .where(
        and(
          eq(schema.supportAccessGrants.id, grantId),
          eq(schema.supportAccessGrants.platformUserId, session.user.id),
        ),
      )
      .returning({ id: schema.supportAccessGrants.id, tenantId: schema.supportAccessGrants.tenantId });
    if (!grant) throw AppError.notFound('Concessao nao encontrada.');

    await auditFromContext(c, {
      tenantId: grant.tenantId,
      action: AUDIT_ACTIONS.supportAccessRevoked,
      entityType: 'support_access_grant',
      entityId: grantId,
      metadata: {},
    });

    return noContent(c);
  });

  app.get('/support-access', requirePlatform('platform:support:grant'), async (c) => {
    const ctx = c.get('ctx');
    const rows = await ctx.db
      .select({
        id: schema.supportAccessGrants.id,
        tenantId: schema.supportAccessGrants.tenantId,
        tenantName: schema.tenants.displayName,
        reason: schema.supportAccessGrants.reason,
        readOnly: schema.supportAccessGrants.readOnly,
        expiresAt: schema.supportAccessGrants.expiresAt,
        revokedAt: schema.supportAccessGrants.revokedAt,
        createdAt: schema.supportAccessGrants.createdAt,
        adminEmail: schema.users.email,
      })
      .from(schema.supportAccessGrants)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.supportAccessGrants.tenantId))
      .innerJoin(schema.users, eq(schema.users.id, schema.supportAccessGrants.platformUserId))
      .orderBy(desc(schema.supportAccessGrants.createdAt))
      .limit(100);

    return ok(c, { grants: rows });
  });

  // -------------------------------------------------------- auditoria
  app.get('/audit', requirePlatform('platform:audit:read'), async (c) => {
    const ctx = c.get('ctx');
    const query = parseQuery(c, auditQuerySchema);

    const result = await listAuditLogs(ctx.db, {
      tenantId: query.tenantId,
      actorUserId: query.actorUserId,
      action: query.action,
      page: query.page,
      pageSize: query.pageSize,
    });

    return ok(c, paginate(result.items, result.total, query));
  });

  return app;
}

/** Checagem adicional de capacidade dentro de um handler. */
function requirePlatformCapability(
  c: { get: (key: 'session') => { user: { platformRole: string } } | null },
  capability: string,
): void {
  const session = c.get('session');
  if (!session || session.user.platformRole !== 'platform_admin') {
    throw AppError.forbidden(`Acao restrita: ${capability}.`);
  }
}
