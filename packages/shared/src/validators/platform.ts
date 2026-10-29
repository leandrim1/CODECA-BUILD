import { z } from 'zod';
import { TENANT_STATUSES } from '../constants.js';
import { planLimitsSchema } from '../plans.js';
import { emailSchema, paginationSchema, personNameSchema, slugSchema, uuidSchema } from './common.js';
import { PLATFORM_ROLES } from '../roles.js';

export const planInputSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[a-z0-9_-]+$/, 'Use letras minusculas, numeros, - e _.'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).default(''),
  priceCents: z.number().int().min(0).max(100_000_000).default(0),
  limits: planLimitsSchema,
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
export type PlanInput = z.infer<typeof planInputSchema>;

export const planUpdateSchema = planInputSchema.partial().omit({ code: true });

export const platformTenantQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(TENANT_STATUSES).optional(),
  planCode: z.string().trim().max(40).optional(),
});

export const platformCreateTenantSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  displayName: z.string().trim().min(2).max(160),
  slug: slugSchema.optional(),
  planCode: z.string().trim().max(40),
  ownerEmail: emailSchema,
  ownerName: personNameSchema,
});

export const platformUpdateTenantSchema = z.object({
  status: z.enum(TENANT_STATUSES).optional(),
  planCode: z.string().trim().max(40).optional(),
  /** Sobrescreve limites do plano para esta empresa. */
  limitOverrides: planLimitsSchema.partial().nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const setPlatformRoleSchema = z.object({
  userId: uuidSchema,
  platformRole: z.enum(PLATFORM_ROLES),
});

/**
 * Acesso de suporte: um administrador da plataforma precisa de autorizacao
 * explicita, com motivo e prazo, para consultar dados de uma empresa.
 * Toda concessao e registrada em auditoria.
 */
export const supportGrantSchema = z.object({
  tenantId: uuidSchema,
  reason: z.string().trim().min(10, 'Descreva o motivo do acesso.').max(400),
  expiresInMinutes: z.number().int().min(5).max(480).default(60),
  /** Acesso de suporte e sempre somente leitura. */
  readOnly: z.literal(true).default(true),
});
export type SupportGrantInput = z.infer<typeof supportGrantSchema>;

export const auditQuerySchema = paginationSchema.extend({
  tenantId: uuidSchema.optional(),
  actorUserId: uuidSchema.optional(),
  action: z.string().trim().max(80).optional(),
  from: z.string().trim().max(32).optional(),
  to: z.string().trim().max(32).optional(),
});
