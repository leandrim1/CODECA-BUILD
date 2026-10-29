import { and, asc, eq, inArray, isNotNull, isNull, lt, or, schema, type Database } from '@codeca/database';
import {
  AppError,
  billingStateFromProvider,
  paymentMethodFromType,
  reaisToCents,
  type ValidaPaySubscriptionStatus,
} from '@codeca/shared';
import type { BillingProvider } from '../validapay/provider.js';
import { BILLING_ACTIONS, recordBillingAudit } from './audit.js';
import { estimatePeriodEnd } from './payload.js';
import {
  applySubscriptionPatch,
  refreshPublication,
  upsertCharge,
  type BillingContext,
  type ChargeRow,
  type SubscriptionPatch,
  type SubscriptionRow,
} from './service.js';

/**
 * Reconciliacao com a ValidaPay.
 *
 * Existe porque webhook e entrega "pelo menos uma vez", mas nao "exatamente
 * uma vez" nem "sempre": uma entrega pode falhar por 72 horas e desistir, e a
 * funcao serverless pode cair no meio do processamento. A reconciliacao
 * reconsulta o provedor, compara com o estado local e corrige a divergencia --
 * sem duplicar pagamento nem periodo, porque passa pelas mesmas funcoes
 * monotonicas usadas pelo webhook.
 *
 * Tambem e o que faz o tempo passar: um periodo de tolerancia vencido suspende
 * o site mesmo que nenhum evento novo chegue.
 */

/** Idade minima para reconsultar o que ja foi sincronizado. */
const DEFAULT_STALE_MS = 6 * 60 * 60 * 1000;
/** Cobrancas em aberto sao reconsultadas com mais frequencia. */
const OPEN_CHARGE_STALE_MS = 30 * 60 * 1000;

export interface ReconcileOptions {
  tenantId?: string;
  force?: boolean;
  limit?: number;
}

export interface ReconcileReport {
  subscriptionsChecked: number;
  subscriptionsUpdated: number;
  chargesChecked: number;
  chargesUpdated: number;
  publicationsChanged: number;
  pendingEventsReplayed: number;
  divergences: Array<{ kind: 'subscription' | 'charge'; id: string; detail: string }>;
  failures: Array<{ kind: string; id: string; error: string }>;
}

export async function reconcileBilling(
  ctx: BillingContext & { provider: BillingProvider },
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    subscriptionsChecked: 0,
    subscriptionsUpdated: 0,
    chargesChecked: 0,
    chargesUpdated: 0,
    publicationsChanged: 0,
    pendingEventsReplayed: 0,
    divergences: [],
    failures: [],
  };

  const limit = options.limit ?? 50;
  const now = ctx.now();

  // 1. A publicacao depende do tempo: recalcula antes de qualquer consulta.
  //    Trial vencido, tolerancia esgotada e periodo encerrado entram aqui, e
  //    isso funciona mesmo sem credenciais do provedor.
  report.publicationsChanged = await refreshStalePublications(ctx, options.tenantId);

  if (!ctx.provider.configured) {
    // Sem credenciais nao ha o que reconsultar; o recalculo acima ja valeu.
    return report;
  }

  // 2. Cobrancas em aberto: o pagamento pode ter sido confirmado sem webhook.
  const openCharges = await selectOpenCharges(ctx.db, {
    tenantId: options.tenantId,
    force: options.force ?? false,
    now,
    limit,
  });

  for (const charge of openCharges) {
    report.chargesChecked += 1;
    try {
      const updated = await reconcileCharge(ctx, charge);
      if (updated) report.chargesUpdated += 1;
    } catch (error) {
      report.failures.push({
        kind: 'charge',
        id: charge.externalChargeId,
        error: errorText(error),
      });
    }
  }

  // 3. Assinaturas vinculadas: confirma estado, ciclo e proxima cobranca.
  const subscriptions = await selectSubscriptionsToSync(ctx.db, {
    tenantId: options.tenantId,
    force: options.force ?? false,
    now,
    limit,
  });

  for (const subscription of subscriptions) {
    report.subscriptionsChecked += 1;
    try {
      const outcome = await reconcileSubscription(ctx, subscription);
      if (outcome.updated) report.subscriptionsUpdated += 1;
      if (outcome.divergence) {
        report.divergences.push({
          kind: 'subscription',
          id: subscription.externalSubscriptionId ?? subscription.id,
          detail: outcome.divergence,
        });
      }
    } catch (error) {
      report.failures.push({
        kind: 'subscription',
        id: subscription.externalSubscriptionId ?? subscription.id,
        error: errorText(error),
      });
      await ctx.db
        .update(schema.subscriptions)
        .set({ lastErrorMessage: errorText(error).slice(0, 300), updatedAt: now })
        .where(eq(schema.subscriptions.id, subscription.id));
    }
  }

  return report;
}

// ------------------------------------------------------- publicacao

/**
 * Recalcula a publicacao de quem pode ter vencido desde a ultima avaliacao.
 *
 * Nao consulta a API: compara `access_until` + tolerancia com o relogio.
 */
export async function refreshStalePublications(
  ctx: BillingContext,
  tenantId?: string,
): Promise<number> {
  const rows = await ctx.db
    .select()
    .from(schema.subscriptions)
    .where(tenantId ? eq(schema.subscriptions.tenantId, tenantId) : undefined);

  let changed = 0;
  for (const row of rows) {
    const updated = await refreshPublication(
      ctx,
      row,
      'Reavaliacao periodica do periodo de acesso e da tolerancia.',
    );
    if (updated.publicationState !== row.publicationState) changed += 1;
  }
  return changed;
}

// ------------------------------------------------------- assinaturas

interface SubscriptionReconcileOutcome {
  updated: boolean;
  divergence: string | null;
}

export async function reconcileSubscription(
  ctx: BillingContext & { provider: BillingProvider },
  row: SubscriptionRow,
): Promise<SubscriptionReconcileOutcome> {
  if (!row.externalSubscriptionId) {
    // Contratacao iniciada e nunca paga: confere a sessao de checkout.
    return reconcilePendingCheckout(ctx, row);
  }

  const remote = await ctx.provider.getSubscription(row.externalSubscriptionId);
  const now = ctx.now();

  const providerStatus = remote.status;
  const mapped = billingStateFromProvider(providerStatus as ValidaPaySubscriptionStatus, {
    cancelAtPeriodEnd: remote.cancelAtPeriodEnd ?? false,
  });

  const patch: SubscriptionPatch = {
    providerStatus,
    lastSyncedAt: now,
  };

  // Suspensao administrativa nao e desfeita pela reconciliacao.
  if (row.status !== 'suspended') patch.status = mapped;

  if (remote.paymentType) {
    const method = paymentMethodFromType(remote.paymentType);
    if (method) patch.paymentMethod = method;
  }
  if (remote.customerId) patch.externalCustomerId = remote.customerId;
  if (remote.primaryItemId) patch.externalItemId = remote.primaryItemId;
  if (remote.priceId) patch.externalPriceId = remote.priceId;
  if (remote.checkoutId) patch.externalCheckoutId = remote.checkoutId;
  if (typeof remote.currentCycleNumber === 'number') {
    patch.currentCycleNumber = remote.currentCycleNumber;
  }
  if (remote.currentCycleAmount !== null && remote.currentCycleAmount !== undefined) {
    patch.currentCycleAmountCents = reaisToCents(remote.currentCycleAmount);
  }
  patch.cancelAtPeriodEnd = remote.cancelAtPeriodEnd ?? false;

  const nextCharge = remote.nextCycleChargeDate ? new Date(remote.nextCycleChargeDate) : null;
  if (nextCharge && !Number.isNaN(nextCharge.getTime())) patch.nextChargeAt = nextCharge;

  // O acesso avanca a partir do ultimo ciclo efetivamente pago, nunca do
  // estado otimista da assinatura.
  const paidAccess = accessFromPaidCycles(remote, row);
  if (paidAccess) patch.accessUntil = paidAccess;

  const divergedState = row.status !== 'suspended' && row.status !== mapped;
  const divergedAccess =
    paidAccess !== null &&
    (!row.accessUntil || Math.abs(paidAccess.getTime() - row.accessUntil.getTime()) > 60_000);

  const updated = await applySubscriptionPatch(ctx, row, patch, {
    action: divergedState || divergedAccess
      ? BILLING_ACTIONS.reconciliationDivergence
      : BILLING_ACTIONS.reconciled,
    reason: divergedState
      ? `Estado local era ${row.status}; a ValidaPay informa ${providerStatus}.`
      : 'Estado confirmado junto a ValidaPay.',
    metadata: {
      providerStatus,
      cancelAtPeriodEnd: remote.cancelAtPeriodEnd ?? false,
      previousAccessUntil: row.accessUntil?.toISOString() ?? null,
    },
    extendAccessOnly: true,
  });

  // Cobrancas dos ciclos conhecidos: fecha o que o webhook pode ter perdido.
  await reconcileCyclesFromSubscription(ctx, updated, remote);

  const changed =
    divergedState ||
    divergedAccess ||
    updated.publicationState !== row.publicationState ||
    updated.cancelAtPeriodEnd !== row.cancelAtPeriodEnd;

  return {
    updated: changed,
    divergence: divergedState
      ? `Estado corrigido de ${row.status} para ${updated.status}.`
      : divergedAccess
        ? 'Periodo de acesso corrigido a partir dos ciclos pagos.'
        : null,
  };
}

/**
 * Fim do acesso derivado dos ciclos pagos.
 *
 * Preferimos a proxima data de cobranca informada pelo provedor, que e quando o
 * proximo debito acontece. Sem ela, estimamos pelo intervalo a partir do
 * ultimo pagamento. Se nenhum ciclo foi pago, devolve `null`: nao ha acesso a
 * conceder.
 */
function accessFromPaidCycles(
  remote: Awaited<ReturnType<BillingProvider['getSubscription']>>,
  row: SubscriptionRow,
): Date | null {
  const cycles = remote.billingCycles ?? [];
  let lastPaidAt: Date | null = null;
  for (const entry of cycles) {
    const paidAt = entry.cycle?.paidAt ? new Date(entry.cycle.paidAt) : null;
    if (entry.cycle?.status === 'PAID' && paidAt && !Number.isNaN(paidAt.getTime())) {
      if (!lastPaidAt || paidAt.getTime() > lastPaidAt.getTime()) lastPaidAt = paidAt;
    }
  }

  if (!lastPaidAt) {
    // Sem historico de ciclos na resposta, aceitamos a proxima cobranca apenas
    // quando a assinatura ja esteve ativa (ou seja, algo foi pago antes).
    const everPaid = row.accessUntil !== null || row.status === 'active';
    const next = remote.nextCycleChargeDate ? new Date(remote.nextCycleChargeDate) : null;
    return everPaid && next && !Number.isNaN(next.getTime()) ? next : null;
  }

  const next = remote.nextCycleChargeDate ? new Date(remote.nextCycleChargeDate) : null;
  if (next && !Number.isNaN(next.getTime()) && next.getTime() > lastPaidAt.getTime()) return next;
  return estimatePeriodEnd(lastPaidAt, remote.interval ?? 'MONTHLY');
}

/** Grava as cobrancas dos ciclos devolvidos pela consulta da assinatura. */
async function reconcileCyclesFromSubscription(
  ctx: BillingContext,
  row: SubscriptionRow,
  remote: Awaited<ReturnType<BillingProvider['getSubscription']>>,
): Promise<void> {
  for (const entry of remote.billingCycles ?? []) {
    const chargeId = entry.cycle?.chargeId ?? entry.invoices?.[0]?.charge?.chargeId ?? null;
    if (!chargeId) continue;

    const cycleStatus = entry.cycle?.status ?? null;
    // Estados de ciclo que nao sao estados de cobranca ficam de fora: o que
    // interessa aqui e o dinheiro, nao a regua interna de cobranca.
    const chargeStatus = cycleStatusToChargeStatus(cycleStatus);
    if (!chargeStatus) continue;

    await upsertCharge(ctx, {
      tenantId: row.tenantId,
      subscriptionId: row.id,
      externalChargeId: chargeId,
      externalSubscriptionId: row.externalSubscriptionId,
      externalInvoiceId: entry.invoices?.[0]?.invoiceId ?? null,
      providerStatus: chargeStatus,
      amount: entry.cycle?.amount ?? entry.charge?.amount ?? null,
      paymentType: entry.cycle?.paymentMethod?.toUpperCase() ?? null,
      cycleNumber: entry.cycleNumber ?? entry.cycle?.cycleNumber ?? null,
      dueAt: entry.cycle?.chargeDate ? new Date(entry.cycle.chargeDate) : null,
      paidAt: entry.cycle?.paidAt ? new Date(entry.cycle.paidAt) : null,
      eventAt: ctx.now(),
      fromSync: true,
    });
  }
}

/**
 * Traduz o estado do ciclo para o estado da cobranca.
 *
 * `SCHEDULED`, `RETRY_SCHEDULED`, `DUNNING` e `SKIPPED` descrevem a regua de
 * cobranca, nao o dinheiro: nao viram estado de cobranca.
 */
function cycleStatusToChargeStatus(status: string | null | undefined): string | null {
  switch (status) {
    case 'PAID':
      return 'PAID';
    case 'PENDING':
      return 'PENDING';
    case 'AWAITING_PAYMENT':
      return 'AWAITING_PAYMENT';
    case 'PROCESSING':
      return 'PROCESSING';
    case 'FAILED':
      return 'FAILED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'CANCELED':
      return 'CANCELED';
    default:
      return null;
  }
}

/**
 * Contratacao iniciada sem assinatura vinculada.
 *
 * Confere a sessao de checkout: se foi paga, procura a assinatura criada pelo
 * documento da empresa. E o caminho de recuperacao quando o webhook
 * `subscription.created` nunca chegou.
 */
async function reconcilePendingCheckout(
  ctx: BillingContext & { provider: BillingProvider },
  row: SubscriptionRow,
): Promise<SubscriptionReconcileOutcome> {
  if (!row.checkoutSessionId) {
    await ctx.db
      .update(schema.subscriptions)
      .set({ lastSyncedAt: ctx.now(), updatedAt: ctx.now() })
      .where(eq(schema.subscriptions.id, row.id));
    return { updated: false, divergence: null };
  }

  const session = await ctx.provider.getCheckoutSession(row.checkoutSessionId);
  if (session.status !== 'completed') {
    await ctx.db
      .update(schema.subscriptions)
      .set({ lastSyncedAt: ctx.now(), updatedAt: ctx.now() })
      .where(eq(schema.subscriptions.id, row.id));
    return { updated: false, divergence: null };
  }

  const [tenant] = await ctx.db
    .select({ taxId: schema.tenants.taxId })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, row.tenantId));

  const candidates = tenant?.taxId
    ? await ctx.provider.findSubscriptionsByDocument(tenant.taxId)
    : [];
  // Só aceitamos o vinculo quando a assinatura aponta para a nossa sessao: o
  // documento sozinho nao prova de quem e a assinatura.
  const match = candidates.find((candidate) => candidate.checkoutId === row.checkoutSessionId);

  if (!match) {
    await recordBillingAudit(ctx.db, {
      tenantId: row.tenantId,
      subscriptionId: row.id,
      action: BILLING_ACTIONS.reconciliationDivergence,
      source: ctx.source,
      reason:
        'Sessao de checkout concluida, mas nenhuma assinatura correspondente foi encontrada na ValidaPay.',
      metadata: { checkoutSessionId: row.checkoutSessionId },
    });
    return {
      updated: false,
      divergence: 'Checkout pago sem assinatura localizada: verificar no painel da ValidaPay.',
    };
  }

  const updated = await applySubscriptionPatch(
    ctx,
    { ...row, externalSubscriptionId: match.subscriptionId },
    { externalSubscriptionId: match.subscriptionId, intentToken: null, lastSyncedAt: ctx.now() },
    {
      action: BILLING_ACTIONS.subscriptionBound,
      reason: 'Assinatura localizada pela reconciliacao da sessao de checkout.',
      metadata: { subscriptionId: match.subscriptionId },
    },
  );

  const outcome = await reconcileSubscription(ctx, updated);
  return { updated: true, divergence: outcome.divergence };
}

// --------------------------------------------------------- cobrancas

export async function reconcileCharge(
  ctx: BillingContext & { provider: BillingProvider },
  charge: ChargeRow,
): Promise<boolean> {
  const status = await ctx.provider.getChargeStatus(charge.externalChargeId);

  const result = await upsertCharge(ctx, {
    tenantId: charge.tenantId,
    subscriptionId: charge.subscriptionId,
    externalChargeId: charge.externalChargeId,
    providerStatus: status.status,
    amount: status.amount ?? null,
    paymentType: status.paymentType ?? null,
    paidAt: status.paidAt ? new Date(status.paidAt) : null,
    expiresAt: status.expiresAt ? new Date(status.expiresAt) : null,
    eventAt: ctx.now(),
    fromSync: true,
  });

  if (!result.applied || !result.becamePaid) {
    return result.applied && result.charge.status !== charge.status;
  }

  // Pagamento descoberto pela consulta: estende o acesso pelos mesmos
  // caminhos do webhook, sem creditar duas vezes (a transicao e unica).
  if (charge.subscriptionId) {
    const [subscription] = await ctx.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.id, charge.subscriptionId));
    if (subscription) {
      const paidAt = status.paidAt ? new Date(status.paidAt) : ctx.now();
      const updated = await applySubscriptionPatch(
        ctx,
        subscription,
        {
          status:
            subscription.status === 'suspended'
              ? subscription.status
              : subscription.cancelAtPeriodEnd
                ? 'cancel_at_period_end'
                : 'active',
          accessUntil: subscription.nextChargeAt ?? estimatePeriodEnd(paidAt, 'MONTHLY'),
          currentPeriodStart: paidAt,
          lastSyncedAt: ctx.now(),
          lastErrorMessage: '',
        },
        {
          action: BILLING_ACTIONS.paymentConfirmed,
          reason: `Pagamento da cobranca ${charge.externalChargeId} confirmado pela reconciliacao.`,
          metadata: { chargeId: charge.externalChargeId, source: 'reconciliation' },
          extendAccessOnly: true,
        },
      );
      // A reconciliacao corrige o estado; a proxima consulta da assinatura
      // confirma a data exata do proximo ciclo.
      void updated;
    }
  }

  return true;
}

// ---------------------------------------------------------- selecao

async function selectOpenCharges(
  db: Database,
  options: { tenantId?: string; force: boolean; now: Date; limit: number },
): Promise<ChargeRow[]> {
  const staleBefore = new Date(options.now.getTime() - OPEN_CHARGE_STALE_MS);
  const conditions = [
    inArray(schema.charges.status, ['pending', 'processing', 'awaiting_payment', 'dispute']),
  ];
  if (options.tenantId) conditions.push(eq(schema.charges.tenantId, options.tenantId));
  if (!options.force) {
    conditions.push(
      or(isNull(schema.charges.lastSyncedAt), lt(schema.charges.lastSyncedAt, staleBefore))!,
    );
  }

  return db
    .select()
    .from(schema.charges)
    .where(and(...conditions))
    .orderBy(asc(schema.charges.lastSyncedAt))
    .limit(options.limit);
}

async function selectSubscriptionsToSync(
  db: Database,
  options: { tenantId?: string; force: boolean; now: Date; limit: number },
): Promise<SubscriptionRow[]> {
  const staleBefore = new Date(options.now.getTime() - DEFAULT_STALE_MS);
  const conditions = [
    /**
     * Assinaturas terminadas (`canceled`, `expired`, `completed`) nao precisam
     * de consulta periodica. `suspended` continua na lista de proposito: a
     * suspensao e uma decisao nossa, e do lado da ValidaPay a assinatura segue
     * viva e cobrando -- o painel mestre precisa ver esse estado real.
     */
    inArray(schema.subscriptions.status, [
      'pending',
      'trialing',
      'active',
      'past_due',
      'cancel_at_period_end',
      'suspended',
    ]),
  ];
  if (options.tenantId) conditions.push(eq(schema.subscriptions.tenantId, options.tenantId));
  if (!options.force) {
    conditions.push(
      or(
        isNull(schema.subscriptions.lastSyncedAt),
        lt(schema.subscriptions.lastSyncedAt, staleBefore),
      )!,
    );
    // Sem vinculo externo e sem sessao de checkout nao ha o que consultar.
    conditions.push(
      or(
        isNotNull(schema.subscriptions.externalSubscriptionId),
        isNotNull(schema.subscriptions.checkoutSessionId),
      )!,
    );
  }

  return db
    .select()
    .from(schema.subscriptions)
    .where(and(...conditions))
    .orderBy(asc(schema.subscriptions.lastSyncedAt))
    .limit(options.limit);
}

function errorText(error: unknown): string {
  if (error instanceof AppError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}
