import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, schema, seedDatabase, sql } from '@codeca/database';
import { createTestDatabase, resultRows, type TestDatabase } from '../helpers/database.js';

let ctx: TestDatabase;

beforeAll(async () => {
  ctx = await createTestDatabase();
});

afterAll(async () => {
  await ctx.close();
});

const EMPTY_ADDRESS = {
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '' as const,
  postalCode: '',
  showFullAddress: true,
};

describe('migracoes e restricoes do schema', () => {
  it('cria todas as tabelas exigidas pelo projeto', async () => {
    const result = await ctx.db.execute(
      sql.raw(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`),
    );
    const names = resultRows<{ table_name: string }>(result).map((r) => r.table_name);

    for (const expected of [
      'plans', 'tenants', 'users', 'memberships', 'sessions', 'user_tokens', 'subscriptions',
      'audit_logs', 'support_access_grants', 'rate_limits', 'domains', 'site_settings', 'pages',
      'page_versions', 'navigation_menus', 'media_assets', 'redirects', 'properties',
      'property_images', 'projects', 'project_images', 'project_updates', 'project_update_images',
      'services', 'testimonials', 'team_members', 'faqs', 'leads', 'lead_notes',
    ]) {
      expect(names, `tabela ${expected}`).toContain(expected);
    }
  });

  it('impede que o mesmo dominio seja vinculado a duas empresas', async () => {
    const { tenantA, tenantB } = await seedTwoTenants();
    await ctx.db.insert(schema.domains).values({ tenantId: tenantA, hostname: 'www.exemplo.com.br' });
    await expect(
      ctx.db.insert(schema.domains).values({ tenantId: tenantB, hostname: 'www.exemplo.com.br' }),
    ).rejects.toThrow();
  });

  it('permite apenas um dominio principal por empresa', async () => {
    const { tenantA } = await seedTwoTenants();
    await ctx.db.insert(schema.domains).values({ tenantId: tenantA, hostname: 'a.exemplo.com.br', isPrimary: true });
    await expect(
      ctx.db.insert(schema.domains).values({ tenantId: tenantA, hostname: 'b.exemplo.com.br', isPrimary: true }),
    ).rejects.toThrow();
    await expect(
      ctx.db.insert(schema.domains).values({ tenantId: tenantA, hostname: 'c.exemplo.com.br', isPrimary: false }),
    ).resolves.toBeDefined();
  });

  it('permite slugs iguais em empresas diferentes e bloqueia duplicatas na mesma', async () => {
    const { tenantA, tenantB } = await seedTwoTenants();
    const base = {
      slug: 'residencial-aurora',
      title: 'Residencial Aurora',
      type: 'apartamento' as const,
      purpose: 'venda' as const,
      address: EMPTY_ADDRESS,
    };
    await ctx.db.insert(schema.properties).values({ ...base, tenantId: tenantA });
    await expect(ctx.db.insert(schema.properties).values({ ...base, tenantId: tenantB })).resolves.toBeDefined();
    await expect(ctx.db.insert(schema.properties).values({ ...base, tenantId: tenantA })).rejects.toThrow();
  });


  it('apaga o conteudo da empresa em cascata ao excluir o tenant', async () => {
    const { tenantA } = await seedTwoTenants();
    await ctx.db
      .insert(schema.leads)
      .values({ tenantId: tenantA, name: 'Teste', phone: '1199999999', interestType: 'orcamento' });
    await ctx.db.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
    const leftovers = await ctx.db.select().from(schema.leads).where(eq(schema.leads.tenantId, tenantA));
    expect(leftovers).toHaveLength(0);
  });

  it('recusa valores fora dos enums definidos no banco', async () => {
    const { tenantA } = await seedTwoTenants();
    await expect(
      ctx.db.execute(
        sql`insert into leads (tenant_id, name, phone, interest_type) values (${tenantA}, 'X', '1', 'tipo_inexistente')`,
      ),
    ).rejects.toThrow();
  });

  it('transacao desfaz tudo quando uma etapa falha', async () => {
    const { tenantA } = await seedTwoTenants();
    await expect(
      ctx.db.transaction(async (tx) => {
        await tx.insert(schema.services).values({ tenantId: tenantA, slug: 'ok', title: 'Servico valido' });
        await tx.insert(schema.services).values({ tenantId: tenantA, slug: 'ok', title: 'Slug duplicado' });
      }),
    ).rejects.toThrow();
    const after = await ctx.db.select().from(schema.services).where(eq(schema.services.tenantId, tenantA));
    expect(after).toHaveLength(0);
  });
});

describe('seed', () => {
  it('cria os planos padrao de forma idempotente', async () => {
    await ctx.reset();
    const first = await seedDatabase(ctx.db);
    const second = await seedDatabase(ctx.db);
    expect(first.plans).toBe(3);
    expect(second.plans).toBe(3);
    const rows = await ctx.db.select().from(schema.plans);
    expect(rows).toHaveLength(3);
    expect(rows.map((p) => p.code).sort()).toEqual(['essencial', 'profissional', 'trial']);
  });

  it('cria administrador da plataforma e construtora de demonstracao com conteudo', async () => {
    await ctx.reset();
    const result = await seedDatabase(ctx.db, {
      platformAdmin: { email: 'Admin@Plataforma.com', password: 'senhaSegura123' },
      demo: { email: 'demo@horizonte.com.br', password: 'senhaSegura123' },
    });
    expect(result.platformAdminId).not.toBeNull();
    expect(result.demoTenantId).not.toBeNull();

    const [admin] = await ctx.db.select().from(schema.users).where(eq(schema.users.email, 'admin@plataforma.com'));
    expect(admin?.platformRole).toBe('platform_admin');
    expect(admin?.passwordHash?.startsWith('scrypt$')).toBe(true);

    const tenantId = result.demoTenantId as string;
    const published = await ctx.db
      .select()
      .from(schema.properties)
      .where(and(eq(schema.properties.tenantId, tenantId), eq(schema.properties.publicationStatus, 'published')));
    expect(published.length).toBeGreaterThan(0);

    // Depoimento sem autorizacao do autor nunca fica publicado.
    const unauthorized = await ctx.db
      .select()
      .from(schema.testimonials)
      .where(and(eq(schema.testimonials.tenantId, tenantId), eq(schema.testimonials.authorizationConfirmed, false)));
    expect(unauthorized.length).toBeGreaterThan(0);
    expect(unauthorized.every((t) => t.publicationStatus !== 'published')).toBe(true);
  });

  it('nao recria a construtora de demonstracao em execucoes seguintes', async () => {
    const before = await ctx.db.select().from(schema.tenants);
    await seedDatabase(ctx.db, { demo: { email: 'demo@horizonte.com.br', password: 'senhaSegura123' } });
    const after = await ctx.db.select().from(schema.tenants);
    expect(after).toHaveLength(before.length);
  });
});

async function seedTwoTenants(): Promise<{ tenantA: string; tenantB: string }> {
  await ctx.reset();
  const [plan] = await ctx.db
    .insert(schema.plans)
    .values({
      code: 'plano-teste',
      name: 'Plano de teste',
      limits: {
        maxUsers: 5,
        maxPublishedProperties: 50,
        maxProjects: 20,
        maxPages: 10,
        maxDomains: 2,
        storageBytes: 1024,
        features: [],
      },
    })
    .returning();
  const [a] = await ctx.db
    .insert(schema.tenants)
    .values({ slug: 'alpha', legalName: 'Alpha Ltda', displayName: 'Alpha', planId: plan!.id, address: EMPTY_ADDRESS })
    .returning();
  const [b] = await ctx.db
    .insert(schema.tenants)
    .values({ slug: 'beta', legalName: 'Beta Ltda', displayName: 'Beta', planId: plan!.id, address: EMPTY_ADDRESS })
    .returning();
  return { tenantA: a!.id, tenantB: b!.id };
}
