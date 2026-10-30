import { and, desc, eq, gte, inArray, lte, schema, sql } from '@codeca/database';
import {
  AppError,
  BILLING_STATE_LABELS,
  CHARGE_STATE_LABELS,
  PAYMENT_METHOD_OPTIONS,
  PUBLICATION_STATE_LABELS,
  formatCents,
  gracePeriodSchema,
  paginate,
  platformChargeQuerySchema,
  platformSubscriptionQuerySchema,
  publicationHoldSchema,
  reconcileSchema,
  replayWebhookSchema,
  uuidSchema,
  webhookEventQuerySchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { BILLING_ACTIONS } from '../lib/billing/audit.js';
import { syncPlanWithProvider, loadPlan } from '../lib/billing/checkout.js';
import { reconcileBilling } from '../lib/billing/reconcile.js';
import { applySubscriptionPatch, requireSubscription } from '../lib/billing/service.js';
import {
  listWebhookEvents,
  loadWebhookEvent,
  replayWebhookEvent,
} from '../lib/billing/webhook-store.js';
import { ok, parseJsonBody, parseParams, parseQuery } from '../lib/http.js';
import { requirePlatform, sessionOf } from '../middleware/auth.js';
import { presentCharge } from './billing.js';
import type { AppBindings } from '../types.js';

/**
 * Cobranca no painel mestre da plataforma.
 *
 * Acesso restrito a `platform_admin`, com auditoria em toda acao. Duas regras
 * guiam este arquivo:
 *
 *  - uma acao administrativa **nao** reescreve o estado financeiro confirmado
 *    pela ValidaPay: ela grava uma decisao propria (`admin_hold`), em coluna
 *    separada do estado da assinatura e do estado das cobrancas;
 *  - suspender a publicacao nunca apaga conteudo da empresa.
 */

export function platformBillingRoutes() {
  const app = new Hono<AppBindings>();

  // ------------------------------------------------------- visao geral
  app.get('/billing/overview', requirePlatform('platform:overview'), async (c) => {
    const ctx = c.get('ctx');
    const countOf = sql<number>`cast(count(*) as int)`;
    const since30d = new Date(ctx.now().getTime() - 30 * 24 * 3600 * 1000);

    const [states] = await ctx.db
      .select({
        total: countOf,
        pending: sql<number>`cast(count(*) filter (where ${schema.subscriptions.status} = 'pending') as int)`,
        trialing: sql<number>`cast(count(*) filter (where ${schema.subscriptions.status} = 'trialing') as int)`,
        active: sql<number>`cast(count(*) filter (where ${schema.subscriptions.status} = 'active') as int)`,
        pastDue: sql<number>`cast(count(*) filter (where ${schema.subscriptions.status} = 'past_due') as int)`,
        cancelScheduled: sql<number>`cast(count(*) filter (where ${schema.subscriptions.status} = 'cancel_at_period_end') as int)`,
        canceled: sql<number>`cast(count(*) filter (where ${schema.subscriptions.status} = 'canceled') as int)`,
        expired: sql<number>`cast(count(*) filter (where ${schema.subscriptions.status} = 'expired') as int)`,
        suspended: sql<number>`cast(count(*) filter (where ${schema.subscriptions.status} = 'suspended') as int)`,
        adminHold: sql<number>`cast(count(*) filter (where ${schema.subscriptions.adminHold}) as int)`,
        disputeHold: sql<number>`cast(count(*) filter (where ${schema.subscriptions.disputeHold}) as int)`,
      })
      .from(schema.subscriptions);

    const [paid30d] = await ctx.db
      .select({
        total: sql<number>`cast(coalesce(sum(${schema.charges.amountCents}), 0) as bigint)`,
        count: countOf,
      })
      .from(schema.charges)
      .where(and(eq(schema.charges.status, 'paid'), gte(schema.charges.paidAt, since30d)));

    const [openCharges] = await ctx.db
      .select({ count: countOf })
      .from(schema.charges)
      .where(inArray(schema.charges.status, ['pending', 'processing', 'awaiting_payment']));

    const [failedEvents] = await ctx.db
      .select({ count: countOf })
      .from(schema.webhookEvents)
      .where(inArray(schema.webhookEvents.status, ['failed', 'unresolved']));

    const [pendingEvents] = await ctx.db
      .select({ count: countOf })
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.status, 'pending'));

    const plansToSync = await ctx.db
      .select({
        id: schema.plans.id,
        code: schema.plans.code,
        name: schema.plans.name,
        priceCents: schema.plans.priceCents,
        externalPriceId: schema.plans.externalPriceId,
        externalSyncedAt: schema.plans.externalSyncedAt,
        externalSyncError: schema.plans.externalSyncError,
        isActive: schema.plans.isActive,
      })
      .from(schema.plans)
      .orderBy(schema.plans.priceCents);

    return ok(c, {
      subscriptions: states ?? {},
      paidLast30Days: {
        amountCents: Number(paid30d?.total ?? 0),
        amountLabel: formatCents(Number(paid30d?.total ?? 0)),
        count: paid30d?.count ?? 0,
      },
      openCharges: openCharges?.count ?? 0,
      webhooks: {
        failed: failedEvents?.count ?? 0,
        pending: pendingEvents?.count ?? 0,
      },
      plans: plansToSync.map((plan) => ({
        ...plan,
        priceLabel: formatCents(plan.priceCents),
        // Plano gratuito nao vira preco na ValidaPay: a API exige valor > 0.
        billable: plan.priceCents > 0,
        synced: Boolean(plan.externalPriceId),
      })),
      provider: {
        configured: ctx.billing.configured,
        environment: ctx.billing.configured ? ctx.billing.environment : null,
        webhooksConfigured: ctx.features.billingWebhooks,
        reconciliationConfigured: ctx.features.billingReconciliation,
      },
    });
  });

  // ------------------------------------------------------- assinaturas
  app.get('/billing/subscriptions', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const query = parseQuery(c, platformSubscriptionQuerySchema);

    const conditions = [];
    if (query.state) conditions.push(eq(schema.subscriptions.status, query.state));
    if (query.tenantId) conditions.push(eq(schema.subscriptions.tenantId, query.tenantId));
    if (query.search) {
      const term = `%${query.search.toLowerCase()}%`;
      conditions.push(
        sql`(lower(${schema.tenants.displayName}) like ${term} or lower(${schema.tenants.slug}) like ${term} or ${schema.subscriptions.externalSubscriptionId} like ${term})`,
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await ctx.db
      .select({
        subscription: schema.subscriptions,
        tenantName: schema.tenants.displayName,
        tenantSlug: schema.tenants.slug,
        tenantStatus: schema.tenants.status,
        siteName: schema.sites.name,
        planName: schema.plans.name,
        planCode: schema.plans.code,
        planPriceCents: schema.plans.priceCents,
      })
      .from(schema.subscriptions)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.subscriptions.tenantId))
      .innerJoin(schema.sites, eq(schema.sites.id, schema.subscriptions.siteId))
      .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
      .where(where)
      .orderBy(desc(schema.subscriptions.updatedAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.subscriptions)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.subscriptions.tenantId))
      .where(where);

    return ok(
      c,
      paginate(
        rows.map((row) => ({
          id: row.subscription.id,
          tenantId: row.subscription.tenantId,
          // A assinatura e do site: e por ele que as acoes administrativas
          // agem, e e ele que a tela precisa nomear.
          siteId: row.subscription.siteId,
          siteName: row.siteName,
          tenantName: row.tenantName,
          tenantSlug: row.tenantSlug,
          tenantStatus: row.tenantStatus,
          planName: row.planName,
          planCode: row.planCode,
          planPriceLabel: formatCents(row.planPriceCents),
          state: row.subscription.status,
          stateLabel: BILLING_STATE_LABELS[row.subscription.status],
          providerStatus: row.subscription.providerStatus,
          publicationState: row.subscription.publicationState,
          publicationLabel: PUBLICATION_STATE_LABELS[row.subscription.publicationState],
          paymentMethod: row.subscription.paymentMethod,
          paymentMethodLabel: row.subscription.paymentMethod
            ? PAYMENT_METHOD_OPTIONS[row.subscription.paymentMethod].label
            : null,
          accessUntil: row.subscription.accessUntil,
          nextChargeAt: row.subscription.nextChargeAt,
          cancelAtPeriodEnd: row.subscription.cancelAtPeriodEnd,
          adminHold: row.subscription.adminHold,
          adminHoldReason: row.subscription.adminHoldReason,
          disputeHold: row.subscription.disputeHold,
          gracePeriodDays: row.subscription.gracePeriodDays,
          externalSubscriptionId: row.subscription.externalSubscriptionId,
          externalCustomerId: row.subscription.externalCustomerId,
          lastSyncedAt: row.subscription.lastSyncedAt,
          lastErrorMessage: row.subscription.lastErrorMessage,
        })),
        totals?.total ?? 0,
        query,
      ),
    );
  });

  // --------------------------------------------------------- cobrancas
  app.get('/billing/charges', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const query = parseQuery(c, platformChargeQuerySchema);

    const conditions = [];
    if (query.tenantId) conditions.push(eq(schema.charges.tenantId, query.tenantId));
    if (query.status) conditions.push(eq(schema.charges.status, query.status));
    if (query.minCents !== undefined) conditions.push(gte(schema.charges.amountCents, query.minCents));
    if (query.maxCents !== undefined) conditions.push(lte(schema.charges.amountCents, query.maxCents));
    if (query.from) {
      const from = new Date(query.from);
      if (!Number.isNaN(from.getTime())) conditions.push(gte(schema.charges.createdAt, from));
    }
    if (query.to) {
      const to = new Date(query.to);
      if (!Number.isNaN(to.getTime())) conditions.push(lte(schema.charges.createdAt, to));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await ctx.db
      .select({
        charge: schema.charges,
        tenantName: schema.tenants.displayName,
        tenantSlug: schema.tenants.slug,
      })
      .from(schema.charges)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.charges.tenantId))
      .where(where)
      .orderBy(desc(schema.charges.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.charges)
      .where(where);

    return ok(
      c,
      paginate(
        rows.map((row) => ({
          ...presentCharge(row.charge),
          tenantId: row.charge.tenantId,
          tenantName: row.tenantName,
          tenantSlug: row.tenantSlug,
        })),
        totals?.total ?? 0,
        query,
      ),
    );
  });

  // ------------------------------------------------- eventos de webhook
  app.get('/billing/webhooks', requirePlatform('platform:audit:read'), async (c) => {
    const ctx = c.get('ctx');
    const query = parseQuery(c, webhookEventQuerySchema);

    const rows = await listWebhookEvents(ctx.db, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.event ? { event: query.event } : {}),
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });

    return ok(c, {
      items: rows.map((row) => ({
        id: row.id,
        externalEventId: row.externalEventId,
        event: row.event,
        status: row.status,
        attempt: row.attempt,
        processingAttempts: row.processingAttempts,
        tenantId: row.tenantId,
        externalSubscriptionId: row.externalSubscriptionId,
        externalChargeId: row.externalChargeId,
        occurredAt: row.occurredAt,
        receivedAt: row.receivedAt,
        processedAt: row.processedAt,
        // Mensagem ja sanitizada na gravacao.
        errorMessage: row.errorMessage,
      })),
      page: query.page,
      pageSize: query.pageSize,
    });
  });

  app.get('/billing/webhooks/:eventId', requirePlatform('platform:audit:read'), async (c) => {
    const ctx = c.get('ctx');
    const { eventId } = parseParams(c, z.object({ eventId: uuidSchema }));
    const row = await loadWebhookEvent(ctx.db, eventId);
    if (!row) throw AppError.notFound('Evento nao encontrado.');
    return ok(c, { event: row });
  });

  // ------------------------------------------------------ reprocessar
  app.post('/billing/webhooks/replay', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, replayWebhookSchema);

    const row = await loadWebhookEvent(ctx.db, input.eventId);
    if (!row) throw AppError.notFound('Evento nao encontrado.');

    // Seguro de repetir: o processamento e idempotente e os estados so avancam.
    const result = await replayWebhookEvent(
      { db: ctx.db, now: ctx.now, source: 'admin', actorUserId: session.user.id },
      row,
    );

    await auditFromContext(c, {
      action: 'platform.webhook_replayed',
      entityType: 'webhook_event',
      entityId: row.id,
      metadata: { event: row.event, outcome: result.status },
    });

    return ok(c, {
      status: result.status,
      outcome: result.outcome,
      detail: result.detail,
      tenantId: result.tenantId,
    });
  });

  // ------------------------------------------------------ reconciliar
  app.post('/billing/reconcile', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, reconcileSchema);

    const report = await reconcileBilling(
      {
        db: ctx.db,
        now: ctx.now,
        source: 'reconciliation',
        actorUserId: session.user.id,
        provider: ctx.billing,
      },
      {
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        force: input.force,
        limit: input.limit,
      },
    );

    await auditFromContext(c, {
      action: 'platform.billing_reconciled',
      entityType: 'subscription',
      entityId: input.tenantId ?? 'all',
      metadata: {
        subscriptionsChecked: report.subscriptionsChecked,
        chargesChecked: report.chargesChecked,
        divergences: report.divergences.length,
        failures: report.failures.length,
      },
    });

    return ok(c, report);
  });

  // ------------------------------------- suspender/reativar publicacao
  app.post('/billing/publication-hold', requirePlatform('platform:tenants:suspend'), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, publicationHoldSchema);
    const subscription = await requireSubscription(ctx.db, input.siteId);

    const updated = await applySubscriptionPatch(
      { db: ctx.db, now: ctx.now, source: 'admin', actorUserId: session.user.id },
      subscription,
      {
        // Decisao administrativa, gravada em campo proprio: o estado da
        // assinatura e das cobrancas continua sendo o que a ValidaPay informou.
        adminHold: input.hold,
        adminHoldReason: input.hold ? input.reason.slice(0, 400) : '',
        adminHoldAt: input.hold ? ctx.now() : null,
        adminHoldByUserId: input.hold ? session.user.id : null,
      },
      {
        action: input.hold ? BILLING_ACTIONS.adminHoldApplied : BILLING_ACTIONS.adminHoldReleased,
        reason: input.reason,
        metadata: { hold: input.hold, providerStatus: subscription.providerStatus },
      },
    );

    // O conteudo nao e tocado: suspender afeta apenas a publicacao.
    // A empresa **nao** e suspensa junto. Antes era: a assinatura era unica
    // por empresa e os dois conceitos coincidiam. Agora, suspender a
    // publicacao de um site deixaria os outros sites da mesma empresa fora do
    // ar e trancaria o painel inteiro. Suspender a empresa continua possivel,
    // pela rota de empresas, que e onde essa decisao mora.
    //
    // `sites.status` tambem fica como esta: e o rotulo operacional da CODECA
    // IA (`draft`, `active`, ...), e sobrescreve-lo faria um site em
    // desenvolvimento virar "no ar" ao liberar a cobranca.
    await auditFromContext(c, {
      action: AUDIT_ACTIONS.tenantStatusChanged,
      tenantId: subscription.tenantId,
      entityType: 'site',
      entityId: input.siteId,
      metadata: { hold: input.hold, reason: input.reason },
    });

    return ok(c, {
      publicationState: updated.publicationState,
      publicationLabel: PUBLICATION_STATE_LABELS[updated.publicationState],
      adminHold: updated.adminHold,
      message: input.hold
        ? 'Publicacao suspensa. O conteudo da empresa continua salvo e o painel segue acessivel.'
        : 'Publicacao reativada conforme o estado da assinatura.',
    });
  });

  // ------------------------------------------- tolerancia por empresa
  app.post('/billing/grace-period', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, gracePeriodSchema);
    const subscription = await requireSubscription(ctx.db, input.siteId);

    const updated = await applySubscriptionPatch(
      { db: ctx.db, now: ctx.now, source: 'admin', actorUserId: session.user.id },
      subscription,
      { gracePeriodDays: input.gracePeriodDays },
      {
        action: BILLING_ACTIONS.gracePeriodChanged,
        reason: input.reason,
        metadata: {
          previous: subscription.gracePeriodDays,
          next: input.gracePeriodDays,
        },
      },
    );

    return ok(c, {
      gracePeriodDays: updated.gracePeriodDays,
      publicationState: updated.publicationState,
    });
  });

  // ------------------------------------------ sincronizar plano na API
  app.post('/billing/plans/:planId/sync', requirePlatform('platform:plans:write'), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const { planId } = parseParams(c, z.object({ planId: uuidSchema }));
    const plan = await loadPlan(ctx.db, planId);

    const result = await syncPlanWithProvider(
      {
        db: ctx.db,
        now: ctx.now,
        source: 'admin',
        actorUserId: session.user.id,
        provider: ctx.billing,
      },
      plan,
    );

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.planUpdated,
      entityType: 'plan',
      entityId: plan.id,
      metadata: { priceId: result.externalPriceId, productId: result.externalProductId },
    });

    return ok(c, {
      planId: plan.id,
      externalProductId: result.externalProductId,
      externalPriceId: result.externalPriceId,
      externalCheckoutUrl: result.externalCheckoutUrl,
    });
  });

  // ------------------------------------- historico de cobranca (audit)
  app.get('/billing/history', requirePlatform('platform:audit:read'), async (c) => {
    const ctx = c.get('ctx');
    const query = parseQuery(
      c,
      z.object({
        tenantId: uuidSchema.optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(30),
      }),
    );

    const where = query.tenantId
      ? eq(schema.billingAuditLogs.tenantId, query.tenantId)
      : undefined;

    const rows = await ctx.db
      .select({
        log: schema.billingAuditLogs,
        tenantName: schema.tenants.displayName,
      })
      .from(schema.billingAuditLogs)
      .leftJoin(schema.tenants, eq(schema.tenants.id, schema.billingAuditLogs.tenantId))
      .where(where)
      .orderBy(desc(schema.billingAuditLogs.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return ok(c, {
      items: rows.map((row) => ({
        id: row.log.id,
        tenantId: row.log.tenantId,
        tenantName: row.tenantName,
        action: row.log.action,
        source: row.log.source,
        previousState: row.log.previousState,
        newState: row.log.newState,
        previousPublication: row.log.previousPublication,
        newPublication: row.log.newPublication,
        reason: row.log.reason,
        metadata: row.log.metadata,
        actorUserId: row.log.actorUserId,
        webhookEventId: row.log.webhookEventId,
        createdAt: row.log.createdAt,
      })),
      page: query.page,
      pageSize: query.pageSize,
    });
  });

  // ------------------------------------------- cobrancas por etiqueta
  app.get('/billing/charge-states', requirePlatform('platform:overview'), (c) =>
    ok(c, {
      chargeStates: Object.entries(CHARGE_STATE_LABELS).map(([code, label]) => ({ code, label })),
      billingStates: Object.entries(BILLING_STATE_LABELS).map(([code, label]) => ({ code, label })),
    }),
  );

  return app;
}
