import { and, asc, eq, schema, type Database } from '@codeca/database';
import { CUSTOM_FIELDS_ENVELOPE, parseCustomFields } from './custom-fields.js';
import {
  AppError,
  MODULE_KEYS,
  MODULE_REGISTRY,
  blockedFields,
  changedKeys,
  customFieldToModuleField,
  effectiveFields,
  isCustomFieldType,
  isModuleKey,
  policyKey,
  type CustomFieldDefinition,
  type EffectiveField,
  type FieldPolicyOverrides,
  type ModuleKey,
  type SiteModuleView,
} from '@codeca/shared';

/**
 * Modulos de um site, do ponto de vista de quem opera.
 *
 * O catalogo vem do registro em `packages/shared`; o banco diz quais modulos
 * este site tem e quais campos fogem do padrao. A juncao acontece aqui, uma
 * vez, para o painel, a API publica e a verificacao de escrita enxergarem
 * exatamente a mesma coisa.
 */


export interface SiteModuleState {
  modules: SiteModuleView[];
  /** Excecoes de campo, no formato `modulo.campo`. */
  overrides: FieldPolicyOverrides;
  /** Campos definidos para este site, por modulo. */
  customFields: Map<ModuleKey, CustomFieldDefinition[]>;
}

export async function loadSiteModules(db: Database, siteId: string): Promise<SiteModuleState> {
  const [habilitados, politicas, personalizados] = await Promise.all([
    db
      .select({
        moduleKey: schema.siteModules.moduleKey,
        enabled: schema.siteModules.enabled,
        settings: schema.siteModules.settings,
      })
      .from(schema.siteModules)
      .where(eq(schema.siteModules.siteId, siteId)),
    db
      .select({
        moduleKey: schema.siteFieldPolicies.moduleKey,
        fieldKey: schema.siteFieldPolicies.fieldKey,
        editable: schema.siteFieldPolicies.editable,
      })
      .from(schema.siteFieldPolicies)
      .where(eq(schema.siteFieldPolicies.siteId, siteId)),
    db
      .select()
      .from(schema.siteCustomFields)
      .where(eq(schema.siteCustomFields.siteId, siteId))
      .orderBy(asc(schema.siteCustomFields.sortOrder), asc(schema.siteCustomFields.label)),
  ]);

  const overrides: Record<string, boolean> = {};
  for (const linha of politicas) {
    if (!isModuleKey(linha.moduleKey)) continue;
    overrides[policyKey(linha.moduleKey, linha.fieldKey)] = linha.editable;
  }

  const porChave = new Map(habilitados.map((linha) => [linha.moduleKey, linha]));

  /**
   * Definicoes por modulo, filtradas pelo registro.
   *
   * O filtro cobre o caso de um modulo sair do registro depois de alguem ter
   * definido campo nele -- o campo fica no banco, sem aparecer em lugar nenhum.
   */
  const definicoesPorModulo = new Map<ModuleKey, CustomFieldDefinition[]>();
  for (const linha of personalizados) {
    if (!isModuleKey(linha.moduleKey)) continue;
    if (!isCustomFieldType(linha.type)) continue;
    const lista = definicoesPorModulo.get(linha.moduleKey) ?? [];
    lista.push({
      fieldKey: linha.fieldKey,
      label: linha.label,
      type: linha.type,
      required: linha.required,
      help: linha.help,
      options: linha.options ?? [],
      editable: linha.editable,
      sortOrder: linha.sortOrder,
    });
    definicoesPorModulo.set(linha.moduleKey, lista);
  }

  const modules = MODULE_KEYS.map((key) => {
    const definicao = MODULE_REGISTRY[key];
    const linha = porChave.get(key);
    return {
      key,
      name: definicao.name,
      description: definicao.description,
      kind: definicao.kind,
      // Modulo sem linha nao esta habilitado: o site so tem o que foi
      // configurado para ele, e nao tudo que a plataforma sabe fazer.
      enabled: linha?.enabled ?? false,
      settings: linha?.settings ?? {},
      /**
       * Campos do registro **e** os definidos para este site, na mesma lista.
       *
       * Os personalizados vao depois, porque sao acrescimos ao formulario que
       * ja existia -- e porque a politica por site ja ordenou os primeiros.
       * A politica de campos vale para os dois: `policyKey` nao distingue.
       */
      fields: [
        ...effectiveFields(key, overrides),
        ...aplicarPolitica(definicoesPorModulo.get(key) ?? [], key, overrides),
      ],
    };
  });

  return { modules, overrides, customFields: definicoesPorModulo };
}

/** Converte definicoes em campos, com a excecao do site aplicada. */
function aplicarPolitica(
  definicoes: readonly CustomFieldDefinition[],
  moduleKey: ModuleKey,
  overrides: FieldPolicyOverrides,
): EffectiveField[] {
  return definicoes.map((definicao) => {
    const campo = customFieldToModuleField(definicao);
    const excecao = overrides[policyKey(moduleKey, definicao.fieldKey)];
    return {
      ...campo,
      editable: excecao ?? campo.editableByDefault,
      overridden: excecao !== undefined,
    };
  });
}

/**
 * Confere a politica e le os campos personalizados de uma **criacao**.
 *
 * Os dois passos vivem juntos de proposito. Eles usam a mesma carga do estado
 * do site e sao faceis de separar por descuido: uma rota nova que chamasse
 * `assertEditableCreate` e esquecesse `parseCustomFields` gravaria conteudo
 * personalizado sem validar nada -- e nada na tela acusaria.
 *
 * E por aqui que passa a escrita dos modulos que aceitam campo personalizado.
 * `categorias` e `galerias` nao aceitam e seguem chamando o `assert` direto:
 * nao ha definicao para carregar, e passar por aqui sugeriria que ha.
 */
export async function lerCriacao(
  db: Database,
  siteId: string,
  moduleKey: ModuleKey,
  raw: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const estado = await loadSiteModules(db, siteId);
  assertEditableCreate(moduleKey, raw, estado.overrides);
  return parseCustomFields({
    moduleKey,
    definicoes: customFieldsOf(estado, moduleKey),
    raw,
    overrides: estado.overrides,
    partial: false,
  });
}

/**
 * O mesmo para uma **alteracao parcial**.
 *
 * `partial: true`: um `PATCH` manda so o que a tela editou, e exigir campo
 * obrigatorio aqui travaria a edicao de todo registro cadastrado antes de o
 * campo existir.
 */
export async function lerAlteracao(
  db: Database,
  siteId: string,
  moduleKey: ModuleKey,
  raw: Record<string, unknown>,
  enviado: Record<string, unknown>,
  atual: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const estado = await loadSiteModules(db, siteId);
  assertEditablePatch(moduleKey, atual, enviado, estado.overrides);
  return parseCustomFields({
    moduleKey,
    definicoes: customFieldsOf(estado, moduleKey),
    raw,
    overrides: estado.overrides,
    partial: true,
  });
}

/** Definicoes de um modulo, para validar a escrita. */
export function customFieldsOf(
  state: SiteModuleState,
  moduleKey: ModuleKey,
): CustomFieldDefinition[] {
  return state.customFields.get(moduleKey) ?? [];
}

/** Somente os modulos habilitados, na ordem do registro. */
export function enabledModuleKeys(state: SiteModuleState): ModuleKey[] {
  return state.modules.filter((m) => m.enabled).map((m) => m.key);
}

export async function assertModuleEnabled(
  db: Database,
  siteId: string,
  moduleKey: ModuleKey,
): Promise<void> {
  const [linha] = await db
    .select({ enabled: schema.siteModules.enabled })
    .from(schema.siteModules)
    .where(
      and(eq(schema.siteModules.siteId, siteId), eq(schema.siteModules.moduleKey, moduleKey)),
    );

  if (!linha?.enabled) {
    throw AppError.forbidden(
      `O modulo ${MODULE_REGISTRY[moduleKey].name} nao esta habilitado para este site.`,
    );
  }
}

/**
 * Recusa a escrita quando ela mexe em campo travado para este site.
 *
 * Compara valor a valor, e nao a lista de chaves enviadas: um formulario
 * reenvia tudo, e recusar por reenviar o mesmo valor tornaria a tela
 * impossivel de usar. So o que mudou conta.
 */
export function assertEditableChanges(
  moduleKey: ModuleKey,
  atual: Record<string, unknown>,
  enviado: Record<string, unknown>,
  overrides: FieldPolicyOverrides,
): string[] {
  const mudou = changedKeys(atual, enviado);
  const travados = blockedFields(moduleKey, mudou, overrides);
  if (travados.length > 0) {
    const rotulos = travados.map((key) => {
      const campo = MODULE_REGISTRY[moduleKey].fields.find((f) => f.key === key);
      return campo?.label ?? key;
    });
    throw AppError.forbidden(
      `Estes campos sao mantidos pela CODECA IA e nao podem ser alterados aqui: ${rotulos.join(', ')}.`,
    );
  }
  return mudou;
}

/**
 * Recusa a criacao de um registro que define campo travado para este site.
 *
 * Recebe o corpo **como chegou**, e nao o resultado do schema: um valor que o
 * Zod preencheu por omissao nao e escolha do cliente, e tratar o padrao como
 * alteracao recusaria toda criacao assim que qualquer campo com padrao fosse
 * travado.
 */
export function assertEditableCreate(
  moduleKey: ModuleKey,
  bruto: Record<string, unknown>,
  overrides: FieldPolicyOverrides,
): string[] {
  const enviadas = Object.keys(bruto)
    .filter((chave) => bruto[chave] !== undefined)
    // O envelope dos campos personalizados nao e um campo tipado, e
    // `isFieldEditable` nega o que nao esta no registro: sem esta excecao,
    // toda gravacao que trouxesse campo personalizado levaria 403.
    .filter((chave) => chave !== CUSTOM_FIELDS_ENVELOPE);
  const travados = blockedFields(moduleKey, enviadas, overrides);
  if (travados.length > 0) {
    const rotulos = travados.map((key) => {
      const campo = MODULE_REGISTRY[moduleKey].fields.find((f) => f.key === key);
      return campo?.label ?? key;
    });
    throw AppError.forbidden(
      `Estes campos sao mantidos pela CODECA IA e nao podem ser definidos aqui: ${rotulos.join(', ')}.`,
    );
  }
  return enviadas;
}

/**
 * Versao de `assertEditableChanges` para alteracao parcial de um registro.
 *
 * Um `PATCH` manda so o que a tela editou, e a linha do banco tem colunas que
 * nao sao campos de modulo (`id`, `createdAt`). Comparar os dois inteiros
 * acusaria essas colunas como alteradas e recusaria toda alteracao, entao a
 * comparacao se restringe as chaves efetivamente enviadas.
 */
export function assertEditablePatch(
  moduleKey: ModuleKey,
  atual: Record<string, unknown>,
  enviado: Record<string, unknown>,
  overrides: FieldPolicyOverrides,
): string[] {
  const enviadas = Object.keys(enviado)
    .filter((chave) => enviado[chave] !== undefined)
    .filter((chave) => chave !== CUSTOM_FIELDS_ENVELOPE);
  const recorte = Object.fromEntries(enviadas.map((chave) => [chave, normalize(atual[chave])]));
  const submetido = Object.fromEntries(enviadas.map((chave) => [chave, normalize(enviado[chave])]));
  return assertEditableChanges(moduleKey, recorte, submetido, overrides);
}

/**
 * Aproxima a forma do banco da forma do JSON.
 *
 * Uma coluna `date` volta como `Date` e chega como texto; sem isto, reenviar
 * a mesma data contaria como alteracao e um campo de data travado nunca
 * poderia ser reenviado pelo formulario.
 */
function normalize(valor: unknown): unknown {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return valor ?? null;
}
