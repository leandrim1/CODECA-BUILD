import { z } from 'zod';
import { SEGMENT_CODE_MAX_LENGTH } from '../constants.js';
import { MODULE_KEYS } from '../modules/registry.js';
import { SLUG_PATTERN } from '../slug.js';

/**
 * Cadastro de segmentos pelo painel mestre.
 *
 * Um segmento e um conjunto padrao de modulos, aplicado quando um site e
 * criado. Como a plataforma atende qualquer ramo, o codigo e texto livre --
 * mas no formato de slug, porque ele aparece na resposta da API publica
 * (`site.segment`) e o site do cliente costuma usa-lo em comparacao e em
 * nome de classe.
 */

export const segmentCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(SEGMENT_CODE_MAX_LENGTH)
  .regex(SLUG_PATTERN, 'Use apenas letras minusculas, numeros e hifen (ex.: clinica-odontologica).');

/**
 * Modulos padrao do segmento.
 *
 * Validados contra o registro na escrita, e nao apenas na leitura: um modulo
 * inexistente seria descartado em silencio no cadastro do site, e o projeto
 * nasceria sem uma tela que alguem achou que tinha configurado.
 */
const defaultModulesSchema = z
  .array(z.enum(MODULE_KEYS))
  .max(MODULE_KEYS.length)
  .default([])
  .transform((lista) => [...new Set(lista)]);

export const createSegmentSchema = z.object({
  code: segmentCodeSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(480).default(''),
  defaultModules: defaultModulesSchema,
  isActive: z.boolean().default(true),
  /** Marca este como o segmento de empresas recem-cadastradas. */
  isDefault: z.boolean().default(false),
});
export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;

/**
 * Edicao de um segmento.
 *
 * O codigo nao esta aqui: ele ja viajou para o site do cliente na resposta da
 * API publica, e troca-lo quebraria silenciosamente um site que compare por
 * ele. Para mudar o codigo, cadastre outro segmento.
 */
export const updateSegmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(480).default(''),
  defaultModules: defaultModulesSchema,
  isActive: z.boolean(),
  isDefault: z.boolean(),
});
export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema>;
