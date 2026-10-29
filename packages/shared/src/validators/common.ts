import { z } from 'zod';
import { BRAZIL_STATES, SOCIAL_NETWORKS } from '../constants.js';
import { SLUG_PATTERN } from '../slug.js';

/** Schemas basicos reutilizados por todos os recursos. */

const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const uuidSchema = z.string().trim().regex(UUID, 'Identificador invalido.');

const EMAIL = /^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(254)
  .regex(EMAIL, 'Informe um e-mail valido.');

export const passwordSchema = z
  .string()
  .min(10, 'A senha deve ter ao menos 10 caracteres.')
  .max(200, 'A senha deve ter no maximo 200 caracteres.')
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), 'Use ao menos uma letra e um numero.');

export const personNameSchema = z.string().trim().min(2, 'Informe o nome completo.').max(120);

export const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .refine((v) => v === '' || v.replace(/\D+/g, '').length >= 10, 'Informe um telefone com DDD.');

export const requiredPhoneSchema = z
  .string()
  .trim()
  .min(1, 'Informe um telefone.')
  .max(32)
  .refine((v) => v.replace(/\D+/g, '').length >= 10, 'Informe um telefone com DDD.');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(96)
  .regex(SLUG_PATTERN, 'Use apenas letras minusculas, numeros e hifens.');

export const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    if (v === '') return true;
    try {
      const url = new URL(v);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Informe uma URL iniciando com https://');

export const cnpjSchema = z
  .string()
  .trim()
  .max(18)
  .refine((v) => v === '' || v.replace(/\D+/g, '').length === 14, 'CNPJ deve ter 14 digitos.');

export const addressSchema = z.object({
  street: z.string().trim().max(160).default(''),
  number: z.string().trim().max(20).default(''),
  complement: z.string().trim().max(80).default(''),
  neighborhood: z.string().trim().max(80).default(''),
  city: z.string().trim().max(80).default(''),
  state: z.union([z.enum(BRAZIL_STATES), z.literal('')]).default(''),
  postalCode: z.string().trim().max(12).default(''),
  /** Controla se o endereco completo aparece no site publico. */
  showFullAddress: z.boolean().default(true),
});
export type AddressInput = z.infer<typeof addressSchema>;

export const socialLinksSchema = z
  .partialRecord(z.enum(SOCIAL_NETWORKS), httpsUrlSchema)
  .prefault({});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, pagination: Pagination): Paginated<T> {
  return {
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
  };
}

export const sortDirectionSchema = z.enum(['asc', 'desc']).default('desc');

/** Converte "" em null para campos opcionais em formularios. */
export function emptyToNull<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === '' ? null : value), schema.nullable());
}
