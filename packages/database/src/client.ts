import { Pool, neonConfig } from '@neondatabase/serverless';
import WebSocketConstructor from 'ws';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema.js';

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
}

export function createNeonDatabase(connectionString: string): DatabaseHandle {
  configureNeon();
  const pool = new Pool({ connectionString, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
  const db = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Database;
  return { db, close: () => pool.end() };
}

/**
 * Retorna a conexao compartilhada do processo. Em funcoes serverless a mesma
 * instancia e reaproveitada entre invocacoes do mesmo container.
 */
export function getDatabase(connectionString?: string): Database {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL nao configurada. Defina a string de conexao do Neon PostgreSQL no ambiente.',
    );
  }
  if (cached && cachedUrl === url) return cached.db;
  cached = createNeonDatabase(url);
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
