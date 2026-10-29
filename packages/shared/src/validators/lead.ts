import { z } from 'zod';
import { LEAD_INTEREST_TYPES, LEAD_STATUSES } from '../constants.js';
import { emailSchema, paginationSchema, personNameSchema, requiredPhoneSchema, uuidSchema } from './common.js';

/**
 * Formulario publico. Validado no servidor com rate limiting e honeypot.
 * O `tenantId` nunca vem do navegador: e resolvido pelo dominio da requisicao.
 */
export const publicLeadSchema = z.object({
  name: personNameSchema,
  phone: requiredPhoneSchema,
  email: z.union([emailSchema, z.literal('')]).default(''),
  interestType: z.enum(LEAD_INTEREST_TYPES),
  message: z.string().trim().max(4000).default(''),
  propertyId: uuidSchema.nullable().default(null),
  projectId: uuidSchema.nullable().default(null),
  serviceId: uuidSchema.nullable().default(null),
  sourcePath: z.string().trim().max(512).default(''),
  /** Consentimento explicito para contato (LGPD). */
  consent: z.literal(true, { message: 'E necessario autorizar o contato.' }),
  /** Campo oculto: se preenchido, trata-se de envio automatizado. */
  honeypot: z.string().max(200).optional(),
});
export type PublicLeadInput = z.infer<typeof publicLeadSchema>;

export const leadQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  interestType: z.enum(LEAD_INTEREST_TYPES).optional(),
  from: z.string().trim().max(10).optional(),
  to: z.string().trim().max(10).optional(),
});
export type LeadQuery = z.infer<typeof leadQuerySchema>;

export const updateLeadSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  assignedToUserId: uuidSchema.nullable().optional(),
});

export const leadNoteSchema = z.object({
  note: z.string().trim().min(1, 'Escreva a observacao.').max(4000),
});
