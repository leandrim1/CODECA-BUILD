import { schema, sql, type Database } from '@codeca/database';
import {
  AppError,
  CONTENT_LIMIT_MODULE_KEYS,
  MODULE_REGISTRY,
  type ModuleKey,
} from '@codeca/shared';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { EffectivePlan } from './plan-limits.js';

/**
 * Conteudos cadastrados: o numero que o limite geral de cada plano limita.
 *
 * ## O que e um "conteudo cadastrado"
 *
 * Um registro de qualquer modulo de **colecao** habilitado no site: produto,
 * servico, imovel, obra, profissional, equipe, depoimento, pergunta, categoria,
 * galeria, banner e cada registro dos modulos personalizados. O limite e geral
 * -- uma loja gasta as vagas em produtos, uma clinica em servicos e
 * profissionais --, e nao por tipo. A plataforma aplica a mesma regra a todo
 * segmento.
 *
 * ## Como cada situacao e contada
 *
 * | Registro                                   | Conta? |
 * | ------------------------------------------ | ------ |
 * | Rascunho                                   | sim    |
 * | Publicado                                  | sim    |
 * | Arquivado                                  | sim    |
 * | Excluido (a exclusao e definitiva)         | nao    |
 * | De modulo **desabilitado** no site         | nao    |
 * | Documento (institucional, contato, modulo personalizado de documento) | nao |
 * | Filho de um registro (etapa de obra, foto de galeria, anexo)         | nao |
 * | Arquivo da biblioteca de imagens           | nao (e o limite de armazenamento) |
 *
 * Rascunho e arquivado contam porque **continuam cadastrados**: sao dados do
 * cliente que ocupam o plano mesmo fora do site. Se rascunho nao contasse, o
 * limite se contornaria cadastrando tudo como rascunho; se arquivado nao
 * contasse, arquivar viraria uma forma de ter mais do que o plano permite -- e
 * "restaurar" precisaria de uma checagem propria em cada modulo.
 *
 * Como so a **criacao** consome vaga (publicar, arquivar e restaurar nao mudam
 * a contagem), e so ela e conferida. Excluir libera a vaga na hora.
 *
 * ## Quem passa do limite
 *
 * Reduzir o limite de um plano, ou mover uma empresa para um plano menor, nunca
 * apaga nem esconde nada: a empresa continua editando e excluindo o que tem, e
 * so deixa de **cadastrar** novos conteudos ate voltar a ficar abaixo do limite.
 *
 * ## Por que uma consulta so
 *
 * A contagem roda a cada criacao e em varias telas. Onze consultas em sequencia
 * seriam onze idas e voltas ao banco; um `UNION ALL` agrupado e uma.
 */

type ModuloDeColecao = Exclude<ModuleKey, 'institucional' | 'contato'>;

/**
 * De que tabela vem a contagem de cada modulo de colecao.
 *
 * `satisfies` obriga a cobrir todo modulo de colecao conhecido; o teste
 * `content-usage.test.ts` confere ainda que esta lista bate com o registro (e
 * com o nome da tabela declarado nele). Um modulo novo sem linha aqui nao
 * compila -- e e assim que ele nao escapa do limite sem ninguem perceber.
 */
const TABELA_DO_MODULO = {
  banners: schema.banners,
  imoveis: schema.properties,
  obras: schema.projects,
  servicos: schema.services,
  depoimentos: schema.testimonials,
  equipe: schema.teamMembers,
  faq: schema.faqs,
  produtos: schema.products,
  categorias: schema.categories,
  galerias: schema.galleries,
} as const satisfies Record<ModuloDeColecao, PgTable & { siteId: unknown; tenantId: unknown }>;

export const TABELAS_DE_CONTEUDO: Readonly<Record<string, PgTable>> = TABELA_DO_MODULO;

/** Prefixo das chaves de modulos personalizados em `contentByModule`. */
export const PREFIXO_MODULO_PROPRIO = 'custom:';

export interface ContentUsage {
  total: number;
  /** Chave do modulo (ou `custom:<chave>`) -> registros. So quem tem ao menos um. */
  byModule: Record<string, number>;
}

export async function loadContentUsage(db: Database, tenantId: string): Promise<ContentUsage> {
  // Um modulo conta enquanto estiver habilitado em ao menos um site da empresa.
  const partes = (CONTENT_LIMIT_MODULE_KEYS as readonly ModuloDeColecao[]).map((chave) => {
    const tabela = TABELA_DO_MODULO[chave];
    return sql`
      select ${chave}::text as module_key, t.site_id as site_id
      from ${tabela} as t
      where t.tenant_id = ${tenantId}
    `;
  });

  const tipados = sql.join(partes, sql` union all `);

  const resultado = await db.execute<{ module_key: string; total: number }>(sql`
    select r.module_key as module_key, cast(count(*) as int) as total
    from (${tipados}) as r
    join ${schema.siteModules} as sm
      on sm.site_id = r.site_id and sm.module_key = r.module_key and sm.enabled
    group by r.module_key
    union all
    select ${PREFIXO_MODULO_PROPRIO} || c.module_key as module_key, cast(count(*) as int) as total
    from ${schema.customRecords} as c
    join ${schema.siteCustomModules} as m
      on m.site_id = c.site_id and m.key = c.module_key and m.enabled and m.kind = 'collection'
    where c.tenant_id = ${tenantId}
    group by c.module_key
  `);

  const linhas = (Array.isArray(resultado) ? resultado : (resultado as { rows: unknown[] }).rows) as Array<{
    module_key: string;
    total: number;
  }>;

  const byModule: Record<string, number> = {};
  let total = 0;
  for (const linha of linhas) {
    const n = Number(linha.total);
    byModule[linha.module_key] = n;
    total += n;
  }
  return { total, byModule };
}

/**
 * Garante vaga para mais `increment` conteudos. Chamada **antes** de criar.
 *
 * A checagem e feita no servidor, em toda criacao, por qualquer caminho. A
 * interface mostra o consumo, mas quem recusa e esta funcao.
 */
export async function assertContentCapacity(
  db: Database,
  tenantId: string,
  plan: EffectivePlan,
  increment = 1,
): Promise<void> {
  const max = plan.limits.maxContentRecords;
  const { total } = await loadContentUsage(db, tenantId);

  if (total + increment > max) {
    throw AppError.planLimit(
      `O plano ${plan.planName} permite até ${max} conteúdos cadastrados e você já utiliza ${total}. `
        + 'Exclua conteúdos que não usa mais ou atualize o plano para cadastrar novos.',
      { limit: 'maxContentRecords', max, current: total, planCode: plan.planCode },
    );
  }
}

/** Nome legivel do modulo, para a tela de uso. */
export function nomeDoModulo(chave: string): string | null {
  const definicao = MODULE_REGISTRY[chave as ModuleKey];
  return definicao ? definicao.name : null;
}
