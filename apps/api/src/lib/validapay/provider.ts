import { AppError, centsToReais, type PaymentMethodCode } from '@codeca/shared';
import type { Env } from '../../env.js';
import { ValidaPayClient, resolveAuthUrl, VALIDAPAY_HOSTS } from './client.js';
import type {
  CancelSubscriptionResponse,
  ChangeDueDateResponse,
  ChangeItemResponse,
  ChangePaymentMethodResponse,
  ChargeResponse,
  ChargeStatusResponse,
  CheckoutSessionResponse,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResponse,
  CreateProductResponse,
  ProrataPreviewResponse,
  SubscriptionResponse,
} from './types.js';

/**
 * Operacoes de cobranca que a plataforma usa.
 *
 * A interface existe para que as rotas nao conhecam a ValidaPay: nos testes
 * entra uma implementacao controlada, e sem credenciais entra a implementacao
 * que recusa explicitamente, em vez de simular sucesso.
 */
export interface BillingProvider {
  readonly configured: boolean;
  /** Ambiente em uso, apenas para exibir no painel mestre. */
  readonly environment: 'production' | 'sandbox' | 'custom';

  /** Cria produto e preco recorrente de um plano. */
  syncPlan: (input: SyncPlanInput) => Promise<SyncPlanResult>;

  /** Sessao de checkout hospedada para a contratacao. */
  createCheckoutSession: (
    input: CreateCheckoutSessionInput,
  ) => Promise<CreateCheckoutSessionResponse>;
  getCheckoutSession: (sessionId: string) => Promise<CheckoutSessionResponse>;

  getSubscription: (subscriptionId: string) => Promise<SubscriptionResponse>;
  /** Busca assinaturas por documento do cliente, para reconciliacao. */
  findSubscriptionsByDocument: (document: string) => Promise<SubscriptionResponse[]>;
  cancelSubscription: (
    subscriptionId: string,
    reason: string,
  ) => Promise<CancelSubscriptionResponse>;
  undoScheduledCancellation: (subscriptionId: string) => Promise<void>;

  previewPlanChange: (input: PlanChangeInput) => Promise<ProrataPreviewResponse>;
  changePlan: (input: PlanChangeInput) => Promise<ChangeItemResponse>;

  /**
   * Troca a forma de pagamento para uma que **nao** exige dados de cartao.
   *
   * Trocar PARA cartao exigiria um `cardToken` gerado no navegador pelo SDK da
   * ValidaPay, o que traria a coleta de cartao para dentro do painel. Hoje o
   * cartao so e informado na pagina hospedada, e esta interface nao abre essa
   * porta: o tipo `ManualPaymentMethod` nao tem `creditcard`.
   */
  changePaymentMethod: (input: ChangePaymentMethodInput) => Promise<ChangePaymentMethodResponse>;
  /** Muda o dia de vencimento. Com `dryRun`, so simula e nada e alterado. */
  changeDueDay: (input: ChangeDueDayInput) => Promise<ChangeDueDateResponse>;

  getChargeStatus: (chargeId: string) => Promise<ChargeStatusResponse>;
  getCharge: (chargeId: string) => Promise<ChargeResponse>;
}

export interface SyncPlanInput {
  name: string;
  description: string;
  /** Preco em centavos; convertido para reais na fronteira da API. */
  priceCents: number;
  recurrenceType: string;
  recurrenceInterval: number;
  trialDays: number | null;
  /** Texto exibido na fatura do cartao, no maximo 22 caracteres. */
  statementDescriptor: string;
  metadata: Record<string, unknown>;
}

export interface SyncPlanResult {
  productId: string;
  priceId: string;
  checkoutUrl: string | null;
}

/** Formas que a empresa pode escolher sem informar cartao: as de pagamento manual. */
export type ManualPaymentMethod = 'pix' | 'boleto';

export interface ChangePaymentMethodInput {
  subscriptionId: string;
  paymentMethod: ManualPaymentMethod;
}

export interface ChangeDueDayInput {
  subscriptionId: string;
  billingDay: number;
  /** Cobra ou desconta a diferenca de dias na proxima cobranca. */
  prorata: boolean;
  dryRun: boolean;
  reason: string;
}

export interface PlanChangeInput {
  subscriptionId: string;
  itemId: string;
  priceId: string;
}

// ------------------------------------------------------------- real

export function createValidaPayProvider(env: Env): BillingProvider {
  const baseUrl = (env.VALIDAPAY_BASE_URL ?? VALIDAPAY_HOSTS.production.api).replace(/\/$/, '');
  const client = new ValidaPayClient({
    clientId: env.VALIDAPAY_CLIENT_ID ?? '',
    clientSecret: env.VALIDAPAY_CLIENT_SECRET ?? '',
    baseUrl,
    authUrl: resolveAuthUrl(env),
  });

  const environment: BillingProvider['environment'] =
    baseUrl === VALIDAPAY_HOSTS.sandbox.api
      ? 'sandbox'
      : baseUrl === VALIDAPAY_HOSTS.production.api
        ? 'production'
        : 'custom';

  return {
    configured: true,
    environment,

    async syncPlan(input) {
      if (input.priceCents <= 0) {
        throw AppError.badRequest(
          'A ValidaPay exige preço maior que zero: um plano gratuito não pode ser sincronizado.',
        );
      }

      const response = await client.request<CreateProductResponse>({
        method: 'POST',
        path: '/v1/products',
        scope: 'products/write',
        body: {
          name: input.name,
          description: input.description || undefined,
          type: 'RECURRING',
          statementDescriptor: input.statementDescriptor.slice(0, 22) || undefined,
          isActive: true,
          metadata: input.metadata,
          prices: [
            {
              title: planPriceTitle(input.recurrenceType),
              amount: centsToReais(input.priceCents),
              currency: 'BRL',
              recurrenceType: input.recurrenceType,
              recurrenceInterval: input.recurrenceInterval,
              ...(input.trialDays && input.trialDays > 0 ? { trialDays: input.trialDays } : {}),
            },
          ],
        },
      });

      const price = response.prices?.[0];
      if (!response.productId || !price?.priceId) {
        throw new AppError(
          'upstream_error',
          'A ValidaPay não devolveu o produto e o preço criados.',
        );
      }
      return {
        productId: response.productId,
        priceId: price.priceId,
        checkoutUrl: price.checkoutUrl ?? null,
      };
    },

    createCheckoutSession: (input) =>
      client.request<CreateCheckoutSessionResponse>({
        method: 'POST',
        path: '/v1/checkout-sessions',
        scope: 'checkouts/write',
        body: input,
        // Criar sessao duas vezes geraria duas contratacoes: sem retentativa.
        attempts: 1,
      }),

    getCheckoutSession: (sessionId) =>
      client.request<CheckoutSessionResponse>({
        method: 'GET',
        path: `/v1/checkout-sessions/${encodeURIComponent(sessionId)}`,
        scope: 'checkouts/read',
      }),

    getSubscription: (subscriptionId) =>
      client.request<SubscriptionResponse>({
        method: 'GET',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
        scope: 'subscriptions/read',
      }),

    async findSubscriptionsByDocument(document) {
      const digits = document.replace(/\D+/g, '');
      if (!digits) return [];
      const response = await client.request<{ items?: SubscriptionResponse[] }>({
        method: 'GET',
        path: '/v1/subscriptions',
        scope: 'subscriptions/read',
        query: { document: digits, limit: 15 },
      });
      return response.items ?? [];
    },

    cancelSubscription: (subscriptionId, reason) =>
      client.request<CancelSubscriptionResponse>({
        method: 'DELETE',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
        scope: 'subscriptions/write',
        body: reason ? { reason } : {},
        attempts: 1,
      }),

    async undoScheduledCancellation(subscriptionId) {
      await client.request<unknown>({
        method: 'DELETE',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/scheduled-cancellation`,
        scope: 'subscriptions/write',
        attempts: 1,
      });
    },

    // Simulacao: nao altera nada, por isso pode ser repetida com seguranca.
    previewPlanChange: ({ subscriptionId, itemId, priceId }) =>
      client.request<ProrataPreviewResponse>({
        method: 'POST',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/prorata`,
        scope: 'subscriptions/write',
        body: { itemId, priceId },
      }),

    changePlan: ({ subscriptionId, itemId, priceId }) =>
      client.request<ChangeItemResponse>({
        method: 'PUT',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/items/${encodeURIComponent(itemId)}`,
        scope: 'subscriptions/write',
        body: { priceId },
        attempts: 1,
      }),

    // `NEXT_CYCLE` sempre: a cobranca em aberto nao e reemitida, entao nenhum
    // boleto antigo fica solto e nenhum valor e cobrado por causa da troca.
    changePaymentMethod: ({ subscriptionId, paymentMethod }) =>
      client.request<ChangePaymentMethodResponse>({
        method: 'PUT',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/payment-method`,
        scope: 'subscriptions/write',
        body: { paymentMethod, applyTo: 'NEXT_CYCLE' },
        attempts: 1,
      }),

    // Simulacao (`dryRun`) nao altera nada e pode ser repetida; a troca de
    // verdade nao: repetir um pro-rata poderia lancar o ajuste duas vezes.
    changeDueDay: ({ subscriptionId, billingDay, prorata, dryRun, reason }) =>
      client.request<ChangeDueDateResponse>({
        method: 'PUT',
        path: `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/due-date`,
        scope: 'subscriptions/write',
        body: {
          billingDay,
          applyFrom: 'NEXT_CYCLE',
          prorata,
          reason: reason || undefined,
          dryRun,
        },
        attempts: dryRun ? undefined : 1,
      }),

    getChargeStatus: (chargeId) =>
      client.request<ChargeStatusResponse>({
        method: 'GET',
        path: `/v1/charges/${encodeURIComponent(chargeId)}/status`,
        scope: 'charges/read',
      }),

    getCharge: (chargeId) =>
      client.request<ChargeResponse>({
        method: 'GET',
        path: `/v1/charges/${encodeURIComponent(chargeId)}`,
        scope: 'charges/read',
      }),
  };
}

function planPriceTitle(recurrenceType: string): string {
  const titles: Record<string, string> = {
    DAILY: 'Diário',
    WEEKLY: 'Semanal',
    MONTHLY: 'Mensal',
    QUARTERLY: 'Trimestral',
    SEMIANNUAL: 'Semestral',
    YEARLY: 'Anual',
    ONE_TIME: 'Avulso',
  };
  return titles[recurrenceType] ?? 'Mensal';
}

// ----------------------------------------------------- nao configurado

const NOT_CONFIGURED_MESSAGE =
  'A integração de pagamentos não está configurada. Defina VALIDAPAY_CLIENT_ID, '
  + 'VALIDAPAY_CLIENT_SECRET e VALIDAPAY_WEBHOOK_SECRET no ambiente do servidor para habilitar '
  + 'a contratação de planos.';

/**
 * Implementacao usada quando faltam credenciais.
 *
 * Recusa toda operacao com `integration_not_configured`, deixando claro que o
 * recurso depende de configuracao externa. Nenhuma rota responde sucesso sem
 * ter falado com o provedor.
 */
export function createUnconfiguredBillingProvider(): BillingProvider {
  const fail = (): never => {
    throw AppError.notConfigured(NOT_CONFIGURED_MESSAGE);
  };
  return {
    configured: false,
    environment: 'custom',
    syncPlan: async () => fail(),
    createCheckoutSession: async () => fail(),
    getCheckoutSession: async () => fail(),
    getSubscription: async () => fail(),
    findSubscriptionsByDocument: async () => fail(),
    cancelSubscription: async () => fail(),
    undoScheduledCancellation: async () => fail(),
    previewPlanChange: async () => fail(),
    changePlan: async () => fail(),
    changePaymentMethod: async () => fail(),
    changeDueDay: async () => fail(),
    getChargeStatus: async () => fail(),
    getCharge: async () => fail(),
  };
}

export function createBillingProvider(env: Env): BillingProvider {
  return env.VALIDAPAY_CLIENT_ID && env.VALIDAPAY_CLIENT_SECRET
    ? createValidaPayProvider(env)
    : createUnconfiguredBillingProvider();
}

/** Converte o codigo interno para o valor aceito em `allowedPaymentMethods`. */
export function checkoutPaymentMethods(
  codes: readonly PaymentMethodCode[],
): Array<'pix' | 'creditcard' | 'boleto' | 'pix_automatico'> {
  return codes.map((code) => (code === 'creditcard' ? 'creditcard' : code));
}
