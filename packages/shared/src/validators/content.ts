import { z } from 'zod';
import { PUBLICATION_STATUSES, SAFE_ICONS, SOCIAL_NETWORKS } from '../constants.js';
import { httpsUrlSchema, paginationSchema, slugSchema, uuidSchema } from './common.js';

export const serviceInputSchema = z.object({
  title: z.string().trim().min(3, 'Informe o nome do servico.').max(120),
  slug: slugSchema.optional(),
  summary: z.string().trim().max(400).default(''),
  description: z.string().trim().max(10_000).default(''),
  icon: z.enum(SAFE_ICONS).default('wrench'),
  imageId: uuidSchema.nullable().default(null),
  highlights: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  publicationStatus: z.enum(PUBLICATION_STATUSES).default('published'),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  seoTitle: z.string().trim().max(120).default(''),
  seoDescription: z.string().trim().max(320).default(''),
});
export type ServiceInput = z.infer<typeof serviceInputSchema>;
export const serviceUpdateSchema = serviceInputSchema.partial();

/**
 * Depoimentos: a empresa declara expressamente que possui autorizacao do autor.
 * Sem esse consentimento o depoimento nao pode ser publicado.
 */
export const testimonialInputSchema = z
  .object({
    authorName: z.string().trim().min(2, 'Informe o nome do autor.').max(120),
    authorRole: z.string().trim().max(120).default(''),
    content: z.string().trim().min(10, 'O depoimento esta muito curto.').max(2000),
    rating: z.number().int().min(1).max(5).nullable().default(null),
    photoId: uuidSchema.nullable().default(null),
    relatedProjectId: uuidSchema.nullable().default(null),
    /** Declaracao de que o autor autorizou a publicacao. */
    authorizationConfirmed: z.boolean().default(false),
    authorizationNote: z.string().trim().max(400).default(''),
    publicationStatus: z.enum(PUBLICATION_STATUSES).default('draft'),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .refine(
    (value) => value.publicationStatus !== 'published' || value.authorizationConfirmed,
    {
      message: 'Confirme a autorizacao do autor antes de publicar o depoimento.',
      path: ['authorizationConfirmed'],
    },
  );
export type TestimonialInput = z.infer<typeof testimonialInputSchema>;

export const teamMemberInputSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome.').max(120),
  role: z.string().trim().max(120).default(''),
  bio: z.string().trim().max(2000).default(''),
  photoId: uuidSchema.nullable().default(null),
  email: z.string().trim().max(254).default(''),
  social: z.partialRecord(z.enum(SOCIAL_NETWORKS), httpsUrlSchema).prefault({}),
  publicationStatus: z.enum(PUBLICATION_STATUSES).default('published'),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type TeamMemberInput = z.infer<typeof teamMemberInputSchema>;

export const faqInputSchema = z.object({
  question: z.string().trim().min(5, 'Informe a pergunta.').max(240),
  answer: z.string().trim().min(5, 'Informe a resposta.').max(4000),
  category: z.string().trim().max(60).default(''),
  publicationStatus: z.enum(PUBLICATION_STATUSES).default('published'),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type FaqInput = z.infer<typeof faqInputSchema>;

export const contentQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  publicationStatus: z.enum(PUBLICATION_STATUSES).optional(),
});

export const reorderSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(500),
});
