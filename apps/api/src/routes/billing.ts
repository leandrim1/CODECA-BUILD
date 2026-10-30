import { and, desc, eq, gte, lte, schema, sql } from '@codeca/database';
import {
  AppError,
  BILLING_STATE_LABELS,
  CHARGE_STATE_LABELS,
  PAYMENT_METHOD_OPTIONS,
  PUBLICATION_STATE_LABELS,
  PUBLICATION_STATE_MESSAGES,
  cancelSubscriptionSchema,
  changePlanSchema,
  chargeIdParamSchema,
  chargeQuerySchema,
  decidePublication,
  formatCents,
  paginate,
  planBillingSchema,
  startSubscriptionSchema,
  uuidSchema,
  type PaymentMethodCode,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { auditFromContext } from '../lib/audit-context.js';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { BILLING_ACTIONS, recordBillingAudit } from '../lib/billing/audit.js';
import { assertPlanContractable, loadPlan, startCheckout } from '../lib/billing/checkout.js';
import { reconcileCharge, reconcileSubscription } from '../lib/billing/reconcile.js';
import { resolveSiteBilling } from '../lib/billing/suspension.js';
import {
  applySubscriptionPatch,
  loadSubscription,
  publicationForRow,
  requireSubscription,
  upsertCharge,
} from '../lib/billing/service.js';
import { ok, parseJsonBody, parseParams, parseQuery } from '../lib/http.js';
import { loadPlanStatus } from '../lib/plan-limits.js';
import { requireCapability, requireVerifiedEmail, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Cobranca da construtora.
 *
 * Tudo aqui e escopado pela empresa resolvida da sessao: nenhuma rota aceita um
 * `tenantId` do corpo, e uma cobranca de outra empresa responde 404 mesmo que o
 * identificador exista.
 *
 * Nenhum valor vem do navegador. O cliente escolhe plano e forma de pagamento;
 * o preco e lido do banco e enviado a ValidaPay pelo servidor.
 */

export function billingRoutes() {
  const app = new Hono<AppBindings>();

  // ------------------------------------------------------------- resumo
  app.get('/:tenantId/billing', requireCapability('billing:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const now = ctx.now();

    const subscription = await loadSubscription(ctx.db, tenant.siteId);
    const { plan, usage } = await loadPlanStatus(ctx.db, tenant.tenantId);
    const situacao = await resolveSiteBilling(ctx.db, tenant.siteId, now);

    const plans = await ctx.db
      .select({
        id: schema.plans.id,
        code: schema.plans.code,
        name: schema.plans.name,
        description: schema.plans.description,
        priceCents: schema.plans.priceCents,
        limits: schema.plans.limits,
        billing: schema.plans.billing,
        isActive: schema.plans.isActive,
        externalPriceId: schema.plans.externalPriceId,
      })
      .from(schema.plans)
      .where(and(eq(schema.plans.isActive, true), eq(schema.plans.isPublic, true)))
      .orderBy(schema.plans.priceCents);

    const charges = await ctx.db
      .select()
      .from(schema.charges)
      .where(eq(schema.charges.tenantId, tenant.tenantId))
      .orderBy(desc(schema.charges.createdAt))
      .limit(6);

    const decision = subscription
      ? decidePublication({
          state: subscription.status,
          accessUntil: subscription.accessUntil,
          gracePeriodDays: subscription.gracePeriodDays,
          adminHold: subscription.adminHold,
          disputeHold: subscription.disputeHold,
          now,
        })
      : null;

    return ok(c, {
      subscription: subscription
        ? {
            state: subscription.status,
            stateLabel: BILLING_STATE_LABELS[subscription.status],
            publicationState: decision?.publication ?? subscription.publicationState,
            publicationLabel:
              PUBLICATION_STATE_LABELS[decision?.publication ?? subscription.publicationState],
            publicationMessage:
              PUBLICATION_STATE_MESSAGES[decision?.publication ?? subscription.publicationState],
            inGracePeriod: decision?.inGracePeriod ?? false,
            graceEndsAt: decision?.graceEndsAt ?? null,
            gracePeriodDays: subscription.gracePeriodDays,
            /**
             * O que a suspensao faz neste plano, e o que vale agora.
             *
             * Esta rota e a unica que a politica nunca restringe, entao e
             * tambem a unica que o painel consegue ler quando a politica e
             * `blocked` -- e portanto o lugar certo para explicar a situacao
             * a quem precisa regularizar.
             */
            suspension: situacao.effect,
            suspensionPolicy: situacao.policy,
            paymentMethod: subscription.paymentMethod,
            paymentMethodLabel: subscription.paymentMethod
              ? PAYMENT_METHOD_OPTIONS[subscription.paymentMethod].label
              : null,
            /** Renovacao automatica so existe em cartao e Pix Automatico. */
            automaticRenewal: subscription.paymentMethod
              ? PAYMENT_METHOD_OPTIONS[subscription.paymentMethod].automatic
              : null,
            accessUntil: subscription.accessUntil,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            nextChargeAt: subscription.nextChargeAt,
            currentCycleNumber: subscription.currentCycleNumber,
            currentCycleAmountCents: subscription.currentCycleAmountCents,
            trialEndsAt: subscription.trialEndsAt,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            canceledAt: subscription.canceledAt,
            cancelReason: subscription.cancelReason,
            adminHold: subscription.adminHold,
            disputeHold: subscription.disputeHold,
            // Mensagem de falha do ultimo pagamento, sem dado de cartao.
            lastErrorMessage: subscription.lastErrorMessage,
            lastSyncedAt: subscription.lastSyncedAt,
            checkoutUrl:
              subscription.status === 'pending' ? subscription.checkoutUrl : null,
            pendingPlanId: subscription.pendingPlanId,
            externalSubscriptionId: subscription.externalSubscriptionId,
          }
        : null,
      plan: {
        id: plan.planId,
        code: plan.planCode,
        name: plan.planName,
        limits: plan.limits,
        overridden: plan.overridden,
      },
      usage,
      plans: plans.map((row) => {
        const billing = planBillingSchema.parse(row.billing);
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description,
          priceCents: row.priceCents,
          priceLabel: formatCents(row.priceCents),
          limits: row.limits,
          recurrenceType: billing.recurrenceType,
          recurrenceInterval: billing.recurrenceInterval,
          trialDays: billing.trialDays,
          /** Formas oferecidas, com o aviso de renovacao manual quando cabe. */
          paymentMethods: billing.paymentMethods
            .filter((code) => row.priceCents >= PAYMENT_METHOD_OPTIONS[code].minimumCents)
            .map((code) => ({
              code,
              label: PAYMENT_METHOD_OPTIONS[code].label,
              description: PAYMENT_METHOD_OPTIONS[code].description,
              automatic: PAYMENT_METHOD_OPTIONS[code].automatic,
            })),
          current: row.id === plan.planId,
          contractable: row.priceCents > 0,
        };
      }),
      charges: charges.map(presentCharge),
      /** Sem credenciais, a contratacao fica indisponivel -- e dito, nao simulado. */
      available: ctx.billing.configured,
      environment: ctx.billing.configured ? ctx.billing.environment : null,
    });
  });

  // -------------------------------------------------------- contratacao
  app.post(
    '/:tenantId/billing/checkout',
    requireVerifiedEmail(),
    requireCapability('billing:manage'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const session = sessionOf(c);
      const input = await parseJsonBody(c, startSubscriptionSchema);

      const result = await startCheckout(
        {
          db: ctx.db,
          now: ctx.now,
          source: 'checkout',
          actorUserId: session.user.id,
          provider: ctx.billing,
          env: ctx.env,
        },
        {
          tenantId: tenant.tenantId,
          siteId: tenant.siteId,
          planId: input.planId,
          paymentMethod: input.paymentMethod,
          actorUserId: session.user.id,
        },
      );

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.tenantPlanChanged,
        entityType: 'subscription',
        entityId: result.checkoutSessionId,
        metadata: {
          planId: input.planId,
          paymentMethod: input.paymentMethod,
          reused: result.reused,
        },
      });

      return ok(c, {
        checkoutUrl: result.checkoutUrl,
        checkoutSessionId: result.checkoutSessionId,
        reused: result.reused,
        planName: result.planName,
        priceLabel: formatCents(result.priceCents),
        paymentMethod: result.paymentMethod,
        notice: result.notice,
        // O site continua privado ate o pagamento ser confirmado.
        message:
          'Conclua o pagamento na pagina da ValidaPay. A publicacao e liberada quando o pagamento '
          + 'for confirmado.',
      });
    },
  );

  // ------------------------------------------------- historico de cobrancas
  app.get('/:tenantId/billing/charges', requireCapability('billing:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const query = parseQuery(c, chargeQuerySchema);

    const conditions = [eq(schema.charges.tenantId, tenant.tenantId)];
    if (query.status) conditions.push(eq(schema.charges.status, query.status));
    if (query.from) {
      const from = new Date(query.from);
      if (!Number.isNaN(from.getTime())) conditions.push(gte(schema.charges.createdAt, from));
    }
    if (query.to) {
      const to = new Date(query.to);
      if (!Number.isNaN(to.getTime())) conditions.push(lte(schema.charges.createdAt, to));
    }

    const rows = await ctx.db
      .select()
      .from(schema.charges)
      .where(and(...conditions))
      .orderBy(desc(schema.charges.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.charges)
      .where(and(...conditions));

    return ok(c, paginate(rows.map(presentCharge), totals?.total ?? 0, query));
  });

  // ------------------------------------------- consulta de uma cobranca
  app.get(
    '/:tenantId/billing/charges/:chargeId',
    requireCapability('billing:read'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const { chargeId } = parseParams(
        c,
        z.object({ tenantId: uuidSchema, chargeId: uuidSchema }),
      );

      // O escopo da empresa entra na propria consulta: trocar o id na URL
      // devolve 404, nunca a cobranca de outro cliente.
      const [charge] = await ctx.db
        .select()
        .from(schema.charges)
        .where(and(eq(schema.charges.id, chargeId), eq(schema.charges.tenantId, tenant.tenantId)));
      if (!charge) throw AppError.notFound('Cobranca nao encontrada.');

      return ok(c, { charge: presentCharge(charge) });
    },
  );

  // ---------------------------------- consultar novamente na ValidaPay
  app.post(
    '/:tenantId/billing/charges/:chargeId/refresh',
    requireCapability('billing:read'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const session = sessionOf(c);
      const { chargeId } = parseParams(
        c,
        z.object({ tenantId: uuidSchema, chargeId: uuidSchema }),
      );

      const [charge] = await ctx.db
        .select()
        .from(schema.charges)
        .where(and(eq(schema.charges.id, chargeId), eq(schema.charges.tenantId, tenant.tenantId)));
      if (!charge) throw AppError.notFound('Cobranca nao encontrada.');

      if (!ctx.billing.configured) {
        throw AppError.notConfigured(
          'A consulta ao provedor depende da configuracao da ValidaPay no servidor.',
        );
      }

      await reconcileCharge(
        {
          db: ctx.db,
          now: ctx.now,
          source: 'reconciliation',
          actorUserId: session.user.id,
          provider: ctx.billing,
        },
        charge,
      );

      const [updated] = await ctx.db
        .select()
        .from(schema.charges)
        .where(eq(schema.charges.id, chargeId));

      return ok(c, { charge: presentCharge(updated ?? charge) });
    },
  );

  // ----------------------------------------- sincronizar a assinatura
  app.post('/:tenantId/billing/refresh', requireCapability('billing:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const subscription = await requireSubscription(ctx.db, tenant.siteId);

    if (!ctx.billing.configured || !subscription.externalSubscriptionId) {
      // Sem provedor ou sem vinculo, ainda vale reavaliar o tempo de acesso.
      const refreshed = await applySubscriptionPatch(
        { db: ctx.db, now: ctx.now, source: 'reconciliation', actorUserId: session.user.id },
        subscription,
        {},
        { action: BILLING_ACTIONS.reconciled, reason: 'Reavaliacao do periodo de acesso.' },
      );
      return ok(c, {
        state: refreshed.status,
        publicationState: refreshed.publicationState,
        synced: false,
      });
    }

    const outcome = await reconcileSubscription(
      {
        db: ctx.db,
        now: ctx.now,
        source: 'reconciliation',
        actorUserId: session.user.id,
        provider: ctx.billing,
      },
      subscription,
    );

    const updated = await requireSubscription(ctx.db, tenant.siteId);
    return ok(c, {
      state: updated.status,
      stateLabel: BILLING_STATE_LABELS[updated.status],
      publicationState: updated.publicationState,
      synced: true,
      updated: outcome.updated,
      divergence: outcome.divergence,
    });
  });

  // --------------------------------------------------- troca de plano
  app.post(
    '/:tenantId/billing/change-plan',
    requireVerifiedEmail(),
    requireCapability('billing:manage'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const session = sessionOf(c);
      const input = await parseJsonBody(c, changePlanSchema);

      const subscription = await requireSubscription(ctx.db, tenant.siteId);
      const plan = await loadPlan(ctx.db, input.planId);

      if (plan.id === subscription.planId) {
        throw AppError.conflict(`A empresa ja esta no plano ${plan.name}.`);
      }

      const method: PaymentMethodCode = subscription.paymentMethod ?? 'creditcard';
      assertPlanContractable(plan, method);

      // Sem assinatura ativa no provedor, trocar de plano e contratar.
      if (!subscription.externalSubscriptionId || !subscription.externalItemId) {
        throw AppError.conflict(
          'Nao ha assinatura ativa para alterar. Contrate o plano desejado pelo checkout.',
          { action: 'checkout' },
        );
      }
      if (!plan.externalPriceId) {
        throw AppError.conflict(
          `O plano ${plan.name} ainda nao foi sincronizado com o provedor de pagamento.`,
        );
      }

      const billingCtx = {
        db: ctx.db,
        now: ctx.now,
        source: 'checkout' as const,
        actorUserId: session.user.id,
        provider: ctx.billing,
      };

      // Simulacao: nao altera nada no provedor.
      if (input.preview) {
        const preview = await ctx.billing.previewPlanChange({
          subscriptionId: subscription.externalSubscriptionId,
          itemId: subscription.externalItemId,
          priceId: plan.externalPriceId,
        });
        return ok(c, {
          preview: true,
          planName: plan.name,
          priceLabel: formatCents(plan.priceCents),
          mode: preview.mode ?? null,
          chargeNowCents: preview.amount != null ? Math.round(preview.amount * 100) : null,
          creditCents: preview.credit != null ? Math.round(preview.credit * 100) : null,
          effectiveCycleNumber: preview.effectiveCycleNumber ?? null,
          warnings: preview.warnings ?? [],
        });
      }

      const result = await ctx.billing.changePlan({
        subscriptionId: subscription.externalSubscriptionId,
        itemId: subscription.externalItemId,
        priceId: plan.externalPriceId,
      });

      // O plano local muda quando o provedor confirmar por webhook; aqui
      // apenas registramos a intencao, para nao conceder limites antes.
      const upgrade = plan.priceCents > (subscription.currentCycleAmountCents ?? 0);
      await applySubscriptionPatch(billingCtx, subscription, {
        pendingPlanId: plan.id,
        ...(result.itemId ? { externalItemId: result.itemId } : {}),
      }, {
        action: BILLING_ACTIONS.planChangeRequested,
        reason: `Troca para o plano ${plan.name} solicitada no provedor.`,
        metadata: {
          planId: plan.id,
          planCode: plan.code,
          mode: result.mode ?? null,
          chargeId: result.chargeId ?? null,
          upgrade,
        },
      });

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.tenantPlanChanged,
        entityType: 'subscription',
        entityId: subscription.id,
        metadata: { planCode: plan.code, mode: result.mode ?? null },
      });

      return ok(c, {
        preview: false,
        planName: plan.name,
        mode: result.mode ?? null,
        chargeId: result.chargeId ?? null,
        message: upgrade
          ? 'Troca solicitada. Quando o pagamento da diferenca for confirmado, o plano novo passa a valer.'
          : 'Troca registrada. O valor novo passa a valer na proxima cobranca.',
      });
    },
  );

  // ------------------------------------------------------ cancelamento
  app.post(
    '/:tenantId/billing/cancel',
    requireVerifiedEmail(),
    requireCapability('billing:manage'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const session = sessionOf(c);
      const input = await parseJsonBody(c, cancelSubscriptionSchema);
      const subscription = await requireSubscription(ctx.db, tenant.siteId);

      if (!subscription.externalSubscriptionId) {
        throw AppError.conflict('Nao ha assinatura contratada para cancelar.');
      }
      if (subscription.status === 'canceled') {
        throw AppError.conflict('Esta assinatura ja esta cancelada.');
      }

      const response = await ctx.billing.cancelSubscription(
        subscription.externalSubscriptionId,
        input.reason,
      );

      // Quem decide se o cancelamento e imediato ou agendado e a ValidaPay,
      // conforme exista periodo pago pela frente. Registramos o que ela disse.
      const immediate = response.immediate === true;
      const effectiveAt = response.effectiveAt ? new Date(response.effectiveAt) : null;

      const updated = await applySubscriptionPatch(
        { db: ctx.db, now: ctx.now, source: 'checkout', actorUserId: session.user.id },
        subscription,
        {
          status: immediate ? 'canceled' : 'cancel_at_period_end',
          cancelAtPeriodEnd: !immediate,
          cancelRequestedAt: ctx.now(),
          cancelReason: input.reason.slice(0, 400),
          ...(immediate ? { canceledAt: ctx.now(), nextChargeAt: null } : {}),
          providerStatus: response.status ?? subscription.providerStatus,
        },
        {
          action: immediate ? BILLING_ACTIONS.canceled : BILLING_ACTIONS.cancelScheduled,
          reason: input.reason || 'Cancelamento solicitado pela empresa.',
          metadata: {
            immediate,
            effectiveAt: effectiveAt?.toISOString() ?? null,
            requestedMode: input.mode,
          },
        },
      );

      await auditFromContext(c, {
        action: 'billing.canceled',
        entityType: 'subscription',
        entityId: subscription.id,
        metadata: { immediate },
      });

      return ok(c, {
        immediate,
        effectiveAt,
        state: updated.status,
        stateLabel: BILLING_STATE_LABELS[updated.status],
        publicationState: updated.publicationState,
        message: immediate
          ? 'Assinatura cancelada. O conteudo do site continua salvo e o painel segue disponivel.'
          : `Cancelamento agendado. O site continua no ar ate ${
              effectiveAt ? effectiveAt.toLocaleDateString('pt-BR') : 'o fim do periodo pago'
            }.`,
      });
    },
  );

  // ------------------------------------ desfazer cancelamento agendado
  app.delete(
    '/:tenantId/billing/cancel',
    requireCapability('billing:manage'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const session = sessionOf(c);
      const subscription = await requireSubscription(ctx.db, tenant.siteId);

      if (!subscription.externalSubscriptionId || !subscription.cancelAtPeriodEnd) {
        throw AppError.conflict('Nao ha cancelamento agendado para desfazer.');
      }

      await ctx.billing.undoScheduledCancellation(subscription.externalSubscriptionId);

      const updated = await applySubscriptionPatch(
        { db: ctx.db, now: ctx.now, source: 'checkout', actorUserId: session.user.id },
        subscription,
        {
          cancelAtPeriodEnd: false,
          cancelRequestedAt: null,
          cancelReason: '',
          status: subscription.accessUntil ? 'active' : subscription.status,
        },
        {
          action: BILLING_ACTIONS.cancelUndone,
          reason: 'Cancelamento agendado desfeito pela empresa.',
        },
      );

      return ok(c, {
        state: updated.status,
        stateLabel: BILLING_STATE_LABELS[updated.status],
        message: 'Cancelamento desfeito. A assinatura segue ativa.',
      });
    },
  );

  return app;
}

/** Converte a cobranca para o formato exibido no painel. */
function presentCharge(row: typeof schema.charges.$inferSelect) {
  return {
    id: row.id,
    externalChargeId: row.externalChargeId,
    status: row.status,
    statusLabel: CHARGE_STATE_LABELS[row.status],
    providerStatus: row.providerStatus,
    amountCents: row.amountCents,
    amountLabel: formatCents(row.amountCents),
    refundedAmountCents: row.refundedAmountCents,
    paymentMethod: row.paymentMethod,
    paymentMethodLabel: row.paymentMethod
      ? PAYMENT_METHOD_OPTIONS[row.paymentMethod].label
      : null,
    cycleNumber: row.cycleNumber,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
    expiresAt: row.expiresAt,
    canceledAt: row.canceledAt,
    failureReason: row.failureReason,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
  };
}

/** Exportado para o painel mestre reaproveitar a mesma apresentacao. */
export { presentCharge };

/** Recalcula a publicacao de uma assinatura, util em rotas administrativas. */
export { publicationForRow, upsertCharge, recordBillingAudit };
