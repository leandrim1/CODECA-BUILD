import { and, count, eq, isNotNull, isNull, schema, type Database } from '@codeca/database';
import { AppError, MODULE_REGISTRY, type ModuleKey } from '@codeca/shared';
import { loadContentUsage } from './content-usage.js';

/**
 * Regras do autoatendimento de modulos.
 *
 * O que muda ao ligar ou desligar um modulo, e o que a pessoa precisa saber
 * ANTES de confirmar. Nada aqui apaga conteudo: desligar um modulo **esconde**
 * (some do painel e da API publica, logo do site) e ligar de novo traz tudo
 * de volta, intacto.
 *
 * As dependencias declaradas abaixo nao sao decorativas: cada uma existe
 * porque ha uma chave estrangeira de verdade no banco ligando os dois modulos.
 * Nao ha "dependencia" inventada para a tela parecer mais completa.
 */

/**
 * Modulo -> modulos que ele USA.
 *
 * `produtos` guarda `category_id` apontando para `categorias`: com categorias
 * desligada, os produtos continuam existindo, mas perdem o agrupamento no
 * site. E a unica ligacao desse tipo entre dois modulos de colecao hoje.
 */
export const MODULE_DEPENDENCIES: Partial<Record<ModuleKey, readonly ModuleKey[]>> = {
  produtos: ['categorias'],
};

/** O inverso: quem depende deste modulo. */
export function dependentesDe(moduleKey: ModuleKey): ModuleKey[] {
  return Object.entries(MODULE_DEPENDENCIES)
    .filter(([, usados]) => (usados ?? []).includes(moduleKey))
    .map(([chave]) => chave as ModuleKey);
}

export interface ModuleToggleImpact {
  moduleKey: ModuleKey;
  moduleName: string;
  enable: boolean;
  /** Quantos registros o modulo tem hoje. */
  records: number;
  /** Modulos que este usa e estao desligados (ao LIGAR). */
  missingDependencies: { key: ModuleKey; name: string }[];
  /** Modulos ligados que usam este (ao DESLIGAR). */
  dependents: { key: ModuleKey; name: string }[];
  /** O que a pessoa precisa saber antes de confirmar. */
  warnings: string[];
  /** Impede a acao por completo. */
  blocked: boolean;
  blockReason: string | null;
}

/**
 * O que acontece se este modulo for ligado ou desligado neste site.
 *
 * Nunca lanca: devolve o retrato, e quem chama decide. A rota usa o mesmo
 * calculo para a previa e para a acao, entao a tela e o servidor nunca
 * discordam.
 */
export async function moduleToggleImpact(
  db: Database,
  input: { tenantId: string; siteId: string; moduleKey: ModuleKey; enable: boolean; enabledKeys: ModuleKey[] },
): Promise<ModuleToggleImpact> {
  const definicao = MODULE_REGISTRY[input.moduleKey];
  const uso = await loadContentUsage(db, input.tenantId);
  const records = uso.byModule[input.moduleKey] ?? 0;

  const ligados = new Set(input.enabledKeys);
  const warnings: string[] = [];

  const missingDependencies = input.enable
    ? (MODULE_DEPENDENCIES[input.moduleKey] ?? [])
        .filter((dep) => !ligados.has(dep))
        .map((key) => ({ key, name: MODULE_REGISTRY[key].name }))
    : [];

  const dependents = input.enable
    ? []
    : dependentesDe(input.moduleKey)
        .filter((dep) => ligados.has(dep))
        .map((key) => ({ key, name: MODULE_REGISTRY[key].name }));

  if (input.enable) {
    for (const falta of missingDependencies) {
      warnings.push(
        `${definicao.name} usa ${falta.name}. Ligue ${falta.name} também para o conteúdo ficar completo.`,
      );
    }
  } else {
    if (records > 0) {
      warnings.push(
        `${definicao.name} tem ${records} conteúdo(s) cadastrado(s). `
          + 'Eles não serão apagados, mas deixam de aparecer no site enquanto o módulo estiver desligado.',
      );
    }
    for (const dependente of dependents) {
      warnings.push(
        `${dependente.name} usa ${definicao.name}. Esse conteúdo continua no site, mas perde o agrupamento.`,
      );
    }
  }

  return {
    moduleKey: input.moduleKey,
    moduleName: definicao.name,
    enable: input.enable,
    records,
    missingDependencies,
    dependents,
    warnings,
    blocked: false,
    blockReason: null,
  };
}

// ------------------------------------------------- chaves de integracao

export interface ApiKeyView {
  id: string;
  kind: 'publishable' | 'secret';
  name: string;
  /**
   * So para a chave publicavel, que nao e segredo e precisa ser copiada para o
   * codigo do site. A secreta nunca volta: o banco guarda apenas o hash.
   */
  token: string | null;
  /** Os primeiros caracteres, para a pessoa reconhecer qual chave e qual. */
  hint: string;
  scopes: string[];
  status: 'ativa' | 'expirando' | 'revogada' | 'expirada';
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

function situacao(row: {
  revokedAt: Date | null;
  expiresAt: Date | null;
}, agora: Date): ApiKeyView['status'] {
  if (row.revokedAt) return 'revogada';
  if (row.expiresAt && row.expiresAt <= agora) return 'expirada';
  if (row.expiresAt) return 'expirando';
  return 'ativa';
}

/**
 * As chaves de um site, como o cliente pode ve-las.
 *
 * **O segredo nunca entra nesta resposta.** Da chave secreta sai apenas o
 * prefixo de busca (`lookup`), que identifica a chave e nao autentica nada: a
 * autenticacao exige o segredo, que so existiu no instante da emissao.
 */
export async function listApiKeys(db: Database, siteId: string, agora: Date): Promise<ApiKeyView[]> {
  const linhas = await db
    .select()
    .from(schema.siteApiKeys)
    .where(eq(schema.siteApiKeys.siteId, siteId));

  return linhas
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      token: row.kind === 'publishable' ? row.token : null,
      hint: `${row.lookup.slice(0, 8)}…`,
      scopes: row.scopes as string[],
      status: situacao(row, agora),
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    }))
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

/**
 * Confere que a chave e DESTE site antes de qualquer operacao.
 *
 * E o que impede a troca do identificador na requisicao de alcançar a chave de
 * outra empresa: a consulta filtra pelo site da sessao, nao pelo que veio no
 * endereco.
 */
export async function requireKeyOfSite(
  db: Database,
  siteId: string,
  keyId: string,
): Promise<{ id: string; kind: 'publishable' | 'secret'; revokedAt: Date | null }> {
  const [linha] = await db
    .select({
      id: schema.siteApiKeys.id,
      kind: schema.siteApiKeys.kind,
      revokedAt: schema.siteApiKeys.revokedAt,
    })
    .from(schema.siteApiKeys)
    .where(and(eq(schema.siteApiKeys.id, keyId), eq(schema.siteApiKeys.siteId, siteId)));
  if (!linha) throw AppError.notFound('Chave não encontrada.');
  return linha;
}

/**
 * Quantas chaves ativas o site tem.
 *
 * Usado para impedir emissao em volume: uma chave por vez e o normal, e a
 * rotacao ja cria a segunda com prazo.
 */
export async function activeKeyCount(db: Database, siteId: string, kind: 'publishable' | 'secret'): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(schema.siteApiKeys)
    .where(
      and(
        eq(schema.siteApiKeys.siteId, siteId),
        eq(schema.siteApiKeys.kind, kind),
        isNull(schema.siteApiKeys.revokedAt),
      ),
    );
  return linha?.total ?? 0;
}

/** Quantas chaves deste site ainda respondem (nao revogadas). */
export async function hasLiveKey(db: Database, siteId: string): Promise<boolean> {
  const [linha] = await db
    .select({ total: count() })
    .from(schema.siteApiKeys)
    .where(and(eq(schema.siteApiKeys.siteId, siteId), isNull(schema.siteApiKeys.revokedAt)));
  return (linha?.total ?? 0) > 0;
}

/** Quantos projetos usam este cliente da agencia. */
export async function projetosDoCliente(db: Database, clientId: string): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(schema.sites)
    .where(and(eq(schema.sites.clientId, clientId), isNotNull(schema.sites.clientId)));
  return linha?.total ?? 0;
}
