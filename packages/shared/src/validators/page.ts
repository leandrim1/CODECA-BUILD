import { z } from 'zod';
import { strictPageLayoutSchema } from '../blocks/layout.js';
import { PUBLICATION_STATUSES } from '../constants.js';
import { httpsUrlSchema, slugSchema, uuidSchema } from './common.js';
import { safeHrefSchema } from '../blocks/primitives.js';

export const pageInputSchema = z.object({
  title: z.string().trim().min(1, 'Informe o titulo da pagina.').max(160),
  slug: slugSchema,
  isHome: z.boolean().default(false),
  seoTitle: z.string().trim().max(120).default(''),
  seoDescription: z.string().trim().max(320).default(''),
  seoImageUrl: httpsUrlSchema.default(''),
  canonicalUrl: httpsUrlSchema.default(''),
  robots: z.enum(['index', 'noindex']).default('index'),
  showInNavigation: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type PageInput = z.infer<typeof pageInputSchema>;

export const pageUpdateSchema = pageInputSchema.partial();

/** Salva o rascunho da pagina (conteudo em edicao). */
export const saveDraftSchema = z.object({
  layout: strictPageLayoutSchema,
  /** Marca de concorrencia: a versao do rascunho que o editor carregou. */
  baseRevision: z.number().int().min(0).optional(),
});
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export const publishPageSchema = z.object({
  note: z.string().trim().max(240).default(''),
});

export const restoreVersionSchema = z.object({
  versionId: uuidSchema,
  /** Quando true, a versao restaurada tambem e publicada. */
  publish: z.boolean().default(false),
});

export const navigationMenuSchema = z.object({
  key: z.string().trim().min(1).max(60).default('principal'),
  label: z.string().trim().min(1).max(80),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        href: safeHrefSchema,
        newTab: z.boolean().default(false),
        children: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(80),
              href: safeHrefSchema,
              newTab: z.boolean().default(false),
            }),
          )
          .max(10)
          .default([]),
      }),
    )
    .max(16)
    .default([]),
});
export type NavigationMenuInput = z.infer<typeof navigationMenuSchema>;

export const redirectSchema = z.object({
  fromPath: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .refine((v) => v.startsWith('/') && !v.startsWith('//'), 'O caminho deve comecar com /.'),
  toPath: safeHrefSchema.refine((v) => v.length > 0, 'Informe o destino.'),
  statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
  enabled: z.boolean().default(true),
});
export type RedirectInput = z.infer<typeof redirectSchema>;

export const pageStatusSchema = z.enum(PUBLICATION_STATUSES);
