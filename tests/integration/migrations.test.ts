import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { formatDatabaseFailure, readMigrations, schema, type Database } from '@codeca/database';
import { resultRows } from '../helpers/database.js';

/**
 * A migracao que derruba as tabelas do renderizador.
 *
 * Ela apaga conteudo, e nenhum teste do resto da suite exercita esse caminho:
 * o banco de testes nasce vazio, entao a guarda nunca dispara. Aqui ela
 * dispara de proposito.
 *
 * O que importa provar e a ordem: a conferencia e a **primeira** instrucao, e
 * o executor roda uma instrucao por vez sem transacao envolvendo o arquivo.
 * Se a guarda ficasse depois de qualquer `DROP`, ela avisaria sobre um dado
 * que ja teria sido apagado.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));
const DESTRUTIVA = '0007_remove_tabelas_do_renderizador.sql';
const REMOVIDAS = ['pages', 'page_versions', 'navigation_menus', 'redirects', 'site_settings'];

/** Banco com todas as migracoes **menos** a destrutiva. */
async function bancoAntesDaRemocao() {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;
  const todas = await readMigrations(MIGRATIONS_DIR);

  const anteriores = todas.filter((m) => m.name !== DESTRUTIVA);
  for (const migracao of anteriores) {
    for (const instrucao of migracao.statements) {
      await db.execute(sql.raw(instrucao));
    }
  }

  const destrutiva = todas.find((m) => m.name === DESTRUTIVA);
  expect(destrutiva, `migracao ${DESTRUTIVA} nao encontrada`).toBeDefined();

  return {
    db,
    close: () => client.close(),
    aplicarDestrutiva: async () => {
      for (const instrucao of destrutiva!.statements) {
        await db.execute(sql.raw(instrucao));
      }
    },
  };
}

async function tabelas(db: Database): Promise<string[]> {
  const result = await db.execute(
    sql.raw(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`),
  );
  return resultRows<{ table_name: string }>(result).map((row) => row.table_name);
}

describe('remocao das tabelas do renderizador', () => {
  it('derruba as cinco tabelas quando estao vazias', async () => {
    const banco = await bancoAntesDaRemocao();
    try {
      expect(await tabelas(banco.db)).toEqual(expect.arrayContaining(REMOVIDAS));

      await banco.aplicarDestrutiva();

      const depois = await tabelas(banco.db);
      for (const removida of REMOVIDAS) {
        expect(depois, `tabela ${removida}`).not.toContain(removida);
      }
      // O resto do banco continua de pe: a migracao nao usa CASCADE.
      expect(depois).toEqual(expect.arrayContaining(['tenants', 'sites', 'properties', 'domains']));
    } finally {
      await banco.close();
    }
  });

  it('interrompe e nao apaga nada quando ainda existe conteudo antigo', async () => {
    const banco = await bancoAntesDaRemocao();
    try {
      // A chave estrangeira sai porque o teste e sobre a guarda, nao sobre
      // integridade referencial: montar uma empresa inteira so para ter uma
      // linha aqui testaria o seed, nao a migracao.
      await banco.db.execute(
        sql.raw(`ALTER TABLE "navigation_menus"
                 DROP CONSTRAINT "navigation_menus_tenant_id_tenants_id_fk"`),
      );
      await banco.db.execute(
        sql.raw(`INSERT INTO "navigation_menus" ("tenant_id", "key", "label")
                 VALUES (gen_random_uuid(), 'principal', 'Menu do editor antigo')`),
      );

      // A mensagem do Postgres fica em `cause`: o Drizzle embrulha tudo em
      // `Failed query: <o SQL>`. E por isso que a CLI de migracao desce a
      // cadeia antes de imprimir.
      const erro = await banco.aplicarDestrutiva().then(
        () => null,
        (motivo: unknown) => motivo,
      );
      expect(erro, 'a guarda deveria ter interrompido a migracao').not.toBeNull();
      expect(formatDatabaseFailure(erro)).toMatch(/navigation_menus \(1 linha\(s\)\)/);
      expect(formatDatabaseFailure(erro)).toMatch(/TRUNCATE/);

      // O essencial: falhou **antes** de apagar. Se a guarda tivesse ficado
      // depois de um DROP, este teste encontraria tabelas faltando.
      const depois = await tabelas(banco.db);
      expect(depois).toEqual(expect.arrayContaining(REMOVIDAS));

      const linhas = await banco.db.execute(
        sql.raw(`SELECT count(*)::int AS total FROM "navigation_menus"`),
      );
      expect(resultRows<{ total: number }>(linhas)[0]!.total).toBe(1);
    } finally {
      await banco.close();
    }
  });

  it('a migracao passa num banco onde as tabelas nunca existiram', async () => {
    // Banco criado depois desta migracao nunca teve as tabelas. `IF EXISTS` e
    // `to_regclass` cobrem isso: ausencia nao e erro, senao toda instalacao
    // nova falharia na primeira implantacao.
    const banco = await bancoAntesDaRemocao();
    try {
      await banco.aplicarDestrutiva();
      await expect(banco.aplicarDestrutiva()).resolves.toBeUndefined();
    } finally {
      await banco.close();
    }
  });
});
