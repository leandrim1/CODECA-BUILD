import { Pool, neonConfig } from '@neondatabase/serverless';
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

function configureNeon(): void {
  // O Node 22 traz WebSocket global; em runtimes mais antigos o driver avisa.
  if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket !== 'undefined') {
    neonConfig.webSocketConstructor = globalThis.WebSocket as never;
  }
  neonConfig.poolQueryViaFetch = true;
}

export function createNeonDatabase(connectionString: string): DatabaseHandle {
  configureNeon();
  const pool = new Pool({ connectionString });
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
