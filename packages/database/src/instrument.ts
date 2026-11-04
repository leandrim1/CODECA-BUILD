import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Medicao de consultas ao banco, por requisicao.
 *
 * ## Por que existe
 *
 * Nao se otimiza o que nao se mede. Em serverless o custo de uma rota nao e o
 * codigo dela: e **quantas idas ao banco ela faz**. Cada uma e uma viagem de
 * rede (o driver HTTP do Neon faz um `fetch` por consulta), e uma rota com 12
 * consultas em sequencia custa 12 vezes a latencia. Sem contar, isso so aparece
 * como "esta lenta" -- sem dizer de onde vem.
 *
 * ## O que faz
 *
 * - `runWithQueryStats` abre um contador para uma requisicao;
 * - `trackQuery` e chamado por cada consulta e soma contagem e tempo nele;
 * - consultas acima do limite sao registradas, em uma linha JSON, com o inicio
 *   do SQL (nunca os parametros: podem ter dado de cliente).
 *
 * `AsyncLocalStorage` mantem o contador certo mesmo com varias requisicoes
 * concorrentes no mesmo processo.
 */

export interface QueryStats {
  count: number;
  totalMs: number;
  slowest: { ms: number; sql: string } | null;
}

const storage = new AsyncLocalStorage<QueryStats>();

/**
 * Totais do processo, independentes de requisicao.
 *
 * O contador por requisicao depende de `AsyncLocalStorage`, e um pool que
 * enfileira consultas (todas as conexoes ocupadas) as executa no contexto de
 * quem liberou a conexao, nao de quem pediu: sob saturacao, parte das consultas
 * deixa de ser atribuida a rota nenhuma. O total do processo nao tem esse
 * problema, e e o que se usa para ler consultas/requisicao sob carga.
 */
export const queryTotals = { count: 0, ms: 0 };

/** Consultas mais lentas que isto sao registradas. Ajustavel por `SLOW_QUERY_MS`. */
let slowQueryMs = 500;

export function setSlowQueryThreshold(ms: number): void {
  slowQueryMs = ms;
}

export function runWithQueryStats<T>(fn: (stats: QueryStats) => Promise<T>): Promise<T> {
  const stats: QueryStats = { count: 0, totalMs: 0, slowest: null };
  return storage.run(stats, () => fn(stats));
}

/** O inicio do SQL, sem parametros e sem quebras de linha, para o log. */
function shorten(sql: string): string {
  return sql.replace(/\s+/g, ' ').slice(0, 160);
}

export function trackQuery(sql: string, ms: number): void {
  queryTotals.count += 1;
  queryTotals.ms += ms;
  const stats = storage.getStore();
  if (stats) {
    stats.count += 1;
    stats.totalMs += ms;
    if (!stats.slowest || ms > stats.slowest.ms) stats.slowest = { ms, sql: shorten(sql) };
  }
  if (ms >= slowQueryMs) {
    console.warn(JSON.stringify({ level: 'warn', event: 'slow_query', ms: Math.round(ms), sql: shorten(sql) }));
  }
}

/** Mede uma promessa de consulta. */
export async function timeQuery<T>(sql: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await run();
  } finally {
    trackQuery(sql, performance.now() - start);
  }
}

/**
 * Embrulha `query` de um pool (ou cliente) para medir cada consulta.
 * Funciona com `pg` e com o `Pool` do driver serverless do Neon: os dois
 * expoem `query(text|{text}, values?)`.
 */
export function instrumentQueryable<T extends { query: (...args: never[]) => unknown }>(target: T): T {
  const original = target.query.bind(target) as (...args: unknown[]) => unknown;
  (target as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    const first = args[0];
    const sql = typeof first === 'string' ? first : ((first as { text?: string } | undefined)?.text ?? '');
    const start = performance.now();
    const result = original(...args);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<unknown>).finally(() => trackQuery(sql, performance.now() - start));
    }
    trackQuery(sql, performance.now() - start);
    return result;
  };
  return target;
}
