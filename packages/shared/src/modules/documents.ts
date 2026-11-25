import { z } from 'zod';
import { socialLinksSchema } from '../validators/common.js';
import { BRAZIL_STATES } from '../constants.js';
import {
  ANO_MINIMO,
  CEP_INVALIDO,
  COORDENADA_INVALIDA,
  WHATSAPP_INVALIDO,
  anoAtual,
  mensagemDeAnoInvalido,
  cepValido,
  digitosDeCep,
  latitudeValida,
  longitudeValida,
  normalizarWhatsApp,
  whatsappValido,
} from '../contato.js';
import { horariosSchema } from '../horarios.js';
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
  /**
   * Ano de fundacao: quatro digitos, de 1800 ao ano de HOJE.
   *
   * O teto era 2200, o que aceitava empresa fundada daqui a dois seculos. E
   * `coerce` porque o campo da tela e de texto (sem as setinhas do
   * `type=number`) e envia `"1998"`.
   */
  foundedYear: z.coerce
    .number()
    .int()
    .nullable()
    .default(null)
    // `error` como funcao, e nao texto fixo: o teto e o ano de HOJE, e uma
    // mensagem montada na importacao do modulo envelheceria na virada do ano.
    .refine((v) => v === null || (v >= ANO_MINIMO && v <= anoAtual()), {
      error: () => mensagemDeAnoInvalido(),
    }),
});
export type InstitucionalDocument = z.infer<typeof institucionalDocumentSchema>;

export const contatoDocumentSchema = z.object({
  email: z.union([z.literal(''), z.string().trim().email()]).default(''),
  /**
   * Telefone: so os digitos, como no cadastro.
   *
   * Sem `telefoneBrSchema` aqui de proposito -- este campo aceita o telefone
   * de qualquer formato que o site ja tenha gravado, inclusive numero com
   * DDI. Quem aperta a regra e a tela, que normaliza para digitos.
   */
  phone: texto(40),
  /**
   * WhatsApp: link `https://wa.me/<numero>`, e nada mais.
   *
   * `normalizarWhatsApp` roda ANTES da conferencia para que os valores
   * antigos -- este campo guardava telefone -- virem link em vez de travar a
   * tela: o formulario envia o documento inteiro, entao um WhatsApp legado
   * recusado impediria de salvar qualquer outro campo.
   */
  whatsapp: z
    .string()
    .max(200)
    .default('')
    .transform(normalizarWhatsApp)
    .refine(whatsappValido, WHATSAPP_INVALIDO),
  whatsappMessage: texto(600),
  addressLine: texto(240),
  city: texto(120),
  /** Sigla de UF, das 27 que existem. Vazio continua valendo. */
  state: z
    .string()
    .trim()
    .toUpperCase()
    .default('')
    .refine((v) => v === '' || (BRAZIL_STATES as readonly string[]).includes(v), 'Informe uma UF válida.'),
  /** CEP guardado so em digitos; a mascara e assunto da tela. */
  postalCode: z
    .string()
    .max(12)
    .default('')
    .transform(digitosDeCep)
    .refine((v) => v === '' || cepValido(v), CEP_INVALIDO),
  /**
   * Texto legivel do horario, gerado a partir da estrutura.
   *
   * Continua existindo porque e o que o site e o SDK ja liam. Quem o produz e
   * `textoDosHorarios`; a tela nao deixa digitar aqui.
   */
  businessHours: texto(400),
  /** A estrutura por dia. `null` enquanto ninguem preencheu pelo painel. */
  businessHoursSchedule: horariosSchema,
  serviceArea: texto(400),
  mapUrl: z.union([z.literal(''), z.string().trim().url()]).default(''),
  /** Coordenadas do pino no mapa, para o site desenhar o mapa dele. */
  latitude: z
    .number()
    .nullable()
    .default(null)
    .refine((v) => v === null || latitudeValida(v), COORDENADA_INVALIDA),
  longitude: z
    .number()
    .nullable()
    .default(null)
    .refine((v) => v === null || longitudeValida(v), COORDENADA_INVALIDA),
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
