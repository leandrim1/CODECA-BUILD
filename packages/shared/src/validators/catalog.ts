import { z } from 'zod';
import { CURRENCIES, PUBLICATION_STATUSES } from '../constants.js';
import { paginationSchema, slugSchema, uuidSchema } from './common.js';

/**
 * Produtos, categorias e galerias.
 *
 * Tres modulos que abrem varejo, restaurante e clinica. As decisoes de
 * modelagem estao no schema do banco; aqui ficam as de validacao.
 */

/**
 * Preco de exibicao.
 *
 * `null` e valido: produto sem preco publicado, ou com `priceOnRequest`. O
 * limite de duas casas e verificado porque o banco guarda `NUMERIC(14,2)` --
 * mandar `19.999` gravaria `20.00` em silencio, e o cliente veria outro valor
 * no site.
 */
const money = z
  .number()
  .min(0, 'O valor nao pode ser negativo.')
  .max(1_000_000_000, 'Valor acima do limite permitido.')
  .refine((valor) => Number.isInteger(Math.round(valor * 100)) && Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6, {
    message: 'Use no maximo duas casas decimais.',
  })
  .nullable();

/**
 * Modulos que agrupam conteudo por categoria.
 *
 * Lista curta de proposito: hoje so produtos consome categoria. Imoveis e
 * obras tem enums proprios (`propertyType`, `projectCategory`). Acrescentar um
 * consumidor e uma entrada aqui, nao uma migracao -- a tabela `categories` ja
 * guarda `module_key`.
 */
export const CATEGORIZED_MODULE_KEYS = ['produtos'] as const;
export type CategorizedModuleKey = (typeof CATEGORIZED_MODULE_KEYS)[number];

export const categoryInputSchema = z.object({
  moduleKey: z.enum(CATEGORIZED_MODULE_KEYS).default('produtos'),
  name: z.string().trim().min(2, 'Informe o nome da categoria.').max(80),
  slug: slugSchema.optional(),
  description: z.string().trim().max(400).default(''),
  publicationStatus: z.enum(PUBLICATION_STATUSES).default('published'),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export const categoryUpdateSchema = categoryInputSchema.partial();

export const productInputSchema = z.object({
  title: z.string().trim().min(2, 'Informe o nome do produto.').max(160),
  slug: slugSchema.optional(),
  summary: z.string().trim().max(400).default(''),
  description: z.string().trim().max(10_000).default(''),
  code: z.string().trim().max(60).default(''),
  categoryId: uuidSchema.nullable().default(null),
  price: money.default(null),
  priceOnRequest: z.boolean().default(false),
  currency: z.enum(CURRENCIES).default('BRL'),
  unit: z.string().trim().max(20).default(''),
  /** Fora de estoque ou fora do dia, sem despublicar o produto. */
  isAvailable: z.boolean().default(true),
  coverImageId: uuidSchema.nullable().default(null),
  galleryImageIds: z.array(uuidSchema).max(40).default([]),
  publicationStatus: z.enum(PUBLICATION_STATUSES).default('draft'),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  seoTitle: z.string().trim().max(120).default(''),
  seoDescription: z.string().trim().max(320).default(''),
});
export type ProductInput = z.infer<typeof productInputSchema>;
export const productUpdateSchema = productInputSchema.partial();

export const galleryInputSchema = z.object({
  title: z.string().trim().min(2, 'Informe o nome da galeria.').max(120),
  slug: slugSchema.optional(),
  description: z.string().trim().max(400).default(''),
  imageIds: z.array(uuidSchema).max(200).default([]),
  publicationStatus: z.enum(PUBLICATION_STATUSES).default('published'),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type GalleryInput = z.infer<typeof galleryInputSchema>;
export const galleryUpdateSchema = galleryInputSchema.partial();

export const productQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  publicationStatus: z.enum(PUBLICATION_STATUSES).optional(),
  categoryId: uuidSchema.optional(),
  /** `false` inclui tambem o que esta fora de estoque. */
  availableOnly: z.coerce.boolean().optional(),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;
