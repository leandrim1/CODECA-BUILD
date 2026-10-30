import { z } from 'zod';
import { TENANT_STATUSES } from '../constants.js';
import {
  addressSchema,
  cnpjSchema,
  emailSchema,
  httpsUrlSchema,
  phoneSchema,
  slugSchema,
  socialLinksSchema,
  uuidSchema,
} from './common.js';

export const createTenantSchema = z.object({
  legalName: z.string().trim().min(2, 'Informe a razao social.').max(160),
  displayName: z.string().trim().min(2, 'Informe o nome de exibicao.').max(160),
  slug: slugSchema.optional(),
  planCode: z.string().trim().max(40).optional(),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  displayName: z.string().trim().min(2).max(160),
  taxId: cnpjSchema.default(''),
  description: z.string().trim().max(2000).default(''),
  foundedYear: z.number().int().min(1800).max(2100).nullable().default(null),
  creaNumber: z.string().trim().max(40).default(''),
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const updateTenantContactSchema = z.object({
  email: z.union([emailSchema, z.literal('')]).default(''),
  phone: phoneSchema.default(''),
  whatsapp: phoneSchema.default(''),
  whatsappDefaultMessage: z.string().trim().max(400).default(''),
  address: addressSchema.prefault({}),
  serviceArea: z.string().trim().max(240).default(''),
  businessHours: z.string().trim().max(240).default(''),
  social: socialLinksSchema,
});
export type UpdateTenantContactInput = z.infer<typeof updateTenantContactSchema>;

export const updateSiteSectionsSchema = z.object({
  /** Secoes do site publico que a empresa pode habilitar ou desabilitar. */
  showProperties: z.boolean().default(true),
  showProjects: z.boolean().default(true),
  showServices: z.boolean().default(true),
  showGallery: z.boolean().default(true),
  showTestimonials: z.boolean().default(true),
  showTeam: z.boolean().default(true),
  showFaq: z.boolean().default(true),
  floatingWhatsApp: z.boolean().default(true),
  privacyPolicyUrl: httpsUrlSchema.default(''),
  privacyPolicyText: z.string().trim().max(20000).default(''),
});
export type UpdateSiteSectionsInput = z.infer<typeof updateSiteSectionsSchema>;

export const tenantStatusSchema = z.enum(TENANT_STATUSES);

export const tenantIdParamSchema = z.object({ tenantId: uuidSchema });
