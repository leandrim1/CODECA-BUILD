import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/**
 * Executor de migracoes versionadas.
 *
 * Aplica os arquivos `.sql` gerados pelo drizzle-kit em ordem e registra o que
 * foi aplicado em `__codeca_migrations`. E independente do driver, por isso
 * funciona tanto no Neon quanto no Postgres em processo usado nos testes.
 */

export const MIGRATIONS_TABLE = '__codeca_migrations';

export function migrationsDirectory(): string {
  return fileURLToPath(new URL('../migrations/', import.meta.url));
}

export interface MigrationFile {
  name: string;
  statements: string[];
}

export async function readMigrations(directory = migrationsDirectory()): Promise<MigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    throw new Error(`Diretorio de migracoes nao encontrado: ${directory}. Rode "pnpm db:generate".`);
  }
  const files = entries.filter((name) => name.endsWith('.sql')).sort();
  const migrations: MigrationFile[] = [];
  for (const name of files) {
    const content = await readFile(path.join(directory, name), 'utf8');
    const statements = content
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0 && !/^(--[^\n]*\n?)*$/.test(statement));
    migrations.push({ name, statements });
  }
  return migrations;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(db: Database, directory?: string): Promise<MigrateResult> {
  const migrations = await readMigrations(directory);
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    ),
  );
  // Drivers diferentes devolvem a lista direta ou um objeto com `rows`.
  const existing = (await db.execute(sql.raw(`SELECT name FROM ${MIGRATIONS_TABLE}`))) as
    | Array<{ name: string }>
    | { rows: Array<{ name: string }> };
  const rows = Array.isArray(existing) ? existing : (existing.rows ?? []);
  const done = new Set(rows.map((row) => row.name));

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.name)) {
      skipped.push(migration.name);
      continue;
    }
    /**
     * Cada migracao e uma transacao, junto com o proprio registro dela.
     *
     * Sem isso, uma falha no meio do arquivo deixava o banco em estado
     * impossivel de consertar sozinho: os comandos anteriores ficavam
     * aplicados, o nome **nao** era registrado, e o deploy seguinte reexecutava
     * o arquivo desde o inicio. `CREATE TABLE IF NOT EXISTS` sobrevive a isso;
     * `ALTER TABLE ... ADD CONSTRAINT` nao -- e existem mais de cem deles.
     * O segundo deploy falhava com "constraint ja existe" e todos os
     * seguintes tambem, ate alguem abrir o banco e corrigir a mao.
     *
     * O Postgres faz DDL transacional, entao a garantia e real: ou a migracao
     * inteira entra e fica registrada, ou nada dela entrou. Nenhuma migracao
     * usa `CREATE INDEX CONCURRENTLY`, que e o comando que nao aceitaria
     * transacao -- se algum dia uma usar, este laco precisa saber disso.
     */
    await db.transaction(async (tx) => {
      for (const statement of migration.statements) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(
        sql`insert into ${sql.identifier(MIGRATIONS_TABLE)} (name) values (${migration.name})`,
      );
    });
    applied.push(migration.name);
  }
  return { applied, skipped };
}
