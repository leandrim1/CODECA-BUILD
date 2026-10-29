import { schema, type Database } from '@codeca/database';

/**
 * Historico das decisoes de cobranca.
 *
 * Registra o estado anterior e o novo, a origem da mudanca (checkout, webhook,
 * reconciliacao, acao administrativa) e o motivo. Uma acao administrativa fica
 * gravada como tal: ela nao reescreve o que a ValidaPay confirmou.
 */

export const BILLING_ACTIONS = {
  planSynced: 'billing.plan_synced',
  checkoutStarted: 'billing.checkout_started',
  checkoutReplaced: 'billing.checkout_replaced',
  subscriptionBound: 'billing.subscription_bound',
  subscriptionStateChanged: 'billing.subscription_state_changed',
  publicationChanged: 'billing.publication_changed',
  chargeRecorded: 'billing.charge_recorded',
  chargeStateChanged: 'billing.charge_state_changed',
  chargeStaleEventIgnored: 'billing.charge_stale_event_ignored',
  paymentConfirmed: 'billing.payment_confirmed',
  paymentFailed: 'billing.payment_failed',
  paymentOverdue: 'billing.payment_overdue',
  refundOpened: 'billing.refund_opened',
  refundConfirmed: 'billing.refund_confirmed',
  cancelRequested: 'billing.cancel_requested',
  cancelScheduled: 'billing.cancel_scheduled',
  cancelUndone: 'billing.cancel_undone',
  canceled: 'billing.canceled',
  expired: 'billing.expired',
  planChangeRequested: 'billing.plan_change_requested',
  planChanged: 'billing.plan_changed',
  downgradeScheduled: 'billing.downgrade_scheduled',
  reconciled: 'billing.reconciled',
  reconciliationDivergence: 'billing.reconciliation_divergence',
  adminHoldApplied: 'billing.admin_hold_applied',
  adminHoldReleased: 'billing.admin_hold_released',
  gracePeriodChanged: 'billing.grace_period_changed',
  webhookReplayed: 'billing.webhook_replayed',
  webhookUnresolved: 'billing.webhook_unresolved',
} as const;

export type BillingAction = (typeof BILLING_ACTIONS)[keyof typeof BILLING_ACTIONS];
export type BillingAuditSource = 'checkout' | 'webhook' | 'reconciliation' | 'admin' | 'system';

export interface BillingAuditEntry {
  tenantId?: string | null;
  subscriptionId?: string | null;
  chargeId?: string | null;
  action: BillingAction | string;
  source: BillingAuditSource;
  actorUserId?: string | null;
  webhookEventId?: string | null;
  previousState?: string;
  newState?: string;
  previousPublication?: string;
  newPublication?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Grava uma linha de auditoria de cobranca.
 *
 * Os metadados sao de uso interno e nunca recebem dados de pagamento: nada de
 * numero de cartao, token, segredo ou corpo completo de requisicao.
 */
export async function recordBillingAudit(db: Database, entry: BillingAuditEntry): Promise<void> {
  await db.insert(schema.billingAuditLogs).values({
    tenantId: entry.tenantId ?? null,
    subscriptionId: entry.subscriptionId ?? null,
    chargeId: entry.chargeId ?? null,
    action: entry.action,
    source: entry.source,
    actorUserId: entry.actorUserId ?? null,
    webhookEventId: entry.webhookEventId ?? null,
    previousState: entry.previousState ?? '',
    newState: entry.newState ?? '',
    previousPublication: entry.previousPublication ?? '',
    newPublication: entry.newPublication ?? '',
    reason: entry.reason ?? '',
    metadata: entry.metadata ?? {},
  });
}
