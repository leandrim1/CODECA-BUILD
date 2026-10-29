import { z } from 'zod';
import {
  CURRENCIES,
  PROPERTY_COMMERCIAL_STATUSES,
  PROPERTY_PURPOSES,
  PROPERTY_TYPES,
  PUBLICATION_STATUSES,
} from '../constants.js';
import { addressSchema, paginationSchema, slugSchema, sortDirectionSchema, uuidSchema } from './common.js';

const money = z
  .number()
  .min(0, 'O valor nao pode ser negativo.')
  .max(1_000_000_000, 'Valor acima do limite permitido.')
  .nullable();

const area = z.number().min(0).max(1_000_000).nullable();
const count = z.number().int().min(0).max(99).nullable();

export const propertyFeatureSchema = z.string().trim().min(1).max(60);

export const propertyInputSchema = z.object({
  title: z.string().trim().min(3, 'Informe o titulo do imovel.').max(160),
  slug: slugSchema.optional(),
  reference: z.string().trim().max(40).default(''),
  description: z.string().trim().max(10_000).default(''),
  shortDescription: z.string().trim().max(400).default(''),
  type: z.enum(PROPERTY_TYPES),
  purpose: z.enum(PROPERTY_PURPOSES),
  price: money.default(null),
  priceOnRequest: z.boolean().default(false),
  condoFee: money.default(null),
  iptu: money.default(null),
  currency: z.enum(CURRENCIES).default('BRL'),
  address: addressSchema.prefault({}),
  builtAreaM2: area.default(null),
  landAreaM2: area.default(null),
  bedrooms: count.default(null),
  suites: count.default(null),
  bathrooms: count.default(null),
  parkingSpots: count.default(null),
  floor: count.default(null),
  features: z.array(propertyFeatureSchema).max(40).default([]),
  coverImageId: uuidSchema.nullable().default(null),
  galleryImageIds: z.array(uuidSchema).max(40).default([]),
  publicationStatus: z.enum(PUBLICATION_STATUSES).default('draft'),
  commercialStatus: z.enum(PROPERTY_COMMERCIAL_STATUSES).default('disponivel'),
  featured: z.boolean().default(false),
  deliveryDate: z.string().trim().max(10).nullable().default(null),
  videoUrl: z.string().trim().max(2048).default(''),
  seoTitle: z.string().trim().max(120).default(''),
  seoDescription: z.string().trim().max(320).default(''),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type PropertyInput = z.infer<typeof propertyInputSchema>;

export const propertyUpdateSchema = propertyInputSchema.partial();
export type PropertyUpdateInput = z.infer<typeof propertyUpdateSchema>;

export const propertyQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  type: z.enum(PROPERTY_TYPES).optional(),
  purpose: z.enum(PROPERTY_PURPOSES).optional(),
  publicationStatus: z.enum(PUBLICATION_STATUSES).optional(),
  commercialStatus: z.enum(PROPERTY_COMMERCIAL_STATUSES).optional(),
  city: z.string().trim().max(80).optional(),
  neighborhood: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  bedrooms: z.coerce.number().int().min(0).max(99).optional(),
  featured: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  sortBy: z.enum(['recent', 'price', 'title', 'manual']).default('recent'),
  sortDir: sortDirectionSchema,
});
export type PropertyQuery = z.infer<typeof propertyQuerySchema>;

export const propertyImagesSchema = z.object({
  coverImageId: uuidSchema.nullable(),
  galleryImageIds: z.array(uuidSchema).max(40),
});

export function formatPrice(value: number | null, currency: string, priceOnRequest: boolean): string {
  if (priceOnRequest || value === null) return 'Valor sob consulta';
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString('pt-BR')}`;
  }
}
