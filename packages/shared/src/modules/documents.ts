import { z } from 'zod';
import { socialLinksSchema } from '../validators/common.js';
import type { DocumentModuleKey } from './registry.js';

/**
 * Validacao do conteudo dos modulos de instancia unica.
 *
 * O documento vive em JSONB, que aceita qualquer coisa -- por isso a validacao
 * aqui nao e conveniencia, e a unica barreira entre o painel e um conteudo que
 * o site do cliente nao sabe desenhar.
 *
 * Os campos declarados aqui e os do registro precisam coincidir. Um teste
 * garante isso nos dois sentidos: campo sem validacao passaria lixo adiante;
 * validacao sem campo seria um dado que ninguem consegue editar.
 */

const texto = (max: number) => z.string().trim().max(max).default('');
const imagem = z.string().uuid().nullable().default(null);

export const institucionalDocumentSchema = z.object({
  companyName: z.string().trim().min(1, 'Informe o nome da empresa.').max(160),
  tagline: texto(200),
  shortDescription: texto(600),
  history: texto(5_000),
  mission: texto(1_000),
  vision: texto(1_000),
  values: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  logoImageId: imagem,
  coverImageId: imagem,
  galleryImageIds: z.array(z.string().uuid()).max(24).default([]),
  foundedYear: z.number().int().min(1800).max(2200).nullable().default(null),
});
export type InstitucionalDocument = z.infer<typeof institucionalDocumentSchema>;

export const contatoDocumentSchema = z.object({
  email: z.union([z.literal(''), z.string().trim().email()]).default(''),
  phone: texto(40),
  whatsapp: texto(40),
  whatsappMessage: texto(600),
  addressLine: texto(240),
  city: texto(120),
  state: z.string().trim().max(2).default(''),
  postalCode: texto(12),
  businessHours: texto(400),
  serviceArea: texto(400),
  mapUrl: z.union([z.literal(''), z.string().trim().url()]).default(''),
  social: socialLinksSchema,
});
export type ContatoDocument = z.infer<typeof contatoDocumentSchema>;

export const DOCUMENT_SCHEMAS = {
  institucional: institucionalDocumentSchema,
  contato: contatoDocumentSchema,
} as const satisfies Record<DocumentModuleKey, z.ZodType>;

export function documentSchema(key: DocumentModuleKey) {
  return DOCUMENT_SCHEMAS[key];
}

/** Documento vazio valido, usado ao criar o site. */
export function emptyDocument(key: DocumentModuleKey): Record<string, unknown> {
  // `companyName` e obrigatorio: o chamador preenche com o nome da empresa.
  const base = key === 'institucional' ? { companyName: 'Empresa' } : {};
  return DOCUMENT_SCHEMAS[key].parse(base) as Record<string, unknown>;
}
