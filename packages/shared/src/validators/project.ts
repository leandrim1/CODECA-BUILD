import { z } from 'zod';
import { PROJECT_CATEGORIES, PROJECT_STAGES, PROJECT_STATUSES, PUBLICATION_STATUSES } from '../constants.js';
import { paginationSchema, slugSchema, sortDirectionSchema, uuidSchema } from './common.js';

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .nullable();

export const projectInputSchema = z.object({
  title: z.string().trim().min(3, 'Informe o titulo da obra.').max(160),
  slug: slugSchema.optional(),
  description: z.string().trim().max(10_000).default(''),
  shortDescription: z.string().trim().max(400).default(''),
  category: z.enum(PROJECT_CATEGORIES),
  status: z.enum(PROJECT_STATUSES).default('em_andamento'),
  stage: z.enum(PROJECT_STAGES).default('planejamento'),
  /** Null quando a empresa nao informa o percentual; nunca estimado pelo sistema. */
  progressPercent: z.number().int().min(0).max(100).nullable().default(null),
  city: z.string().trim().max(80).default(''),
  state: z.string().trim().max(2).default(''),
  neighborhood: z.string().trim().max(80).default(''),
  showLocation: z.boolean().default(true),
  startDate: isoDate.default(null),
  expectedCompletionDate: isoDate.default(null),
  completedDate: isoDate.default(null),
  coverImageId: uuidSchema.nullable().default(null),
  galleryImageIds: z.array(uuidSchema).max(60).default([]),
  publicationStatus: z.enum(PUBLICATION_STATUSES).default('draft'),
  featured: z.boolean().default(false),
  seoTitle: z.string().trim().max(120).default(''),
  seoDescription: z.string().trim().max(320).default(''),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const projectUpdateSchema = projectInputSchema.partial();

export const projectQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  category: z.enum(PROJECT_CATEGORIES).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  stage: z.enum(PROJECT_STAGES).optional(),
  publicationStatus: z.enum(PUBLICATION_STATUSES).optional(),
  sortBy: z.enum(['recent', 'title', 'manual']).default('recent'),
  sortDir: sortDirectionSchema,
});
export type ProjectQuery = z.infer<typeof projectQuerySchema>;

/** Registro de evolucao da obra, com fotos opcionais. */
export const projectUpdateEntrySchema = z.object({
  title: z.string().trim().min(3).max(160),
  note: z.string().trim().max(4000).default(''),
  stage: z.enum(PROJECT_STAGES).optional(),
  progressPercent: z.number().int().min(0).max(100).nullable().default(null),
  recordedAt: isoDate.default(null),
  imageIds: z.array(uuidSchema).max(20).default([]),
});
export type ProjectUpdateEntryInput = z.infer<typeof projectUpdateEntrySchema>;
