import { eq, schema } from '@codeca/database';
import { signWebhookBody } from '@codeca/api';
import { expect } from 'vitest';
import { TEST_WEBHOOK_SECRET, type RegisteredAccount, type TestApi } from './api.js';

/**
 * Apoio aos testes de cobranca.
 *
 * Monta e assina corpos de webhook exatamente como a ValidaPay faria:
 * `X-Webhook-Signature: t=<ms>,v1=<hmac de "<t>.<corpo bruto>">`, com o corpo
 * enviado byte a byte -- e o que garante que o teste exercita a verificacao
 * real, e nao uma versao simplificada dela.
 */

export interface WebhookOptions {
  /** Identificador do evento; o mesmo valor em reentregas. */
  eventId?: string;
  /** Instante da assinatura, em ms. Padrao: agora. */
  signedAtMs?: number;
  /** Numero da tentativa de entrega. */
  attempt?: number;
  /** Assinatura deliberadamente invalida, para o teste de recusa. */
  corruptSignature?: boolean;
  /** Omite o cabecalho de assinatura. */
  omitSignature?: boolean;
  /** Segredo usado para assinar; padrao, o do ambiente de teste. */
  secret?: string;
}

export interface WebhookResponse {
  status: number;
  body: { data?: Record<string, unknown>; error?: { code?: string; message?: string } };
}

/** Envia um webhook assinado para a API, como a ValidaPay faria. */
export async function sendWebhook(
  api: TestApi,
  event: string,
  payload: Record<string, unknown>,
  options: WebhookOptions = {},
): Promise<WebhookResponse> {
  // O corpo e serializado uma unica vez: a assinatura e a requisicao usam
  // exatamente os mesmos bytes.
  const rawBody = JSON.stringify({ event, ...payload });
  const signedAt = options.signedAtMs ?? Date.now();
  const signature = signWebhookBody(signedAt, rawBody, options.secret ?? TEST_WEBHOOK_SECRET);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-webhook-event': event,
    'x-webhook-id': options.eventId ?? `evt_${Math.random().toString(36).slice(2, 12)}`,
    'x-webhook-attempt': String(options.attempt ?? 1),
  };
  if (!options.omitSignature) {
    headers['x-webhook-signature'] = options.corruptSignature
      ? `t=${signedAt},v1=${'0'.repeat(signature.length)}`
      : `t=${signedAt},v1=${signature}`;
  }

  const response = await api.app.request('http://app.localhost:5173/api/webhooks/validapay', {
    method: 'POST',
    headers,
    body: rawBody,
  });

  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as WebhookResponse['body']) : {},
  };
}

/** Preco em reais, como a ValidaPay envia (nunca centavos). */
export function reais(cents: number): number {
  return cents / 100;
}

export interface SubscriptionPayloadOptions {
  subscriptionId: string;
  status: string;
  amountCents: number;
  priceId?: string | null;
  itemId?: string;
  customerId?: string;
  cycleNumber?: number;
  cycleStatus?: string;
  paidAt?: Date | null;
  chargeDate?: Date | null;
  nextChargeDate?: Date | null;
  chargeId?: string | null;
  invoiceId?: string | null;
  paymentMethod?: string;
  paymentType?: string;
  canceledAt?: Date | null;
  cancelReason?: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
  retry?: { attempt: number; status: string; failureReason: string };
}

/**
 * Monta o corpo de um evento de assinatura no formato documentado.
 *
 * Atencao ao detalhe que mais engana: aqui `status` e o status da ASSINATURA, e
 * `currentCycle.status` e o status do ciclo (a cobranca).
 */
export function subscriptionPayload(
  options: SubscriptionPayloadOptions,
): Record<string, unknown> {
  const itemId = options.itemId ?? 'item_teste_1';
  const priceId = options.priceId ?? null;

  return {
    timestamp: (options.timestamp ?? new Date()).toISOString(),
    accountNumber: '4231833',
    subscriptionId: options.subscriptionId,
    customerId: options.customerId ?? 'cus_teste_1',
    status: options.status,
    email: 'contato@construtorahorizonte.com.br',
    taxId: '12345678000199',
    interval: 'MONTHLY',
    currentCycleNumber: options.cycleNumber ?? 1,
    nextChargeDate: options.nextChargeDate ? options.nextChargeDate.toISOString() : null,
    metadata: options.metadata ?? {},
    startDate: new Date('2026-01-01T12:00:00.000Z').toISOString(),
    canceledAt: options.canceledAt ? options.canceledAt.toISOString() : null,
    ...(options.cancelReason ? { cancelReason: options.cancelReason } : {}),
    ...(options.paymentType ? { paymentType: options.paymentType } : {}),
    ...(options.chargeId ? { chargeId: options.chargeId } : {}),
    ...(options.invoiceId ? { invoiceId: options.invoiceId } : {}),
    ...(options.retry ? { retry: options.retry } : {}),
    items: [
      {
        itemId,
        name: 'Plano Essencial',
        description: null,
        type: 'RECURRING',
        amount: reais(options.amountCents),
        quantity: 1,
        discount: 0,
        status: 'ACTIVE',
        price: {
          ...(priceId ? { priceId } : {}),
          amount: reais(options.amountCents),
          title: 'Mensal',
          recurrenceType: 'MONTHLY',
          trialDays: null,
        },
        product: { productId: 'prod_teste_1', name: 'Codeca Build', type: 'RECURRING' },
      },
    ],
    currentCycle: {
      cycleNumber: options.cycleNumber ?? 1,
      amount: reais(options.amountCents),
      status: options.cycleStatus ?? 'PAID',
      chargeDate: (options.chargeDate ?? new Date()).toISOString(),
      paidAt: options.paidAt === null ? null : (options.paidAt ?? new Date()).toISOString(),
      paymentMethod: options.paymentMethod ?? 'creditcard',
    },
    customer: {
      customerId: options.customerId ?? 'cus_teste_1',
      name: 'Construtora Horizonte',
      email: 'contato@construtorahorizonte.com.br',
      taxId: '12345678000199',
      phone: '19999990000',
    },
  };
}

/** Define o plano da empresa diretamente, para preparar um cenario. */
export async function usePlanCode(
  api: TestApi,
  tenantId: string,
  code: 'trial' | 'essencial' | 'profissional',
): Promise<{ id: string; priceCents: number }> {
  const [plan] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, code));
  if (!plan) throw new Error(`Plano ${code} nao existe no seed.`);
  await api.db
    .update(schema.tenants)
    .set({ planId: plan.id })
    .where(eq(schema.tenants.id, tenantId));
  await api.db
    .update(schema.subscriptions)
    .set({ planId: plan.id })
    .where(eq(schema.subscriptions.tenantId, tenantId));
  return { id: plan.id, priceCents: plan.priceCents };
}

/** Garante que o plano tem produto e preco na ValidaPay, como apos sincronizar. */
export async function syncPlanCode(
  api: TestApi,
  code: 'essencial' | 'profissional',
  priceId = `price_${code}_teste`,
): Promise<{ id: string; priceId: string; priceCents: number }> {
  const [plan] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, code));
  if (!plan) throw new Error(`Plano ${code} nao existe no seed.`);
  await api.db
    .update(schema.plans)
    .set({
      externalProductId: `prod_${code}_teste`,
      externalPriceId: priceId,
      externalSyncedAt: new Date(),
      externalSyncError: '',
    })
    .where(eq(schema.plans.id, plan.id));
  return { id: plan.id, priceId, priceCents: plan.priceCents };
}

export async function loadSubscriptionRow(api: TestApi, tenantId: string) {
  const [row] = await api.db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, tenantId));
  if (!row) throw new Error('Assinatura nao encontrada.');
  return row;
}

export async function loadChargeRows(api: TestApi, tenantId: string) {
  return api.db.select().from(schema.charges).where(eq(schema.charges.tenantId, tenantId));
}

export async function loadEventRows(api: TestApi) {
  return api.db.select().from(schema.webhookEvents);
}

/**
 * Contrata um plano e devolve a sessao criada.
 *
 * O fluxo e o real: a rota cria a sessao de checkout e devolve a URL; nenhuma
 * assinatura existe ainda, porque na ValidaPay ela nasce do pagamento.
 */
export async function startCheckout(
  account: RegisteredAccount,
  planId: string,
  paymentMethod: 'creditcard' | 'pix_automatico' | 'pix' | 'boleto' = 'creditcard',
) {
  const response = await account.client.post(
    `/api/tenants/${account.tenantId}/billing/checkout`,
    { planId, paymentMethod },
  );
  expect(response.status, response.errorMessage ?? '').toBe(200);
  return response.body as {
    checkoutUrl: string;
    checkoutSessionId: string;
    reused: boolean;
    notice: string | null;
  };
}

/**
 * Encerra a avaliacao da empresa, como se os 14 dias tivessem passado.
 *
 * Necessario nos cenarios de inadimplencia: enquanto a avaliacao vale, o
 * acesso esta garantido por ela, e nenhum atraso de pagamento suspende o site
 * -- o que e o comportamento correto, mas mascara o que esses testes querem
 * verificar.
 */
export async function expireTrial(api: TestApi, tenantId: string): Promise<void> {
  const past = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  await api.db
    .update(schema.subscriptions)
    .set({ trialEndsAt: past, accessUntil: past, currentPeriodEnd: past })
    .where(eq(schema.subscriptions.tenantId, tenantId));
}
