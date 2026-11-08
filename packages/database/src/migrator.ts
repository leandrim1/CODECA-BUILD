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
    throw new Error(`Diretorio de migrações não encontrado: ${directory}. Rode "pnpm db:generate".`);
  }
  const files = entries.filter((name) => name.endsWith('.sql')).sort();
  const migrations: MigrationFile[] = [];
  for (const name of files) {
    const content = await readFile(path.join(directory, name), 'utf8');
    const statements = content
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0 && hasExecutableSql(statement));
    migrations.push({ name, statements });
  }
  return migrations;
}

/**
 * `true` quando o trecho tem ao menos uma linha que nao e comentario.
 *
 * Serve para descartar o bloco de comentario que abre cada migracao, que
 * viraria um comando vazio.
 *
 * Era uma expressao regular -- `^(--[^\n]*\n?)*$` -- e ela tinha retrocesso
 * catastrofico: o grupo repetido com `\n?` opcional da ao motor duas formas
 * de consumir cada linha, entao um trecho com muitas linhas de comentario
 * seguidas de SQL leva tempo **exponencial** no numero de linhas antes de
 * falhar. Com os cabecalhos curtos das primeiras migracoes isso passou
 * despercebido por muito tempo; uma migracao com um bloco de comentario mais
 * longo travou a carga do banco inteira, e o sintoma era o pior possivel --
 * nenhum erro, nenhuma mensagem, apenas a suite de testes parada consumindo
 * um nucleo.
 *
 * A versao abaixo e linear e diz o que quer dizer.
 */
function hasExecutableSql(statement: string): boolean {
  for (const line of statement.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('--')) continue;
    return true;
  }
  return false;
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
