import { Pool, neonConfig } from '@neondatabase/serverless';
import WebSocketConstructor from 'ws';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema.js';
import { instrumentQueryable } from './instrument.js';
import { backoffDelayMs, isSafeToRetry } from './resilience.js';

/**
 * Acesso ao Neon PostgreSQL.
 *
 * Usamos o driver `neon-serverless` (WebSocket) em vez do driver HTTP porque a
 * publicacao de paginas depende de transacoes reais, que o driver HTTP nao
 * suporta. Consultas simples continuam saindo por HTTP via `poolQueryViaFetch`.
 */

export type Schema = typeof schema;

/** Tipo aceito por qualquer consulta, seja conexao direta ou transacao. */
export type Database = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export type Transaction = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

let cached: DatabaseHandle | null = null;
let cachedUrl: string | null = null;

/**
 * Tempo maximo esperando uma conexao nova.
 *
 * Sem limite, uma conexao que nao se estabelece consome o orcamento inteiro da
 * funcao e o navegador recebe um 504 sem causa. Com limite, o erro chega
 * depressa e com nome.
 */
const CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Tempo maximo de uma consulta enviada por HTTP.
 *
 * `poolQueryViaFetch` faz as consultas simples sairem por `fetch`, que nao tem
 * prazo proprio: um endpoint que aceita a conexao e nao responde prende a
 * funcao ate o limite da plataforma, e o navegador recebe 504 sem causa. Com
 * prazo, o erro chega enquanto ainda ha tempo de responder direito.
 */
const QUERY_TIMEOUT_MS = 15_000;

/** Junta o prazo ao sinal que o driver ja tenha passado, sem descartar nenhum. */
function withDeadline(signal: AbortSignal | null | undefined, ms: number): AbortSignal {
  const deadline = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/** Status do gateway HTTP do Neon que recusam ANTES de executar a consulta. */
const GATEWAY_REFUSED = new Set([429, 503]);
const FETCH_RETRIES = 2;

/**
 * `fetch` com prazo e repeticao segura.
 *
 * So repete quando a consulta comprovadamente nao foi executada (conexao
 * recusada, DNS, 429/503 do gateway). Uma escrita nunca e duplicada: ver
 * `resilience.ts`. A espera tem backoff exponencial com jitter.
 */
async function resilientFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(input, { ...init, signal: withDeadline(init?.signal, QUERY_TIMEOUT_MS) });
      if (GATEWAY_REFUSED.has(response.status) && attempt < FETCH_RETRIES) {
        await response.body?.cancel().catch(() => undefined);
        await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
        continue;
      }
      return response;
    } catch (error) {
      if (attempt >= FETCH_RETRIES || !isSafeToRetry(error)) throw error;
      await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
    }
  }
}

function configureNeon(): void {
  // O driver do Neon abre uma conexao WebSocket para tudo que precisa de
  // transacao. O Node so passou a ter WebSocket global na versao 22, e quando
  // ele falta o driver nao avisa: a conexao simplesmente nao completa, a
  // funcao estoura o tempo e a tela recebe um 504 sem explicacao. Fornecer o
  // construtor do pacote `ws` tira a versao do Node da equacao -- e o caminho
  // que a propria documentacao do Neon indica para Node.
  neonConfig.webSocketConstructor ??= WebSocketConstructor as never;

  // Consultas simples saem por HTTP, sem abrir WebSocket. Transacoes nao: elas
  // dependem do construtor acima.
  neonConfig.poolQueryViaFetch = true;

  neonConfig.fetchFunction ??= resilientFetch;
}

export interface NeonDatabaseOptions {
  /**
   * Maximo de conexoes WebSocket (transacoes) POR INSTANCIA da funcao.
   *
   * Cada instancia serverless tem o proprio pool: com N instancias, o banco ve
   * ate N x max conexoes. Por isso o padrao e baixo (5) e a string de conexao
   * deve ser a **pooled** (`-pooler`, PgBouncer do Neon), que multiplexa.
   * Consultas simples nao usam o pool: saem por HTTP.
   */
  poolMax?: number;
}

export function createNeonDatabase(connectionString: string, options: NeonDatabaseOptions = {}): DatabaseHandle {
  configureNeon();
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    max: options.poolMax ?? 5,
    // Devolve conexoes ociosas depressa: funcao serverless congelada nao deve
    // segurar conexao no banco.
    idleTimeoutMillis: 10_000,
    // Reabre a conexao depois de N usos, evitando acumulo de estado no servidor.
    maxUses: 5_000,
  });
  // Erro em conexao ociosa (o Neon derrubou-a) sem ouvinte derrubaria o
  // processo. O pool descarta a conexao e abre outra na proxima necessidade.
  pool.on('error', (error: Error) => {
    console.warn(JSON.stringify({ level: 'warn', event: 'db_pool_error', message: error.message }));
  });
  instrumentQueryable(pool);
  const db = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Database;
  return { db, close: () => pool.end() };
}

/**
 * Retorna a conexao compartilhada do processo. Em funcoes serverless a mesma
 * instancia e reaproveitada entre invocacoes do mesmo container.
 */
export function getDatabase(connectionString?: string, options: NeonDatabaseOptions = {}): Database {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL não configurada. Defina a string de conexão do Neon PostgreSQL no ambiente.',
    );
  }
  if (cached && cachedUrl === url) return cached.db;
  cached = createNeonDatabase(url, options);
  cachedUrl = url;
  return cached.db;
}

export async function closeDatabase(): Promise<void> {
  if (cached) {
    await cached.close();
    cached = null;
    cachedUrl = null;
  }
}

/**
 * Permite injetar outra implementacao (por exemplo PGlite nos testes de
 * integracao) mantendo o restante da aplicacao sem alteracoes.
 */
export function setDatabase(handle: DatabaseHandle, url = 'injected'): void {
  cached = handle;
  cachedUrl = url;
}

export { schema };
