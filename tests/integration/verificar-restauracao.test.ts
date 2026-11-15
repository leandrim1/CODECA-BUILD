import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, schema, sql, verifyRestoredDatabase } from '@codeca/database';
import { createTestApi, registerAccount, type RegisteredAccount, type TestApi } from '../helpers/api.js';

/**
 * A conferência de um banco restaurado.
 *
 * É a ferramenta do ensaio de restauração (`docs/continuidade-operacional.md`,
 * seção 8): antes de alguém apontar a aplicação para um banco restaurado, ela
 * diz se a estrutura bate com a do código, se os dados estão lá e se há
 * registro apontando para o que não existe.
 *
 * Aqui ela roda contra o Postgres em processo dos testes. Isso prova que a
 * conferência detecta os defeitos que deve detectar e que não escreve nada --
 * **não** prova que um backup do Neon existe nem que uma restauração funciona.
 * Isso só o ensaio real, no painel do Neon, responde.
 */

const MIGRACOES = fileURLToPath(new URL('../../packages/database/migrations/', import.meta.url));

let api: TestApi;
let conta: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  conta = await registerAccount(api, { email: 'dona@padaria.com.br', companyName: 'Padaria Central' });
});

const conferir = () => verifyRestoredDatabase(api.db, MIGRACOES);
const check = (relatorio: Awaited<ReturnType<typeof conferir>>, nome: string) =>
  relatorio.checks.find((item) => item.nome === nome)!;

describe('banco íntegro', () => {
  it('aprova, e mostra os números para conferência humana', async () => {
    const relatorio = await conferir();

    expect(relatorio.ok, JSON.stringify(relatorio.checks.filter((item) => !item.ok))).toBe(true);
    expect(relatorio.checks.map((item) => item.nome)).toEqual([
      'conexao', 'migracoes', 'tabelas', 'dados', 'referencias', 'proprietarios',
    ]);
    expect(relatorio.contagens.tenants).toBe(1);
    expect(relatorio.contagens.users).toBe(1);
    expect(relatorio.contagens.subscriptions).toBe(1);
    expect(relatorio.contagens.plans).toBeGreaterThan(0);
  });

  it('não escreve nada', async () => {
    const antes = await api.db.execute(sql`select count(*)::int as total from audit_logs`);
    const relatorio = await conferir();
    const depois = await api.db.execute(sql`select count(*)::int as total from audit_logs`);

    expect(relatorio.ok).toBe(true);
    expect(JSON.stringify(depois)).toBe(JSON.stringify(antes));
  });
});

describe('defeitos que a conferência precisa pegar', () => {
  it('migração faltando: a estrutura é mais antiga que o código', async () => {
    await api.db.execute(
      sql`delete from __codeca_migrations where name = (select max(name) from __codeca_migrations)`,
    );
    try {
      const relatorio = await conferir();
      expect(relatorio.ok).toBe(false);
      expect(check(relatorio, 'migracoes').ok).toBe(false);
      expect(check(relatorio, 'migracoes').detalhe).toContain('Faltam no banco');
    } finally {
      // Devolve o registro: o banco de teste é compartilhado pelo arquivo.
      const { readMigrations } = await import('@codeca/database');
      const ultima = (await readMigrations(MIGRACOES)).at(-1)!.name;
      await api.db.execute(sql`insert into __codeca_migrations (name) values (${ultima}) on conflict do nothing`);
    }
  });

  it('migração desconhecida: o código em uso é mais antigo que o banco', async () => {
    await api.db.execute(sql`insert into __codeca_migrations (name) values ('9999_do_futuro.sql')`);
    try {
      const relatorio = await conferir();
      expect(check(relatorio, 'migracoes').ok).toBe(false);
      expect(check(relatorio, 'migracoes').detalhe).toContain('9999_do_futuro.sql');
    } finally {
      await api.db.execute(sql`delete from __codeca_migrations where name = '9999_do_futuro.sql'`);
    }
  });

  it('empresa sem proprietário: ninguém conseguiria administrá-la', async () => {
    await api.db
      .delete(schema.memberships)
      .where(and(eq(schema.memberships.tenantId, conta.tenantId), eq(schema.memberships.role, 'owner')));

    const relatorio = await conferir();

    expect(relatorio.ok).toBe(false);
    expect(check(relatorio, 'proprietarios').ok).toBe(false);
    expect(check(relatorio, 'proprietarios').detalhe).toContain('1 empresa');
  });

  it('banco vazio não passa por restaurado', async () => {
    await api.db.execute(sql`truncate table plans cascade`);

    const relatorio = await conferir();

    expect(relatorio.ok).toBe(false);
    expect(check(relatorio, 'dados').ok).toBe(false);
  });

  it('tabela principal ausente', async () => {
    await api.db.execute(sql`alter table leads rename to leads_fora`);
    try {
      const relatorio = await conferir();
      expect(check(relatorio, 'tabelas').ok).toBe(false);
      expect(check(relatorio, 'tabelas').detalhe).toContain('leads');
    } finally {
      await api.db.execute(sql`alter table leads_fora rename to leads`);
    }
  });
});
