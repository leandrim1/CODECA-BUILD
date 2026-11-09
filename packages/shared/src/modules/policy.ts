import { MODULE_REGISTRY, type ModuleKey } from './registry.js';
import type { ModuleField } from './types.js';

/**
 * Politica de campos de um site.
 *
 * O padrao vem do registro; o banco guarda **apenas as excecoes**. Guardar uma
 * linha por campo de cada site daria milhares de linhas que repetem o padrao e
 * envelhecem sozinhas quando um campo novo aparece no registro -- um campo
 * acrescentado hoje ficaria invisivel para todos os sites criados ontem.
 */

/** Excecao gravada no banco: `moduleKey.fieldKey` -> pode editar. */
export type FieldPolicyOverrides = Readonly<Record<string, boolean>>;

/**
 * Chave da excecao no banco.
 *
 * Aceita `string`, e nao `ModuleKey`, porque a politica vale tambem para os
 * modulos personalizados -- cuja chave e dado. As funcoes que de fato
 * dependem do registro (`effectiveFields`, `isFieldEditable`) seguem exigindo
 * `ModuleKey`: e nelas que a tipagem tem o que garantir, nao na concatenacao.
 */
export function policyKey(moduleKey: string, fieldKey: string): string {
  return `${moduleKey}.${fieldKey}`;
}

export interface EffectiveField extends ModuleField {
  /** Resultado do padrao com a excecao do site aplicada. */
  editable: boolean;
  /** `true` quando o site tem uma excecao para este campo. */
  overridden: boolean;
}

export function effectiveFields(
  moduleKey: ModuleKey,
  overrides: FieldPolicyOverrides = {},
): EffectiveField[] {
  return MODULE_REGISTRY[moduleKey].fields.map((field) => {
    const override = overrides[policyKey(moduleKey, field.key)];
    return {
      ...field,
      editable: override ?? field.editableByDefault,
      overridden: override !== undefined,
    };
  });
}

export function isFieldEditable(
  moduleKey: ModuleKey,
  fieldKey: string,
  overrides: FieldPolicyOverrides = {},
): boolean {
  const override = overrides[policyKey(moduleKey, fieldKey)];
  if (override !== undefined) return override;
  const field = MODULE_REGISTRY[moduleKey].fields.find((f) => f.key === fieldKey);
  // Campo fora do registro nao e editavel por omissao: o que nao foi
  // declarado nao pode ser gravado por engano.
  return field?.editableByDefault ?? false;
}

/**
 * Colunas que existem em todo registro e nunca sao conteudo.
 *
 * Nao sao campos do modulo: sao a identidade e o carimbo de tempo da linha.
 * Ninguem as envia num formulario, e ninguem as edita -- a gravacao as
 * define sozinha.
 *
 * Precisam ser nomeadas aqui porque a comparacao da politica recebe, de um
 * lado, a **linha inteira do banco** e, de outro, apenas os campos de
 * conteudo validados. Sem esta lista, cada coluna de sistema aparecia como
 * "alterada" (valor na linha, ausente no envio) e era recusada por nao
 * constar do registro de modulos -- o que quebrava **toda** edicao de
 * registro, nao um caso raro.
 */
export const SYSTEM_COLUMNS: readonly string[] = [
  'id',
  'tenantId',
  'siteId',
  'createdAt',
  'updatedAt',
];

/**
 * Campos que o cliente tentou alterar e nao pode.
 *
 * Recebe apenas as chaves que **mudaram de valor**, nao o corpo inteiro: um
 * formulario reenvia todos os campos, e recusar por reenviar o mesmo valor
 * tornaria a tela impossivel de usar.
 *
 * Coluna de sistema nunca entra na conta: ela nao e campo, e a diferenca
 * entre a linha do banco e o corpo validado nao significa que alguem tentou
 * altera-la.
 */
export function blockedFields(
  moduleKey: ModuleKey,
  changedKeys: readonly string[],
  overrides: FieldPolicyOverrides = {},
): string[] {
  return changedKeys
    .filter((key) => !SYSTEM_COLUMNS.includes(key))
    .filter((key) => !isFieldEditable(moduleKey, key, overrides));
}

/** Chaves cujo valor mudou entre o registro atual e o enviado. */
export function changedKeys(
  atual: Record<string, unknown>,
  enviado: Record<string, unknown>,
): string[] {
  const chaves = new Set([...Object.keys(atual), ...Object.keys(enviado)]);
  return [...chaves].filter(
    (chave) => JSON.stringify(atual[chave] ?? null) !== JSON.stringify(enviado[chave] ?? null),
  );
}
