import { z } from 'zod';
import type { ModuleField } from './types.js';

/**
 * Campos personalizados por site.
 *
 * O caso do pedido: um cliente tem "CRECI", outro tem "Registro
 * profissional", e nenhum precisa da estrutura do outro.
 *
 * A decisao que organiza tudo aqui: o campo personalizado entra na **mesma
 * lista** que o painel ja usa para desenhar o formulario de um modulo,
 * marcado com `custom: true`. Com isso a politica de campos, o formulario de
 * documento (que e montado a partir da lista) e a conferencia de escrita
 * passam a valer para ele sem uma linha de codigo nova.
 *
 * A alternativa era um mecanismo paralelo -- segunda lista, segunda politica,
 * segunda conferencia. Tres lugares para manter em acordo em vez de um.
 */

/**
 * Tipos que um campo personalizado pode ter.
 *
 * Subconjunto de `FIELD_TYPES`, e as ausencias tem motivo:
 *
 * - `image` e `imageList` exigiriam conferir, a cada valor, que o arquivo e da
 *   biblioteca daquela empresa. E possivel, mas e acoplamento com a midia que
 *   o modulo `galerias` ja resolve melhor.
 * - `money` precisa de moeda e da regra de duas casas, que pertencem ao campo
 *   tipado -- um preco personalizado sem essas duas coisas e um numero que
 *   parece dinheiro.
 */
export const CUSTOM_FIELD_TYPES = [
  'text',
  'longText',
  'number',
  'boolean',
  'url',
  'email',
  'phone',
  'date',
  'select',
  'tags',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** Guarda de tipo: o banco guarda `type` como texto. */
export function isCustomFieldType(valor: string): valor is CustomFieldType {
  return (CUSTOM_FIELD_TYPES as readonly string[]).includes(valor);
}

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Texto curto',
  longText: 'Texto longo',
  number: 'Numero',
  boolean: 'Sim ou nao',
  url: 'Endereco de site',
  email: 'E-mail',
  phone: 'Telefone',
  date: 'Data',
  select: 'Escolha entre opcoes',
  tags: 'Lista de palavras',
};

/** Quantos campos personalizados um modulo pode ter num site. */
export const MAX_CUSTOM_FIELDS_PER_MODULE = 20;

/**
 * Chave do campo.
 *
 * Identificador, nao texto livre: ela e chave de JSONB, aparece na resposta da
 * API publica e o site do cliente a usa em codigo. Um espaco ou acento ali
 * viraria `row.customFields['CRECI do corretor']` no projeto dele.
 */
export const customFieldKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Comece com letra e use apenas letras minusculas, numeros e _ (ex.: creci).',
  );

export const customFieldDefinitionSchema = z
  .object({
    fieldKey: customFieldKeySchema,
    label: z.string().trim().min(2).max(80),
    type: z.enum(CUSTOM_FIELD_TYPES),
    required: z.boolean().default(false),
    help: z.string().trim().max(240).default(''),
    options: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    /** `false` quando a CODECA IA preenche e o cliente so consulta. */
    editable: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
  })
  .refine((campo) => campo.type !== 'select' || campo.options.length >= 2, {
    message: 'Um campo de escolha precisa de pelo menos duas opcoes.',
    path: ['options'],
  })
  .refine((campo) => campo.type === 'select' || campo.options.length === 0, {
    message: 'Opcoes valem somente para campo de escolha.',
    path: ['options'],
  })
  /**
   * Obrigatorio e nao editavel juntos impediriam todo cadastro.
   *
   * O cliente nao pode preencher (a gravacao e recusada com 403) e nao pode
   * omitir (o campo e exigido na criacao) -- e nao existe caminho pelo qual a
   * CODECA IA preencha valor de conteudo. O resultado seria um formulario que
   * nunca salva, sem a tela dizer por que.
   */
  .refine((campo) => !(campo.required && !campo.editable), {
    message:
      'Um campo mantido pela CODECA IA nao pode ser obrigatorio: o cliente nao conseguiria cadastrar.',
    path: ['required'],
  });
export type CustomFieldDefinitionInput = z.infer<typeof customFieldDefinitionSchema>;

/** Definicao como ela sai do banco. */
export interface CustomFieldDefinition {
  fieldKey: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  help: string;
  options: string[];
  editable: boolean;
  sortOrder: number;
}

/**
 * A definicao vista como campo de modulo.
 *
 * E a conversao que faz o resto da plataforma funcionar sem saber que o campo
 * e personalizado: ele chega ao painel na mesma forma de um campo do registro.
 */
export function customFieldToModuleField(definicao: CustomFieldDefinition): ModuleField & {
  custom: true;
  options?: string[];
} {
  return {
    key: definicao.fieldKey,
    label: definicao.label,
    type: definicao.type,
    editableByDefault: definicao.editable,
    custom: true,
    ...(definicao.required ? { required: true } : {}),
    ...(definicao.help ? { help: definicao.help } : {}),
    ...(definicao.type === 'select' ? { options: definicao.options } : {}),
  };
}

/**
 * Schema de validacao montado a partir das definicoes do site.
 *
 * Em tempo de execucao, porque as definicoes sao dados. O preco disso e
 * conhecido e esta declarado na arquitetura: o TypeScript nao tipa o conteudo
 * personalizado, e o SDK o entrega como `Record<string, unknown>`.
 *
 * `.strict()` recusa chave que ninguem definiu. Aceitar em silencio guardaria
 * dado que nenhum formulario mostra e nenhum site le -- e, pior, deixaria o
 * JSONB crescer com o que o navegador mandasse.
 */
export function buildCustomFieldsSchema(definicoes: readonly CustomFieldDefinition[]) {
  const forma: Record<string, z.ZodType> = {};
  for (const definicao of definicoes) {
    forma[definicao.fieldKey] = schemaDoTipo(definicao);
  }
  // `ZodObject`, e nao `ZodType`: a gravacao parcial precisa de `.partial()`.
  // Um registro criado antes de o campo existir nao tem a chave, e exigi-la
  // numa edicao qualquer travaria a edicao de tudo o que ja estava cadastrado.
  return z.object(forma).strict();
}

function schemaDoTipo(definicao: CustomFieldDefinition): z.ZodType {
  const base = (() => {
    switch (definicao.type) {
      case 'longText':
        return z.string().trim().max(10_000);
      case 'number':
        return z.number().finite();
      case 'boolean':
        return z.boolean();
      case 'url':
        return z
          .string()
          .trim()
          .max(500)
          .refine((valor) => valor === '' || /^https:\/\//.test(valor), {
            message: 'Use um endereco comecando com https://.',
          });
      case 'email':
        return z
          .string()
          .trim()
          .toLowerCase()
          .max(254)
          .refine((valor) => valor === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor), {
            message: 'Informe um e-mail valido.',
          });
      case 'phone':
        return z.string().trim().max(40);
      case 'date':
        return z
          .string()
          .trim()
          .refine((valor) => valor === '' || /^\d{4}-\d{2}-\d{2}$/.test(valor), {
            message: 'Use o formato AAAA-MM-DD.',
          });
      case 'select':
        // Fora da lista nao entra: a opcao foi definida por quem configurou o
        // site, e aceitar outra tornaria a definicao decorativa.
        return z.enum(definicao.options as [string, ...string[]]);
      case 'tags':
        return z.array(z.string().trim().min(1).max(80)).max(50);
      case 'text':
      default:
        return z.string().trim().max(500);
    }
  })();

  if (definicao.required) {
    // Obrigatorio significa preenchido, nao apenas presente: texto vazio
    // passaria por `z.string()` e deixaria o campo obrigatorio em branco.
    if (definicao.type === 'text' || definicao.type === 'longText') {
      return (base as z.ZodString).min(1, `${definicao.label} e obrigatorio.`);
    }
    if (definicao.type === 'tags') {
      return (base as z.ZodArray<z.ZodString>).min(1, `${definicao.label} e obrigatorio.`);
    }
    return base;
  }

  return base.optional();
}

/** Valores vazios de cada tipo, para um registro novo nascer preenchivel. */
export function emptyCustomFields(
  definicoes: readonly CustomFieldDefinition[],
): Record<string, unknown> {
  const valores: Record<string, unknown> = {};
  for (const definicao of definicoes) {
    valores[definicao.fieldKey] = vazioDoTipo(definicao);
  }
  return valores;
}

function vazioDoTipo(definicao: CustomFieldDefinition): unknown {
  switch (definicao.type) {
    case 'boolean':
      return false;
    case 'number':
      return null;
    case 'tags':
      return [];
    case 'select':
      return definicao.options[0] ?? '';
    default:
      return '';
  }
}
