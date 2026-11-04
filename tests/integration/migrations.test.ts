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
const LIMPEZA = '0014_limpeza_do_renderizador.sql';
const SEGMENTOS = '0015_segmentos_por_ramo.sql';
const HOSPEDAGEM = '0016_projeto_de_hospedagem_por_site.sql';
const DOMINIOS_SEM_HOSPEDAGEM = '0017_dominios_sem_hospedagem.sql';
const LIMITE_GERAL = '0018_limite_geral_de_conteudos.sql';
const ACENTOS = '0019_acentos_nos_textos_de_fabrica.sql';
const LOGIN_EXTERNO = '0020_login_com_provedores_externos.sql';
const CODIGOS_DE_ACESSO = '0021_codigos_de_acesso_por_email.sql';
const REMOVIDAS = ['pages', 'page_versions', 'navigation_menus', 'redirects', 'site_settings'];

/**
 * Banco com todas as migracoes **menos** uma, que fica para o teste aplicar.
 *
 * E o unico jeito de exercitar o efeito de uma migracao sobre dado que ja
 * existia: aplicar tudo e so entao criar o dado mostraria o estado final, nao
 * a transicao.
 */
async function bancoAntesDe(alvo: string, tambemAdiadas: readonly string[] = []) {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;
  const todas = await readMigrations(MIGRATIONS_DIR);

  /**
   * `tambemAdiadas` existe por causa do par 0007/0014.
   *
   * As duas mexem nas mesmas tabelas: a 0014 conclui o que a 0007 adiou. Se o
   * banco de partida ja tivesse rodado a 0014, as tabelas estariam derrubadas
   * antes de a 0007 ser testada, e o teste observaria um banco que nao existe
   * na pratica -- um em que a limpeza aconteceu duas vezes.
   */
  const adiadas = new Set([alvo, ...tambemAdiadas]);
  for (const migracao of todas.filter((m) => !adiadas.has(m.name))) {
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

/** Banco com todas as migracoes **menos** a destrutiva e a limpeza. */
async function bancoAntesDaRemocao() {
  const banco = await bancoAntesDe(DESTRUTIVA, [LIMPEZA]);
  return { ...banco, aplicarDestrutiva: banco.aplicar };
}

/**
 * Banco no estado que a 0014 existe para resolver.
 *
 * A 0007 ja rodou e **avisou** -- tabelas de pe, com conteudo -- e e sobre
 * esse banco que a 0014 precisa ser segura.
 */
async function bancoDepoisDoAviso() {
  const banco = await bancoAntesDe(LIMPEZA, [DESTRUTIVA]);
  const todas = await readMigrations(MIGRATIONS_DIR);
  const zeroSete = todas.find((m) => m.name === DESTRUTIVA)!;

  await banco.db.execute(
    sql.raw(`ALTER TABLE "navigation_menus"
             DROP CONSTRAINT "navigation_menus_tenant_id_tenants_id_fk"`),
  );
  await banco.db.execute(
    sql.raw(`INSERT INTO "navigation_menus" ("tenant_id", "key", "label")
             VALUES (gen_random_uuid(), 'principal', 'Menu do editor antigo')`),
  );
  for (const instrucao of zeroSete.statements) {
    await banco.db.execute(sql.raw(instrucao));
  }
  return banco;
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

  /**
   * O conteudo antigo segura a limpeza -- e **nao** segura o deploy.
   *
   * Ate 03/11/2026 a migracao interrompia aqui, e o efeito foi pior do que o
   * problema que evitava: `prepare-db` roda dentro do build, entao a migracao
   * barrada derrubou o deploy inteiro por dias. Nada no ar le estas tabelas,
   * entao falhar o build por causa delas protegia zero e bloqueava tudo.
   *
   * O que o teste exige continua sendo o essencial -- **nada apagado** -- mais
   * a parte nova: a migracao termina, e as seguintes podem rodar.
   */
  it('mantem tudo e deixa o deploy seguir quando ainda existe conteudo antigo', async () => {
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

      // Nao lanca: o deploy nao pode parar por causa de tabela que ninguem le.
      await expect(banco.aplicarDestrutiva()).resolves.toBeUndefined();

      // O essencial, inalterado: nenhuma tabela derrubada, nenhuma linha
      // perdida. A guarda vem antes de qualquer `DROP`.
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

  /**
   * A 0014 conclui o que a 0007 adiou -- e so quando for seguro.
   *
   * Migracao aplicada nao roda de novo, entao num banco onde a 0007 avisou as
   * tabelas ficariam para sempre sem um segundo ato. A 0014 e esse ato, e
   * repete a mesma regra: tabela com linha dentro nao e tocada.
   */
  it('a 0014 nao apaga tabela que ainda tem conteudo', async () => {
    const banco = await bancoDepoisDoAviso();
    try {
      await expect(banco.aplicar()).resolves.toBeUndefined();

      // A que tinha conteudo fica; as vazias saem.
      const depois = await tabelas(banco.db);
      expect(depois).toContain('navigation_menus');
      expect(depois).not.toContain('pages');

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
    // A 0015 fica de fora junto: o segmento padrao que ela instala ja liga
    // depoimentos, equipe e FAQ, e o teste precisa do banco **anterior** a
    // 0010 -- um em que esses modulos ainda nao chegaram a site nenhum.
    const banco = await bancoAntesDe(MODULOS_NOVOS, [SEGMENTOS]);
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
    // A 0015 fica de fora junto: o segmento padrao que ela instala ja liga
    // depoimentos, equipe e FAQ, e o teste precisa do banco **anterior** a
    // 0010 -- um em que esses modulos ainda nao chegaram a site nenhum.
    const banco = await bancoAntesDe(MODULOS_NOVOS, [SEGMENTOS]);
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
    // A 0015 fica de fora junto: o segmento padrao que ela instala ja liga
    // depoimentos, equipe e FAQ, e o teste precisa do banco **anterior** a
    // 0010 -- um em que esses modulos ainda nao chegaram a site nenhum.
    const banco = await bancoAntesDe(MODULOS_NOVOS, [SEGMENTOS]);
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

/**
 * Um banco que ficou pela metade antes da transacao existir.
 *
 * Os deploys anteriores a migracao virar transacao podiam deixar exatamente
 * isso: as tabelas da 0012/0013 criadas, as constraints criadas, e o nome
 * **nao** registrado. Sem protecao, toda reexecucao morre em "constraint ja
 * existe" -- e como o executor roda no build, o deploy inteiro para, de
 * forma permanente, ate alguem abrir o banco de producao a mao.
 *
 * O teste reproduz esse estado e exige que a migracao passe por cima dele.
 */
describe('recuperacao de um banco pela metade', () => {
  it('reaplica 0012 e 0013 sobre o que ja existia, sem erro', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;

    try {
      const todas = await readMigrations(MIGRATIONS_DIR);
      const parciais = ['0012_campos_personalizados.sql', '0013_modulos_personalizados.sql'];

      // Aplica tudo, inclusive as duas, mas **sem** registrar as duas: e o
      // estado que a falha no meio deixava.
      for (const migracao of todas) {
        for (const instrucao of migracao.statements) {
          await db.execute(sql.raw(instrucao));
        }
      }
      await db.execute(
        sql.raw(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
                   name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`),
      );
      for (const migracao of todas.filter((m) => !parciais.includes(m.name))) {
        await db.execute(
          sql`insert into ${sql.identifier(MIGRATIONS_TABLE)} (name) values (${migracao.name})`,
        );
      }

      // O executor de verdade reencontra as duas como pendentes.
      const resultado = await runMigrations(db, MIGRATIONS_DIR);
      expect(resultado.applied).toEqual(expect.arrayContaining(parciais));

      // E o schema continua de pe.
      const depois = await tabelas(db);
      expect(depois).toEqual(
        expect.arrayContaining(['site_custom_fields', 'site_custom_modules', 'custom_records']),
      );
    } finally {
      await client.close();
    }
  });
});

/**
 * Segmentos de outros ramos num banco que ja existia.
 *
 * `ensureBaselineSegments` so semeia com a tabela vazia, entao acrescentar
 * entradas em `DEFAULT_SEGMENTS` nao muda nada numa instalacao que ja rodou.
 * Quem leva os novos para la e a 0015 -- sem ela, o catalogo ampliado ficaria
 * so no codigo.
 */
describe('segmentos por ramo', () => {
  const RAMOS_NOVOS = ['institucional', 'restaurante', 'clinica', 'escola', 'varejo', 'prestador'];

  async function codigos(db: Database): Promise<string[]> {
    const linhas = await db.select({ code: schema.segments.code }).from(schema.segments);
    return linhas.map((l) => l.code).sort();
  }

  it('acrescenta os ramos novos sem tocar nos que ja existiam', async () => {
    const banco = await bancoAntesDe(SEGMENTOS);
    try {
      const antes = await codigos(banco.db);
      expect(antes).toEqual(['construtora', 'corretor', 'imobiliaria']);

      await banco.aplicar();

      const depois = await codigos(banco.db);
      // Os tres originais continuam la, com os sites que os usam.
      expect(depois).toEqual(expect.arrayContaining(antes));
      expect(depois).toEqual(expect.arrayContaining(RAMOS_NOVOS));
    } finally {
      await banco.close();
    }
  });

  /**
   * O padrao sai de `construtora` e vai para o neutro.
   *
   * Nao e cosmetico: enquanto `construtora` era o padrao, um restaurante que
   * se cadastrasse abria o painel com Imoveis e Obras ligados.
   */
  it('move o padrao para o segmento neutro', async () => {
    const banco = await bancoAntesDe(SEGMENTOS);
    try {
      const padraoAntes = await banco.db
        .select({ code: schema.segments.code })
        .from(schema.segments)
        .where(eq(schema.segments.isDefault, true));
      expect(padraoAntes.map((l) => l.code)).toEqual(['construtora']);

      await banco.aplicar();

      const padraoDepois = await banco.db
        .select({ code: schema.segments.code })
        .from(schema.segments)
        .where(eq(schema.segments.isDefault, true));
      // Exatamente um, e o neutro: um indice unico parcial garante o resto.
      expect(padraoDepois.map((l) => l.code)).toEqual(['institucional']);
    } finally {
      await banco.close();
    }
  });

  /**
   * Uma escolha deliberada da CODECA IA nao e desfeita.
   *
   * A migracao so move o padrao quando ele ainda e o valor semeado. Se alguem
   * ja escolheu outro no painel mestre, essa decisao fica.
   */
  it('nao mexe no padrao que alguem ja trocou a mao', async () => {
    const banco = await bancoAntesDe(SEGMENTOS);
    try {
      await banco.db
        .update(schema.segments)
        .set({ isDefault: false })
        .where(eq(schema.segments.code, 'construtora'));
      await banco.db
        .update(schema.segments)
        .set({ isDefault: true })
        .where(eq(schema.segments.code, 'corretor'));

      await banco.aplicar();

      const padrao = await banco.db
        .select({ code: schema.segments.code })
        .from(schema.segments)
        .where(eq(schema.segments.isDefault, true));
      expect(padrao.map((l) => l.code)).toEqual(['corretor']);
    } finally {
      await banco.close();
    }
  });

  it('e segura de reaplicar', async () => {
    const banco = await bancoAntesDe(SEGMENTOS);
    try {
      await banco.aplicar();
      const depoisDaPrimeira = await codigos(banco.db);

      await expect(banco.aplicar()).resolves.toBeUndefined();
      expect(await codigos(banco.db)).toEqual(depoisDaPrimeira);
    } finally {
      await banco.close();
    }
  });
});

/**
 * O projeto de hospedagem passa a ser do site.
 *
 * O que a migracao promete e estrutural -- uma coluna nula, um valor de enum, um
 * indice parcial --, entao e conferido no catalogo do Postgres. O
 * `seedDatabase` nao serve para montar o banco anterior: ele usa o schema atual,
 * que ja tem a coluna que ainda nao existe la.
 */
describe('projeto de hospedagem por site', () => {
  async function colunaHosting(db: Database) {
    const r = await db.execute(
      sql.raw(`SELECT is_nullable FROM information_schema.columns
               WHERE table_name = 'sites' AND column_name = 'hosting_project_id'`),
    );
    return resultRows<{ is_nullable: string }>(r)[0] ?? null;
  }

  async function estadosDeDominio(db: Database): Promise<string[]> {
    const r = await db.execute(
      sql.raw(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
               WHERE t.typname = 'domain_status' ORDER BY e.enumsortorder`),
    );
    return resultRows<{ enumlabel: string }>(r).map((l) => l.enumlabel);
  }

  it('acrescenta a coluna (nula) e o estado "registrado", sem tirar nada', async () => {
    // A 0017 fica de fora junto: ela usa o valor `registered`, que a 0016 ainda
    // vai criar. Na pipeline real a ordem garante; o helper aplica "tudo menos
    // um", e sem isto aplicaria a 0017 sobre um banco que nao tem o valor.
    const banco = await bancoAntesDe(HOSPEDAGEM, [DOMINIOS_SEM_HOSPEDAGEM]);
    try {
      expect(await colunaHosting(banco.db), 'a coluna nao existe antes').toBeNull();
      const antes = await estadosDeDominio(banco.db);
      expect(antes).not.toContain('registered');

      await banco.aplicar();

      // Nula: o caso comum, e o que mantem "sem projeto" como padrao seguro.
      expect(await colunaHosting(banco.db)).toEqual({ is_nullable: 'YES' });
      // Apenas acrescenta: nenhum dominio existente muda de estado.
      expect(await estadosDeDominio(banco.db)).toEqual([...antes, 'registered']);
    } finally {
      await banco.close();
    }
  });

  it('e segura de reaplicar', async () => {
    // A 0017 fica de fora junto: ela usa o valor `registered`, que a 0016 ainda
    // vai criar. Na pipeline real a ordem garante; o helper aplica "tudo menos
    // um", e sem isto aplicaria a 0017 sobre um banco que nao tem o valor.
    const banco = await bancoAntesDe(HOSPEDAGEM, [DOMINIOS_SEM_HOSPEDAGEM]);
    try {
      await banco.aplicar();
      await expect(banco.aplicar()).resolves.toBeUndefined();
      expect(await estadosDeDominio(banco.db)).toContain('registered');
    } finally {
      await banco.close();
    }
  });

  /**
   * `ALTER TYPE ... ADD VALUE` nao pode ser *usado* na mesma transacao em que e
   * criado, e `runMigrations` envolve cada arquivo numa. A 0016 so acrescenta e
   * nao usa o valor -- este teste passa o arquivo pelo executor de verdade para
   * garantir que isso continue assim.
   */
  it('passa pelo executor transacional de verdade', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;
    try {
      const resultado = await runMigrations(db, MIGRATIONS_DIR);
      expect(resultado.applied).toContain(HOSPEDAGEM);
      expect(await estadosDeDominio(db)).toContain('registered');
    } finally {
      await client.close();
    }
  });
});

/**
 * Dominios que nunca chegaram a Vercel passam a ser "registrados".
 *
 * Antes, todo dominio nascia esperando a Vercel; sem credenciais ficava em
 * "aguardando DNS" para sempre. Com a regra nova a plataforma so afirma algo
 * sobre DNS quando hospeda o site, e deixar esses dominios assim contradiria a
 * propria explicacao da tela.
 *
 * O criterio que organiza o bloco e o que a migracao **nao** pode tocar:
 * dominio que a Vercel conhece esta la de verdade.
 */
describe('dominios sem hospedagem', () => {
  async function bancoComSite() {
    const banco = await bancoAntesDe(DOMINIOS_SEM_HOSPEDAGEM);
    await seedDatabase(banco.db, {
      demo: { email: 'demo@horizonte.com.br', password: 'senhaSegura123' },
    });
    const [site] = await banco.db
      .select({ id: schema.sites.id, tenantId: schema.sites.tenantId })
      .from(schema.sites);
    return { banco, site: site! };
  }

  async function estados(db: Database): Promise<Record<string, string>> {
    const linhas = await db
      .select({ hostname: schema.domains.hostname, status: schema.domains.status })
      .from(schema.domains);
    return Object.fromEntries(linhas.map((l) => [l.hostname, l.status]));
  }

  function dominio(
    site: { id: string; tenantId: string },
    hostname: string,
    status: 'pending' | 'awaiting_dns' | 'verifying_ownership' | 'active' | 'misconfigured',
    vercelDomainId: string | null,
  ) {
    return { tenantId: site.tenantId, siteId: site.id, hostname, status, vercelDomainId };
  }

  it('converte so o que nunca foi aceito pelo provedor', async () => {
    const { banco, site } = await bancoComSite();
    try {
      await banco.db.insert(schema.domains).values([
        // Nunca chegaram a Vercel: esperavam para sempre.
        dominio(site, 'espera.com.br', 'awaiting_dns', null),
        dominio(site, 'pendente.com.br', 'pending', null),
        dominio(site, 'sem-txt.com.br', 'verifying_ownership', null),
        // A Vercel conhece estes: o estado deles e real e nao se reescreve.
        dominio(site, 'ativo.com.br', 'active', 'ativo.com.br'),
        dominio(site, 'erro.com.br', 'misconfigured', 'erro.com.br'),
        dominio(site, 'dns.com.br', 'awaiting_dns', 'dns.com.br'),
      ]);

      await banco.aplicar();

      expect(await estados(banco.db)).toEqual({
        'espera.com.br': 'registered',
        'pendente.com.br': 'registered',
        'sem-txt.com.br': 'registered',
        'ativo.com.br': 'active',
        'erro.com.br': 'misconfigured',
        'dns.com.br': 'awaiting_dns',
      });
    } finally {
      await banco.close();
    }
  });

  /**
   * Site com projeto de hospedagem e gerenciado: o proximo "verificar" anexa o
   * dominio e traz o estado real. Reescrever antes seria afirmar o que ainda
   * nao se sabe.
   */
  it('nao toca em dominio de site que ja tem projeto de hospedagem', async () => {
    const { banco, site } = await bancoComSite();
    try {
      await banco.db
        .update(schema.sites)
        .set({ hostingProjectId: 'prj_hospedado' })
        .where(eq(schema.sites.id, site.id));
      await banco.db
        .insert(schema.domains)
        .values(dominio(site, 'gerenciado.com.br', 'awaiting_dns', null));

      await banco.aplicar();

      expect(await estados(banco.db)).toEqual({ 'gerenciado.com.br': 'awaiting_dns' });
    } finally {
      await banco.close();
    }
  });

  it('e segura de reaplicar', async () => {
    const { banco, site } = await bancoComSite();
    try {
      await banco.db.insert(schema.domains).values([
        dominio(site, 'espera.com.br', 'awaiting_dns', null),
        dominio(site, 'ativo.com.br', 'active', 'ativo.com.br'),
      ]);

      await banco.aplicar();
      const depoisDaPrimeira = await estados(banco.db);
      await expect(banco.aplicar()).resolves.toBeUndefined();

      expect(await estados(banco.db)).toEqual(depoisDaPrimeira);
    } finally {
      await banco.close();
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


/**
 * Limite geral de conteudos, no lugar de "imoveis" e "obras".
 *
 * A migracao e **aditiva** de proposito: acrescenta `maxContentRecords` e deixa
 * as chaves antigas no JSON, porque a Vercel migra durante o build enquanto a
 * versao anterior do codigo (que exige as duas chaves em cada requisicao) segue
 * no ar. O teste que mais importa e o que prova isso.
 */
describe('limite geral de conteudos', () => {
  const LEGADO = {
    trial: { maxPublishedProperties: 5, maxProjects: 3 },
    essencial: { maxPublishedProperties: 20, maxProjects: 10 },
    profissional: { maxPublishedProperties: 100, maxProjects: 50 },
    empresas: { maxPublishedProperties: 400, maxProjects: 200 },
  } as const;

  const DESCRICAO_ANTIGA: Record<string, string> = {
    trial: 'Para conhecer o painel antes de contratar.',
    essencial: 'Site personalizado com dominio proprio. O conteudo e mantido pela CODECA IA.',
    profissional: 'Site personalizado com painel para a empresa gerenciar o proprio conteudo.',
    empresas: 'Tudo do Profissional, com a hospedagem do site por conta da CODECA IA.',
  };

  /** Banco no estado de ANTES: planos com os limites e as descricoes antigos. */
  async function bancoLegado() {
    const banco = await bancoAntesDe(LIMITE_GERAL);
    await seedDatabase(banco.db, { demo: { email: 'demo@horizonte.com.br', password: 'senhaSegura123' } });
    for (const [codigo, antigo] of Object.entries(LEGADO)) {
      await banco.db.execute(sql`
        update plans
        set limits = (limits - 'maxContentRecords') || ${JSON.stringify(antigo)}::jsonb,
            description = ${DESCRICAO_ANTIGA[codigo]!}
        where code = ${codigo}
      `);
    }
    return banco;
  }

  const limitesDe = async (db: Database, codigo: string) => {
    const [linha] = await db
      .select({ limits: schema.plans.limits })
      .from(schema.plans)
      .where(eq(schema.plans.code, codigo));
    return linha!.limits as unknown as Record<string, unknown>;
  };

  async function novaEmpresa(db: Database, slug: string, overrides: unknown) {
    const [plano] = await db.select({ id: schema.plans.id }).from(schema.plans).where(eq(schema.plans.code, 'trial'));
    const [linha] = await db
      .insert(schema.tenants)
      .values({
        slug,
        legalName: slug,
        displayName: slug,
        planId: plano!.id,
        limitOverrides: overrides as never,
        address: { street: '', number: '', complement: '', neighborhood: '', city: '', state: '', postalCode: '', showFullAddress: true } as never,
      })
      .returning({ id: schema.tenants.id });
    return linha!.id;
  }

  const overridesDe = async (db: Database, id: string) => {
    const [linha] = await db
      .select({ o: schema.tenants.limitOverrides })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, id));
    return linha!.o as Record<string, unknown> | null;
  };

  it('cada plano recebe o limite geral igual ao que tinha em imoveis publicados', async () => {
    const banco = await bancoLegado();
    try {
      await banco.aplicar();
      expect((await limitesDe(banco.db, 'trial')).maxContentRecords).toBe(5);
      expect((await limitesDe(banco.db, 'essencial')).maxContentRecords).toBe(20);
      expect((await limitesDe(banco.db, 'profissional')).maxContentRecords).toBe(100);
      expect((await limitesDe(banco.db, 'empresas')).maxContentRecords).toBe(400);
    } finally {
      await banco.close();
    }
  });

  it('e aditiva: as chaves antigas continuam no JSON para a versao anterior do codigo', async () => {
    const banco = await bancoLegado();
    try {
      await banco.aplicar();
      for (const [codigo, antigo] of Object.entries(LEGADO)) {
        const limites = await limitesDe(banco.db, codigo);
        expect(limites.maxPublishedProperties, codigo).toBe(antigo.maxPublishedProperties);
        expect(limites.maxProjects, codigo).toBe(antigo.maxProjects);
      }
    } finally {
      await banco.close();
    }
  });

  it('nao toca em mais nada do plano: usuarios, dominios, armazenamento, recursos e preco', async () => {
    const banco = await bancoLegado();
    try {
      const antes = await banco.db.select().from(schema.plans);
      await banco.aplicar();
      const depois = await banco.db.select().from(schema.plans);

      for (const plano of antes) {
        const novo = depois.find((p) => p.code === plano.code)!;
        const { maxContentRecords: _nada, ...restante } = novo.limits as unknown as Record<string, unknown>;
        void _nada;
        expect(restante, plano.code).toEqual(plano.limits);
        expect(novo.priceCents, plano.code).toBe(plano.priceCents);
        expect(novo.isActive).toBe(plano.isActive);
      }
    } finally {
      await banco.close();
    }
  });

  it('um plano que o painel mestre criou ou editou mantem a decisao de quem o editou', async () => {
    const banco = await bancoLegado();
    try {
      await banco.db.execute(sql`
        insert into plans (code, name, limits, billing)
        values ('sob-medida', 'Sob medida',
          '{"maxUsers":50,"maxPublishedProperties":1000,"maxProjects":500,"maxDomains":10,"storageBytes":1024,"features":[]}'::jsonb,
          '{"recurrenceType":"MONTHLY","recurrenceInterval":1,"trialDays":null,"paymentMethods":["creditcard"]}'::jsonb)
      `);
      await banco.aplicar();
      expect((await limitesDe(banco.db, 'sob-medida')).maxContentRecords).toBe(1000);
    } finally {
      await banco.close();
    }
  });

  it('nao sobrescreve um limite geral que ja exista (e segura de reaplicar)', async () => {
    const banco = await bancoLegado();
    try {
      await banco.db.execute(sql`
        update plans set limits = limits || '{"maxContentRecords": 777}'::jsonb where code = 'profissional'
      `);
      await banco.aplicar();
      await banco.aplicar();
      expect((await limitesDe(banco.db, 'profissional')).maxContentRecords).toBe(777);
      expect((await limitesDe(banco.db, 'essencial')).maxContentRecords).toBe(20);
    } finally {
      await banco.close();
    }
  });

  describe('ajustes individuais por empresa', () => {
    it('o ajuste de imoveis ou de obras vira ajuste do limite geral, pelo maior valor', async () => {
      const banco = await bancoLegado();
      try {
        const soObras = await novaEmpresa(banco.db, 'so-obras', { maxProjects: 300 });
        const soImoveis = await novaEmpresa(banco.db, 'so-imoveis', { maxPublishedProperties: 60 });
        const ambos = await novaEmpresa(banco.db, 'ambos', { maxPublishedProperties: 50, maxProjects: 80 });
        await banco.aplicar();

        expect((await overridesDe(banco.db, soObras))?.maxContentRecords).toBe(300);
        expect((await overridesDe(banco.db, soImoveis))?.maxContentRecords).toBe(60);
        // Um acordo comercial ja feito nao encolhe: vale o maior dos dois.
        expect((await overridesDe(banco.db, ambos))?.maxContentRecords).toBe(80);
      } finally {
        await banco.close();
      }
    });

    it('nao inventa ajuste onde nao havia, e nao mexe em ajuste de outro limite', async () => {
      const banco = await bancoLegado();
      try {
        const semAjuste = await novaEmpresa(banco.db, 'sem-ajuste', null);
        const outro = await novaEmpresa(banco.db, 'outro-ajuste', { maxUsers: 9, maxDomains: 4 });
        await banco.aplicar();

        expect(await overridesDe(banco.db, semAjuste)).toBeNull();
        expect(await overridesDe(banco.db, outro)).toEqual({ maxUsers: 9, maxDomains: 4 });
      } finally {
        await banco.close();
      }
    });

    it('um ajuste geral que ja existia prevalece', async () => {
      const banco = await bancoLegado();
      try {
        const id = await novaEmpresa(banco.db, 'ja-migrada', { maxContentRecords: 11, maxProjects: 999 });
        await banco.aplicar();
        expect((await overridesDe(banco.db, id))?.maxContentRecords).toBe(11);
      } finally {
        await banco.close();
      }
    });
  });

  describe('descricoes comerciais', () => {
    it('passam a ser as novas, sem citar imovel nem obra, onde ninguem as tinha editado', async () => {
      const banco = await bancoLegado();
      try {
        await banco.aplicar();
        const planos = await banco.db.select({ code: schema.plans.code, d: schema.plans.description }).from(schema.plans);
        const por = Object.fromEntries(planos.map((p) => [p.code, p.d]));
        expect(por.essencial).toBe('Site personalizado com domínio próprio e gestão de conteúdo realizada pela equipe CODECA IA.');
        expect(por.profissional).toBe('Mais autonomia para sua empresa administrar e atualizar o próprio site.');
        expect(por.empresas).toBe('Uma solução ampliada para empresas que precisam de gestão de conteúdo, equipe e hospedagem.');
        expect(por.trial).toBe('Para conhecer o painel e visualizar o funcionamento da plataforma.');
      } finally {
        await banco.close();
      }
    });

    it('uma descricao que o painel mestre ja tinha editado nao e desfeita', async () => {
      const banco = await bancoLegado();
      try {
        await banco.db.execute(sql`update plans set description = 'Texto escolhido pela CODECA IA.' where code = 'essencial'`);
        await banco.aplicar();
        const [plano] = await banco.db.select({ d: schema.plans.description }).from(schema.plans).where(eq(schema.plans.code, 'essencial'));
        expect(plano!.d).toBe('Texto escolhido pela CODECA IA.');
      } finally {
        await banco.close();
      }
    });
  });
});

describe('acentos nos textos de fabrica', () => {
  /** Banco como ele estava: o seed gravou os textos sem acento. */
  async function bancoLegado() {
    const banco = await bancoAntesDe(ACENTOS);
    await seedDatabase(banco.db, { demo: { email: 'demo@horizonte.com.br', password: 'senhaSegura123' } });
    await banco.db.execute(sql`update plans set name = 'Avaliacao' where code = 'trial'`);
    await banco.db.execute(sql`
      update segments
      set name = 'Clinica ou consultorio',
          description = 'Especialidades, corpo clinico e agendamento por contato.'
      where code = 'clinica'
    `);
    await banco.db.execute(sql`
      update segments set name = 'Imobiliaria', description = 'Carteira de imoveis e servicos.' where code = 'imobiliaria'
    `);
    return banco;
  }

  const planoDe = async (db: Database, codigo: string) => {
    const [linha] = await db.select({ n: schema.plans.name }).from(schema.plans).where(eq(schema.plans.code, codigo));
    return linha!.n;
  };
  const segmentoDe = async (db: Database, codigo: string) => {
    const [linha] = await db
      .select({ n: schema.segments.name, d: schema.segments.description })
      .from(schema.segments)
      .where(eq(schema.segments.code, codigo));
    return linha!;
  };

  it('acentua o que ainda esta como a fabrica gravou', async () => {
    const banco = await bancoLegado();
    try {
      await banco.aplicar();
      expect(await planoDe(banco.db, 'trial')).toBe('Avaliação');
      expect(await segmentoDe(banco.db, 'clinica')).toEqual({
        n: 'Clínica ou consultório',
        d: 'Especialidades, corpo clínico e agendamento por contato.',
      });
      expect(await segmentoDe(banco.db, 'imobiliaria')).toEqual({
        n: 'Imobiliária',
        d: 'Carteira de imóveis e serviços.',
      });
    } finally {
      await banco.close();
    }
  });

  it('nao desfaz um nome ou uma descricao que o painel mestre ja editou', async () => {
    const banco = await bancoLegado();
    try {
      await banco.db.execute(sql`update plans set name = 'Teste gratis' where code = 'trial'`);
      await banco.db.execute(sql`
        update segments set name = 'Clinica da familia', description = 'Texto proprio.' where code = 'clinica'
      `);
      await banco.aplicar();
      expect(await planoDe(banco.db, 'trial')).toBe('Teste gratis');
      expect(await segmentoDe(banco.db, 'clinica')).toEqual({ n: 'Clinica da familia', d: 'Texto proprio.' });
    } finally {
      await banco.close();
    }
  });

  it('e segura de reaplicar', async () => {
    const banco = await bancoLegado();
    try {
      await banco.aplicar();
      await banco.aplicar();
      expect(await planoDe(banco.db, 'trial')).toBe('Avaliação');
    } finally {
      await banco.close();
    }
  });
});

describe('login com provedores externos', () => {
  async function bancoComUsuarios() {
    const banco = await bancoAntesDe(LOGIN_EXTERNO);
    await seedDatabase(banco.db, { demo: { email: 'demo@horizonte.com.br', password: 'senhaSegura123' } });
    return banco;
  }

  const usuarios = (db: Database) =>
    db
      .select({ id: schema.users.id, email: schema.users.email, hash: schema.users.passwordHash })
      .from(schema.users);

  it('so acrescenta: nenhum usuario, senha ou vinculo existente e tocado', async () => {
    const banco = await bancoComUsuarios();
    try {
      const antes = await usuarios(banco.db);
      const vinculosAntes = await banco.db.select().from(schema.memberships);
      expect(antes.length).toBeGreaterThan(0);

      await banco.aplicar();

      expect(await usuarios(banco.db)).toEqual(antes);
      expect(await banco.db.select().from(schema.memberships)).toEqual(vinculosAntes);
      expect(await banco.db.select().from(schema.userIdentities)).toHaveLength(0);
      expect(await banco.db.select().from(schema.oauthStates)).toHaveLength(0);
    } finally {
      await banco.close();
    }
  });

  it('uma conta Google pertence a um usuario so, e um usuario tem uma conta Google so', async () => {
    const banco = await bancoComUsuarios();
    try {
      await banco.aplicar();
      const [a] = await usuarios(banco.db);
      const [b] = await banco.db
        .insert(schema.users)
        .values({ email: 'outro@x.com.br', name: 'Outro', passwordHash: null })
        .returning({ id: schema.users.id });
      const identidade = (userId: string, sub: string) =>
        banco.db.insert(schema.userIdentities).values({ userId, provider: 'google', providerSubject: sub });

      await identidade(a!.id, 'sub-1');
      // Mesma conta Google em outro usuario: recusado pelo banco.
      await expect(identidade(b!.id, 'sub-1')).rejects.toThrow();
      // Segunda conta Google para o mesmo usuario: recusado pelo banco.
      await expect(identidade(a!.id, 'sub-2')).rejects.toThrow();
      // Outro provedor para o mesmo usuario seria permitido (um por provedor).
      await banco.db.insert(schema.userIdentities).values({ userId: a!.id, provider: 'outro', providerSubject: 'sub-1' });
      expect(await banco.db.select().from(schema.userIdentities)).toHaveLength(2);
    } finally {
      await banco.close();
    }
  });

  it('apagar o usuario apaga os vinculos e os estados do fluxo dele, sem deixar orfao', async () => {
    const banco = await bancoComUsuarios();
    try {
      await banco.aplicar();
      const [usuario] = await banco.db
        .insert(schema.users)
        .values({ email: 'google@x.com.br', name: 'G', passwordHash: null })
        .returning({ id: schema.users.id });
      await banco.db.insert(schema.userIdentities).values({ userId: usuario!.id, provider: 'google', providerSubject: 'sub-z' });
      await banco.db.insert(schema.oauthStates).values({
        stateHash: 'hash-1',
        provider: 'google',
        intent: 'link',
        userId: usuario!.id,
        expiresAt: new Date(Date.now() + 600_000),
      });

      await banco.db.delete(schema.users).where(eq(schema.users.id, usuario!.id));

      expect(await banco.db.select().from(schema.userIdentities)).toHaveLength(0);
      expect(await banco.db.select().from(schema.oauthStates)).toHaveLength(0);
    } finally {
      await banco.close();
    }
  });

  it('o state e unico (nao se registra o mesmo duas vezes)', async () => {
    const banco = await bancoComUsuarios();
    try {
      await banco.aplicar();
      const linha = { stateHash: 'mesmo', provider: 'google', intent: 'continue', expiresAt: new Date(Date.now() + 600_000) };
      await banco.db.insert(schema.oauthStates).values(linha);
      await expect(banco.db.insert(schema.oauthStates).values(linha)).rejects.toThrow();
    } finally {
      await banco.close();
    }
  });

  it('e segura de reaplicar', async () => {
    const banco = await bancoComUsuarios();
    try {
      await banco.aplicar();
      await banco.aplicar();
      expect(await banco.db.select().from(schema.userIdentities)).toHaveLength(0);
    } finally {
      await banco.close();
    }
  });
});

describe('codigos de acesso por e-mail', () => {
  it('so acrescenta a tabela: usuarios e senhas existentes ficam como estavam', async () => {
    const banco = await bancoAntesDe(CODIGOS_DE_ACESSO);
    try {
      await seedDatabase(banco.db, { demo: { email: 'demo@horizonte.com.br', password: 'senhaSegura123' } });
      const antes = await banco.db.select({ id: schema.users.id, hash: schema.users.passwordHash }).from(schema.users);

      await banco.aplicar();

      expect(await banco.db.select({ id: schema.users.id, hash: schema.users.passwordHash }).from(schema.users)).toEqual(antes);
      expect(await banco.db.select().from(schema.loginCodes)).toHaveLength(0);
    } finally {
      await banco.close();
    }
  });

  it('guarda hash (nao o codigo), conta tentativas e aceita o ciclo completo de uso', async () => {
    const banco = await bancoAntesDe(CODIGOS_DE_ACESSO);
    try {
      await banco.aplicar();
      const [linha] = await banco.db
        .insert(schema.loginCodes)
        .values({ email: 'a@x.com', codeHash: 'h'.repeat(64), expiresAt: new Date(Date.now() + 600_000) })
        .returning();
      expect(linha).toMatchObject({ attempts: 0, usedAt: null, requestIpHash: '' });

      await banco.db.update(schema.loginCodes).set({ attempts: 3, usedAt: new Date() }).where(eq(schema.loginCodes.id, linha!.id));
      const [depois] = await banco.db.select().from(schema.loginCodes);
      expect(depois?.attempts).toBe(3);
      expect(depois?.usedAt).not.toBeNull();
    } finally {
      await banco.close();
    }
  });

  it('nao depende de usuario: um endereco sem conta tem codigo igual a um com conta', async () => {
    const banco = await bancoAntesDe(CODIGOS_DE_ACESSO);
    try {
      await banco.aplicar();
      await banco.db
        .insert(schema.loginCodes)
        .values({ email: 'ninguem@sem-conta.com', codeHash: 'x', expiresAt: new Date(Date.now() + 1000) });
      expect(await banco.db.select().from(schema.users)).toHaveLength(0);
      expect(await banco.db.select().from(schema.loginCodes)).toHaveLength(1);
    } finally {
      await banco.close();
    }
  });

  it('e segura de reaplicar', async () => {
    const banco = await bancoAntesDe(CODIGOS_DE_ACESSO);
    try {
      await banco.aplicar();
      await banco.aplicar();
      expect(await banco.db.select().from(schema.loginCodes)).toHaveLength(0);
    } finally {
      await banco.close();
    }
  });
});
