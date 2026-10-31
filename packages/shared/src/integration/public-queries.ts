import { z } from 'zod';
import { PROJECT_CATEGORIES, PROJECT_STATUSES, PROPERTY_PURPOSES, PROPERTY_TYPES } from '../constants.js';

/**
 * Filtros aceitos pela API publica.
 *
 * Tudo aqui chega como texto na query string, por isso `coerce`: um numero
 * declarado como `z.number()` recusaria `"3"` e o site do cliente receberia um
 * 422 sem motivo aparente -- erro que ja aconteceu neste projeto.
 */

export const publicPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  /** Somente com chave secreta: inclui rascunhos. */
  preview: z.coerce.boolean().default(false),
});

export const publicPropertyQuerySchema = publicPaginationSchema.extend({
  purpose: z.enum(PROPERTY_PURPOSES).optional(),
  type: z.enum(PROPERTY_TYPES).optional(),
  city: z.string().trim().max(80).optional(),
  neighborhood: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  featured: z.coerce.boolean().optional(),
  search: z.string().trim().max(120).optional(),
});
export type PublicPropertyQuery = z.infer<typeof publicPropertyQuerySchema>;

export const publicProjectQuerySchema = publicPaginationSchema.extend({
  status: z.enum(PROJECT_STATUSES).optional(),
  category: z.enum(PROJECT_CATEGORIES).optional(),
  city: z.string().trim().max(80).optional(),
  featured: z.coerce.boolean().optional(),
  search: z.string().trim().max(120).optional(),
});
export type PublicProjectQuery = z.infer<typeof publicProjectQuerySchema>;

export const publicListQuerySchema = publicPaginationSchema;
export type PublicListQuery = z.infer<typeof publicListQuerySchema>;

export const publicProductQuerySchema = publicPaginationSchema.extend({
  /** Slug da categoria, nao o id: o site monta a URL a partir do menu. */
  category: z.string().trim().max(120).optional(),
  /**
   * `true` esconde o que esta esgotado.
   *
   * Por padrao o esgotado vem junto, com `isAvailable: false`: riscar,
   * esmaecer ou esconder e decisao de design do projeto, nao da plataforma.
   */
  availableOnly: z.coerce.boolean().optional(),
  search: z.string().trim().max(120).optional(),
});
export type PublicProductQuery = z.infer<typeof publicProductQuerySchema>;
