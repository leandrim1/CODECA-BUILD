import type { ValidaPayRecurrenceType } from '@codeca/shared';

/**
 * Leitura dos payloads de webhook.
 *
 * Os corpos vem de fora: cada campo e lido com verificacao de tipo, sem
 * `as` cego. Dois detalhes do contrato da ValidaPay ficam explicitos aqui,
 * porque sao a origem dos erros mais caros:
 *
 *  - em `charge.created` e `charge.expired`, o `status` da raiz e o status da
 *    **cobranca**;
 *  - em `payment.*` e `subscription.*`, o `status` da raiz e o status da
 *    **assinatura** -- o status da cobranca daquele ciclo esta em
 *    `currentCycle.status`.
 */

export type RawPayload = Record<string, unknown>;

export function asRecord(value: unknown): RawPayload | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawPayload)
    : null;
}

export function readString(source: RawPayload | null, key: string): string | null {
  if (!source) return null;
  const value = source[key];
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function readNumber(source: RawPayload | null, key: string): number | null {
  if (!source) return null;
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function readBoolean(source: RawPayload | null, key: string): boolean | null {
  if (!source) return null;
  const value = source[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

/** Converte texto ISO em data, devolvendo `null` para valor invalido. */
export function readDate(source: RawPayload | null, key: string): Date | null {
  const text = readString(source, key);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function readRecord(source: RawPayload | null, key: string): RawPayload | null {
  if (!source) return null;
  return asRecord(source[key]);
}

export function readArray(source: RawPayload | null, key: string): unknown[] {
  if (!source) return [];
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

/** Metadados enviados por nos na sessao de checkout e devolvidos nos eventos. */
export interface EventMetadata {
  tenantId: string | null;
  intentToken: string | null;
  planId: string | null;
}

export function readMetadata(payload: RawPayload): EventMetadata {
  const metadata = readRecord(payload, 'metadata');
  return {
    tenantId: readString(metadata, 'tenantId'),
    intentToken: readString(metadata, 'intentToken'),
    planId: readString(metadata, 'planId'),
  };
}

/** Numero da conta ValidaPay: a chave muda conforme o evento. */
export function readAccount(payload: RawPayload): string | null {
  return readString(payload, 'accountNumber') ?? readString(payload, 'accountId');
}

export interface SubscriptionEventBase {
  subscriptionId: string | null;
  customerId: string | null;
  /** Status da ASSINATURA (eventos `subscription.*` e `payment.*`). */
  subscriptionStatus: string | null;
  interval: string | null;
  currentCycleNumber: number | null;
  nextChargeDate: Date | null;
  startDate: Date | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  email: string | null;
  taxId: string | null;
  metadata: EventMetadata;
  /** Ciclo corrente, quando presente. */
  cycle: {
    cycleNumber: number | null;
    amount: number | null;
    /** Status do CICLO/cobranca, nao da assinatura. */
    status: string | null;
    chargeDate: Date | null;
    paidAt: Date | null;
    paymentMethod: string | null;
  } | null;
  /** Primeiro item recorrente da assinatura. */
  item: {
    itemId: string | null;
    priceId: string | null;
    productId: string | null;
    amount: number | null;
  } | null;
  chargeId: string | null;
  invoiceId: string | null;
  paymentType: string | null;
  /** Bloco de retentativa dos eventos `payment.failed` e `payment.retry`. */
  retry: {
    attempt: number | null;
    status: string | null;
    failureReason: string | null;
    failureCode: string | null;
    nextAttemptAt: Date | null;
  } | null;
}

export function readSubscriptionBase(payload: RawPayload): SubscriptionEventBase {
  const cycleRecord = readRecord(payload, 'currentCycle');
  const items = readArray(payload, 'items');
  const firstRecurring =
    items.map(asRecord).find((item) => readString(item, 'type') !== 'ONE_TIME') ??
    asRecord(items[0] ?? null);
  const price = readRecord(firstRecurring, 'price');
  const product = readRecord(firstRecurring, 'product');
  const retryRecord = readRecord(payload, 'retry');

  return {
    subscriptionId: readString(payload, 'subscriptionId'),
    customerId: readString(payload, 'customerId'),
    subscriptionStatus: readString(payload, 'status'),
    interval: readString(payload, 'interval'),
    currentCycleNumber: readNumber(payload, 'currentCycleNumber'),
    nextChargeDate: readDate(payload, 'nextChargeDate') ?? readDate(payload, 'nextCycleChargeDate'),
    startDate: readDate(payload, 'startDate'),
    canceledAt: readDate(payload, 'canceledAt'),
    cancelReason: readString(payload, 'cancelReason'),
    email: readString(payload, 'email'),
    taxId: readString(payload, 'taxId'),
    metadata: readMetadata(payload),
    cycle: cycleRecord
      ? {
          cycleNumber: readNumber(cycleRecord, 'cycleNumber'),
          amount: readNumber(cycleRecord, 'amount'),
          status: readString(cycleRecord, 'status'),
          chargeDate: readDate(cycleRecord, 'chargeDate'),
          paidAt: readDate(cycleRecord, 'paidAt'),
          paymentMethod: readString(cycleRecord, 'paymentMethod'),
        }
      : null,
    item: firstRecurring
      ? {
          itemId: readString(firstRecurring, 'itemId'),
          priceId: readString(price, 'priceId') ?? readString(firstRecurring, 'priceId'),
          productId: readString(product, 'productId') ?? readString(firstRecurring, 'productId'),
          amount: readNumber(firstRecurring, 'amount'),
        }
      : null,
    chargeId: readString(payload, 'chargeId'),
    invoiceId: readString(payload, 'invoiceId'),
    paymentType: readString(payload, 'paymentType'),
    retry: retryRecord
      ? {
          attempt: readNumber(retryRecord, 'attempt') ?? readNumber(retryRecord, 'attemptNumber'),
          status: readString(retryRecord, 'status'),
          failureReason: readString(retryRecord, 'failureReason'),
          failureCode: readString(retryRecord, 'failureCode'),
          nextAttemptAt: readDate(retryRecord, 'nextAttemptAt') ?? readDate(retryRecord, 'nextRetryAt'),
        }
      : null,
  };
}

/** Duracao de um ciclo, usada so quando o provedor nao informa a proxima data. */
const INTERVAL_DAYS: Partial<Record<ValidaPayRecurrenceType, number>> = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 30,
  QUARTERLY: 90,
  SEMIANNUAL: 182,
  YEARLY: 365,
};

/**
 * Estima o fim do periodo pago.
 *
 * Usada apenas como ultimo recurso: a data preferida e sempre a
 * `nextChargeDate` informada pela ValidaPay, porque e ela que decide quando o
 * proximo debito acontece.
 */
export function estimatePeriodEnd(from: Date, interval: string | null): Date {
  const days = INTERVAL_DAYS[(interval ?? 'MONTHLY') as ValidaPayRecurrenceType] ?? 30;
  return new Date(from.getTime() + days * 24 * 3600 * 1000);
}
