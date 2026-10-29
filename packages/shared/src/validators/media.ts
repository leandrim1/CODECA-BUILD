import { z } from 'zod';
import { paginationSchema, uuidSchema } from './common.js';

/** Tipos aceitos no upload. Qualquer outro mime e rejeitado no servidor. */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/gif',
] as const;

export const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf'] as const;

export const ALLOWED_MIME_TYPES = [...ALLOWED_IMAGE_MIME_TYPES, ...ALLOWED_DOCUMENT_MIME_TYPES] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const EXTENSION_BY_MIME: Record<AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

/** Limite por arquivo. O limite total e definido pelo plano da empresa. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

export const MEDIA_KINDS = ['image', 'document'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export function mediaKindFor(mimeType: string): MediaKind {
  return mimeType.startsWith('image/') ? 'image' : 'document';
}

export const uploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(3).max(120).refine(isAllowedMimeType, 'Tipo de arquivo nao permitido.'),
  sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES, 'Arquivo acima do limite de 4 MB.'),
  alt: z.string().trim().max(240).default(''),
  tag: z.string().trim().max(60).default(''),
});
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

export const updateMediaSchema = z.object({
  alt: z.string().trim().max(240).optional(),
  title: z.string().trim().max(160).optional(),
  tag: z.string().trim().max(60).optional(),
});

export const mediaQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  kind: z.enum(MEDIA_KINDS).optional(),
  tag: z.string().trim().max(60).optional(),
  /** Quando true, retorna somente arquivos sem referencia ativa. */
  unusedOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
export type MediaQuery = z.infer<typeof mediaQuerySchema>;

export const mediaIdParamSchema = z.object({ mediaId: uuidSchema });

/** Nome de arquivo seguro para compor o caminho no Blob. */
export function safeFileName(input: string, mimeType: AllowedMimeType): string {
  const base = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const extension = EXTENSION_BY_MIME[mimeType];
  return `${base || 'arquivo'}.${extension}`;
}
