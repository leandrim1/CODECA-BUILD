import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MIGRATIONS_TABLE,
  eq,
  formatDatabaseFailure,
  readMigrations,
  runMigrations,
  schema,
  seedDatabase,
  type Database,
} from '@codeca/database';
import { resultRows } from '../helpers/database.js';

/**
 * A migracao que derruba as tabelas do renderizador.
 *
 * Ela apaga conteudo, e nenhum teste do resto da suite exercita esse caminho:
 * o banco de testes nasce vazio, entao a guarda nunca dispara. Aqui ela
 * dispara de proposito.
 *
 * O que importa provar e a ordem: a conferencia e a **primeira** instrucao, e
 * so depois dela vem qualquer `DROP`. Hoje o executor envolve cada arquivo
 * numa transacao, entao um erro tardio desfaria os `DROP` de qualquer forma --
 * mas a ordem continua sendo o que se testa aqui, porque e ela que faz a
 * migracao **avisar** em vez de so desfazer: a mensagem da guarda e o que diz
 * a quem opera que ainda existe conteudo do renderizador antigo.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));

/**
 * Roda o executor de verdade sobre arquivos de ensaio.
 *
 * `runMigrations` le o diretorio; aqui o conteudo e injetado para o teste
 * poder provocar uma falha no meio sem inventar uma migracao no repositorio.
 */
async function aplicar(db: Database, arquivos: Array<{ name: string; statements: string[] }>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'codeca-mig-'));
  for (const arquivo of arquivos) {
    await writeFile(path.join(dir, arquivo.name), arquivo.statements.join('\n--> statement-breakpoint\n'));
  }
  return runMigrations(db, dir);
}
const DESTRUTIVA = '0007_remove_tabelas_do_renderizador.sql';
const MODULOS_NOVOS = '0010_depoimentos_equipe_faq.sql';
const REMOVIDAS = ['pages', 'page_versions', 'navigation_menus', 'redirects', 'site_settings'];

/**
 * Banco com todas as migracoes **menos** uma, que fica para o teste aplicar.
 *
 * E o unico jeito de exercitar o efeito de uma migracao sobre dado que ja
 * existia: aplicar tudo e so entao criar o dado mostraria o estado final, nao
 * a transicao.
 */
async function bancoAntesDe(alvo: string) {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;
  const todas = await readMigrations(MIGRATIONS_DIR);

  for (const migracao of todas.filter((m) => m.name !== alvo)) {
    for (const instrucao of migracao.statements) {
      await db.execute(sql.raw(instrucao));
    }
  }

  const pendente = todas.find((m) => m.name === alvo);
  expect(pendente, `migracao ${alvo} nao encontrada`).toBeDefined();

  return {
    db,
    close: () => client.close(),
    /**
     * Aplica instrucao a instrucao, **sem** a transacao que `runMigrations`
     * usa. E proposital: assim o teste observa o estado no ponto em que a
     * guarda interrompe, que e o que ele existe para verificar. Com a
     * transacao, o `rollback` desfaria tudo antes de qualquer assercao e o
     * teste nao conseguiria distinguir "a guarda parou na hora certa" de "a
     * transacao desfez depois".
     */
    aplicar: async () => {
      for (const instrucao of pendente!.statements) {
        await db.execute(sql.raw(instrucao));
      }
    },
  };
}

/** Banco com todas as migracoes **menos** a destrutiva. */
async function bancoAntesDaRemocao() {
  const banco = await bancoAntesDe(DESTRUTIVA);
  return { ...banco, aplicarDestrutiva: banco.aplicar };
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

describe('depoimentos, equipe e FAQ viram modulos', () => {
  it('habilita os tres nos sites que ja existiam', async () => {
    // As tres telas valiam para todo site antes de serem modulos. O painel
    // esconde o que nao esta habilitado, entao sem este passo a migracao
    // tiraria tres telas de todo cliente no ar.
    const banco = await bancoAntesDe(MODULOS_NOVOS);
    try {
      await seedDatabase(banco.db, {
        demo: { email: 'demo@horizonte.com.br', password: 'senhaSegura123' },
      });

      const [site] = await banco.db.select({ id: schema.sites.id }).from(schema.sites);
      expect(site, 'o seed deveria ter criado um site').toBeDefined();

      const antes = await modulosHabilitados(banco.db, site!.id);
      expect(antes).not.toContain('depoimentos');

      await banco.aplicar();

      const depois = await modulosHabilitados(banco.db, site!.id);
      expect(depois).toEqual(expect.arrayContaining(['depoimentos', 'equipe', 'faq']));
    } finally {
      await banco.close();
    }
  });

  it('nao desfaz a escolha de quem ja tinha configurado o modulo', async () => {
    const banco = await bancoAntesDe(MODULOS_NOVOS);
    try {
      await seedDatabase(banco.db, {
        demo: { email: 'demo@horizonte.com.br', password: 'senhaSegura123' },
      });
      const [site] = await banco.db
        .select({ id: schema.sites.id, tenantId: schema.sites.tenantId })
        .from(schema.sites);

      // Alguem desligou depoimentos para este site antes da migracao.
      await banco.db.insert(schema.siteModules).values({
        tenantId: site!.tenantId,
        siteId: site!.id,
        moduleKey: 'depoimentos',
        enabled: false,
      });

      await banco.aplicar();

      // `ON CONFLICT DO NOTHING`: a migracao preenche o que falta e nao
      // reverte decisao de configuracao.
      expect(await modulosHabilitados(banco.db, site!.id)).not.toContain('depoimentos');
      expect(await modulosHabilitados(banco.db, site!.id)).toContain('equipe');
    } finally {
      await banco.close();
    }
  });

  it('e segura de reaplicar', async () => {
    const banco = await bancoAntesDe(MODULOS_NOVOS);
    try {
      await seedDatabase(banco.db, {
        demo: { email: 'demo@horizonte.com.br', password: 'senhaSegura123' },
      });
      await banco.aplicar();
      await expect(banco.aplicar()).resolves.toBeUndefined();

      const [site] = await banco.db.select({ id: schema.sites.id }).from(schema.sites);
      const linhas = await banco.db
        .select()
        .from(schema.siteModules)
        .where(eq(schema.siteModules.siteId, site!.id));
      const chaves = linhas.map((l) => l.moduleKey);
      expect(new Set(chaves).size).toBe(chaves.length);
    } finally {
      await banco.close();
    }
  });
});

/**
 * A migracao inteira entra, ou nada dela entra.
 *
 * O caso real: uma migracao falha no meio durante o deploy. Antes, os
 * comandos ja executados ficavam aplicados e o nome **nao** era registrado --
 * entao o deploy seguinte reexecutava o arquivo desde o inicio.
 * `CREATE TABLE IF NOT EXISTS` sobrevive a isso; `ALTER TABLE ... ADD
 * CONSTRAINT` nao, e existem mais de cem deles nas migracoes. O segundo
 * deploy falhava com "constraint ja existe", e todos os seguintes tambem,
 * ate alguem abrir o banco de producao e corrigir a mao.
 */
describe('atomicidade das migracoes', () => {
  it('uma migracao que falha no meio nao deixa metade aplicada', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;

    try {
      // Arquivo com duas instrucoes validas e uma invalida no fim.
      const comErro = [
        {
          name: '9999_falha_proposital.sql',
          statements: [
            'CREATE TABLE "ensaio_a" ("id" integer PRIMARY KEY)',
            'CREATE TABLE "ensaio_b" ("id" integer PRIMARY KEY)',
            'ALTER TABLE "ensaio_inexistente" ADD CONSTRAINT "x" PRIMARY KEY ("id")',
          ],
        },
      ];

      await expect(aplicar(db, comErro)).rejects.toThrow();

      // Nenhuma das duas tabelas validas sobreviveu.
      const depois = await tabelas(db);
      expect(depois).not.toContain('ensaio_a');
      expect(depois).not.toContain('ensaio_b');

      // E o arquivo nao ficou registrado como aplicado, entao pode ser
      // reexecutado depois de corrigido.
      const registros = await db.execute(
        sql.raw(`SELECT name FROM ${MIGRATIONS_TABLE}`),
      );
      expect(resultRows<{ name: string }>(registros).map((r) => r.name)).not.toContain(
        '9999_falha_proposital.sql',
      );
    } finally {
      await client.close();
    }
  });

  /**
   * A consequencia pratica: corrigir o arquivo e reexecutar funciona.
   *
   * Sem a transacao, este segundo `runMigrations` falharia -- `ensaio_a` ja
   * existiria e o `ADD CONSTRAINT` repetido seria recusado.
   */
  it('depois da falha, a migracao corrigida aplica limpa', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;

    try {
      await expect(
        aplicar(db, [
          {
            name: '9999_ensaio.sql',
            statements: [
              'CREATE TABLE "ensaio_a" ("id" integer PRIMARY KEY)',
              'ALTER TABLE "ensaio_a" ADD CONSTRAINT "ensaio_a_uk" UNIQUE ("id")',
              'SELECT * FROM "nao_existe"',
            ],
          },
        ]),
      ).rejects.toThrow();

      // Mesmo nome, agora sem a instrucao quebrada.
      await aplicar(db, [
        {
          name: '9999_ensaio.sql',
          statements: [
            'CREATE TABLE "ensaio_a" ("id" integer PRIMARY KEY)',
            'ALTER TABLE "ensaio_a" ADD CONSTRAINT "ensaio_a_uk" UNIQUE ("id")',
          ],
        },
      ]);

      expect(await tabelas(db)).toContain('ensaio_a');
    } finally {
      await client.close();
    }
  });
});

/** Modulos habilitados de um site. */
async function modulosHabilitados(db: Database, siteId: string): Promise<string[]> {
  const linhas = await db
    .select({ moduleKey: schema.siteModules.moduleKey, enabled: schema.siteModules.enabled })
    .from(schema.siteModules)
    .where(eq(schema.siteModules.siteId, siteId));
  return linhas.filter((l) => l.enabled).map((l) => l.moduleKey);
}
