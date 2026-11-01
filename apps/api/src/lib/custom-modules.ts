import { and, asc, eq, schema, type Database } from '@codeca/database';
import {
  AppError,
  buildCustomFieldsSchema,
  customFieldToModuleField,
  isCustomFieldType,
  policyKey,
  type CustomFieldDefinition,
  type CustomModuleDefinition,
  type CustomModuleView,
  type EffectiveField,
  type FieldPolicyOverrides,
  type ModuleKind,
} from '@codeca/shared';

/**
 * Modulos criados para um site, com os campos de cada um.
 *
 * Carregados por uma funcao propria, e nao dentro de `loadSiteModules`: os
 * modulos do registro e os personalizados vivem em listas separadas no
 * contrato (o motivo esta em `packages/shared/src/modules/custom-modules.ts`),
 * e juntar as duas cargas aqui so adiaria a separacao para o chamador.
 */

export interface CustomModuleState {
  /** Todos, inclusive os desabilitados: o painel mestre precisa ver os dois. */
  modules: CustomModuleDefinition[];
  /** Excecoes de campo do site, no formato `modulo.campo`. */
  overrides: FieldPolicyOverrides;
}

export async function loadCustomModules(
  db: Database,
  siteId: string,
): Promise<CustomModuleState> {
  const [definicoes, campos, politicas] = await Promise.all([
    db
      .select()
      .from(schema.siteCustomModules)
      .where(eq(schema.siteCustomModules.siteId, siteId))
      .orderBy(asc(schema.siteCustomModules.sortOrder), asc(schema.siteCustomModules.name)),
    db
      .select()
      .from(schema.siteCustomFields)
      .where(eq(schema.siteCustomFields.siteId, siteId))
      .orderBy(asc(schema.siteCustomFields.sortOrder), asc(schema.siteCustomFields.label)),
    db
      .select({
        moduleKey: schema.siteFieldPolicies.moduleKey,
        fieldKey: schema.siteFieldPolicies.fieldKey,
        editable: schema.siteFieldPolicies.editable,
      })
      .from(schema.siteFieldPolicies)
      .where(eq(schema.siteFieldPolicies.siteId, siteId)),
  ]);

  const overrides: Record<string, boolean> = {};
  for (const linha of politicas) {
    overrides[policyKey(linha.moduleKey, linha.fieldKey)] = linha.editable;
  }

  const porModulo = new Map<string, CustomFieldDefinition[]>();
  for (const linha of campos) {
    // O tipo vem do banco como texto. Um tipo que saiu da lista deixa o campo
    // de fora em vez de quebrar a carga do modulo inteiro.
    if (!isCustomFieldType(linha.type)) continue;
    const lista = porModulo.get(linha.moduleKey) ?? [];
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
    porModulo.set(linha.moduleKey, lista);
  }

  return {
    modules: definicoes.map((linha) => ({
      key: linha.key,
      name: linha.name,
      description: linha.description,
      kind: linha.kind as ModuleKind,
      icon: linha.icon,
      sortOrder: linha.sortOrder,
      enabled: linha.enabled,
      fields: porModulo.get(linha.key) ?? [],
    })),
    overrides,
  };
}

/** Somente os habilitados, que e o que o cliente e o site veem. */
export function enabledCustomModules(state: CustomModuleState): CustomModuleDefinition[] {
  return state.modules.filter((modulo) => modulo.enabled);
}

/**
 * A definicao vista pelo painel, com a politica do site aplicada.
 *
 * Mesma forma de `SiteModuleView.fields`, para a tela que desenha o formulario
 * nao precisar saber de qual lista o modulo veio.
 */
export function toCustomModuleView(
  definicao: CustomModuleDefinition,
  overrides: FieldPolicyOverrides,
): CustomModuleView {
  return {
    key: definicao.key,
    name: definicao.name,
    description: definicao.description,
    kind: definicao.kind,
    icon: definicao.icon,
    sortOrder: definicao.sortOrder,
    enabled: definicao.enabled,
    fields: definicao.fields.map((campo): EffectiveField => {
      const base = customFieldToModuleField(campo);
      const excecao = overrides[policyKey(definicao.key, campo.fieldKey)];
      return {
        ...base,
        editable: excecao ?? base.editableByDefault,
        overridden: excecao !== undefined,
      };
    }),
  };
}

/**
 * Carrega o modulo habilitado ou recusa.
 *
 * Recusa com 403 no painel: o cliente esta autenticado e a mensagem diz o que
 * fazer. A API publica usa `loadCustomModulePublico`, que responde 404 --
 * para quem le o site, um modulo que ele nao tem simplesmente nao existe, e
 * dizer "proibido" revelaria que a rota existe em outros sites.
 */
export async function assertCustomModule(
  db: Database,
  siteId: string,
  moduleKey: string,
): Promise<CustomModuleDefinition> {
  const state = await loadCustomModules(db, siteId);
  const modulo = state.modules.find((m) => m.key === moduleKey);
  if (!modulo) throw AppError.notFound('Modulo nao encontrado.');
  if (!modulo.enabled) {
    throw AppError.forbidden(`O modulo ${modulo.name} nao esta habilitado para este site.`);
  }
  return modulo;
}

/** A mesma carga, mas invisivel: nada revela que o modulo existe alhures. */
export async function loadCustomModulePublico(
  db: Database,
  siteId: string,
  moduleKey: string,
): Promise<CustomModuleDefinition> {
  const state = await loadCustomModules(db, siteId);
  const modulo = state.modules.find((m) => m.key === moduleKey && m.enabled);
  if (!modulo) throw AppError.notFound('Recurso nao disponivel para este site.');
  return modulo;
}

/**
 * Valida os valores dos campos de um registro.
 *
 * Mesma mecanica da etapa F: o schema e montado em tempo de execucao a partir
 * das definicoes, `.strict()` recusa chave que ninguem definiu, e a politica
 * do site e conferida **antes** -- esconder na tela nao e proteger.
 *
 * `partial` numa alteracao: um registro criado antes de um campo existir nao
 * tem a chave, e exigir campo obrigatorio numa edicao qualquer travaria a
 * edicao de tudo o que ja estava cadastrado.
 */
export function parseRecordData(input: {
  modulo: CustomModuleDefinition;
  overrides: FieldPolicyOverrides;
  /** Corpo como chegou, para distinguir ausente de vazio. */
  raw: Record<string, unknown>;
  partial: boolean;
}): Record<string, unknown> | undefined {
  const bruto = input.raw.data;
  if (bruto === undefined) return undefined;

  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw AppError.badRequest('`data` precisa ser um objeto.');
  }

  const enviados = bruto as Record<string, unknown>;
  const definidos = new Map(input.modulo.fields.map((campo) => [campo.fieldKey, campo]));

  // Recusada pelo nome: aceitar em silencio deixaria o JSONB crescer com o que
  // o navegador mandasse, e nenhuma tela mostraria o que ficou guardado.
  const desconhecidas = Object.keys(enviados).filter((chave) => !definidos.has(chave));
  if (desconhecidas.length > 0) {
    throw AppError.badRequest(
      `Estes campos nao estao definidos no modulo ${input.modulo.name}: ${desconhecidas.join(', ')}.`,
    );
  }

  const travados = Object.keys(enviados).filter((chave) => {
    const definicao = definidos.get(chave)!;
    const excecao = input.overrides[policyKey(input.modulo.key, chave)];
    return !(excecao ?? definicao.editable);
  });
  if (travados.length > 0) {
    const rotulos = travados.map((chave) => definidos.get(chave)!.label);
    throw AppError.forbidden(
      `Estes campos sao mantidos pela CODECA IA e nao podem ser definidos aqui: ${rotulos.join(', ')}.`,
    );
  }

  const esquema = buildCustomFieldsSchema(input.modulo.fields);
  const resultado = (input.partial ? esquema.partial() : esquema).safeParse(enviados);
  if (!resultado.success) {
    const fields: Record<string, string> = {};
    for (const issue of resultado.error.issues) {
      const chave = issue.path.map(String).join('.') || 'data';
      fields[`data.${chave}`] ??= issue.message;
    }
    throw AppError.validation('Alguns campos precisam ser corrigidos.', { fields });
  }

  return resultado.data as Record<string, unknown>;
}

/** Mescla sobre o gravado: edicao que nao mostrou um campo nao o apaga. */
export function mergeRecordData(
  atual: Record<string, unknown> | null | undefined,
  enviados: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...(atual ?? {}), ...(enviados ?? {}) };
}

/** Slug unico dentro do modulo, no site. */
export async function uniqueRecordSlug(
  db: Database,
  input: { siteId: string; moduleKey: string; desired: string; exceptId?: string },
): Promise<string> {
  const base =
    input.desired
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'registro';

  for (let tentativa = 0; tentativa < 50; tentativa += 1) {
    const candidato = tentativa === 0 ? base : `${base}-${tentativa + 1}`;
    const existentes = await db
      .select({ id: schema.customRecords.id })
      .from(schema.customRecords)
      .where(
        and(
          eq(schema.customRecords.siteId, input.siteId),
          eq(schema.customRecords.moduleKey, input.moduleKey),
          eq(schema.customRecords.slug, candidato),
        ),
      );
    const livre = existentes.every((linha) => linha.id === input.exceptId);
    if (livre) return candidato;
  }

  throw AppError.conflict('Nao foi possivel gerar um endereco unico para este registro.');
}
