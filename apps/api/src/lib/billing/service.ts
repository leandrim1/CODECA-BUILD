import { and, eq, findPrimarySiteId, schema, type Database } from '@codeca/database';
import {
  AppError,
  chargeCountsAsPaid,
  chargeReversesPayment,
  chargeStateAdvances,
  chargeStateFromProvider,
  decidePublication,
  paymentMethodFromType,
  reaisToCents,
  type BillingState,
  type ChargeState,
  type PaymentMethodCode,
  type PublicationState,
  type ValidaPayChargeStatus,
} from '@codeca/shared';
import { BILLING_ACTIONS, recordBillingAudit, type BillingAuditSource } from './audit.js';

/**
 * Estado da assinatura e da publicacao.
 *
 * Tudo que muda dinheiro ou publicacao passa por aqui, nunca direto nas rotas.
 * Duas invariantes valem em todo o modulo:
 *
 *  1. **O acesso so avanca com pagamento confirmado.** `access_until` nunca e
 *     estendido pela criacao de uma assinatura nem por um estado otimista; so
 *     por uma cobranca paga ou pelo proximo ciclo informado pelo provedor.
 *  2. **Estado definitivo nao retrocede.** Eventos chegam fora de ordem e mais
 *     de uma vez; um `pending` atrasado nao apaga um `paid` ja aplicado.
 */

export type SubscriptionRow = typeof schema.subscriptions.$inferSelect;
export type ChargeRow = typeof schema.charges.$inferSelect;

export interface BillingContext {
  db: Database;
  now: () => Date;
  /** Origem da mudanca, usada na auditoria. */
  source: BillingAuditSource;
  actorUserId?: string | null;
  webhookEventId?: string | null;
}

// --------------------------------------------------------------- leitura

export async function loadSubscription(
  db: Database,
  tenantId: string,
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, tenantId));
  return row ?? null;
}

export async function requireSubscription(
  db: Database,
  tenantId: string,
): Promise<SubscriptionRow> {
  const row = await loadSubscription(db, tenantId);
  if (!row) throw AppError.notFound('Esta empresa nao possui assinatura registrada.');
  return row;
}

export async function findSubscriptionByExternalId(
  db: Database,
  externalSubscriptionId: string,
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.externalSubscriptionId, externalSubscriptionId));
  return row ?? null;
}

export async function findSubscriptionByIntent(
  db: Database,
  intentToken: string,
): Promise<SubscriptionRow | null> {
  const [row] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.intentToken, intentToken));
  return row ?? null;
}

export async function findChargeByExternalId(
  db: Database,
  externalChargeId: string,
): Promise<ChargeRow | null> {
  const [row] = await db
    .select()
    .from(schema.charges)
    .where(eq(schema.charges.externalChargeId, externalChargeId));
  return row ?? null;
}

// ------------------------------------------------------------ publicacao

export interface PublicationInput {
  state: BillingState;
  accessUntil: Date | null;
  gracePeriodDays: number;
  adminHold: boolean;
  disputeHold: boolean;
}

/** Decide a publicacao a partir das colunas da assinatura. */
export function publicationFor(row: PublicationInput, now: Date): PublicationState {
  return decidePublication({
    state: row.state,
    accessUntil: row.accessUntil,
    gracePeriodDays: row.gracePeriodDays,
    adminHold: row.adminHold,
    disputeHold: row.disputeHold,
    now,
  }).publication;
}

export function publicationForRow(row: SubscriptionRow, now: Date): PublicationState {
  return publicationFor(
    {
      state: row.status,
      accessUntil: row.accessUntil,
      gracePeriodDays: row.gracePeriodDays,
      adminHold: row.adminHold,
      disputeHold: row.disputeHold,
    },
    now,
  );
}

// ------------------------------------------------------- atualizacao base

export interface SubscriptionPatch {
  status?: BillingState;
  providerStatus?: string;
  paymentMethod?: PaymentMethodCode | null;
  accessUntil?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  nextChargeAt?: Date | null;
  currentCycleNumber?: number;
  currentCycleAmountCents?: number | null;
  cancelAtPeriodEnd?: boolean;
  cancelRequestedAt?: Date | null;
  cancelReason?: string;
  canceledAt?: Date | null;
  planId?: string;
  pendingPlanId?: string | null;
  disputeHold?: boolean;
  disputeReason?: string;
  adminHold?: boolean;
  adminHoldReason?: string;
  adminHoldAt?: Date | null;
  adminHoldByUserId?: string | null;
  gracePeriodDays?: number;
  externalSubscriptionId?: string | null;
  externalCustomerId?: string | null;
  externalItemId?: string | null;
  externalPriceId?: string | null;
  externalCheckoutId?: string | null;
  checkoutSessionId?: string | null;
  checkoutUrl?: string | null;
  checkoutCreatedAt?: Date | null;
  intentToken?: string | null;
  lastSyncedAt?: Date | null;
  lastEventAt?: Date | null;
  lastErrorMessage?: string;
  trialEndsAt?: Date | null;
}

export interface ApplyPatchOptions {
  action: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  /**
   * Quando informado, o acesso so e estendido -- nunca encurtado. Usado nos
   * caminhos de pagamento: uma renovacao nao pode reduzir o acesso ja pago.
   */
  extendAccessOnly?: boolean;
}

/**
 * Aplica a mudanca na assinatura, recalcula a publicacao e registra auditoria.
 *
 * Devolve a linha atualizada. Deve ser chamada dentro de uma transacao quando a
 * mudanca acompanha outras escritas (cobranca, evento), para que estado,
 * cobranca e historico avancem juntos ou nao avancem.
 */
export async function applySubscriptionPatch(
  ctx: BillingContext,
  current: SubscriptionRow,
  patch: SubscriptionPatch,
  options: ApplyPatchOptions,
): Promise<SubscriptionRow> {
  const now = ctx.now();

  let accessUntil = patch.accessUntil !== undefined ? patch.accessUntil : current.accessUntil;
  if (options.extendAccessOnly && accessUntil && current.accessUntil) {
    // Renovacao nunca encurta o acesso que a empresa ja pagou.
    accessUntil = accessUntil.getTime() >= current.accessUntil.getTime()
      ? accessUntil
      : current.accessUntil;
  }

  const next = {
    status: patch.status ?? current.status,
    accessUntil,
    gracePeriodDays: patch.gracePeriodDays ?? current.gracePeriodDays,
    adminHold: patch.adminHold ?? current.adminHold,
    disputeHold: patch.disputeHold ?? current.disputeHold,
  };

  const publication = publicationFor(
    {
      state: next.status,
      accessUntil: next.accessUntil,
      gracePeriodDays: next.gracePeriodDays,
      adminHold: next.adminHold,
      disputeHold: next.disputeHold,
    },
    now,
  );

  const [updated] = await ctx.db
    .update(schema.subscriptions)
    .set({
      ...patch,
      accessUntil,
      publicationState: publication,
      updatedAt: now,
    })
    .where(eq(schema.subscriptions.id, current.id))
    .returning();

  if (!updated) throw AppError.internal('Nao foi possivel atualizar a assinatura.');

  const stateChanged = current.status !== updated.status;
  const publicationChanged = current.publicationState !== updated.publicationState;

  if (stateChanged || publicationChanged || options.reason || options.metadata) {
    await recordBillingAudit(ctx.db, {
      tenantId: current.tenantId,
      subscriptionId: current.id,
      action: options.action,
      source: ctx.source,
      actorUserId: ctx.actorUserId ?? null,
      webhookEventId: ctx.webhookEventId ?? null,
      previousState: current.status,
      newState: updated.status,
      previousPublication: current.publicationState,
      newPublication: updated.publicationState,
      reason: options.reason ?? '',
      metadata: {
        ...(options.metadata ?? {}),
        ...(patch.providerStatus !== undefined ? { providerStatus: patch.providerStatus } : {}),
      },
    });
  }

  return updated;
}

/**
 * Recalcula a publicacao sem mudar mais nada.
 *
 * E o que faz um periodo de tolerancia vencido suspender o site: o estado
 * comercial continua `past_due`, mas a decisao de publicacao muda com o tempo.
 */
export async function refreshPublication(
  ctx: BillingContext,
  row: SubscriptionRow,
  reason = '',
): Promise<SubscriptionRow> {
  const publication = publicationForRow(row, ctx.now());
  if (publication === row.publicationState) return row;

  const [updated] = await ctx.db
    .update(schema.subscriptions)
    .set({ publicationState: publication, updatedAt: ctx.now() })
    .where(eq(schema.subscriptions.id, row.id))
    .returning();
  if (!updated) return row;

  await recordBillingAudit(ctx.db, {
    tenantId: row.tenantId,
    subscriptionId: row.id,
    action: BILLING_ACTIONS.publicationChanged,
    source: ctx.source,
    actorUserId: ctx.actorUserId ?? null,
    webhookEventId: ctx.webhookEventId ?? null,
    previousState: row.status,
    newState: updated.status,
    previousPublication: row.publicationState,
    newPublication: updated.publicationState,
    reason,
  });

  return updated;
}

// ----------------------------------------------------------- cobrancas

export interface UpsertChargeInput {
  tenantId: string;
  /**
   * Site cobrado. A assinatura e do site, nao da empresa: uma empresa com dois
   * sites pode ter um no plano pago e o outro nao. Resolvido aqui a partir da
   * propria assinatura, para nenhum chamador poder cruzar os dois.
   */
  subscriptionId: string | null;
  externalChargeId: string;
  externalSubscriptionId?: string | null;
  externalInvoiceId?: string | null;
  providerStatus: ValidaPayChargeStatus | string;
  /** Valor em reais, como vem do provedor. Convertido para centavos aqui. */
  amount?: number | string | null;
  refundedAmount?: number | string | null;
  paymentType?: string | null;
  cycleNumber?: number | null;
  description?: string;
  dueAt?: Date | null;
  paidAt?: Date | null;
  expiresAt?: Date | null;
  canceledAt?: Date | null;
  failureCode?: string;
  failureReason?: string;
  attempt?: number | null;
  /** Instante do evento ou da consulta que originou esta atualizacao. */
  eventAt: Date;
  /** `true` quando o dado vem de uma consulta direta a API. */
  fromSync?: boolean;
}

export interface UpsertChargeResult {
  charge: ChargeRow;
  previousState: ChargeState | null;
  /** `false` quando o dado recebido era mais antigo e foi descartado. */
  applied: boolean;
  /** `true` quando a cobranca passou a contar como paga nesta aplicacao. */
  becamePaid: boolean;
  /** `true` quando o pagamento foi revertido (estorno ou chargeback). */
  becameReversed: boolean;
}

/**
 * Grava ou atualiza uma cobranca, de forma idempotente.
 *
 * O identificador externo e unico na tabela: a mesma cobranca recebida duas
 * vezes atualiza a mesma linha. Estados so avancam (ver `chargeStateAdvances`),
 * portanto um evento repetido ou atrasado nao reabre uma cobranca paga nem
 * credita o periodo outra vez.
 */
/**
 * Site a que a cobranca pertence.
 *
 * Vem da assinatura quando ela existe; sem assinatura, do site principal da
 * empresa. O banco ainda confere o par `(site_id, tenant_id)`, entao um site
 * de outra empresa nao passaria daqui.
 */
async function resolveChargeSiteId(
  ctx: BillingContext,
  input: UpsertChargeInput,
): Promise<string> {
  if (input.subscriptionId) {
    const [row] = await ctx.db
      .select({ siteId: schema.subscriptions.siteId })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, input.subscriptionId));
    if (row) return row.siteId;
  }
  const siteId = await findPrimarySiteId(ctx.db, input.tenantId);
  if (!siteId) throw new Error('Empresa sem site principal para vincular a cobranca.');
  return siteId;
}

export async function upsertCharge(
  ctx: BillingContext,
  input: UpsertChargeInput,
): Promise<UpsertChargeResult> {
  const state = normalizeChargeState(input.providerStatus);
  const amountCents = input.amount === null || input.amount === undefined
    ? null
    : reaisToCents(input.amount);
  const refundedCents = input.refundedAmount === null || input.refundedAmount === undefined
    ? null
    : reaisToCents(input.refundedAmount);
  const paymentMethod = input.paymentType ? paymentMethodFromType(input.paymentType) : null;

  const existing = await findChargeByExternalId(ctx.db, input.externalChargeId);

  if (!existing) {
    const siteId = await resolveChargeSiteId(ctx, input);
    const [created] = await ctx.db
      .insert(schema.charges)
      .values({
        tenantId: input.tenantId,
        siteId,
        subscriptionId: input.subscriptionId,
        externalChargeId: input.externalChargeId,
        externalSubscriptionId: input.externalSubscriptionId ?? null,
        externalInvoiceId: input.externalInvoiceId ?? null,
        status: state,
        providerStatus: String(input.providerStatus),
        amountCents: amountCents ?? 0,
        refundedAmountCents: refundedCents ?? 0,
        paymentMethod,
        cycleNumber: input.cycleNumber ?? null,
        description: input.description ?? '',
        dueAt: input.dueAt ?? null,
        paidAt: input.paidAt ?? null,
        expiresAt: input.expiresAt ?? null,
        canceledAt: input.canceledAt ?? null,
        failureCode: input.failureCode ?? '',
        failureReason: input.failureReason ?? '',
        attempt: input.attempt ?? null,
        lastEventAt: input.eventAt,
        lastSyncedAt: input.fromSync ? ctx.now() : null,
      })
      .returning();
    if (!created) throw AppError.internal('Nao foi possivel registrar a cobranca.');

    await recordBillingAudit(ctx.db, {
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId,
      chargeId: created.id,
      action: BILLING_ACTIONS.chargeRecorded,
      source: ctx.source,
      actorUserId: ctx.actorUserId ?? null,
      webhookEventId: ctx.webhookEventId ?? null,
      newState: state,
      metadata: {
        externalChargeId: input.externalChargeId,
        amountCents: amountCents ?? 0,
        cycleNumber: input.cycleNumber ?? null,
      },
    });

    return {
      charge: created,
      previousState: null,
      applied: true,
      becamePaid: chargeCountsAsPaid(state),
      becameReversed: chargeReversesPayment(state),
    };
  }

  // A cobranca pertence a empresa que a registrou primeiro. Um evento que
  // aponte para outra empresa e tratado como divergencia, nao aplicado.
  if (existing.tenantId !== input.tenantId) {
    throw AppError.conflict('A cobranca informada pertence a outra empresa.');
  }

  const advances = chargeStateAdvances(existing.status, state);
  const sameState = existing.status === state;

  if (!advances) {
    await recordBillingAudit(ctx.db, {
      tenantId: existing.tenantId,
      subscriptionId: existing.subscriptionId,
      chargeId: existing.id,
      action: BILLING_ACTIONS.chargeStaleEventIgnored,
      source: ctx.source,
      webhookEventId: ctx.webhookEventId ?? null,
      previousState: existing.status,
      newState: state,
      reason: 'Estado recebido e anterior ao estado atual da cobranca.',
      metadata: { externalChargeId: input.externalChargeId, eventAt: input.eventAt.toISOString() },
    });
    return {
      charge: existing,
      previousState: existing.status,
      applied: false,
      becamePaid: false,
      becameReversed: false,
    };
  }

  const [updated] = await ctx.db
    .update(schema.charges)
    .set({
      status: state,
      providerStatus: String(input.providerStatus),
      // Campos ausentes no evento preservam o que ja estava gravado.
      ...(amountCents !== null ? { amountCents } : {}),
      ...(refundedCents !== null ? { refundedAmountCents: refundedCents } : {}),
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(input.cycleNumber !== null && input.cycleNumber !== undefined
        ? { cycleNumber: input.cycleNumber }
        : {}),
      ...(input.subscriptionId && !existing.subscriptionId
        ? { subscriptionId: input.subscriptionId }
        : {}),
      ...(input.externalSubscriptionId ? { externalSubscriptionId: input.externalSubscriptionId } : {}),
      ...(input.externalInvoiceId ? { externalInvoiceId: input.externalInvoiceId } : {}),
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      ...(input.paidAt ? { paidAt: input.paidAt } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      ...(input.canceledAt ? { canceledAt: input.canceledAt } : {}),
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      ...(input.attempt !== null && input.attempt !== undefined ? { attempt: input.attempt } : {}),
      lastEventAt: input.eventAt,
      ...(input.fromSync ? { lastSyncedAt: ctx.now() } : {}),
      updatedAt: ctx.now(),
    })
    .where(eq(schema.charges.id, existing.id))
    .returning();
  if (!updated) throw AppError.internal('Nao foi possivel atualizar a cobranca.');

  if (!sameState) {
    await recordBillingAudit(ctx.db, {
      tenantId: existing.tenantId,
      subscriptionId: updated.subscriptionId,
      chargeId: updated.id,
      action: BILLING_ACTIONS.chargeStateChanged,
      source: ctx.source,
      actorUserId: ctx.actorUserId ?? null,
      webhookEventId: ctx.webhookEventId ?? null,
      previousState: existing.status,
      newState: state,
      metadata: { externalChargeId: input.externalChargeId },
    });
  }

  return {
    charge: updated,
    previousState: existing.status,
    applied: true,
    // "Passou a contar como paga" so na transicao: evita creditar duas vezes.
    becamePaid: !chargeCountsAsPaid(existing.status) && chargeCountsAsPaid(state),
    becameReversed: !chargeReversesPayment(existing.status) && chargeReversesPayment(state),
  };
}

function normalizeChargeState(status: ValidaPayChargeStatus | string): ChargeState {
  const upper = String(status).toUpperCase();
  const known = chargeStateFromProvider(upper as ValidaPayChargeStatus);
  const valid = (
    [
      'pending',
      'processing',
      'awaiting_payment',
      'failed',
      'expired',
      'canceled',
      'archived',
      'paid',
      'dispute',
      'partially_refunded',
      'refunded',
      'charged_back',
    ] as const
  ).includes(known as never);
  if (!valid) {
    // Estado novo do provedor: tratamos como pendente e seguimos pela
    // reconciliacao, em vez de assumir que o dinheiro entrou.
    console.warn(`[billing] status de cobranca desconhecido recebido: ${upper}`);
    return 'pending';
  }
  return known;
}

/** Soma paga por uma empresa, usada no painel e na reconciliacao. */
export async function countPaidCharges(db: Database, tenantId: string): Promise<number> {
  const rows = await db
    .select({ amountCents: schema.charges.amountCents })
    .from(schema.charges)
    .where(and(eq(schema.charges.tenantId, tenantId), eq(schema.charges.status, 'paid')));
  return rows.reduce((total, row) => total + row.amountCents, 0);
}
