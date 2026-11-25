import { and, eq, gt, lt, schema, sql, type Database } from '@codeca/database';

/**
 * Cache das respostas de geocodificacao, no proprio Postgres.
 *
 * Duas razoes, nesta ordem:
 *
 * 1. **Politica de uso.** O Nominatim e gratuito e compartilhado; repetir a
 *    mesma pergunta a cada abertura de tela e exatamente o que eles pedem que
 *    nao se faca.
 * 2. **Resposta.** CEP e endereco nao mudam de um dia para o outro. Ler do
 *    banco e uma consulta local em vez de uma ida a internet.
 *
 * Nao ha tabela por tipo: a chave carrega o tipo (`cep:13010000`,
 * `rev:-22.90710,-47.06320`, `busca:rua x campinas`), e o valor e o JSON ja
 * normalizado -- nunca a resposta crua do provedor.
 */

export type TipoDeConsulta = 'cep' | 'reverse' | 'search';

/** CEP e endereco de um ponto nao mudam; busca por texto envelhece antes. */
export const TTL_EM_DIAS: Record<TipoDeConsulta, number> = {
  cep: 30,
  reverse: 30,
  search: 7,
};

export function chaveDeCache(tipo: TipoDeConsulta, chave: string): string {
  return `${tipo}:${chave}`;
}

export async function lerDoCache<T>(
  db: Database,
  tipo: TipoDeConsulta,
  chave: string,
  agora: Date,
): Promise<T | null> {
  const [linha] = await db
    .select({ valor: schema.geoCache.value })
    .from(schema.geoCache)
    .where(and(eq(schema.geoCache.key, chaveDeCache(tipo, chave)), gt(schema.geoCache.expiresAt, agora)));
  return (linha?.valor as T | undefined) ?? null;
}

export async function gravarNoCache(
  db: Database,
  tipo: TipoDeConsulta,
  chave: string,
  valor: unknown,
  agora: Date,
  provedor: string,
): Promise<void> {
  const expira = new Date(agora.getTime() + TTL_EM_DIAS[tipo] * 86_400_000);
  await db
    .insert(schema.geoCache)
    .values({ key: chaveDeCache(tipo, chave), value: valor, provider: provedor, expiresAt: expira })
    .onConflictDoUpdate({
      target: schema.geoCache.key,
      set: { value: valor, provider: provedor, expiresAt: expira, createdAt: agora },
    });
}

/**
 * Apaga o que venceu.
 *
 * Chamado pelo mesmo job diario que ja limpa outras filas. Sem isto a tabela
 * cresce para sempre guardando resposta que ninguem le.
 */
export async function limparCacheVencido(db: Database, agora: Date): Promise<number> {
  const apagados = await db
    .delete(schema.geoCache)
    .where(lt(schema.geoCache.expiresAt, agora))
    .returning({ key: schema.geoCache.key });
  return apagados.length;
}

/** Usado pelos testes e pelo diagnostico: quantas linhas vivas existem. */
export async function tamanhoDoCache(db: Database): Promise<number> {
  const [linha] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.geoCache);
  return linha?.total ?? 0;
}
