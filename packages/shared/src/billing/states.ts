/**
 * Estados de cobranca.
 *
 * Quatro coisas distintas, propositalmente separadas:
 *
 *  1. `ValidaPaySubscriptionStatus` -- o estado da assinatura NA VALIDAPAY.
 *  2. `ValidaPayChargeStatus`       -- o estado de cada cobranca NA VALIDAPAY.
 *  3. `BillingState`                -- o estado comercial na plataforma.
 *  4. `PublicationState`            -- se o site da empresa pode ficar no ar.
 *
 * Os nomes externos nunca sao reaproveitados como estado interno: o provedor
 * pode renomear ou acrescentar valores, e a decisao comercial e nossa.
 */

// --------------------------------------------------------------- provedor

/** Estados de assinatura documentados pela ValidaPay. */
export const VALIDAPAY_SUBSCRIPTION_STATUSES = [
  'PENDING',
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'DEFAULT',
  'EXPIRED',
  'CANCELED',
  'COMPLETED',
  'ARCHIVED',
] as const;
export type ValidaPaySubscriptionStatus = (typeof VALIDAPAY_SUBSCRIPTION_STATUSES)[number];

/** Estados de cobranca documentados pela ValidaPay. */
export const VALIDAPAY_CHARGE_STATUSES = [
  'PENDING',
  'PROCESSING',
  'AWAITING_PAYMENT',
  'PAID',
  'FAILED',
  'EXPIRED',
  'CANCELED',
  'ARCHIVED',
  'DISPUTE',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CHARGED_BACK',
] as const;
export type ValidaPayChargeStatus = (typeof VALIDAPAY_CHARGE_STATUSES)[number];

/** Formas de pagamento aceitas em uma assinatura. */
export const VALIDAPAY_PAYMENT_TYPES = ['CREDIT_CARD', 'PIX', 'BOLETO', 'PIX_AUTOMATICO'] as const;
export type ValidaPayPaymentType = (typeof VALIDAPAY_PAYMENT_TYPES)[number];

/** Periodicidades de um preco recorrente. */
export const VALIDAPAY_RECURRENCE_TYPES = [
  'ONE_TIME',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'YEARLY',
] as const;
export type ValidaPayRecurrenceType = (typeof VALIDAPAY_RECURRENCE_TYPES)[number];

/** Eventos de webhook que esta integracao processa. */
export const VALIDAPAY_HANDLED_EVENTS = [
  'subscription.created',
  'subscription.trial',
  'subscription.activated',
  'subscription.renewed',
  'subscription.upgraded',
  'subscription.downgrade_scheduled',
  'subscription.cancel_scheduled',
  'subscription.canceled',
  'subscription.expired',
  'subscription.item_added',
  'subscription.item_removed',
  'charge.created',
  'charge.expired',
  'payment.success',
  'payment.failed',
  'payment.retry',
  'payment.overdue',
  'refund.requested',
  'refund.confirmed',
  'refund.failed',
] as const;
export type ValidaPayEvent = (typeof VALIDAPAY_HANDLED_EVENTS)[number];

export function isHandledEvent(value: string): value is ValidaPayEvent {
  return (VALIDAPAY_HANDLED_EVENTS as readonly string[]).includes(value);
}

// --------------------------------------------------- formas de pagamento

/**
 * Metodos oferecidos na contratacao.
 *
 * `automatic: true` significa que os ciclos seguintes sao debitados sem acao do
 * cliente -- o que, pela documentacao, vale apenas para cartao de credito e
 * Pix Automatico. Com Pix comum ou boleto a ValidaPay emite uma cobranca nova a
 * cada ciclo, mas **quem paga e o cliente, manualmente**: nao e debito
 * automatico e nao deve ser apresentado como tal.
 */
export interface PaymentMethodOption {
  /** Valor aceito em `allowedPaymentMethods` da sessao de checkout. */
  checkoutValue: 'creditcard' | 'pix' | 'boleto' | 'pix_automatico';
  /** Valor correspondente em `paymentType` nas respostas e eventos. */
  paymentType: ValidaPayPaymentType;
  label: string;
  description: string;
  automatic: boolean;
  /** Pix Automatico exige conta ValidaPay PJ. */
  requiresCompanyAccount: boolean;
  /** Valor minimo por cobranca imposto pelo metodo, em centavos. */
  minimumCents: number;
}

export const PAYMENT_METHOD_OPTIONS = {
  creditcard: {
    checkoutValue: 'creditcard',
    paymentType: 'CREDIT_CARD',
    label: 'Cartao de credito',
    description: 'Renovacao automatica a cada ciclo, com nova tentativa em caso de recusa.',
    automatic: true,
    requiresCompanyAccount: false,
    minimumCents: 0,
  },
  pix_automatico: {
    checkoutValue: 'pix_automatico',
    paymentType: 'PIX_AUTOMATICO',
    label: 'Pix Automatico',
    description:
      'O cliente autoriza a recorrencia uma unica vez no aplicativo do banco e os ciclos seguintes '
      + 'sao debitados automaticamente. Valor minimo de R$ 4,99 por cobranca.',
    automatic: true,
    requiresCompanyAccount: true,
    minimumCents: 499,
  },
  pix: {
    checkoutValue: 'pix',
    paymentType: 'PIX',
    label: 'Pix a cada ciclo',
    description:
      'A plataforma emite um Pix por ciclo e avisa a empresa. O pagamento e manual: nao ha debito '
      + 'automatico.',
    automatic: false,
    requiresCompanyAccount: false,
    minimumCents: 0,
  },
  boleto: {
    checkoutValue: 'boleto',
    paymentType: 'BOLETO',
    label: 'Boleto a cada ciclo',
    description: 'Um boleto por ciclo, com pagamento manual pela empresa.',
    automatic: false,
    requiresCompanyAccount: false,
    minimumCents: 0,
  },
} as const satisfies Record<string, PaymentMethodOption>;

export const PAYMENT_METHOD_CODES = ['creditcard', 'pix_automatico', 'pix', 'boleto'] as const;
export type PaymentMethodCode = (typeof PAYMENT_METHOD_CODES)[number];

/** Metodos cujas renovacoes sao debitadas sem acao do cliente. */
export const AUTOMATIC_PAYMENT_METHODS: readonly PaymentMethodCode[] = PAYMENT_METHOD_CODES.filter(
  (code) => PAYMENT_METHOD_OPTIONS[code].automatic,
);

export function paymentMethodFromType(type: string): PaymentMethodCode | null {
  const found = PAYMENT_METHOD_CODES.find(
    (code) => PAYMENT_METHOD_OPTIONS[code].paymentType === type,
  );
  return found ?? null;
}

// ------------------------------------------------------- estado comercial

/** Estado comercial da assinatura na plataforma. */
export const BILLING_STATES = [
  'pending',
  'trialing',
  'active',
  'past_due',
  'cancel_at_period_end',
  'canceled',
  'expired',
  'completed',
  'suspended',
] as const;
export type BillingState = (typeof BILLING_STATES)[number];

export const BILLING_STATE_LABELS: Record<BillingState, string> = {
  pending: 'Aguardando primeiro pagamento',
  trialing: 'Em avaliacao',
  active: 'Ativa',
  past_due: 'Pagamento em atraso',
  cancel_at_period_end: 'Cancelamento agendado',
  canceled: 'Cancelada',
  expired: 'Encerrada por falta de pagamento',
  completed: 'Concluida',
  suspended: 'Suspensa pela plataforma',
} as const;

/** Estados em que nao ha renovacao futura esperada. */
export const TERMINAL_BILLING_STATES: readonly BillingState[] = [
  'canceled',
  'expired',
  'completed',
];

/**
 * Traduz o estado do provedor para o estado comercial.
 *
 * `DEFAULT` e `PAST_DUE` caem ambos em `past_due`: a diferenca (inadimplencia
 * depois de ter sido ativa x primeiro ciclo nunca pago) continua disponivel na
 * coluna que guarda o status cru do provedor.
 *
 * `suspended` nunca vem do provedor: so o painel mestre o define.
 */
export function billingStateFromProvider(
  status: ValidaPaySubscriptionStatus,
  options: { cancelAtPeriodEnd?: boolean } = {},
): BillingState {
  switch (status) {
    case 'PENDING':
      return 'pending';
    case 'TRIALING':
      return options.cancelAtPeriodEnd ? 'cancel_at_period_end' : 'trialing';
    case 'ACTIVE':
      return options.cancelAtPeriodEnd ? 'cancel_at_period_end' : 'active';
    case 'PAST_DUE':
    case 'DEFAULT':
      return 'past_due';
    case 'EXPIRED':
      return 'expired';
    case 'CANCELED':
    case 'ARCHIVED':
      return 'canceled';
    case 'COMPLETED':
      return 'completed';
  }
}

// -------------------------------------------------- estado das cobrancas

/** Estado local de uma cobranca: espelha o provedor, em minusculas. */
export const CHARGE_STATES = [
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
] as const;
export type ChargeState = (typeof CHARGE_STATES)[number];

export const CHARGE_STATE_LABELS: Record<ChargeState, string> = {
  pending: 'Pendente',
  processing: 'Em processamento',
  awaiting_payment: 'Aguardando pagamento',
  failed: 'Recusada',
  expired: 'Expirada',
  canceled: 'Cancelada',
  archived: 'Arquivada',
  paid: 'Paga',
  dispute: 'Em contestacao',
  partially_refunded: 'Parcialmente estornada',
  refunded: 'Estornada',
  charged_back: 'Chargeback',
};

export function chargeStateFromProvider(status: ValidaPayChargeStatus): ChargeState {
  return status.toLowerCase() as ChargeState;
}

/**
 * Ordem de avanco de uma cobranca.
 *
 * Usada para nao substituir um estado definitivo por um estado antigo que
 * chegou depois -- webhooks sao *at-least-once* e podem vir fora de ordem. Um
 * `paid` que chega depois de um `expired` e aceito (boleto pago apos o
 * vencimento acontece); um `pending` que chega depois de `paid` e descartado.
 */
const CHARGE_STATE_RANK: Record<ChargeState, number> = {
  pending: 0,
  processing: 1,
  awaiting_payment: 1,
  failed: 2,
  expired: 3,
  canceled: 3,
  archived: 3,
  paid: 4,
  dispute: 5,
  partially_refunded: 6,
  refunded: 6,
  charged_back: 7,
};

export function chargeStateRank(state: ChargeState): number {
  return CHARGE_STATE_RANK[state];
}

/** `true` quando o estado novo pode substituir o atual. */
export function chargeStateAdvances(current: ChargeState, next: ChargeState): boolean {
  return CHARGE_STATE_RANK[next] >= CHARGE_STATE_RANK[current];
}

/** Estados em que o dinheiro entrou e nao voltou. */
export function chargeCountsAsPaid(state: ChargeState): boolean {
  return state === 'paid' || state === 'partially_refunded';
}

/** Estados que retiram o dinheiro ja recebido e exigem revisao. */
export function chargeReversesPayment(state: ChargeState): boolean {
  return state === 'refunded' || state === 'charged_back';
}

// ------------------------------------------------ estado de publicacao

/** Se o site publico da empresa pode ser servido, e por que nao. */
export const PUBLICATION_STATES = [
  'allowed',
  'blocked_pending',
  'blocked_overdue',
  'blocked_canceled',
  'blocked_dispute',
  'blocked_admin',
] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const PUBLICATION_STATE_LABELS: Record<PublicationState, string> = {
  allowed: 'Publicacao liberada',
  blocked_pending: 'Aguardando a confirmacao do primeiro pagamento',
  blocked_overdue: 'Suspenso por pagamento em atraso',
  blocked_canceled: 'Suspenso: assinatura encerrada',
  blocked_dispute: 'Suspenso para revisao de estorno ou contestacao',
  blocked_admin: 'Suspenso pela plataforma',
};

export const PUBLICATION_STATE_MESSAGES: Record<PublicationState, string> = {
  allowed: 'O site esta no ar.',
  blocked_pending:
    'O site fica privado ate a confirmacao do pagamento. Conclua a contratacao para publicar.',
  blocked_overdue:
    'O pagamento esta em atraso e o periodo de tolerancia terminou. Regularize para voltar ao ar; '
    + 'o conteudo cadastrado continua salvo.',
  blocked_canceled:
    'A assinatura foi encerrada. Contrate um plano para publicar de novo; o conteudo continua salvo.',
  blocked_dispute:
    'Ha um estorno ou contestacao em analise. O site fica suspenso durante a revisao e o conteudo '
    + 'continua salvo.',
  blocked_admin:
    'A publicacao foi suspensa pela plataforma. Fale com o suporte; o conteudo continua salvo.',
};

export function publicationAllowed(state: PublicationState): boolean {
  return state === 'allowed';
}

/** Tolerancia padrao, em dias, entre o vencimento e a suspensao do site. */
export const DEFAULT_GRACE_PERIOD_DAYS = 5;

/** Duracao da avaliacao concedida no cadastro, em dias. */
export const TRIAL_PERIOD_DAYS = 14;

export interface PublicationDecisionInput {
  state: BillingState;
  /** Fim do acesso pago (ou do periodo de avaliacao). */
  accessUntil: Date | null;
  /** Dias de tolerancia depois de `accessUntil`. */
  gracePeriodDays: number;
  /** Suspensao manual pelo painel mestre. */
  adminHold: boolean;
  /** Estorno, contestacao ou chargeback em revisao. */
  disputeHold: boolean;
  now: Date;
}

export interface PublicationDecision {
  publication: PublicationState;
  /** Instante em que a tolerancia termina, quando houver. */
  graceEndsAt: Date | null;
  /** `true` enquanto o acesso vale apenas por causa da tolerancia. */
  inGracePeriod: boolean;
}

/**
 * Decide a publicacao a partir do estado comercial.
 *
 * Funcao pura: a mesma entrada sempre decide igual, no webhook, na
 * reconciliacao, no painel e no renderizador do site.
 *
 * Regras, na ordem em que valem:
 *  - suspensao manual vence tudo;
 *  - estorno ou contestacao em revisao suspende;
 *  - assinatura que nunca foi paga nao publica;
 *  - encerrada ou cancelada publica apenas enquanto houver periodo pago;
 *  - atraso publica durante a tolerancia e suspende quando ela vence.
 */
export function decidePublication(input: PublicationDecisionInput): PublicationDecision {
  const { state, accessUntil, now } = input;
  const graceMs = Math.max(0, input.gracePeriodDays) * 24 * 3600 * 1000;
  const graceEndsAt = accessUntil ? new Date(accessUntil.getTime() + graceMs) : null;
  const withinAccess = accessUntil !== null && accessUntil.getTime() > now.getTime();
  const withinGrace = graceEndsAt !== null && graceEndsAt.getTime() > now.getTime();
  const inGracePeriod = !withinAccess && withinGrace;

  if (input.adminHold) return { publication: 'blocked_admin', graceEndsAt, inGracePeriod: false };
  if (input.disputeHold) return { publication: 'blocked_dispute', graceEndsAt, inGracePeriod: false };

  switch (state) {
    case 'pending':
      // Nunca houve pagamento confirmado: criar a assinatura nao publica o site.
      return { publication: 'blocked_pending', graceEndsAt: null, inGracePeriod: false };

    case 'suspended':
      return { publication: 'blocked_admin', graceEndsAt, inGracePeriod: false };

    case 'trialing':
    case 'active':
    case 'cancel_at_period_end':
      if (withinAccess) return { publication: 'allowed', graceEndsAt, inGracePeriod: false };
      if (withinGrace) return { publication: 'allowed', graceEndsAt, inGracePeriod: true };
      return { publication: 'blocked_overdue', graceEndsAt, inGracePeriod: false };

    case 'past_due':
      // Uma falha isolada nao e cancelamento: o site segue no ar na tolerancia.
      if (withinAccess || withinGrace) {
        return { publication: 'allowed', graceEndsAt, inGracePeriod: !withinAccess };
      }
      return { publication: 'blocked_overdue', graceEndsAt, inGracePeriod: false };

    case 'canceled':
    case 'expired':
    case 'completed':
      // Cancelamento respeita o periodo contratado, mas nao ganha tolerancia.
      if (withinAccess) return { publication: 'allowed', graceEndsAt: null, inGracePeriod: false };
      return { publication: 'blocked_canceled', graceEndsAt: null, inGracePeriod: false };
  }
}
