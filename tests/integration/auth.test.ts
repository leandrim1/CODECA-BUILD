import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  extractToken,
  registerAccount,
  seedPlatformAdmin,
  verifyEmail,
  TEST_APP_ORIGIN,
  type TestApi,
} from '../helpers/api.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  // A instalacao ja tem um administrador (como apos o `pnpm db:seed`): assim
  // as contas abaixo sao usuarios comuns, e nao a primeira conta da
  // instalacao, que assumiria o painel mestre.
  await seedPlatformAdmin(api);
});

describe('cadastro', () => {
  it('cria usuario, construtora e vinculo de proprietario', async () => {
    const account = await registerAccount(api, {
      email: 'marina@horizonte.com.br',
      companyName: 'Construtora Horizonte',
    });

    const [user] = await api.db.select().from(schema.users).where(eq(schema.users.id, account.userId));
    expect(user?.email).toBe('marina@horizonte.com.br');
    expect(user?.passwordHash?.startsWith('scrypt$')).toBe(true);
    expect(user?.platformRole).toBe('none');

    const [membership] = await api.db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.tenantId, account.tenantId));
    expect(membership?.role).toBe('owner');
    expect(membership?.status).toBe('active');

    const [subscription] = await api.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, account.tenantId));
    expect(subscription?.status).toBe('trialing');
  });

  it('recusa e-mail ja cadastrado', async () => {
    await registerAccount(api, { email: 'duplicado@a.com.br', companyName: 'Alpha' });
    const client = api.client();
    const response = await client.post('/api/auth/register', {
      name: 'Outro Nome',
      email: 'duplicado@a.com.br',
      password: 'senhaSegura123',
      companyName: 'Beta',
      acceptedTerms: true,
    });
    expect(response.status).toBe(409);
    expect(response.errorCode).toBe('conflict');
  });

  it('recusa senha fraca com mensagem por campo', async () => {
    const client = api.client();
    const response = await client.post('/api/auth/register', {
      name: 'Teste Fraco',
      email: 'fraco@a.com.br',
      password: 'curta',
      companyName: 'Gamma',
      acceptedTerms: true,
    });
    expect(response.status).toBe(422);
    expect(response.errorCode).toBe('validation_error');
  });

  it('gera slug distinto para empresas com o mesmo nome', async () => {
    const first = await registerAccount(api, { email: 'a@x.com.br', companyName: 'Construtora Igual' });
    const second = await registerAccount(api, { email: 'b@x.com.br', companyName: 'Construtora Igual' });

    const [t1] = await api.db.select().from(schema.tenants).where(eq(schema.tenants.id, first.tenantId));
    const [t2] = await api.db.select().from(schema.tenants).where(eq(schema.tenants.id, second.tenantId));
    expect(t1?.slug).toBe('construtora-igual');
    expect(t2?.slug).toBe('construtora-igual-2');
  });
});

describe('login e sessao', () => {
  it('autentica e devolve a sessao com os vinculos', async () => {
    const account = await registerAccount(api, { email: 'login@a.com.br', companyName: 'Alpha' });
    const client = api.client();

    const response = await client.post('/api/auth/login', {
      email: 'login@a.com.br',
      password: account.password,
      rememberMe: false,
    });

    expect(response.status).toBe(200);
    expect(response.body.session.user.email).toBe('login@a.com.br');
    expect(response.body.session.memberships).toHaveLength(1);
    expect(client.sessionCookie).toBeTruthy();
    expect(client.csrfToken).toBeTruthy();
  });

  it('define cookie de sessao HttpOnly e cookie de CSRF legivel', async () => {
    await registerAccount(api, { email: 'cookies@a.com.br', companyName: 'Alpha' });
    const client = api.client();
    const response = await client.post('/api/auth/login', {
      email: 'cookies@a.com.br',
      password: 'senhaSegura123',
    });

    const cookies = response.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith('codeca_session='));
    const csrf = cookies.find((c) => c.startsWith('codeca_csrf='));
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(csrf).toBeDefined();
    expect(csrf).not.toMatch(/HttpOnly/i);
  });

  it('nao revela se o e-mail existe', async () => {
    await registerAccount(api, { email: 'existe@a.com.br', companyName: 'Alpha' });
    const client = api.client();

    const wrongPassword = await client.post('/api/auth/login', {
      email: 'existe@a.com.br',
      password: 'senhaErrada123',
    });
    const unknownEmail = await client.post('/api/auth/login', {
      email: 'naoexiste@a.com.br',
      password: 'senhaErrada123',
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.errorMessage).toBe(unknownEmail.errorMessage);
  });

  it('bloqueia a conta depois de cinco tentativas incorretas', async () => {
    await registerAccount(api, { email: 'bloqueio@a.com.br', companyName: 'Alpha' });
    const client = api.client();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await client.post('/api/auth/login', {
        email: 'bloqueio@a.com.br',
        password: 'senhaErrada123',
      });
      expect(response.status).toBe(401);
    }

    const blocked = await client.post('/api/auth/login', {
      email: 'bloqueio@a.com.br',
      password: 'senhaSegura123',
    });
    expect(blocked.status).toBe(429);
    expect(blocked.errorMessage).toMatch(/bloqueada/i);
  });

  it('encerra a sessao no logout', async () => {
    const account = await registerAccount(api, { email: 'sair@a.com.br', companyName: 'Alpha' });
    const before = await account.client.get(`/api/tenants/${account.tenantId}`);
    expect(before.status).toBe(200);

    const logout = await account.client.post('/api/auth/logout');
    expect(logout.status).toBe(204);

    const after = await account.client.get(`/api/tenants/${account.tenantId}`);
    expect(after.status).toBe(401);
  });

  it('rejeita cookie de sessao inventado', async () => {
    const account = await registerAccount(api, { email: 'forjado@a.com.br', companyName: 'Alpha' });
    const client = api.client();
    client.setCookie('codeca_session', 'token-inventado-que-nao-existe');
    const response = await client.get(`/api/tenants/${account.tenantId}`);
    expect(response.status).toBe(401);
  });
});

describe('protecao contra CSRF', () => {
  it('recusa escrita sem o cabecalho x-csrf-token', async () => {
    const account = await registerAccount(api, { email: 'csrf@a.com.br', companyName: 'Alpha' });

    const response = await account.client.patch(
      `/api/tenants/${account.tenantId}`,
      { legalName: 'Nome Novo Ltda', displayName: 'Nome Novo', taxId: '', description: '', foundedYear: null, creaNumber: '' },
      { omitCsrf: true },
    );

    expect(response.status).toBe(403);
    expect(response.errorMessage).toMatch(/csrf/i);
  });

  it('recusa escrita com token anti-CSRF de outra sessao', async () => {
    const account = await registerAccount(api, { email: 'csrf2@a.com.br', companyName: 'Alpha' });
    const other = await registerAccount(api, { email: 'csrf3@a.com.br', companyName: 'Beta' });

    const response = await account.client.patch(
      `/api/tenants/${account.tenantId}`,
      { legalName: 'X Ltda', displayName: 'X', taxId: '', description: '', foundedYear: null, creaNumber: '' },
      { headers: { 'x-csrf-token': other.client.csrfToken ?? '' } },
    );

    expect(response.status).toBe(403);
  });

  it('recusa escrita vinda de origem desconhecida', async () => {
    const account = await registerAccount(api, { email: 'origem@a.com.br', companyName: 'Alpha' });

    const response = await account.client.patch(
      `/api/tenants/${account.tenantId}`,
      { legalName: 'X Ltda', displayName: 'X', taxId: '', description: '', foundedYear: null, creaNumber: '' },
      { origin: 'https://site-malicioso.com' },
    );

    expect(response.status).toBe(403);
    expect(response.errorMessage).toMatch(/origem/i);
  });

  it('aceita leitura sem token anti-CSRF', async () => {
    const account = await registerAccount(api, { email: 'leitura@a.com.br', companyName: 'Alpha' });
    const response = await account.client.get(`/api/tenants/${account.tenantId}`);
    expect(response.status).toBe(200);
  });
});

describe('confirmacao de e-mail', () => {
  it('confirma com o token do e-mail e libera operacoes sensiveis', async () => {
    const account = await registerAccount(api, { email: 'confirma@a.com.br', companyName: 'Alpha' });

    // Sem e-mail confirmado, convidar alguem para a empresa e bloqueado.
    const convite = { email: 'equipe@a.com.br', role: 'editor' as const, name: 'Equipe' };
    const blocked = await account.client.post(
      `/api/tenants/${account.tenantId}/members/invite`,
      convite,
    );
    expect(blocked.status).toBe(403);
    expect(blocked.errorCode).toBe('email_not_verified');

    await verifyEmail(api, account);

    const allowed = await account.client.post(
      `/api/tenants/${account.tenantId}/members/invite`,
      convite,
    );
    expect(allowed.status, allowed.errorMessage ?? '').toBe(201);
  });

  it('recusa o mesmo token duas vezes', async () => {
    const account = await registerAccount(api, { email: 'reuso@a.com.br', companyName: 'Alpha' });
    const message = api.outbox.find((m) => m.kind === 'verify_email');
    const token = extractToken(message!.text);

    expect((await account.client.post('/api/auth/verify-email', { token })).status).toBe(200);
    const second = await account.client.post('/api/auth/verify-email', { token });
    expect(second.status).toBe(400);
  });
});

describe('recuperacao de senha', () => {
  it('redefine a senha e encerra as sessoes antigas', async () => {
    const account = await registerAccount(api, { email: 'reset@a.com.br', companyName: 'Alpha' });

    const anonymous = api.client();
    const requested = await anonymous.post('/api/auth/forgot-password', { email: 'reset@a.com.br' });
    expect(requested.status).toBe(200);

    const message = api.outbox.find((m) => m.kind === 'reset_password');
    expect(message).toBeDefined();
    const token = extractToken(message!.text);

    const reset = await anonymous.post('/api/auth/reset-password', { token, password: 'novaSenha4567' });
    expect(reset.status).toBe(200);

    // A sessao anterior foi invalidada.
    const stale = await account.client.get(`/api/tenants/${account.tenantId}`);
    expect(stale.status).toBe(401);

    const relogin = await api.client().post('/api/auth/login', {
      email: 'reset@a.com.br',
      password: 'novaSenha4567',
    });
    expect(relogin.status).toBe(200);
  });

  it('responde igual para e-mail inexistente', async () => {
    const client = api.client();
    const response = await client.post('/api/auth/forgot-password', { email: 'ninguem@a.com.br' });
    expect(response.status).toBe(200);
    expect(api.outbox.filter((m) => m.kind === 'reset_password')).toHaveLength(0);
  });
});

describe('troca de senha', () => {
  it('exige a senha atual e mantem a sessao em uso', async () => {
    const account = await registerAccount(api, { email: 'trocar@a.com.br', companyName: 'Alpha' });

    const wrong = await account.client.post('/api/auth/change-password', {
      currentPassword: 'erradaAbc123',
      newPassword: 'outraSenha789',
    });
    expect(wrong.status).toBe(422);

    const right = await account.client.post('/api/auth/change-password', {
      currentPassword: account.password,
      newPassword: 'outraSenha789',
    });
    expect(right.status).toBe(200);

    const stillValid = await account.client.get(`/api/tenants/${account.tenantId}`);
    expect(stillValid.status).toBe(200);
  });
});

describe('CORS', () => {
  it('nega preflight de origem desconhecida', async () => {
    const client = api.client();
    const response = await client.request('OPTIONS', '/api/auth/login', {
      origin: 'https://site-malicioso.com',
    });
    expect(response.status).toBe(403);
  });

  it('libera preflight da origem do painel', async () => {
    const client = api.client();
    const response = await client.request('OPTIONS', '/api/auth/login', { origin: TEST_APP_ORIGIN });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(TEST_APP_ORIGIN);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });
});

describe('cabecalhos de seguranca', () => {
  it('aplica os cabecalhos de protecao e impede cache da API', async () => {
    const client = api.client();
    const response = await client.get('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('o health identifica a implantacao que respondeu', async () => {
    // Quando a tela diverge do repositorio, esta e a resposta que diz se o
    // problema e o codigo ou o deploy. As chaves existem mesmo fora da Vercel.
    const response = await api.client().get<{
      status: string;
      deployment: Record<string, string | null>;
      database: { query: string; transaction: string } | null;
    }>('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    // Sem `?db=1` o health nao toca no banco: responder sempre e o ponto dele.
    expect(response.body.database).toBeNull();

    const sondado = await api.client().get<{
      status: string;
      database: { query: string; transaction: string };
    }>('/api/health?db=1');
    expect(sondado.status).toBe(200);
    expect(sondado.body.database.query).toBe('ok');
    expect(sondado.body.database.transaction).toBe('ok');
    expect(Object.keys(response.body.deployment).sort()).toEqual([
      'branch',
      'commit',
      'environment',
      'region',
    ]);
  });
});
