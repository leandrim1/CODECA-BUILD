import { AppError, buildCustomFieldsSchema, isFieldEditable, policyKey } from '@codeca/shared';
import type {
  CustomFieldDefinition,
  FieldPolicyOverrides,
  ModuleKey,
} from '@codeca/shared';

/**
 * Leitura e gravacao dos valores dos campos personalizados.
 *
 * Os valores chegam num envelope `customFields` no corpo, e nao espalhados
 * entre os campos tipados: isso mantem as duas validacoes separadas -- o
 * schema estatico cuida do que o registro declara, e o schema montado em
 * tempo de execucao cuida do que foi definido para este site.
 */

/**
 * Nome do envelope no corpo da requisicao.
 *
 * A conferencia de politica dos campos tipados precisa ignora-lo: ele nao e um
 * campo, e `isFieldEditable` nega o que nao esta no registro -- entao sem esta
 * excecao toda gravacao com campo personalizado levaria 403.
 */
export const CUSTOM_FIELDS_ENVELOPE = 'customFields';

export interface ParseCustomFieldsInput {
  moduleKey: ModuleKey;
  definicoes: readonly CustomFieldDefinition[];
  /** Corpo como chegou, para distinguir ausente de vazio. */
  raw: Record<string, unknown>;
  overrides: FieldPolicyOverrides;
  /**
   * `true` numa edicao: valida somente o que foi enviado.
   *
   * Numa criacao o conjunto inteiro vale, entao campo obrigatorio e exigido.
   */
  partial: boolean;
}

/**
 * Valida o envelope e devolve os valores, ou `undefined` quando nao veio.
 *
 * `undefined` e diferente de `{}`: ausente significa "nao mexa", e e o que
 * permite a edicao parcial preservar valor de campo que a tela nao mostrou --
 * inclusive de um campo cuja definicao foi removida depois.
 */
export function parseCustomFields(input: ParseCustomFieldsInput): Record<string, unknown> | undefined {
  const bruto = input.raw[CUSTOM_FIELDS_ENVELOPE];
  if (bruto === undefined) return undefined;

  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw AppError.badRequest('`customFields` precisa ser um objeto.');
  }

  const enviados = bruto as Record<string, unknown>;
  const definidos = new Map(input.definicoes.map((d) => [d.fieldKey, d]));

  /**
   * Chave que ninguem definiu e recusada **por nome**.
   *
   * Aceitar em silencio guardaria dado que nenhum formulario mostra e nenhum
   * site le, e deixaria o JSONB crescer com o que o navegador mandasse. Dizer
   * qual chave sobrou e o que faz a recusa ser corrigivel.
   */
  const desconhecidas = Object.keys(enviados).filter((chave) => !definidos.has(chave));
  if (desconhecidas.length > 0) {
    throw AppError.badRequest(
      `Estes campos nao estao definidos para este site: ${desconhecidas.join(', ')}.`,
    );
  }

  /**
   * Campo que a CODECA IA mantem.
   *
   * A politica por site vale tambem para campo personalizado -- `policyKey`
   * nao distingue -- e a definicao tem o proprio `editable`. Os dois sao
   * conferidos aqui, no servidor, porque esconder na tela nao e proteger.
   */
  const travados = Object.keys(enviados).filter((chave) => {
    const definicao = definidos.get(chave)!;
    const excecao = input.overrides[policyKey(input.moduleKey, chave)];
    return !(excecao ?? definicao.editable);
  });
  if (travados.length > 0) {
    const rotulos = travados.map((chave) => definidos.get(chave)!.label);
    throw AppError.forbidden(
      `Estes campos sao mantidos pela CODECA IA e nao podem ser definidos aqui: ${rotulos.join(', ')}.`,
    );
  }

  const schema = buildCustomFieldsSchema(input.definicoes);
  const resultado = (input.partial ? schema.partial() : schema).safeParse(enviados);
  if (!resultado.success) {
    throw AppError.validation('Alguns campos precisam ser corrigidos.', {
      fields: fieldErrors(resultado.error.issues),
    });
  }

  return resultado.data as Record<string, unknown>;
}

/**
 * Mescla os valores enviados sobre os que estao gravados.
 *
 * Mesclar, e nao substituir: uma edicao que nao mostrou um campo nao deve
 * apaga-lo. Vale sobretudo para o valor de um campo cuja definicao foi
 * removida -- ele fica invisivel, mas nao e destruido, e volta se o campo for
 * redefinido com a mesma chave.
 */
export function mergeCustomFields(
  atual: Record<string, unknown> | null | undefined,
  enviados: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...(atual ?? {}), ...(enviados ?? {}) };
}

/** `fieldErrors` no formato que o painel ja sabe exibir, prefixado. */
function fieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]) {
  const erros: Record<string, string> = {};
  for (const issue of issues) {
    const chave = issue.path.map(String).join('.') || CUSTOM_FIELDS_ENVELOPE;
    erros[`${CUSTOM_FIELDS_ENVELOPE}.${chave}`] ??= issue.message;
  }
  return erros;
}

/** Campo tipado travado, agora ignorando o envelope dos personalizados. */
export function blockedTypedFields(
  moduleKey: ModuleKey,
  chaves: readonly string[],
  overrides: FieldPolicyOverrides,
): string[] {
  return chaves
    .filter((chave) => chave !== CUSTOM_FIELDS_ENVELOPE)
    .filter((chave) => !isFieldEditable(moduleKey, chave, overrides));
}
