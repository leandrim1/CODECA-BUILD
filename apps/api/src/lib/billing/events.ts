import { eq, schema, type Database } from '@codeca/database';
import {
  AppError,
  billingStateFromProvider,
  paymentMethodFromType,
  type BillingState,
  type ValidaPaySubscriptionStatus,
} from '@codeca/shared';
import { BILLING_ACTIONS, recordBillingAudit } from './audit.js';
import {
  asRecord,
  estimatePeriodEnd,
  readAccount,
  readDate,
  readMetadata,
  readNumber,
  readRecord,
  readString,
  readSubscriptionBase,
  type RawPayload,
} from './payload.js';
import {
  applySubscriptionPatch,
  findChargeByExternalId,
  findSubscriptionByExternalId,
  findSubscriptionByIntent,
  upsertCharge,
  type BillingContext,
  type SubscriptionPatch,
  type SubscriptionRow,
} from './service.js';

/**
 * Aplicacao dos eventos de webhook.
 *
 * Tres regras governam este modulo:
 *
 *  1. **O evento nao e a verdade sobre quem e o cliente.** A empresa e
 *     resolvida pelos nossos proprios registros (assinatura externa, token de
 *     intencao, cobranca ja gravada). Um evento que nao resolve e marcado como
 *     `unresolved` para reconciliacao -- nunca atribuido por aproximacao.
 *  2. **Pagamento confirmado e o unico caminho para estender o acesso.**
 *  3. **Nada e aplicado duas vezes.** Cobrancas sao unicas pelo id externo e
 *     os estados so avancam; um evento repetido vira operacao sem efeito.
 */

export type EventOutcome = 'processed' | 'ignored' | 'unresolved';

export interface ApplyEventInput {
  event: string;
  payload: RawPayload;
  /** Instante declarado no corpo do evento. */
  occurredAt: Date;
  webhookEventId: string | null;
}

export interface ApplyEventResult {
  outcome: EventOutcome;
  tenantId: string | null;
  subscriptionId: string | null
  chargeId: string | null;
  /** Explicacao curta, gravada no evento e na auditoria. */
  detail: string;
}

export async function applyBillingEvent(
  ctx: BillingContext,
  input: ApplyEventInput,
): Promise<ApplyEventResult> {
  const { event, payload } = input;

  if (event.startsWith('refund.')) return applyRefundEvent(ctx, input);
  if (event === 'charge.created' || event === 'charge.expired') {
    return applyChargeOnlyEvent(ctx, input);
  }
  if (event.startsWith('subscription.') || event.startsWith('payment.')) {
    return applySubscriptionEvent(ctx, input);
  }

  void payload;
  return {
    outcome: 'ignored',
    tenantId: null,
    subscriptionId: null,
    chargeId: null,
    detail: `Evento ${event} nao e tratado por esta integracao.`,
  };
}

// --------------------------------------------------- resolucao da empresa

interface Resolution {
  subscription: SubscriptionRow | null;
  detail: string;
}

/**
 * Encontra a assinatura local correspondente ao evento.
 *
 * Ordem deliberada: primeiro o vinculo ja estabelecido, depois o token que nos
 * mesmos enviamos no checkout, depois a cobranca ja registrada. E-mail e
 * documento **nao** entram: dois clientes podem compartilhar um e-mail de
 * contato, e um evento nao prova a quem pertence.
 */
async function resolveSubscription(
  db: Database,
  payload: RawPayload,
): Promise<Resolution> {
  const externalSubscriptionId = readString(payload, 'subscriptionId');
  if (externalSubscriptionId) {
    const bound = await findSubscriptionByExternalId(db, externalSubscriptionId);
    if (bound) return { subscription: bound, detail: 'Resolvido pelo id da assinatura.' };
  }

  const metadata = readMetadata(payload);
  if (metadata.intentToken) {
    const byIntent = await findSubscriptionByIntent(db, metadata.intentToken);
    if (byIntent) return { subscription: byIntent, detail: 'Resolvido pelo token da contratacao.' };
  }

  const chargeId = readString(payload, 'chargeId');
  if (chargeId) {
    const charge = await findChargeByExternalId(db, chargeId);
    if (charge?.subscriptionId) {
      const [row] = await db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.id, charge.subscriptionId));
      if (row) return { subscription: row, detail: 'Resolvido pela cobranca ja registrada.' };
    }
  }

  return {
    subscription: null,
    detail: externalSubscriptionId
      ? `Assinatura ${externalSubscriptionId} nao esta vinculada a nenhuma empresa.`
      : 'O evento nao traz identificadores que permitam localizar a empresa.',
  };
}

// ------------------------------------------- eventos de assinatura

async function applySubscriptionEvent(
  ctx: BillingContext,
  input: ApplyEventInput,
): Promise<ApplyEventResult> {
  const { event, payload, occurredAt } = input;
  const base = readSubscriptionBase(payload);

  const { subscription, detail } = await resolveSubscription(ctx.db, payload);
  if (!subscription) {
    return {
      outcome: 'unresolved',
      tenantId: null,
      subscriptionId: base.subscriptionId,
      chargeId: base.chargeId,
      detail,
    };
  }

  // Evento anterior ao ultimo aplicado: o estado atual e mais novo.
  // A excecao e o primeiro vinculo, em que ainda nao ha marca de tempo.
  const stale =
    subscription.lastEventAt !== null && occurredAt.getTime() < subscription.lastEventAt.getTime();

  const patch: SubscriptionPatch = {
    lastEventAt: stale ? subscription.lastEventAt : occurredAt,
  };

  // Vincula o id externo no primeiro evento da assinatura.
  if (base.subscriptionId && !subscription.externalSubscriptionId) {
    patch.externalSubscriptionId = base.subscriptionId;
    patch.intentToken = null; // o token cumpriu seu papel
  }
  if (base.customerId && !subscription.externalCustomerId) {
    patch.externalCustomerId = base.customerId;
  }
  if (base.item?.itemId && !subscription.externalItemId) patch.externalItemId = base.item.itemId;
  if (base.item?.priceId && !subscription.externalPriceId) {
    patch.externalPriceId = base.item.priceId;
  }

  const providerStatus = base.subscriptionStatus;
  if (providerStatus) patch.providerStatus = providerStatus;

  const paymentMethod =
    (base.paymentType ? paymentMethodFromType(base.paymentType) : null) ??
    (base.cycle?.paymentMethod ? paymentMethodFromType(base.cycle.paymentMethod.toUpperCase()) : null);
  if (paymentMethod && !subscription.paymentMethod) patch.paymentMethod = paymentMethod;

  if (base.currentCycleNumber !== null && !stale) {
    patch.currentCycleNumber = base.currentCycleNumber;
  }
  if (base.cycle?.amount !== null && base.cycle?.amount !== undefined && !stale) {
    patch.currentCycleAmountCents = Math.round(base.cycle.amount * 100);
  }
  if (base.nextChargeDate !== null && !stale) patch.nextChargeAt = base.nextChargeDate;

  // Estado comercial: so avanca com evento atual.
  if (providerStatus && !stale) {
    const mapped = mapProviderState(providerStatus, event, subscription);
    if (mapped) patch.status = mapped;
  }

  let action: string = BILLING_ACTIONS.subscriptionStateChanged;
  let reason = `Evento ${event}.`;
  let extendAccessOnly = false;
  let chargeRecorded: string | null = null;

  // Registra a cobranca que acompanha o evento, quando houver.
  if (base.chargeId) {
    const chargeStatus = chargeStatusForEvent(event, base);
    if (chargeStatus) {
      const result = await upsertCharge(ctx, {
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        externalChargeId: base.chargeId,
        externalSubscriptionId: base.subscriptionId,
        externalInvoiceId: base.invoiceId,
        providerStatus: chargeStatus,
        amount: base.cycle?.amount ?? readNumber(payload, 'amount'),
        paymentType: base.paymentType ?? base.cycle?.paymentMethod?.toUpperCase() ?? null,
        cycleNumber: base.cycle?.cycleNumber ?? base.currentCycleNumber,
        dueAt: base.cycle?.chargeDate ?? null,
        paidAt: base.cycle?.paidAt ?? readDate(payload, 'paidAt'),
        failureCode: base.retry?.failureCode ?? '',
        failureReason: base.retry?.failureReason ?? '',
        attempt: base.retry?.attempt ?? null,
        eventAt: occurredAt,
      });
      chargeRecorded = result.charge.id;
    }
  }

  switch (event) {
    case 'subscription.created':
      action = BILLING_ACTIONS.subscriptionBound;
      // Criar a assinatura nao libera o site: o acesso espera o pagamento.
      if (!stale && !subscription.accessUntil) patch.status = patch.status ?? 'pending';
      if (base.startDate && !subscription.currentPeriodStart) {
        patch.currentPeriodStart = base.startDate;
      }
      break;

    case 'subscription.trial': {
      action = BILLING_ACTIONS.subscriptionStateChanged;
      const trialEnd = trialEndFrom(payload, base.startDate ?? occurredAt);
      if (trialEnd && !stale) {
        patch.trialEndsAt = trialEnd;
        patch.accessUntil = trialEnd;
        extendAccessOnly = true;
      }
      break;
    }

    case 'subscription.activated':
    case 'subscription.renewed':
    case 'payment.success': {
      // Unico caminho que estende o acesso, e so com ciclo efetivamente pago.
      const paid = base.cycle?.status?.toUpperCase() === 'PAID' || event !== 'payment.success';
      const paidAt = base.cycle?.paidAt ?? readDate(payload, 'paidAt') ?? occurredAt;
      if (paid && !stale) {
        action = BILLING_ACTIONS.paymentConfirmed;
        reason = `Pagamento confirmado pelo evento ${event}.`;
        patch.accessUntil = base.nextChargeDate ?? estimatePeriodEnd(paidAt, base.interval);
        patch.currentPeriodStart = base.cycle?.chargeDate ?? paidAt;
        patch.currentPeriodEnd = patch.accessUntil;
        extendAccessOnly = true;
        patch.lastErrorMessage = '';
        if (!patch.status || patch.status === 'pending' || patch.status === 'past_due') {
          patch.status = subscription.cancelAtPeriodEnd ? 'cancel_at_period_end' : 'active';
        }
      }
      break;
    }

    case 'payment.overdue':
      action = BILLING_ACTIONS.paymentOverdue;
      reason = 'Ciclo vencido sem pagamento.';
      // Uma falha isolada nao cancela: o acesso segue ate a tolerancia vencer.
      if (!stale) patch.status = 'past_due';
      break;

    case 'payment.failed':
    case 'payment.retry': {
      action = BILLING_ACTIONS.paymentFailed;
      const failure = base.retry?.failureReason ?? readString(payload, 'failureReason');
      reason = failure ? `Pagamento recusado: ${failure}` : 'Pagamento recusado.';
      if (failure) patch.lastErrorMessage = failure.slice(0, 300);
      // Nao muda o estado comercial: quem decide atraso e `payment.overdue`.
      break;
    }

    case 'subscription.cancel_scheduled':
      action = BILLING_ACTIONS.cancelScheduled;
      reason = 'Cancelamento agendado para o fim do periodo contratado.';
      if (!stale) {
        patch.cancelAtPeriodEnd = true;
        patch.status = 'cancel_at_period_end';
      }
      break;

    case 'subscription.canceled':
      action = BILLING_ACTIONS.canceled;
      reason = base.cancelReason ?? 'Assinatura cancelada.';
      if (!stale) {
        patch.status = 'canceled';
        patch.canceledAt = base.canceledAt ?? occurredAt;
        patch.cancelAtPeriodEnd = false;
        patch.nextChargeAt = null;
        if (base.cancelReason) patch.cancelReason = base.cancelReason.slice(0, 400);
      }
      break;

    case 'subscription.expired':
      action = BILLING_ACTIONS.expired;
      reason = 'Assinatura encerrada por falta de pagamento.';
      if (!stale) {
        patch.status = 'expired';
        patch.nextChargeAt = null;
      }
      break;

    case 'subscription.downgrade_scheduled':
      action = BILLING_ACTIONS.downgradeScheduled;
      reason = 'Troca de plano agendada para o proximo ciclo.';
      break;

    case 'subscription.upgraded':
      action = BILLING_ACTIONS.planChanged;
      reason = 'Plano alterado no provedor.';
      if (!stale && base.item?.priceId) patch.externalPriceId = base.item.priceId;
      break;

    default:
      break;
  }

  // Alinha o plano local com o preco contratado -- somente em eventos que
  // confirmam pagamento ou troca efetivada. Uma assinatura apenas criada nao
  // concede os limites do plano novo: o pagamento e que concede.
  const priceId = base.item?.priceId ?? null;
  if (priceId && !stale && PLAN_ALIGNING_EVENTS.has(event)) {
    const plan = await findPlanByPriceId(ctx.db, priceId);
    if (plan && plan.id !== subscription.planId) {
      patch.planId = plan.id;
      patch.pendingPlanId = null;
      await ctx.db
        .update(schema.tenants)
        .set({ planId: plan.id, updatedAt: ctx.now() })
        .where(eq(schema.tenants.id, subscription.tenantId));
    }
  }

  const updated = await applySubscriptionPatch(ctx, subscription, patch, {
    action,
    reason: stale ? `${reason} (evento anterior ao ultimo aplicado: estado preservado)` : reason,
    metadata: {
      event,
      account: readAccount(payload),
      providerStatus: providerStatus ?? '',
      stale,
    },
    extendAccessOnly,
  });

  // O estado da empresa acompanha a assinatura, sem apagar conteudo.
  await syncTenantStatus(ctx, updated);

  return {
    outcome: 'processed',
    tenantId: updated.tenantId,
    subscriptionId: base.subscriptionId,
    chargeId: chargeRecorded,
    detail: stale ? 'Evento atrasado: apenas registrado.' : reason,
  };
}

/**
 * Qual status de cobranca o evento carrega.
 *
 * Nos eventos de pagamento o `status` da raiz e o da assinatura; o da cobranca
 * vem do ciclo. Quando nao da para saber, devolve `null` e nenhuma cobranca e
 * gravada a partir desse evento.
 */
function chargeStatusForEvent(
  event: string,
  base: ReturnType<typeof readSubscriptionBase>,
): string | null {
  switch (event) {
    case 'payment.success':
      return 'PAID';
    case 'payment.overdue':
      return base.cycle?.status?.toUpperCase() ?? null;
    case 'payment.failed':
    case 'payment.retry':
      return 'FAILED';
    case 'subscription.activated':
    case 'subscription.renewed':
      return base.cycle?.status?.toUpperCase() ?? 'PAID';
    case 'subscription.canceled':
      return base.cycle?.status?.toUpperCase() ?? null;
    case 'subscription.upgraded':
    case 'subscription.item_added':
      return base.cycle?.status?.toUpperCase() ?? null;
    default:
      return base.cycle?.status?.toUpperCase() ?? null;
  }
}

/** Traduz o status do provedor, preservando um cancelamento ja agendado. */
function mapProviderState(
  providerStatus: string,
  event: string,
  current: SubscriptionRow,
): BillingState | null {
  const known = (
    [
      'PENDING',
      'TRIALING',
      'ACTIVE',
      'PAST_DUE',
      'DEFAULT',
      'EXPIRED',
      'CANCELED',
      'COMPLETED',
      'ARCHIVED',
    ] as const
  ).includes(providerStatus as ValidaPaySubscriptionStatus)
    ? (providerStatus as ValidaPaySubscriptionStatus)
    : null;

  if (!known) {
    console.warn(`[billing] status de assinatura desconhecido em ${event}: ${providerStatus}`);
    return null;
  }

  // Uma suspensao administrativa nao e desfeita por um evento do provedor.
  if (current.status === 'suspended') return null;

  return billingStateFromProvider(known, {
    cancelAtPeriodEnd: current.cancelAtPeriodEnd || event === 'subscription.cancel_scheduled',
  });
}

function trialEndFrom(payload: RawPayload, from: Date): Date | null {
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    const price = readRecord(asRecord(item), 'price');
    const trialDays = readNumber(price, 'trialDays');
    if (trialDays && trialDays > 0) {
      return new Date(from.getTime() + trialDays * 24 * 3600 * 1000);
    }
  }
  return null;
}

async function findPlanByPriceId(
  db: Database,
  priceId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.externalPriceId, priceId));
  return row ?? null;
}

/**
 * Reflete o estado da assinatura no estado da empresa.
 *
 * `suspended` aqui significa "site fora do ar", nunca "dados removidos":
 * conteudo, imoveis, imagens e configuracoes continuam intactos, e o
 * proprietario segue com acesso ao painel para regularizar.
 */
async function syncTenantStatus(ctx: BillingContext, row: SubscriptionRow): Promise<void> {
  const [tenant] = await ctx.db
    .select({ status: schema.tenants.status })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, row.tenantId));
  if (!tenant) return;

  const target = tenantStatusFor(row);
  if (!target || target === tenant.status) return;

  await ctx.db
    .update(schema.tenants)
    .set({
      status: target,
      suspendedAt: target === 'suspended' ? ctx.now() : null,
      updatedAt: ctx.now(),
    })
    .where(eq(schema.tenants.id, row.tenantId));

  await recordBillingAudit(ctx.db, {
    tenantId: row.tenantId,
    subscriptionId: row.id,
    action: BILLING_ACTIONS.publicationChanged,
    source: ctx.source,
    actorUserId: ctx.actorUserId ?? null,
    webhookEventId: ctx.webhookEventId ?? null,
    previousState: tenant.status,
    newState: target,
    previousPublication: row.publicationState,
    newPublication: row.publicationState,
    reason: 'Estado da empresa alinhado ao estado da assinatura.',
  });
}

function tenantStatusFor(row: SubscriptionRow): 'trialing' | 'active' | 'suspended' | null {
  if (row.adminHold) return 'suspended';
  switch (row.status) {
    case 'trialing':
      return 'trialing';
    case 'active':
    case 'cancel_at_period_end':
    case 'past_due':
      // Atraso nao suspende a empresa: quem decide o site e `publicationState`.
      return 'active';
    case 'suspended':
      return 'suspended';
    case 'pending':
    case 'canceled':
    case 'expired':
    case 'completed':
      // Mantem a empresa ativa no painel; o site e controlado a parte.
      return null;
  }
}

// ----------------------------------------- eventos apenas de cobranca

/**
 * `charge.created` e `charge.expired`.
 *
 * Aqui o `status` da raiz e o status da COBRANCA. Cobrancas avulsas (sem
 * `subscriptionId`) nao pertencem a este fluxo e sao ignoradas de forma
 * explicita.
 */
async function applyChargeOnlyEvent(
  ctx: BillingContext,
  input: ApplyEventInput,
): Promise<ApplyEventResult> {
  const { payload, occurredAt, event } = input;
  const chargeId = readString(payload, 'chargeId');
  if (!chargeId) {
    return {
      outcome: 'ignored',
      tenantId: null,
      subscriptionId: null,
      chargeId: null,
      detail: 'Evento de cobranca sem chargeId.',
    };
  }

  const { subscription, detail } = await resolveSubscription(ctx.db, payload);
  if (!subscription) {
    const existing = await findChargeByExternalId(ctx.db, chargeId);
    if (!existing) {
      return {
        outcome: readString(payload, 'subscriptionId') ? 'unresolved' : 'ignored',
        tenantId: null,
        subscriptionId: readString(payload, 'subscriptionId'),
        chargeId,
        detail: readString(payload, 'subscriptionId')
          ? detail
          : 'Cobranca avulsa: nao pertence a nenhuma assinatura da plataforma.',
      };
    }
  }

  const base = readSubscriptionBase(payload);
  const result = await upsertCharge(ctx, {
    tenantId: subscription?.tenantId ?? '',
    subscriptionId: subscription?.id ?? null,
    externalChargeId: chargeId,
    externalSubscriptionId: base.subscriptionId,
    externalInvoiceId: base.invoiceId,
    // Status da raiz: nestes dois eventos ele e da cobranca.
    providerStatus: readString(payload, 'status') ?? 'PENDING',
    amount: readNumber(payload, 'amount'),
    paymentType: base.paymentType,
    cycleNumber: base.cycle?.cycleNumber ?? base.currentCycleNumber,
    dueAt: readDate(payload, 'dueDate'),
    paidAt: readDate(payload, 'paidAt'),
    expiresAt: readDate(readRecord(payload, 'pix'), 'expiresAt'),
    eventAt: occurredAt,
  });

  if (subscription) {
    await applySubscriptionPatch(
      ctx,
      subscription,
      { lastEventAt: occurredAt },
      {
        action: BILLING_ACTIONS.chargeRecorded,
        reason: `Evento ${event} da cobranca ${chargeId}.`,
        metadata: { event, chargeState: result.charge.status },
      },
    );
  }

  return {
    outcome: 'processed',
    tenantId: result.charge.tenantId,
    subscriptionId: base.subscriptionId,
    chargeId: result.charge.id,
    detail: result.applied
      ? `Cobranca em ${result.charge.status}.`
      : 'Evento anterior ao estado atual da cobranca: descartado.',
  };
}

// ------------------------------------------------ estornos e contestacoes

/**
 * `refund.requested`, `refund.confirmed` e `refund.failed`.
 *
 * Estes eventos nao trazem `subscriptionId`: a empresa e encontrada pela
 * cobranca ja registrada. Um estorno confirmado suspende o site para revisao,
 * por decisao explicita -- nao e tratado como simples inadimplencia.
 */
async function applyRefundEvent(
  ctx: BillingContext,
  input: ApplyEventInput,
): Promise<ApplyEventResult> {
  const { payload, occurredAt, event } = input;
  const chargeId = readString(payload, 'chargeId');
  if (!chargeId) {
    return {
      outcome: 'ignored',
      tenantId: null,
      subscriptionId: null,
      chargeId: null,
      detail: 'Evento de devolucao sem chargeId.',
    };
  }

  const charge = await findChargeByExternalId(ctx.db, chargeId);
  if (!charge) {
    return {
      outcome: 'unresolved',
      tenantId: null,
      subscriptionId: null,
      chargeId,
      detail: `Cobranca ${chargeId} nao esta registrada na plataforma.`,
    };
  }

  const amount = readNumber(payload, 'amount');
  const refundStatus = (readString(payload, 'status') ?? '').toUpperCase();

  // `refund.failed` chega com status ERROR: o dinheiro permanece com a
  // plataforma, portanto a cobranca continua paga.
  if (event === 'refund.failed' || refundStatus === 'ERROR') {
    await recordBillingAudit(ctx.db, {
      tenantId: charge.tenantId,
      subscriptionId: charge.subscriptionId,
      chargeId: charge.id,
      action: BILLING_ACTIONS.refundOpened,
      source: ctx.source,
      webhookEventId: ctx.webhookEventId ?? null,
      previousState: charge.status,
      newState: charge.status,
      reason: 'Devolucao recusada pelo provedor: a cobranca segue paga.',
      metadata: { event, refundId: readString(payload, 'refundId') },
    });
    return {
      outcome: 'processed',
      tenantId: charge.tenantId,
      subscriptionId: charge.externalSubscriptionId,
      chargeId: charge.id,
      detail: 'Devolucao recusada: nenhuma mudanca de acesso.',
    };
  }

  const confirmed = event === 'refund.confirmed' || refundStatus === 'CONFIRMED';
  const totalRefund =
    amount !== null && charge.amountCents > 0
      ? Math.round(amount * 100) >= charge.amountCents
      : true;

  const result = await upsertCharge(ctx, {
    tenantId: charge.tenantId,
    subscriptionId: charge.subscriptionId,
    externalChargeId: chargeId,
    providerStatus: confirmed
      ? totalRefund
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED'
      : 'DISPUTE',
    refundedAmount: amount,
    eventAt: occurredAt,
  });

  let detail = confirmed ? 'Estorno confirmado.' : 'Estorno em processamento.';

  if (charge.subscriptionId) {
    const [subscription] = await ctx.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, charge.subscriptionId));

    if (subscription) {
      // Estorno total suspende o site para revisao; parcial fica registrado.
      const hold = confirmed && totalRefund;
      const updated = await applySubscriptionPatch(
        ctx,
        subscription,
        {
          lastEventAt: occurredAt,
          ...(hold
            ? {
                disputeHold: true,
                disputeReason: `Estorno confirmado da cobranca ${chargeId}.`,
              }
            : {}),
        },
        {
          action: confirmed ? BILLING_ACTIONS.refundConfirmed : BILLING_ACTIONS.refundOpened,
          reason: hold
            ? 'Estorno total confirmado: publicacao suspensa para revisao.'
            : detail,
          metadata: {
            event,
            refundId: readString(payload, 'refundId'),
            chargeState: result.charge.status,
          },
        },
      );
      if (hold) detail = 'Estorno total confirmado: site suspenso para revisao.';
      await syncTenantStatus(ctx, updated);
    }
  }

  return {
    outcome: 'processed',
    tenantId: charge.tenantId,
    subscriptionId: charge.externalSubscriptionId,
    chargeId: result.charge.id,
    detail,
  };
}

/**
 * Eventos em que o plano contratado passa a valer de fato.
 *
 * `subscription.created` fica de fora de proposito: a assinatura existe, mas
 * nada foi pago ainda, e os limites do plano novo nao podem ser liberados.
 */
const PLAN_ALIGNING_EVENTS = new Set([
  'subscription.activated',
  'subscription.renewed',
  'subscription.upgraded',
  'payment.success',
]);

/** Mensagem curta e sem dados sensiveis para gravar no evento. */
export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof AppError) return `${error.code}: ${error.message}`.slice(0, 500);
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 500);
  return String(error).slice(0, 500);
}
