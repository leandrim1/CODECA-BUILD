import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { ensureBaselinePlans } from '@codeca/database';
import { planBillingSchema, planLimitsSchema } from '@codeca/shared';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { fileURLToPath } from 'node:url';
import { runMigrations, type Database } from '@codeca/database';
import { createTestDatabase, type TestDatabase } from '../helpers/database.js';

/**
 * Preparacao do banco no deploy.
 *
 * O caso que mais importa nao e criar os planos -- e **nao** sobrescrever os
 * que ja existem. Preco e limites sao decisao comercial de quem opera, e um
 * deploy nao pode desfazer um ajuste feito no painel mestre.
 */

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

describe('instalacao vazia', () => {
  it('cria os planos padrao, validos para a aplicacao', async () => {
    const result = await ensureBaselinePlans(database.db);

    expect(result.skipped).toBe(false);
    expect(result.plansCreated).toBe(3);

    const rows = await database.db.select().from(schema.plans).orderBy(schema.plans.priceCents);
    expect(rows.map((row) => row.code)).toEqual(['trial', 'essencial', 'profissional']);

    for (const row of rows) {
      // Os mesmos schemas que a API usa ao ler o plano.
      expect(() => planLimitsSchema.parse(row.limits)).not.toThrow();
      expect(() => planBillingSchema.parse(row.billing)).not.toThrow();
    }

    // E o plano que o cadastro procura para abrir a avaliacao.
    const [trial] = await database.db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.code, 'trial'));
    expect(trial).toBeDefined();
  });

  it('rodar de novo nao duplica nem altera nada', async () => {
    await ensureBaselinePlans(database.db);
    const segunda = await ensureBaselinePlans(database.db);

    expect(segunda.skipped).toBe(true);
    expect(segunda.plansCreated).toBe(0);

    const rows = await database.db.select().from(schema.plans);
    expect(rows).toHaveLength(3);
  });
});

describe('instalacao em uso', () => {
  it('nao sobrescreve preco e limites ajustados no painel mestre', async () => {
    await ensureBaselinePlans(database.db);

    // Quem opera ajusta o plano pelo painel.
    await database.db
      .update(schema.plans)
      .set({ priceCents: 24900, name: 'Essencial Plus' })
      .where(eq(schema.plans.code, 'essencial'));

    // Um deploy novo roda a preparacao de novo.
    const result = await ensureBaselinePlans(database.db);
    expect(result.skipped).toBe(true);

    const [essencial] = await database.db
      .select({ priceCents: schema.plans.priceCents, name: schema.plans.name })
      .from(schema.plans)
      .where(eq(schema.plans.code, 'essencial'));

    expect(essencial?.priceCents).toBe(24900);
    expect(essencial?.name).toBe('Essencial Plus');
  });

  it('com qualquer plano presente, nao acrescenta os que faltam', async () => {
    // Instalacao que deliberadamente tem apenas um plano proprio.
    await database.db.insert(schema.plans).values({
      code: 'sob-medida',
      name: 'Sob medida',
      description: 'Plano negociado caso a caso.',
      priceCents: 99900,
      limits: planLimitsSchema.parse({
        maxUsers: 50,
        maxPublishedProperties: 1000,
        maxProjects: 500,
        maxPages: 100,
        maxDomains: 10,
        storageBytes: 50 * 1024 * 1024 * 1024,
        features: [],
      }),
      billing: planBillingSchema.parse({}),
    });

    const result = await ensureBaselinePlans(database.db);
    expect(result.skipped).toBe(true);

    const rows = await database.db.select({ code: schema.plans.code }).from(schema.plans);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('sob-medida');
  });
});

describe('passo de deploy', () => {
  /**
   * O que a Vercel executa no build de producao, contra um banco vazio: as
   * migracoes e, so entao, os planos. Rodado duas vezes seguidas, como dois
   * deploys em sequencia -- o segundo nao pode alterar nada.
   */
  it('prepara um banco vazio e e seguro repetir a cada deploy', async () => {
    const migrationsDir = fileURLToPath(
      new URL('../../packages/database/migrations/', import.meta.url),
    );
    const client = new PGlite();
    const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;

    try {
      const primeiro = {
        migracoes: await runMigrations(db, migrationsDir),
        planos: await ensureBaselinePlans(db),
      };
      expect(primeiro.migracoes.applied.length).toBeGreaterThan(0);
      expect(primeiro.planos.plansCreated).toBe(3);

      const segundo = {
        migracoes: await runMigrations(db, migrationsDir),
        planos: await ensureBaselinePlans(db),
      };
      // Segundo deploy: nada aplicado, nada criado.
      expect(segundo.migracoes.applied).toHaveLength(0);
      expect(segundo.migracoes.skipped.length).toBe(primeiro.migracoes.applied.length);
      expect(segundo.planos.skipped).toBe(true);

      const rows = await db.select({ code: schema.plans.code }).from(schema.plans);
      expect(rows).toHaveLength(3);
    } finally {
      await client.close();
    }
  });
});
