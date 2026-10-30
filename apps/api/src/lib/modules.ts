import { and, eq, schema, type Database } from '@codeca/database';
import {
  AppError,
  MODULE_KEYS,
  MODULE_REGISTRY,
  blockedFields,
  changedKeys,
  effectiveFields,
  isModuleKey,
  policyKey,
  type EffectiveField,
  type FieldPolicyOverrides,
  type ModuleKey,
  type ModuleKind,
} from '@codeca/shared';

/**
 * Modulos de um site, do ponto de vista de quem opera.
 *
 * O catalogo vem do registro em `packages/shared`; o banco diz quais modulos
 * este site tem e quais campos fogem do padrao. A juncao acontece aqui, uma
 * vez, para o painel, a API publica e a verificacao de escrita enxergarem
 * exatamente a mesma coisa.
 */

export interface SiteModuleView {
  key: ModuleKey;
  name: string;
  description: string;
  kind: ModuleKind;
  enabled: boolean;
  settings: Record<string, unknown>;
  fields: EffectiveField[];
}

export interface SiteModuleState {
  modules: SiteModuleView[];
  /** Excecoes de campo, no formato `modulo.campo`. */
  overrides: FieldPolicyOverrides;
}

export async function loadSiteModules(db: Database, siteId: string): Promise<SiteModuleState> {
  const [habilitados, politicas] = await Promise.all([
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
  ]);

  const overrides: Record<string, boolean> = {};
  for (const linha of politicas) {
    if (!isModuleKey(linha.moduleKey)) continue;
    overrides[policyKey(linha.moduleKey, linha.fieldKey)] = linha.editable;
  }

  const porChave = new Map(habilitados.map((linha) => [linha.moduleKey, linha]));

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
      fields: effectiveFields(key, overrides),
    };
  });

  return { modules, overrides };
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
