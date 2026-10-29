import { z } from 'zod';
import {
  BILLING_STATES,
  CHARGE_STATES,
  PAYMENT_METHOD_CODES,
  VALIDAPAY_RECURRENCE_TYPES,
} from '../billing/states.js';
import { paginationSchema, uuidSchema } from './common.js';

/**
 * Entradas das rotas de cobranca.
 *
 * Nenhuma delas aceita valor: o preco vem sempre do plano gravado no banco. O
 * navegador escolhe **qual plano** e **qual forma de pagamento**, nada mais.
 */

/** Identificadores da ValidaPay: `prod_`, `price_`, `sub_`, `cha_`, `cs_`. */
const externalId = (prefix: string, label: string) =>
  z
    .string()
    .trim()
    .min(prefix.length + 1)
    .max(120)
    .regex(new RegExp(`^${prefix}[A-Za-z0-9_-]+$`), `Informe um ${label} valido (${prefix}...).`);

export const externalProductIdSchema = externalId('prod_', 'identificador de produto');
export const externalPriceIdSchema = externalId('price_', 'identificador de preco');
export const externalSubscriptionIdSchema = externalId('sub_', 'identificador de assinatura');
export const externalChargeIdSchema = externalId('cha_', 'identificador de cobranca');

/** Contratacao: plano e forma de pagamento, decididos no servidor a partir do id. */
export const startSubscriptionSchema = z.object({
  planId: uuidSchema,
  paymentMethod: z.enum(PAYMENT_METHOD_CODES),
});
export type StartSubscriptionInput = z.infer<typeof startSubscriptionSchema>;

export const cancelSubscriptionSchema = z.object({
  reason: z.string().trim().max(400).default(''),
  /**
   * `period_end` respeita o periodo contratado; `immediate` apenas pede o
   * cancelamento agora -- quem decide o efeito e a ValidaPay, conforme houver
   * periodo pago pela frente.
   */
  mode: z.enum(['period_end', 'immediate']).default('period_end'),
});
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;

export const changePlanSchema = z.object({
  planId: uuidSchema,
  /** Quando true, apenas simula e devolve o valor da pro-rata ou do credito. */
  preview: z.boolean().default(false),
});
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

export const chargeQuerySchema = paginationSchema.extend({
  status: z.enum(CHARGE_STATES).optional(),
  from: z.string().trim().max(32).optional(),
  to: z.string().trim().max(32).optional(),
});

export const chargeIdParamSchema = z.object({ chargeId: uuidSchema });

// ------------------------------------------------------- painel mestre

export const planBillingSchema = z.object({
  /** Periodicidade enviada a ValidaPay ao sincronizar o preco. */
  recurrenceType: z.enum(VALIDAPAY_RECURRENCE_TYPES).default('MONTHLY'),
  recurrenceInterval: z.number().int().min(1).max(12).default(1),
  trialDays: z.number().int().min(0).max(365).nullable().default(null),
  /** Formas de pagamento oferecidas na contratacao deste plano. */
  paymentMethods: z.array(z.enum(PAYMENT_METHOD_CODES)).min(1).default(['creditcard']),
});
export type PlanBillingInput = z.infer<typeof planBillingSchema>;

export const platformSubscriptionQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  state: z.enum(BILLING_STATES).optional(),
  tenantId: uuidSchema.optional(),
});

export const platformChargeQuerySchema = paginationSchema.extend({
  tenantId: uuidSchema.optional(),
  status: z.enum(CHARGE_STATES).optional(),
  from: z.string().trim().max(32).optional(),
  to: z.string().trim().max(32).optional(),
  /**
   * Valor minimo e maximo em centavos. Chegam como texto na query string,
   * por isso a coercao: `z.number()` puro recusaria "19900".
   */
  minCents: z.coerce.number().int().min(0).optional(),
  maxCents: z.coerce.number().int().min(0).optional(),
});

export const webhookEventQuerySchema = paginationSchema.extend({
  status: z.enum(['pending', 'processed', 'failed', 'ignored', 'unresolved']).optional(),
  event: z.string().trim().max(60).optional(),
});

/** Consulta de assinaturas e cobrancas aceita apenas filtros, nunca valores. */
export const billingHistoryQuerySchema = paginationSchema.extend({
  tenantId: uuidSchema.optional(),
});

export const replayWebhookSchema = z.object({ eventId: uuidSchema });

export const reconcileSchema = z.object({
  tenantId: uuidSchema.optional(),
  /** Reconsulta tambem o que ja esta sincronizado recentemente. */
  force: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(50),
});

/**
 * Suspensao ou reativacao manual da publicacao.
 *
 * Nao altera o estado financeiro confirmado pela ValidaPay: grava uma decisao
 * administrativa, com justificativa, em coluna propria e em auditoria.
 */
export const publicationHoldSchema = z.object({
  tenantId: uuidSchema,
  hold: z.boolean(),
  reason: z.string().trim().min(10, 'Descreva o motivo da decisao.').max(400),
});
export type PublicationHoldInput = z.infer<typeof publicationHoldSchema>;

export const gracePeriodSchema = z.object({
  tenantId: uuidSchema,
  gracePeriodDays: z.number().int().min(0).max(60),
  reason: z.string().trim().min(5).max(400),
});
