import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../helpers/google.js';
import {
  ANALYTICS_KEY,
  ANALYTICS_SCOPE,
  createFakeAnalytics,
  type FakeAccount,
  type FakeAnalytics,
} from '../helpers/google-analytics.js';
import {
  TEST_APP_ORIGIN,
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Integracao com o Google Analytics 4.
 *
 * O que se prova, em ordem de importancia:
 *
 * 1. isolamento: uma empresa nunca ve (nem decifra) a conexao de outra;
 * 2. o token nunca fica em claro: nem no banco, nem na auditoria;
 * 3. o retorno do Google nao pode ser forjado nem reaproveitado;
 * 4. a autorizacao so e pedida no clique, com o escopo minimo, e o login com
 *    Google continua exatamente como era.
 */

const CALLBACK = '/api/integrations/google-analytics/callback';
const CONTA_A: FakeAccount = { name: 'Conta A', properties: [{ id: '111111', name: 'Site A' }, { id: '111112', name: 'Site A (app)' }] };
const CONTA_B: FakeAccount = { name: 'Conta B', properties: [{ id: '222222', name: 'Site B' }] };

let api: TestApi;
let google: FakeAnalytics;
let a: RegisteredAccount;
let b: RegisteredAccount;

beforeAll(async () => {
  google = createFakeAnalytics({ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET });
  api = await createTestApi({
    fetch: google.fetch,
    env: { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, INTEGRATIONS_ENCRYPTION_KEY: ANALYTICS_KEY },
  });
});
afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  google.state.apiDisabled = false;
  google.state.refreshFails = false;
  google.revoked.clear();
  a = await registerAccount(api, { email: 'dono@empresa-a.test', companyName: 'Empresa A' });
  b = await registerAccount(api, { email: 'dono@empresa-b.test', companyName: 'Empresa B' });
  await verifyEmail(api, a);
  await verifyEmail(api, b);
});

const base = (account: RegisteredAccount) => `/api/tenants/${account.tenantId}/analytics`;

async function startUrl(account: RegisteredAccount): Promise<string> {
  const response = await account.client.post(`${base(account)}/connect/start`);
  expect(response.status, response.errorMessage ?? '').toBe(200);
  return response.body.authorizationUrl as string;
}

async function connect(
  account: RegisteredAccount,
  google_account: FakeAccount,
  behavior: { scope?: string; withRefresh?: boolean } = {},
): Promise<string> {
  const url = await startUrl(account);
  const { code, state } = google.authorize(url, google_account, behavior);
  const callback = await account.client.get(`${CALLBACK}?code=${code}&state=${state}`);
  expect(callback.status).toBe(302);
  return callback.headers.get('location') ?? '';
}

async function connectAndSelect(account: RegisteredAccount, google_account: FakeAccount, propertyId: string) {
  expect(await connect(account, google_account)).toContain('analytics=connected');
  const select = await account.client.put(`${base(account)}/property`, { propertyId });
  expect(select.status, select.errorMessage ?? '').toBe(200);
}

describe('configuracao e autorizacao', () => {
  it('informa a URL de retorno exata a cadastrar no Google, distinta da do login', async () => {
    const status = await a.client.get(base(a));
    expect(status.status).toBe(200);
    expect(status.body.available).toBe(true);
    expect(status.body.canManage).toBe(true);
    expect(status.body.connection).toBeNull();
    expect(status.body.redirectUri).toBe(`${TEST_APP_ORIGIN}${CALLBACK}`);
    expect(status.body.redirectUri).not.toContain('/auth/google');
  });

  it('nada e solicitado ao Google antes do clique em Conectar', async () => {
    await a.client.get(base(a));
    await a.client.get('/api/auth/session');
    expect(google.calls).toHaveLength(0);
  });

  it('a autorizacao pede somente leitura do Analytics, offline, com PKCE e state proprio', async () => {
    const url = new URL(await startUrl(a));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(ANALYTICS_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(`${TEST_APP_ORIGIN}${CALLBACK}`);
    expect(url.searchParams.get('client_id')).toBe(GOOGLE_CLIENT_ID);
    expect(url.searchParams.get('scope')).not.toMatch(/openid|email|profile/);
    expect(a.client.getCookie('codeca_ga_state')).toBe(url.searchParams.get('state'));
  });

  it('o login com Google continua pedindo so identidade, com o callback dele', async () => {
    const response = await api.client().post('/api/auth/google/start', { intent: 'continue' });
    expect(response.status, response.errorMessage ?? '').toBe(200);
    const url = new URL(response.body.authorizationUrl as string);
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('access_type')).toBe('online');
    expect(url.searchParams.get('redirect_uri')).toBe(`${TEST_APP_ORIGIN}/api/auth/google/callback`);
    expect(url.searchParams.get('scope')).not.toContain('analytics');
  });
});

describe('conectar, escolher propriedade e ler estatisticas', () => {
  it('fluxo completo: conecta, lista, escolhe e le o relatorio da propriedade escolhida', async () => {
    const location = await connect(a, CONTA_A);
    expect(location).toBe('/painel/estatisticas?analytics=connected');

    let status = await a.client.get(base(a));
    expect(status.body.connection.status).toBe('pending_property');
    expect((await a.client.get(`${base(a)}/report`)).status).toBe(404); // ainda sem propriedade

    const list = await a.client.get(`${base(a)}/properties`);
    expect(list.body.items.map((p: { propertyId: string }) => p.propertyId)).toEqual(['111111', '111112']);

    const select = await a.client.put(`${base(a)}/property`, { propertyId: '111112' });
    expect(select.status, select.errorMessage ?? '').toBe(200);
    status = await a.client.get(base(a));
    expect(status.body.connection).toMatchObject({ status: 'active', propertyId: '111112', propertyName: 'Site A (app)' });

    const report = await a.client.get(`${base(a)}/report?range=7d`);
    expect(report.status, report.errorMessage ?? '').toBe(200);
    expect(report.body.propertyId).toBe('111112');
    expect(report.body.totals).toEqual({ activeUsers: 1112, sessions: 2224, pageViews: 5560, engagementRate: 0.62, avgSessionSeconds: 95 });
    expect(report.body.daily).toEqual([
      { date: '2026-03-14', activeUsers: 3, sessions: 4, pageViews: 9 },
      { date: '2026-03-15', activeUsers: 5, sessions: 6, pageViews: 11 },
    ]);
    expect(report.body.topPages[0].path).toBe('/propriedade-111112');
  });

  it('recusa propriedade que a conta Google conectada nao enxerga', async () => {
    await connect(a, CONTA_A);
    const select = await a.client.put(`${base(a)}/property`, { propertyId: '222222' });
    expect(select.status).toBe(422);
    expect((await a.client.get(base(a))).body.connection.propertyId).toBeNull();
  });

  it('periodo invalido e rejeitado', async () => {
    await connectAndSelect(a, CONTA_A, '111111');
    expect((await a.client.get(`${base(a)}/report?range=1000d`)).status).toBe(422);
  });

  it('desconectar apaga a conexao e revoga o acesso no Google', async () => {
    await connectAndSelect(a, CONTA_A, '111111');
    const [row] = await api.db.select().from(schema.analyticsConnections);
    expect(row).toBeDefined();

    expect((await a.client.delete(base(a))).status).toBe(204);
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(0);
    expect(google.revoked.size).toBe(1);
    expect((await a.client.get(base(a))).body.connection).toBeNull();
    expect((await a.client.get(`${base(a)}/report`)).status).toBe(404);
  });

  it('reconectar com a conexao ativa exige escolher a propriedade de novo', async () => {
    await connectAndSelect(a, CONTA_A, '111111');
    await connect(a, CONTA_B);
    const status = await a.client.get(base(a));
    expect(status.body.connection).toMatchObject({ status: 'pending_property', propertyId: null });
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(1);
  });
});

describe('tokens', () => {
  it('o refresh token fica cifrado e nenhum token aparece no banco nem na auditoria', async () => {
    await connectAndSelect(a, CONTA_A, '111111');
    await a.client.get(`${base(a)}/report`);

    const [row] = await api.db.select().from(schema.analyticsConnections);
    const refreshToken = [...google.refreshTokens.keys()][0]!;
    expect(row!.refreshTokenEnc.startsWith('v1.')).toBe(true);
    const everything = JSON.stringify(row);
    expect(everything).not.toContain(refreshToken);
    expect(everything).not.toMatch(/at-\d+/);

    const audit = JSON.stringify(await api.db.select().from(schema.auditLogs));
    expect(audit).not.toContain(refreshToken);
    expect(audit).not.toMatch(/"at-\d+/);
    expect(audit).toContain('analytics.connected');
    expect(audit).toContain('analytics.property_selected');
  });

  it('nenhuma resposta da API devolve token, cifrado ou nao', async () => {
    await connectAndSelect(a, CONTA_A, '111111');
    const refreshToken = [...google.refreshTokens.keys()][0]!;
    const [row] = await api.db.select().from(schema.analyticsConnections);
    for (const path of ['', '/properties', '/report']) {
      const response = await a.client.get(`${base(a)}${path}`);
      const text = JSON.stringify(response.body);
      expect(text).not.toContain(refreshToken);
      expect(text).not.toContain(row!.refreshTokenEnc);
      expect(text).not.toMatch(/refresh|token/i);
    }
  });

  it('renova o acesso sozinho e, se o Google revogar, pede para reconectar sem perder a propriedade', async () => {
    await connectAndSelect(a, CONTA_A, '111111');
    google.state.refreshFails = true;

    const report = await a.client.get(`${base(a)}/report`);
    expect(report.status).toBe(409);
    expect(report.errorCode).toBe('conflict');
    expect((await a.client.get(base(a))).body.connection).toMatchObject({ status: 'needs_reconnect', propertyId: '111111' });
    // Enquanto precisa reconectar, nem tenta o Google de novo.
    const callsBefore = google.calls.length;
    expect((await a.client.get(`${base(a)}/report`)).status).toBe(409);
    expect(google.calls.length).toBe(callsBefore);

    google.state.refreshFails = false;
    expect(await connect(a, CONTA_A)).toContain('analytics=connected');
    const status = await a.client.get(base(a));
    expect(status.body.connection).toMatchObject({ status: 'active', propertyId: '111111' });
    expect((await a.client.get(`${base(a)}/report`)).status).toBe(200);
  });

  it('API do Google desativada vira mensagem clara, nao erro generico', async () => {
    await connectAndSelect(a, CONTA_A, '111111');
    google.state.apiDisabled = true;
    const report = await a.client.get(`${base(a)}/report`);
    expect(report.status).toBe(502);
    expect(report.errorMessage).toContain('Analytics Data API');
  });
});

describe('isolamento entre empresas', () => {
  it('cada empresa le somente a propriedade que escolheu', async () => {
    await connectAndSelect(a, CONTA_A, '111111');
    await connectAndSelect(b, CONTA_B, '222222');

    const ra = await a.client.get(`${base(a)}/report`);
    const rb = await b.client.get(`${base(b)}/report`);
    expect(ra.body.propertyId).toBe('111111');
    expect(rb.body.propertyId).toBe('222222');
    expect(ra.body.totals.activeUsers).toBe(1111);
    expect(rb.body.totals.activeUsers).toBe(2222);
    expect(JSON.stringify(ra.body)).not.toContain('222222');
    expect(JSON.stringify(rb.body)).not.toContain('111111');
  });

  it('uma empresa nao enxerga nem altera a conexao de outra (404, nunca 403)', async () => {
    await connectAndSelect(b, CONTA_B, '222222');
    for (const [method, path, body] of [
      ['GET', '', undefined],
      ['GET', '/report', undefined],
      ['GET', '/properties', undefined],
      ['PUT', '/property', { propertyId: '222222' }],
      ['POST', '/connect/start', undefined],
      ['DELETE', '', undefined],
    ] as const) {
      const response = await a.client.request(method, `/api/tenants/${b.tenantId}/analytics${path}`, body ? { body } : {});
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(1);
  });

  it('o tenantId enviado no corpo e ignorado', async () => {
    await connectAndSelect(b, CONTA_B, '222222');
    await connect(a, CONTA_A);
    await a.client.put(`${base(a)}/property`, { propertyId: '111111', tenantId: b.tenantId, siteId: b.siteId });
    const rows = await api.db.select().from(schema.analyticsConnections);
    const rowB = rows.find((r) => r.tenantId === b.tenantId)!;
    expect(rowB.propertyId).toBe('222222');
    expect(rows.find((r) => r.tenantId === a.tenantId)!.propertyId).toBe('111111');
  });

  it('um token cifrado copiado para a linha de outra empresa nao decifra', async () => {
    await connectAndSelect(a, CONTA_A, '111111');
    await connectAndSelect(b, CONTA_B, '222222');
    const rows = await api.db.select().from(schema.analyticsConnections);
    const rowB = rows.find((r) => r.tenantId === b.tenantId)!;

    // Cenario hostil: alguem com acesso ao banco troca o token de A pelo de B.
    await api.db
      .update(schema.analyticsConnections)
      .set({ refreshTokenEnc: rowB.refreshTokenEnc })
      .where(eq(schema.analyticsConnections.tenantId, a.tenantId));

    const report = await a.client.get(`${base(a)}/report`);
    expect(report.status).not.toBe(200);
    expect(JSON.stringify(report.body)).not.toContain('222222');
  });

  it('o banco recusa conexao com site de outra empresa', async () => {
    await expect(
      api.db.insert(schema.analyticsConnections).values({
        tenantId: a.tenantId,
        siteId: b.siteId,
        refreshTokenEnc: 'v1.x.y.z',
      }),
    ).rejects.toThrow();
  });
});

describe('permissoes', () => {
  async function viewerOf(account: RegisteredAccount): Promise<RegisteredAccount> {
    const viewer = await registerAccount(api, { email: `leitor-${Math.random().toString(36).slice(2, 8)}@x.test`, companyName: 'Outra Empresa' });
    await api.db.insert(schema.memberships).values({
      tenantId: account.tenantId,
      userId: viewer.userId,
      role: 'viewer',
      status: 'active',
    });
    return viewer;
  }

  it('leitor ve as estatisticas, mas nao conecta, escolhe nem desconecta', async () => {
    await connectAndSelect(a, CONTA_A, '111111');
    const viewer = await viewerOf(a);
    await verifyEmail(api, viewer);
    const path = base(a);

    const status = await viewer.client.get(path);
    expect(status.status).toBe(200);
    expect(status.body.canManage).toBe(false);
    expect(status.body.redirectUri).toBeNull();
    expect((await viewer.client.get(`${path}/report`)).status).toBe(200);

    expect((await viewer.client.post(`${path}/connect/start`)).status).toBe(403);
    expect((await viewer.client.get(`${path}/properties`)).status).toBe(403);
    expect((await viewer.client.put(`${path}/property`, { propertyId: '111111' })).status).toBe(403);
    expect((await viewer.client.delete(path)).status).toBe(403);
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(1);
  });

  it('sem sessao, nada responde', async () => {
    expect((await api.client().get(base(a))).status).toBe(401);
    expect((await api.client().post(`${base(a)}/connect/start`)).status).toBe(401);
  });
});

describe('o retorno do Google nao pode ser forjado nem reaproveitado', () => {
  it('sem o cookie do state, e recusado', async () => {
    const url = await startUrl(a);
    const { code, state } = google.authorize(url, CONTA_A);
    a.client.deleteCookie('codeca_ga_state');
    const response = await a.client.get(`${CALLBACK}?code=${code}&state=${state}`);
    expect(response.headers.get('location')).toBe('/painel/estatisticas?analytics=invalid_state');
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(0);
  });

  it('state inventado ou diferente do cookie e recusado', async () => {
    const url = await startUrl(a);
    const { code } = google.authorize(url, CONTA_A);
    const response = await a.client.get(`${CALLBACK}?code=${code}&state=inventado`);
    expect(response.headers.get('location')).toContain('invalid_state');
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(0);
  });

  it('o state e de uso unico', async () => {
    const url = await startUrl(a);
    const { code, state } = google.authorize(url, CONTA_A);
    const first = await a.client.get(`${CALLBACK}?code=${code}&state=${state}`);
    expect(first.headers.get('location')).toContain('analytics=connected');
    a.client.setCookie('codeca_ga_state', state);
    const second = await a.client.get(`${CALLBACK}?code=${code}&state=${state}`);
    expect(second.headers.get('location')).toContain('invalid_state');
  });

  it('o retorno concluido por outra pessoa e recusado (nada e conectado)', async () => {
    const url = await startUrl(a);
    const { code, state } = google.authorize(url, CONTA_A);
    // Link de retorno entregue a B, com o state de A: o cookie ate confere, a sessao nao.
    b.client.setCookie('codeca_ga_state', state);
    const response = await b.client.get(`${CALLBACK}?code=${code}&state=${state}`);
    expect(response.headers.get('location')).toBe('/painel/estatisticas?analytics=session_mismatch');
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(0);
  });

  it('sem sessao, o retorno nao conecta nada', async () => {
    const url = await startUrl(a);
    const { code, state } = google.authorize(url, CONTA_A);
    const anonimo = api.client();
    anonimo.setCookie('codeca_ga_state', state);
    const response = await anonimo.get(`${CALLBACK}?code=${code}&state=${state}`);
    expect(response.headers.get('location')).toContain('session_mismatch');
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(0);
  });

  it('quem perdeu a permissao entre o clique e o retorno nao conecta', async () => {
    const url = await startUrl(a);
    const { code, state } = google.authorize(url, CONTA_A);
    await api.db.update(schema.memberships).set({ role: 'viewer' }).where(eq(schema.memberships.userId, a.userId));
    const response = await a.client.get(`${CALLBACK}?code=${code}&state=${state}`);
    expect(response.headers.get('location')).toContain('forbidden');
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(0);
  });

  it('cancelar na tela do Google nao grava nada', async () => {
    const url = new URL(await startUrl(a));
    const response = await a.client.get(`${CALLBACK}?error=access_denied&state=${url.searchParams.get('state')}`);
    expect(response.headers.get('location')).toBe('/painel/estatisticas?analytics=cancelled');
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(0);
  });

  it('consentimento sem a permissao do Analytics e recusado', async () => {
    expect(await connect(a, CONTA_A, { scope: 'https://www.googleapis.com/auth/userinfo.email' })).toContain('scope_missing');
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(0);
  });

  it('sem refresh token a conexao nao e criada', async () => {
    expect(await connect(a, CONTA_A, { withRefresh: false })).toContain('no_refresh_token');
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(0);
  });

  it('codigo trocado com PKCE errado nao conecta', async () => {
    const url = await startUrl(a);
    const { code, state } = google.authorize(url.replace(/code_challenge=[^&]+/, 'code_challenge=outro'), CONTA_A);
    const response = await a.client.get(`${CALLBACK}?code=${code}&state=${state}`);
    expect(response.headers.get('location')).toContain('analytics=failed');
    expect(await api.db.select().from(schema.analyticsConnections)).toHaveLength(0);
  });
});

describe('integracao nao configurada', () => {
  it('sem a chave de cifra, desliga e nunca grava token sem cifra', async () => {
    const semChave = await createTestApi({
      fetch: google.fetch,
      env: { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET },
    });
    try {
      const conta = await registerAccount(semChave, { email: 'x@sem-chave.test', companyName: 'Sem Chave' });
      await verifyEmail(semChave, conta);
      const status = await conta.client.get(`/api/tenants/${conta.tenantId}/analytics`);
      expect(status.body.available).toBe(false);
      expect(status.body.redirectUri).toBeNull();
      const start = await conta.client.post(`/api/tenants/${conta.tenantId}/analytics/connect/start`);
      expect(start.status).toBe(501);
      // E o login com Google segue funcionando com as mesmas credenciais.
      const login = await semChave.client().post('/api/auth/google/start', { intent: 'continue' });
      expect(login.status).toBe(200);
    } finally {
      await semChave.close();
    }
  });

  it('chave de cifra invalida tambem desliga (nao derruba a API)', async () => {
    const chaveRuim = await createTestApi({
      env: { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, INTEGRATIONS_ENCRYPTION_KEY: 'curta-demais' },
    });
    try {
      const health = await chaveRuim.client().get('/api/health');
      expect(health.status).toBe(200);
      expect(health.body.features.googleAnalytics).toBe(false);
      expect(health.body.features.googleAuth).toBe(true);
    } finally {
      await chaveRuim.close();
    }
  });
});
