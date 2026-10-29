import { eq, schema, type Database } from '@codeca/database';
import {
  AppError,
  PAYMENT_METHOD_OPTIONS,
  formatCents,
  planBillingSchema,
  type PaymentMethodCode,
} from '@codeca/shared';
import { createOpaqueToken } from '@codeca/shared/server';
import type { Env } from '../../env.js';
import type { BillingProvider } from '../validapay/provider.js';
import { checkoutPaymentMethods } from '../validapay/provider.js';
import { BILLING_ACTIONS, recordBillingAudit } from './audit.js';
import {
  applySubscriptionPatch,
  requireSubscription,
  type BillingContext,
  type SubscriptionRow,
} from './service.js';

/**
 * Contratacao de um plano.
 *
 * Importante: **a ValidaPay nao cria assinaturas por API.** Nao existe
 * `POST /v1/subscriptions`: a assinatura nasce quando uma cobranca com item
 * recorrente e paga. Por isso o fluxo e:
 *
 *   1. o plano e sincronizado como produto + preco recorrente;
 *   2. a plataforma cria uma sessao de checkout hospedada com aquele preco;
 *   3. o cliente paga na pagina da ValidaPay (o cartao e tokenizado la, e os
 *      dados sensiveis nunca passam pelo nosso servidor);
 *   4. os webhooks `subscription.created` e `subscription.activated` /
 *      `payment.success` trazem a assinatura, que e vinculada a empresa.
 *
 * Enquanto o pagamento nao e confirmado a assinatura fica `pending` e o site
 * nao e publicado.
 */

export type PlanRow = typeof schema.plans.$inferSelect;
export type TenantRow = typeof schema.tenants.$inferSelect;

/** Janela em que uma sessao de checkout pendente e reaproveitada. */
const CHECKOUT_REUSE_WINDOW_MS = 30 * 60 * 1000;

export interface StartCheckoutInput {
  tenantId: string;
  planId: string;
  paymentMethod: PaymentMethodCode;
  actorUserId: string;
}

export interface StartCheckoutResult {
  checkoutUrl: string;
  checkoutSessionId: string;
  /** `true` quando a sessao anterior foi reaproveitada. */
  reused: boolean;
  planName: string;
  priceCents: number;
  paymentMethod: PaymentMethodCode;
  /** Aviso quando o metodo escolhido nao renova automaticamente. */
  notice: string | null;
}

export async function startCheckout(
  ctx: BillingContext & { provider: BillingProvider; env: Env },
  input: StartCheckoutInput,
): Promise<StartCheckoutResult> {
  const { db } = ctx;
  const subscription = await requireSubscription(db, input.tenantId);
  const plan = await loadPlan(db, input.planId);
  const tenant = await loadTenant(db, input.tenantId);

  assertPlanContractable(plan, input.paymentMethod);

  // Ja ha assinatura paga neste mesmo plano: trocar de plano usa outra rota.
  if (
    subscription.planId === plan.id &&
    (subscription.status === 'active' || subscription.status === 'cancel_at_period_end') &&
    subscription.externalSubscriptionId
  ) {
    throw AppError.conflict(
      `A empresa ja possui uma assinatura ativa do plano ${plan.name}.`,
    );
  }

  // Idempotencia: uma repeticao da mesma requisicao devolve a sessao anterior
  // em vez de criar uma segunda contratacao para a mesma empresa.
  const reusable = reusableSession(subscription, plan.id, input.paymentMethod, ctx.now());
  if (reusable) {
    return {
      checkoutUrl: reusable.checkoutUrl,
      checkoutSessionId: reusable.checkoutSessionId,
      reused: true,
      planName: plan.name,
      priceCents: plan.priceCents,
      paymentMethod: input.paymentMethod,
      notice: methodNotice(input.paymentMethod),
    };
  }

  const priceId = await ensurePlanSynced(ctx, plan);

  // Token opaco que volta nos eventos e liga a assinatura a esta empresa.
  const intentToken = createOpaqueToken(18);
  const appUrl = ctx.env.APP_URL.replace(/\/$/, '');

  const session = await ctx.provider.createCheckoutSession({
    priceId,
    allowedPaymentMethods: checkoutPaymentMethods([input.paymentMethod]),
    createPendingSubscription: true,
    customer: {
      name: tenant.legalName || tenant.displayName,
      ...(tenant.contactEmail ? { email: tenant.contactEmail } : {}),
      ...(tenant.taxId ? { documentNumber: tenant.taxId.replace(/\D+/g, '') } : {}),
      ...(tenant.contactPhone ? { phone: tenant.contactPhone.replace(/\D+/g, '') } : {}),
    },
    companyName: ctx.env.PLATFORM_NAME,
    successUrl: `${appUrl}/painel/plano?contratacao=sucesso`,
    failureUrl: `${appUrl}/painel/plano?contratacao=falha`,
    redirectAfterPaymentUrl: `${appUrl}/painel/plano?contratacao=concluida`,
    // Metadados sao a ponte entre a sessao e a empresa; nada sensivel aqui.
    metadata: {
      tenantId: input.tenantId,
      planId: plan.id,
      intentToken,
      amountCents: plan.priceCents,
      platform: 'codeca-build',
    },
  });

  if (!session.url || !session.id) {
    throw new AppError('upstream_error', 'A ValidaPay nao devolveu o link de pagamento.');
  }

  const replacing = Boolean(subscription.checkoutSessionId);
  await applySubscriptionPatch(
    { ...ctx, source: 'checkout', actorUserId: input.actorUserId },
    subscription,
    {
      // O plano desejado fica pendente: os limites novos so valem apos o
      // pagamento confirmado.
      pendingPlanId: plan.id,
      paymentMethod: input.paymentMethod,
      checkoutSessionId: session.id,
      checkoutUrl: session.url,
      checkoutCreatedAt: ctx.now(),
      intentToken,
      externalPriceId: priceId,
      lastErrorMessage: '',
      // Assinatura que nunca foi paga volta para `pending`; uma assinatura em
      // vigor continua no estado atual ate o novo pagamento ser confirmado.
      ...(subscription.externalSubscriptionId ? {} : { status: 'pending' as const }),
    },
    {
      action: replacing ? BILLING_ACTIONS.checkoutReplaced : BILLING_ACTIONS.checkoutStarted,
      reason: `Contratacao do plano ${plan.name} por ${PAYMENT_METHOD_OPTIONS[input.paymentMethod].label}.`,
      metadata: {
        planId: plan.id,
        planCode: plan.code,
        priceCents: plan.priceCents,
        paymentMethod: input.paymentMethod,
        checkoutSessionId: session.id,
      },
    },
  );

  return {
    checkoutUrl: session.url,
    checkoutSessionId: session.id,
    reused: false,
    planName: plan.name,
    priceCents: plan.priceCents,
    paymentMethod: input.paymentMethod,
    notice: methodNotice(input.paymentMethod),
  };
}

function reusableSession(
  subscription: SubscriptionRow,
  planId: string,
  paymentMethod: PaymentMethodCode,
  now: Date,
): { checkoutUrl: string; checkoutSessionId: string } | null {
  if (!subscription.checkoutSessionId || !subscription.checkoutUrl) return null;
  if (subscription.pendingPlanId !== planId) return null;
  if (subscription.paymentMethod !== paymentMethod) return null;
  if (subscription.externalSubscriptionId) return null;
  if (!subscription.checkoutCreatedAt) return null;
  if (now.getTime() - subscription.checkoutCreatedAt.getTime() > CHECKOUT_REUSE_WINDOW_MS) {
    return null;
  }
  return {
    checkoutUrl: subscription.checkoutUrl,
    checkoutSessionId: subscription.checkoutSessionId,
  };
}

/** Recusa a contratacao de plano inativo, gratuito ou com metodo nao oferecido. */
export function assertPlanContractable(plan: PlanRow, paymentMethod: PaymentMethodCode): void {
  if (!plan.isActive) {
    throw AppError.conflict(`O plano ${plan.name} esta inativo e nao pode ser contratado.`);
  }
  if (plan.priceCents <= 0) {
    throw AppError.badRequest(
      `O plano ${plan.name} nao tem preco e nao pode ser contratado. `
        + 'Planos de avaliacao sao concedidos pela plataforma.',
    );
  }

  const billing = planBillingSchema.parse(plan.billing);
  if (!billing.paymentMethods.includes(paymentMethod)) {
    throw AppError.badRequest(
      `O plano ${plan.name} nao aceita ${PAYMENT_METHOD_OPTIONS[paymentMethod].label}. `
        + `Formas disponiveis: ${billing.paymentMethods
          .map((code) => PAYMENT_METHOD_OPTIONS[code].label)
          .join(', ')}.`,
    );
  }

  const option = PAYMENT_METHOD_OPTIONS[paymentMethod];
  if (plan.priceCents < option.minimumCents) {
    throw AppError.badRequest(
      `${option.label} exige valor minimo de ${formatCents(option.minimumCents)} por cobranca. `
        + `O plano ${plan.name} custa ${formatCents(plan.priceCents)}.`,
    );
  }
}

/** Aviso honesto quando a forma escolhida nao debita sozinha. */
function methodNotice(paymentMethod: PaymentMethodCode): string | null {
  const option = PAYMENT_METHOD_OPTIONS[paymentMethod];
  if (option.automatic) return null;
  return (
    `${option.label}: a ValidaPay emite uma cobranca a cada ciclo, mas o pagamento e manual. `
    + 'Nao ha debito automatico nesta forma de pagamento.'
  );
}

/**
 * Garante que o plano existe como produto e preco recorrente na ValidaPay.
 *
 * Sincroniza na primeira contratacao, se ainda nao houver `price_`. O
 * identificador fica gravado no plano: o preco nunca vem do navegador.
 */
export async function ensurePlanSynced(
  ctx: BillingContext & { provider: BillingProvider },
  plan: PlanRow,
): Promise<string> {
  if (plan.externalPriceId) return plan.externalPriceId;
  const synced = await syncPlanWithProvider(ctx, plan);
  return synced.externalPriceId;
}

export interface SyncedPlan {
  externalProductId: string;
  externalPriceId: string;
  externalCheckoutUrl: string | null;
}

export async function syncPlanWithProvider(
  ctx: BillingContext & { provider: BillingProvider },
  plan: PlanRow,
): Promise<SyncedPlan> {
  if (plan.priceCents <= 0) {
    throw AppError.badRequest(
      `O plano ${plan.name} e gratuito: a ValidaPay exige preco maior que zero para criar um preco recorrente.`,
    );
  }

  const billing = planBillingSchema.parse(plan.billing);

  try {
    const result = await ctx.provider.syncPlan({
      name: plan.name,
      description: plan.description,
      priceCents: plan.priceCents,
      recurrenceType: billing.recurrenceType,
      recurrenceInterval: billing.recurrenceInterval,
      trialDays: billing.trialDays,
      statementDescriptor: plan.name,
      metadata: { planId: plan.id, planCode: plan.code, platform: 'codeca-build' },
    });

    await ctx.db
      .update(schema.plans)
      .set({
        externalProductId: result.productId,
        externalPriceId: result.priceId,
        externalCheckoutUrl: result.checkoutUrl,
        externalSyncedAt: ctx.now(),
        externalSyncError: '',
        updatedAt: ctx.now(),
      })
      .where(eq(schema.plans.id, plan.id));

    await recordBillingAudit(ctx.db, {
      action: BILLING_ACTIONS.planSynced,
      source: ctx.source,
      actorUserId: ctx.actorUserId ?? null,
      reason: `Plano ${plan.code} sincronizado com a ValidaPay.`,
      metadata: {
        planId: plan.id,
        productId: result.productId,
        priceId: result.priceId,
        priceCents: plan.priceCents,
      },
    });

    return {
      externalProductId: result.productId,
      externalPriceId: result.priceId,
      externalCheckoutUrl: result.checkoutUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.db
      .update(schema.plans)
      .set({ externalSyncError: message.slice(0, 300), updatedAt: ctx.now() })
      .where(eq(schema.plans.id, plan.id));
    throw error;
  }
}

export async function loadPlan(db: Database, planId: string): Promise<PlanRow> {
  const [row] = await db.select().from(schema.plans).where(eq(schema.plans.id, planId));
  if (!row) throw AppError.notFound('Plano nao encontrado.');
  return row;
}

export async function loadTenant(db: Database, tenantId: string): Promise<TenantRow> {
  const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  if (!row) throw AppError.notFound('Empresa nao encontrada.');
  return row;
}
