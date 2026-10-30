import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import type { Database, DatabaseHandle } from '@codeca/database';
import { runMigrations, schema } from '@codeca/database';

/**
 * Banco de testes: Postgres real rodando em processo (PGlite).
 *
 * As migracoes aplicadas sao exatamente as mesmas enviadas ao Neon, portanto os
 * testes validam chaves estrangeiras, indices unicos parciais, enums e
 * transacoes de verdade -- inclusive os testes de isolamento entre empresas.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));

/** Todas as tabelas de dados, exceto o controle de migracoes. */
const DATA_TABLES = [
  'billing_audit_logs',
  'webhook_events',
  'charges',
  'audit_logs',
  'support_access_grants',
  'rate_limits',
  'lead_notes',
  'leads',
  'faqs',
  'team_members',
  'testimonials',
  'services',
  'project_update_images',
  'project_updates',
  'project_images',
  'projects',
  'property_images',
  'properties',
  'media_assets',
  'domains',
  'subscriptions',
  'sessions',
  'user_tokens',
  'memberships',
  'tenants',
  'users',
  'plans',
] as const;

export interface TestDatabase extends DatabaseHandle {
  db: Database;
  /** Limpa todos os dados preservando o schema. */
  reset: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;
  await runMigrations(db, MIGRATIONS_DIR);
  return {
    db,
    close: () => client.close(),
    reset: async () => {
      await db.execute(sql.raw(`TRUNCATE TABLE ${DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`));
    },
  };
}

/** Normaliza o retorno de `db.execute` entre drivers. */
export function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] } | null)?.rows;
  return rows ?? [];
}
