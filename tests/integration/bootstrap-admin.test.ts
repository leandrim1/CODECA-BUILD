import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { createTestApi, registerAccount, type TestApi } from '../helpers/api.js';

/**
 * Primeiro acesso da plataforma.
 *
 * Uma instalacao nova nao tem administrador, e sem ele o painel mestre e
 * inalcancavel. A primeira conta cadastrada assume o papel -- e **somente** a
 * primeira: o teste decisivo aqui e o segundo cadastro continuar comum, porque
 * e ele que separa "instalacao se iniciando sozinha" de "qualquer um vira
 * administrador".
 */

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
});

async function platformRoleOf(userId: string): Promise<string> {
  const [row] = await api.db
    .select({ role: schema.users.platformRole })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return row?.role ?? 'desconhecido';
}

async function countAdmins(): Promise<number> {
  const rows = await api.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.platformRole, 'platform_admin'));
  return rows.length;
}

describe('primeira conta da instalacao', () => {
  it('assume o painel mestre e ja nasce com o e-mail confirmado', async () => {
    const first = await registerAccount(api, {
      email: 'dono@construtorahorizonte.com.br',
      companyName: 'Construtora Horizonte',
    });

    expect(await platformRoleOf(first.userId)).toBe('platform_admin');

    const [user] = await api.db
      .select({ emailVerifiedAt: schema.users.emailVerifiedAt })
      .from(schema.users)
      .where(eq(schema.users.id, first.userId));
    // Sem isso, a instalacao ficaria travada esperando um e-mail que depende
    // de um servico que pode nem estar configurado.
    expect(user?.emailVerifiedAt).not.toBeNull();
  });

  it('a resposta do cadastro avisa que a conta assumiu o painel mestre', async () => {
    const client = api.client();
    const response = await client.post('/api/auth/register', {
      name: 'Responsavel Teste',
      email: 'dono@construtorahorizonte.com.br',
      password: 'senhaSegura123',
      companyName: 'Construtora Horizonte',
      phone: '(19) 99999-0000',
      acceptedTerms: true,
    });

    expect(response.status).toBe(201);
    expect(response.body.becamePlatformAdmin).toBe(true);
    expect(response.body.session.user.platformRole).toBe('platform_admin');
  });

  it('o painel mestre abre para ela, sem nenhum passo manual', async () => {
    const first = await registerAccount(api, {
      email: 'dono@construtorahorizonte.com.br',
      companyName: 'Construtora Horizonte',
    });

    const overview = await first.client.get('/api/platform/overview');
    expect(overview.status, overview.errorMessage ?? '').toBe(200);
    expect(overview.body.tenants.total).toBeGreaterThan(0);
  });
});

describe('contas seguintes', () => {
  it('nao sao promovidas: so a primeira assume', async () => {
    const first = await registerAccount(api, {
      email: 'dono@construtorahorizonte.com.br',
      companyName: 'Construtora Horizonte',
    });
    const second = await registerAccount(api, {
      email: 'outro@construtoraoutra.com.br',
      companyName: 'Construtora Outra',
    });
    const third = await registerAccount(api, {
      email: 'terceiro@construtoraterceira.com.br',
      companyName: 'Construtora Terceira',
    });

    expect(await platformRoleOf(first.userId)).toBe('platform_admin');
    expect(await platformRoleOf(second.userId)).toBe('none');
    expect(await platformRoleOf(third.userId)).toBe('none');
    expect(await countAdmins()).toBe(1);
  });

  it('a segunda conta recebe 403 no painel mestre', async () => {
    await registerAccount(api, {
      email: 'dono@construtorahorizonte.com.br',
      companyName: 'Construtora Horizonte',
    });
    const second = await registerAccount(api, {
      email: 'outro@construtoraoutra.com.br',
      companyName: 'Construtora Outra',
    });

    const response = await second.client.get('/api/platform/overview');
    expect(response.status).toBe(403);
    expect(response.body.becamePlatformAdmin).toBeUndefined();
  });

  it('cadastros simultaneos nao geram dois administradores', async () => {
    // O lock de transacao serializa a reivindicacao.
    const cadastros = ['a', 'b', 'c', 'd'].map((letra) =>
      registerAccount(api, {
        email: `dono-${letra}@construtora-${letra}.com.br`,
        companyName: `Construtora ${letra.toUpperCase()}`,
      }),
    );
    await Promise.all(cadastros);

    expect(await countAdmins()).toBe(1);
  });

  it('um administrador vindo do seed impede qualquer promocao', async () => {
    // Instalacao preparada pelo `pnpm db:seed`: o cadastro seguinte e comum.
    await api.db.insert(schema.users).values({
      email: 'admin@codecabuild.test',
      name: 'Administrador da plataforma',
      passwordHash: 'x',
      platformRole: 'platform_admin',
      emailVerifiedAt: new Date(),
    });

    const account = await registerAccount(api, {
      email: 'dono@construtorahorizonte.com.br',
      companyName: 'Construtora Horizonte',
    });

    expect(await platformRoleOf(account.userId)).toBe('none');
    expect(await countAdmins()).toBe(1);
  });
});

describe('restricao por e-mail', () => {
  it('com PLATFORM_ADMIN_EMAIL, so o endereco indicado assume', async () => {
    const restrito = await createTestApi({
      env: { PLATFORM_ADMIN_EMAIL: 'dono@construtorahorizonte.com.br' },
    });
    try {
      // Chega antes, mas nao e o endereco indicado: continua conta comum.
      const intruso = await registerAccount(restrito, {
        email: 'qualquer@pessoa.com.br',
        companyName: 'Construtora Qualquer',
      });
      const [intrusoRow] = await restrito.db
        .select({ role: schema.users.platformRole })
        .from(schema.users)
        .where(eq(schema.users.id, intruso.userId));
      expect(intrusoRow?.role).toBe('none');

      // O endereco indicado assume, mesmo nao sendo o primeiro cadastro.
      const dono = await registerAccount(restrito, {
        email: 'dono@construtorahorizonte.com.br',
        companyName: 'Construtora Horizonte',
      });
      const [donoRow] = await restrito.db
        .select({ role: schema.users.platformRole })
        .from(schema.users)
        .where(eq(schema.users.id, dono.userId));
      expect(donoRow?.role).toBe('platform_admin');
    } finally {
      await restrito.close();
    }
  });
});
