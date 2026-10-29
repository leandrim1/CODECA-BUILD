import { AppError, centsToReais } from '@codeca/shared';
import type { BillingProvider, SyncPlanInput, SyncPlanResult } from './provider.js';
import type {
  CancelSubscriptionResponse,
  ChangeItemResponse,
  ChargeResponse,
  ChargeStatusResponse,
  CheckoutSessionResponse,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResponse,
  ProrataPreviewResponse,
  SubscriptionResponse,
} from './types.js';

/**
 * Provedor de cobranca em memoria, para os testes.
 *
 * Reproduz o fluxo real da ValidaPay: o checkout cria uma sessao, e a
 * assinatura so passa a existir quando um pagamento e confirmado -- nao ha
 * criacao direta de assinatura, como tambem nao ha na API de verdade. Nenhuma
 * cobranca real acontece aqui.
 */
export interface MemoryBillingProvider extends BillingProvider {
  /** Sessoes criadas, por id. */
  sessions: Map<
    string,
    CreateCheckoutSessionResponse & {
      input: CreateCheckoutSessionInput;
      status: 'active' | 'completed' | 'expired';
    }
  >;
  subscriptions: Map<string, SubscriptionResponse>;
  charges: Map<string, ChargeResponse>;
  /** Chamadas registradas, para conferir idempotencia nos testes. */
  calls: string[];
  /** Falha programada na proxima chamada do metodo informado. */
  failNext: (method: string, error: unknown) => void;
  /** Simula o pagamento de uma sessao: cria assinatura e cobranca paga. */
  simulatePaidSession: (sessionId: string, options?: SimulatePaymentOptions) => {
    subscription: SubscriptionResponse;
    charge: ChargeResponse;
  };
}

export interface SimulatePaymentOptions {
  paymentType?: 'CREDIT_CARD' | 'PIX' | 'BOLETO' | 'PIX_AUTOMATICO';
  paidAt?: Date;
  nextChargeDate?: Date;
  cycleNumber?: number;
}

export function createMemoryBillingProvider(
  options: { now?: () => Date } = {},
): MemoryBillingProvider {
  const now = options.now ?? (() => new Date());
  const sessions = new Map<
    string,
    CreateCheckoutSessionResponse & {
      input: CreateCheckoutSessionInput;
      status: 'active' | 'completed' | 'expired';
    }
  >();
  const subscriptions = new Map<string, SubscriptionResponse>();
  const charges = new Map<string, ChargeResponse>();
  const calls: string[] = [];
  const failures = new Map<string, unknown>();
  let counter = 0;

  const nextId = (prefix: string) => {
    counter += 1;
    return `${prefix}${Date.now()}_${String(counter).padStart(4, '0')}`;
  };

  const track = (method: string) => {
    calls.push(method);
    const failure = failures.get(method);
    if (failure !== undefined) {
      failures.delete(method);
      throw failure;
    }
  };

  const provider: MemoryBillingProvider = {
    configured: true,
    environment: 'sandbox',
    sessions,
    subscriptions,
    charges,
    calls,

    failNext(method, error) {
      failures.set(method, error);
    },

    async syncPlan(input: SyncPlanInput): Promise<SyncPlanResult> {
      track('syncPlan');
      if (input.priceCents <= 0) {
        throw AppError.badRequest('A ValidaPay exige preco maior que zero.');
      }
      const productId = nextId('prod_');
      const priceId = nextId('price_');
      return { productId, priceId, checkoutUrl: `https://checkout.test/${priceId}` };
    },

    async createCheckoutSession(input) {
      track('createCheckoutSession');
      const id = nextId('cs_');
      const session = {
        id,
        url: `https://checkout.test/${id}`,
        priceId: input.priceId,
        input,
        status: 'active' as const,
      };
      sessions.set(id, session);
      return { id: session.id, url: session.url, priceId: session.priceId };
    },

    async getCheckoutSession(sessionId) {
      track('getCheckoutSession');
      const session = sessions.get(sessionId);
      if (!session) throw AppError.notFound('Sessao nao encontrada.');
      const response: CheckoutSessionResponse = {
        id: session.id,
        status: session.status,
        metadata: (session.input.metadata as Record<string, unknown> | undefined) ?? null,
        items: [{ priceId: session.priceId }],
      };
      return response;
    },

    async getSubscription(subscriptionId) {
      track('getSubscription');
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) throw AppError.notFound('Assinatura nao encontrada.');
      return subscription;
    },

    async findSubscriptionsByDocument(document) {
      track('findSubscriptionsByDocument');
      const digits = document.replace(/\D+/g, '');
      return [...subscriptions.values()].filter(
        (subscription) => (subscription as { document?: string }).document === digits,
      );
    },

    async cancelSubscription(subscriptionId, reason) {
      track('cancelSubscription');
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) throw AppError.notFound('Assinatura nao encontrada.');
      if (subscription.status === 'CANCELED') {
        throw AppError.conflict('Esta assinatura ja esta cancelada.');
      }

      // Com periodo pago pela frente, a ValidaPay agenda; sem ele, cancela agora.
      const periodEnd = subscription.nextCycleChargeDate
        ? new Date(subscription.nextCycleChargeDate)
        : null;
      const immediate = !periodEnd || periodEnd.getTime() <= now().getTime();

      if (immediate) {
        subscription.status = 'CANCELED';
        subscription.cancelAtPeriodEnd = false;
      } else {
        subscription.cancelAtPeriodEnd = true;
      }

      const response: CancelSubscriptionResponse = {
        success: true,
        subscriptionId,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
        immediate,
        effectiveAt: immediate ? null : (periodEnd?.toISOString() ?? null),
        reason,
      };
      return response;
    },

    async undoScheduledCancellation(subscriptionId) {
      track('undoScheduledCancellation');
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) throw AppError.notFound('Assinatura nao encontrada.');
      subscription.cancelAtPeriodEnd = false;
    },

    async previewPlanChange({ subscriptionId, priceId }) {
      track('previewPlanChange');
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) throw AppError.notFound('Assinatura nao encontrada.');
      const preview: ProrataPreviewResponse = {
        mode: 'PRORATA_NOW',
        amount: 0,
        credit: null,
        effectiveCycleNumber: (subscription.currentCycleNumber ?? 1) + 1,
        warnings: [],
      };
      void priceId;
      return preview;
    },

    async changePlan({ subscriptionId, itemId, priceId }) {
      track('changePlan');
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) throw AppError.notFound('Assinatura nao encontrada.');
      subscription.priceId = priceId;
      if (subscription.items?.[0]) subscription.items[0].priceId = priceId;
      const response: ChangeItemResponse = {
        subscriptionId,
        itemId,
        status: 'ACTIVE',
        chargeId: null,
        mode: 'PRORATA_NOW',
      };
      return response;
    },

    async getChargeStatus(chargeId) {
      track('getChargeStatus');
      const charge = charges.get(chargeId);
      if (!charge) throw AppError.notFound('Cobranca nao encontrada.');
      return {
        chargeId: charge.chargeId,
        status: charge.status,
        amount: charge.amount,
        paymentType: charge.paymentType ?? null,
        paidAt: charge.paidAt ?? null,
        createdAt: charge.createdAt ?? null,
        expiresAt: charge.expiresAt ?? null,
      } satisfies ChargeStatusResponse;
    },

    async getCharge(chargeId) {
      track('getCharge');
      const charge = charges.get(chargeId);
      if (!charge) throw AppError.notFound('Cobranca nao encontrada.');
      return charge;
    },

    simulatePaidSession(sessionId, simulation = {}) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`Sessao ${sessionId} nao existe no provedor de teste.`);

      const paidAt = simulation.paidAt ?? now();
      const nextChargeDate =
        simulation.nextChargeDate ?? new Date(paidAt.getTime() + 30 * 24 * 3600 * 1000);
      const amountCents = (session.input.metadata?.amountCents as number | undefined) ?? 0;
      const metadata = (session.input.metadata as Record<string, unknown> | undefined) ?? {};

      const subscriptionId = nextId('sub_');
      const itemId = nextId('item_');
      const chargeId = nextId('cha_');
      const document = (session.input.customer?.documentNumber ?? '').replace(/\D+/g, '');

      // A sessao e de uso unico: depois do pagamento, aparece como concluida.
      session.status = 'completed';

      const subscription: SubscriptionResponse = {
        subscriptionId,
        customerId: nextId('cus_'),
        status: 'ACTIVE',
        interval: 'MONTHLY',
        paymentType: simulation.paymentType ?? 'CREDIT_CARD',
        priceId: session.priceId ?? null,
        checkoutId: session.id,
        currentCycleNumber: simulation.cycleNumber ?? 1,
        currentCycleAmount: centsToReais(amountCents),
        nextCycleAmount: centsToReais(amountCents),
        nextCycleChargeDate: nextChargeDate.toISOString(),
        cancelAtPeriodEnd: false,
        primaryItemId: itemId,
        createdAt: paidAt.toISOString(),
        billingCycles: [
          {
            cycleNumber: simulation.cycleNumber ?? 1,
            cycle: {
              cycleNumber: simulation.cycleNumber ?? 1,
              amount: centsToReais(amountCents),
              status: 'PAID',
              chargeId,
              chargeDate: paidAt.toISOString(),
              paidAt: paidAt.toISOString(),
              paymentMethod: 'creditcard',
            },
          },
        ],
        items: [
          {
            itemId,
            amount: centsToReais(amountCents),
            quantity: 1,
            type: 'RECURRING',
            status: 'ACTIVE',
            ...(session.priceId ? { priceId: session.priceId } : {}),
          },
        ],
      };
      // `document` e usado por findSubscriptionsByDocument na reconciliacao.
      Object.assign(subscription, { metadata, document, taxId: document });
      subscriptions.set(subscriptionId, subscription);

      const charge: ChargeResponse = {
        chargeId,
        status: 'PAID',
        amount: centsToReais(amountCents),
        paymentType: simulation.paymentType ?? 'CREDIT_CARD',
        paidAt: paidAt.toISOString(),
        createdAt: paidAt.toISOString(),
        expiresAt: null,
        subscriptionId,
        saleType: 'RECURRING',
      };
      charges.set(chargeId, charge);

      return { subscription, charge };
    },
  };

  return provider;
}
