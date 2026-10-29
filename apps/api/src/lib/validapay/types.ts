import type {
  ValidaPayChargeStatus,
  ValidaPayPaymentType,
  ValidaPayRecurrenceType,
  ValidaPaySubscriptionStatus,
} from '@codeca/shared';

/**
 * Formas das respostas da ValidaPay que esta integracao realmente le.
 *
 * Declaradas a partir da documentacao oficial, com tudo opcional onde a
 * documentacao admite ausencia ou `null`. Nada e deduzido de outro endpoint: os
 * campos que nao estao documentados simplesmente nao aparecem aqui.
 */

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/** `POST /v1/products` */
export interface CreateProductInput {
  name: string;
  description?: string;
  type: 'RECURRING' | 'ONE_TIME';
  statementDescriptor?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
  prices: Array<{
    title: string;
    /** Em reais, sempre maior que zero. */
    amount: number;
    currency?: 'BRL';
    recurrenceType: ValidaPayRecurrenceType;
    recurrenceInterval?: number;
    trialDays?: number;
  }>;
}

export interface CreateProductResponse {
  productId: string;
  name?: string;
  prices?: Array<{ priceId: string; amount?: number; checkoutUrl?: string }>;
}

/** `POST /v1/checkout-sessions` */
export interface CreateCheckoutSessionInput {
  priceId: string;
  allowedPaymentMethods?: Array<'pix' | 'creditcard' | 'boleto' | 'pix_automatico'>;
  subscriptionAllowedPaymentMethods?: Array<'pix' | 'creditcard' | 'boleto'>;
  customer?: {
    name?: string;
    email?: string;
    documentNumber?: string;
    phone?: string;
  };
  items?: Array<{ priceId: string; quantity?: number }>;
  /** Cria a assinatura como pendente antes do primeiro pagamento. */
  createPendingSubscription?: boolean;
  successUrl?: string;
  failureUrl?: string;
  redirectAfterPaymentUrl?: string;
  termsOfServiceUrl?: string;
  privacyPolicyUrl?: string;
  companyName?: string;
  primaryColor?: string;
  /** Objeto livre persistido na sessao; usado para correlacionar a empresa. */
  metadata?: Record<string, unknown>;
}

export interface CreateCheckoutSessionResponse {
  id: string;
  url: string;
  priceId?: string;
}

export interface CheckoutSessionResponse {
  id: string;
  status?: 'active' | 'completed' | 'expired';
  chargeId?: string | null;
  metadata?: Record<string, unknown> | null;
  items?: Array<{ priceId?: string; productId?: string; amount?: number }>;
}

/** Ciclo de cobranca dentro da assinatura. */
export interface SubscriptionCycle {
  cycleNumber?: number;
  amount?: number;
  status?: string;
  chargeDate?: string | null;
  chargeId?: string | null;
  paidAt?: string | null;
  paymentMethod?: string | null;
}

/** `GET /v1/subscriptions/:subscriptionId` */
export interface SubscriptionResponse {
  subscriptionId: string;
  customerId?: string;
  status: ValidaPaySubscriptionStatus;
  interval?: string;
  billingDay?: number | null;
  paymentType?: ValidaPayPaymentType | null;
  productId?: string | null;
  priceId?: string | null;
  checkoutId?: string | null;
  checkoutUrl?: string | null;
  currentCycleNumber?: number;
  currentCycleAmount?: number | null;
  nextCycleAmount?: number | null;
  nextCycleChargeDate?: string | null;
  cancelAtPeriodEnd?: boolean;
  primaryItemId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  cancellation?: { immediate?: boolean; effectiveAt?: string | null } | null;
  items?: Array<{
    itemId: string;
    name?: string;
    amount?: number;
    quantity?: number;
    type?: 'RECURRING' | 'ONE_TIME';
    status?: string;
    priceId?: string;
    productId?: string;
  }>;
  billingCycles?: Array<{
    cycleNumber?: number;
    cycle?: SubscriptionCycle;
    invoices?: Array<{
      invoiceId?: string;
      status?: string;
      paymentType?: string;
      dueDate?: string | null;
      paidAt?: string | null;
      charge?: { chargeId?: string; paymentType?: string } | null;
      summary?: { total?: number } | null;
    }>;
    charge?: { amount?: number; paidAt?: string | null; createdAt?: string } | null;
  }>;
}

/** `DELETE /v1/subscriptions/:subscriptionId` */
export interface CancelSubscriptionResponse {
  success?: boolean;
  message?: string;
  subscriptionId?: string;
  status?: ValidaPaySubscriptionStatus;
  cancelAtPeriodEnd?: boolean;
  immediate?: boolean;
  effectiveAt?: string | null;
  reason?: string;
}

/** `GET /v1/charges/:chargeId/status` */
export interface ChargeStatusResponse {
  chargeId: string;
  status: ValidaPayChargeStatus;
  amount?: number;
  paymentType?: ValidaPayPaymentType | null;
  paidAt?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
}

/** `GET /v1/charges/:chargeId` -- apenas os campos que usamos. */
export interface ChargeResponse extends ChargeStatusResponse {
  invoiceId?: string | null;
  subscriptionId?: string | null;
  saleType?: 'ONE_TIME' | 'RECURRING';
  dueDate?: string | null;
  currency?: string;
  customerId?: string | null;
}

/** `POST /v1/subscriptions/:id/prorata` -- simulacao de troca de plano. */
export interface ProrataPreviewResponse {
  mode?: string;
  /** Valor cobrado agora, em reais. */
  amount?: number | null;
  /** Credito gerado, em reais. */
  credit?: number | null;
  effectiveCycleNumber?: number | null;
  warnings?: string[];
}

/** `PUT /v1/subscriptions/:id/items/:itemId` */
export interface ChangeItemResponse {
  subscriptionId?: string;
  itemId?: string;
  status?: string;
  chargeId?: string | null;
  mode?: string;
}
