import { z } from 'zod';
import { SAFE_ICONS } from '../constants.js';
import { MODULE_KEYS, type ModuleKey } from './registry.js';
import { customFieldKeySchema, type CustomFieldDefinition } from './custom-fields.js';
import type { EffectiveField, ModuleKind } from './index.js';

/**
 * Modulos cuja **existencia** e dado, nao codigo.
 *
 * A etapa F deu campos novos a um modulo que ja existia. Esta da um tipo de
 * conteudo inteiro: "Cardapio" num restaurante, "Turmas" numa escola,
 * "Processos" num escritorio -- coisas que nenhum modulo do registro cobre e
 * que nao justificam entrar no registro, porque valem para um cliente so.
 *
 * ## A decisao que organiza o resto: duas listas, nao uma alargada
 *
 * `SiteModulesPayload.modules` continua tipada por `ModuleKey`. Os modulos
 * personalizados vao em `customModules`, separados.
 *
 * A alternativa era alargar `key` para `string` e marcar `custom: true`. Ela
 * parece mais simples e cobra caro: `ModuleKey | string` colapsa em `string`,
 * e a partir dai `MODULE_REGISTRY[chave]` deixa de ser conferido, um literal
 * com erro de digitacao passa a compilar, e todo consumidor tipado precisa
 * lembrar de checar a marca. A tipagem dos doze modulos do registro e a razao
 * declarada de o registro viver em codigo (ver `types.ts`); troca-la pela
 * conveniencia de uma lista a mais seria desfazer a escolha da etapa 2.
 *
 * O preco desta escolha tambem e real e esta aqui: quem monta menu ou contagem
 * junta as duas listas, em dois lugares. E explicito, e e o que se quer.
 *
 * ## O que *nao* e
 *
 * Nao e um construtor de sites. Quem cria um modulo personalizado e a CODECA
 * IA, no painel mestre, ao desenvolver aquele projeto; o cliente so edita o
 * conteudo. A plataforma nao ganhou editor visual nem modelo pronto.
 */

/** Quantos modulos personalizados um site pode ter. */
export const MAX_CUSTOM_MODULES_PER_SITE = 10;

/**
 * Chave do modulo.
 *
 * Mesmo formato de identificador da chave de campo: ela aparece na rota
 * publica, no menu do painel e no codigo do site do cliente.
 */
export const customModuleKeySchema = customFieldKeySchema;

/**
 * Chave que o registro ja usa e recusada.
 *
 * Nao e por causa da rota -- a rota publica dos personalizados e
 * `/api/v1/custom/...` justamente para nunca colidir. E por causa do painel:
 * duas entradas com a mesma chave no menu, uma lendo tabela tipada e a outra
 * `custom_records`, nao teriam como ser distinguidas pelo cliente.
 */
export function isReservedModuleKey(key: string): key is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(key);
}

export const customModuleInputSchema = z.object({
  key: customModuleKeySchema,
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(240).default(''),
  /**
   * `document` e uma colecao com exatamente um registro.
   *
   * Nao ha mecanismo separado: o registro de um documento tem `slug` vazio, e
   * o mesmo indice unico que mantem os slugs distintos mantem o documento
   * unico. Um segundo mecanismo seria mais codigo para a mesma garantia.
   */
  kind: z.enum(['collection', 'document']),
  /**
   * Icone do menu, do conjunto que o painel sabe desenhar.
   *
   * Lista fechada, e nao texto livre: o painel desenha a partir de um mapa de
   * nome para componente, e um nome fora dele nao renderiza nada. Guardar o
   * que nao se sabe desenhar seria uma configuracao sem efeito visivel.
   */
  icon: z.union([z.enum(SAFE_ICONS), z.literal('')]).default(''),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  enabled: z.boolean().default(true),
});
export type CustomModuleInput = z.infer<typeof customModuleInputSchema>;

/** Alteracao: a chave nao muda, porque o site do cliente a usa em codigo. */
export const customModuleUpdateSchema = customModuleInputSchema.omit({ key: true }).partial();

/** Definicao como ela sai do banco, com os campos daquele modulo. */
export interface CustomModuleDefinition {
  key: string;
  name: string;
  description: string;
  kind: ModuleKind;
  icon: string;
  sortOrder: number;
  enabled: boolean;
  fields: CustomFieldDefinition[];
}

/**
 * O modulo personalizado como o painel o recebe.
 *
 * Espelha `SiteModuleView` de proposito -- `fields` com a politica do site
 * aplicada, do mesmo tipo -- para a tela que desenha um formulario nao precisar
 * saber de qual das duas listas o modulo veio.
 */
export interface CustomModuleView {
  key: string;
  name: string;
  description: string;
  kind: ModuleKind;
  icon: string;
  sortOrder: number;
  enabled: boolean;
  fields: EffectiveField[];
}

/** Estados de publicacao de um registro, iguais aos das colecoes tipadas. */
export const CUSTOM_RECORD_STATUSES = ['draft', 'published'] as const;
export type CustomRecordStatus = (typeof CUSTOM_RECORD_STATUSES)[number];

/**
 * Campos de um registro que **nao** vem das definicoes.
 *
 * Todo modulo personalizado os tem, porque sao o que a plataforma precisa para
 * listar, ordenar, publicar e entregar: sem titulo a lista do painel nao tem o
 * que mostrar, e sem slug a rota publica de um registro so nao existe.
 */
export const customRecordInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(140)
    .regex(/^[a-z0-9-]*$/, 'Use apenas letras minusculas, numeros e hifen.')
    .optional(),
  publicationStatus: z.enum(CUSTOM_RECORD_STATUSES).default('draft'),
  featured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
});
export type CustomRecordInput = z.infer<typeof customRecordInputSchema>;

export const customRecordUpdateSchema = customRecordInputSchema.partial();

/** O registro de um `document`: sem slug, sem destaque, sem ordem. */
export const customDocumentInputSchema = customRecordInputSchema.pick({
  title: true,
  publicationStatus: true,
});
