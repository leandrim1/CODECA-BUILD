import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, createContext, parseEnv } from '@codeca/api';
import { eq, schema } from '@codeca/database';
import {
  TEST_JOB_SECRET,
  TEST_APP_ORIGIN,
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Desempenho SEM perder correcao.
 *
 * Os caches deixam de ser opcionais em producao, entao o que se prova aqui nao
 * e "fica mais rapido" (isso e dos testes de carga), e que **continuam certos**:
 *
 * - uma empresa nunca recebe dado de outra, nem pelo cache;
 * - logout, revogacao de chave e alteracao feita no painel valem NA HORA;
 * - sob sobrecarga a API recusa com 503 em vez de enfileirar para todos;
 * - banco fora do ar vira 503 com `Retry-After`, nunca 500 nem vazamento.
 */

const METRICS_SECRET = 'segredo-de-metricas-com-mais-de-16';
const ORIGEM_A = 'https://empresa-a.com.br';
const ORIGEM_B = 'https://empresa-b.com.br';

let api: TestApi;
let admin: RegisteredAccount;
let a: RegisteredAccount;
let b: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi({
    env: { AUTH_CACHE_TTL_SECONDS: '30', PUBLIC_CACHE_TTL_SECONDS: '30', METRICS_SECRET },
  });
});
afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  admin = await registerAccount(api, { email: 'admin@codeca.test', companyName: 'Plataforma' });
  await api.db.update(schema.users).set({ platformRole: 'platform_admin' }).where(eq(schema.users.id, admin.userId));
  a = await registerAccount(api, { email: 'a@empresa-a.test', companyName: 'Empresa A' });
  b = await registerAccount(api, { email: 'b@empresa-b.test', companyName: 'Empresa B' });
  await verifyEmail(api, a);
  await verifyEmail(api, b);
});

async function chave(siteId: string, origin: string): Promise<string> {
  const origins = await admin.client.put(`/api/platform/sites/${siteId}/origins`, { origins: [{ origin, note: 't' }] });
  expect(origins.status, origins.errorMessage ?? '').toBe(200);
  const response = await admin.client.post(`/api/platform/sites/${siteId}/keys`, { kind: 'publishable', name: 'k' });
  expect(response.status, response.errorMessage ?? '').toBe(201);
  return response.body.key.token as string;
}

const publico = (token: string, origin: string, path = '/api/v1/site') =>
  api.client().get(path, { origin, headers: { authorization: `Bearer ${token}` } });

async function metrics() {
  const response = await api.client().get('/api/metrics', { headers: { authorization: `Bearer ${METRICS_SECRET}` } });
  expect(response.status).toBe(200);
  return response.body as {
    caches: Record<string, { hits: number; misses: number; size: number }>;
    requests: { total: number; shed: number };
  };
}

describe('caches ligados: o dado continua certo', () => {
  it('o cache de sessao e usado (acertos aumentam) e a resposta nao muda', async () => {
    const antes = await metrics();
    const primeira = await a.client.get(`/api/tenants/${a.tenantId}/overview`);
    const segunda = await a.client.get(`/api/tenants/${a.tenantId}/overview`);
    expect(primeira.status).toBe(200);
    expect(segunda.body).toEqual(primeira.body);
    const depois = await metrics();
    expect(depois.caches.session!.hits).toBeGreaterThan(antes.caches.session!.hits);
    expect(depois.caches.tenant!.hits).toBeGreaterThan(antes.caches.tenant!.hits);
  });

  it('logout vale na hora, mesmo com a sessao em cache', async () => {
    expect((await a.client.get(`/api/tenants/${a.tenantId}/overview`)).status).toBe(200);
    expect((await a.client.get(`/api/tenants/${a.tenantId}/overview`)).status).toBe(200);

    const cookie = a.client.sessionCookie!;
    expect((await a.client.post('/api/auth/logout')).status).toBe(204);

    // Reapresenta o cookie antigo, como faria quem o copiou.
    const intruso = api.client();
    intruso.setCookie('codeca_session', cookie);
    const response = await intruso.get(`/api/tenants/${a.tenantId}/overview`);
    expect(response.status).toBe(401);
  });

  it('uma empresa nunca ve a outra, nem com tudo em cache', async () => {
    // Aquece os caches das duas.
    for (let i = 0; i < 3; i += 1) {
      expect((await a.client.get(`/api/tenants/${a.tenantId}/overview`)).status).toBe(200);
      expect((await b.client.get(`/api/tenants/${b.tenantId}/overview`)).status).toBe(200);
    }
    // A pede a empresa B: 404 (nao 403), sempre.
    for (let i = 0; i < 3; i += 1) {
      expect((await a.client.get(`/api/tenants/${b.tenantId}/overview`)).status).toBe(404);
      expect((await b.client.get(`/api/tenants/${a.tenantId}/overview`)).status).toBe(404);
    }
    const ver = await a.client.get(`/api/tenants/${a.tenantId}/overview`);
    expect(ver.body.site.id).toBe(a.siteId);
  });

  it('a API publica nao mistura sites, e o segundo pedido vem do cache', async () => {
    const tokenA = await chave(a.siteId, ORIGEM_A);
    const tokenB = await chave(b.siteId, ORIGEM_B);

    const a1 = await publico(tokenA, ORIGEM_A);
    const a2 = await publico(tokenA, ORIGEM_A);
    const b1 = await publico(tokenB, ORIGEM_B);
    expect(a1.status).toBe(200);
    expect(a2.headers.get('x-cache')).toBe('HIT');
    expect(a1.body.site.id).toBe(a.siteId);
    expect(a2.body.site.id).toBe(a.siteId);
    expect(b1.body.site.id).toBe(b.siteId);
    expect(b1.headers.get('x-cache')).toBeNull();

    // Chave de A com a origem de B continua recusada (a origem entra na chave de cache).
    const cruzado = await publico(tokenA, ORIGEM_B);
    expect(cruzado.status).toBe(403);
  });

  it('a resposta publica nunca e cacheavel pela rede', async () => {
    const token = await chave(a.siteId, ORIGEM_A);
    await publico(token, ORIGEM_A);
    const hit = await publico(token, ORIGEM_A);
    expect(hit.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('alteracao feita no painel aparece na hora na API publica', async () => {
    const token = await chave(a.siteId, ORIGEM_A);
    const antes = await publico(token, ORIGEM_A);
    await publico(token, ORIGEM_A); // aquece
    const novoNome = 'Nome Novo da Empresa';
    const edicao = await admin.client.patch(`/api/platform/sites/${a.siteId}`, { name: novoNome, status: 'active' });
    expect(edicao.status, edicao.errorMessage ?? '').toBe(200);
    const depois = await publico(token, ORIGEM_A);
    expect(antes.body.site.name).not.toBe(novoNome);
    expect(depois.body.site.name).toBe(novoNome);
  });

  it('Cache-Control: no-cache e preview vao direto ao banco', async () => {
    const token = await chave(a.siteId, ORIGEM_A);
    await publico(token, ORIGEM_A);
    const direto = await api.client().get('/api/v1/site', {
      origin: ORIGEM_A,
      headers: { authorization: `Bearer ${token}`, 'cache-control': 'no-cache' },
    });
    expect(direto.status).toBe(200);
    expect(direto.headers.get('x-cache')).toBeNull();
  });

  it('chave revogada deixa de valer na hora, mesmo em cache', async () => {
    const token = await chave(a.siteId, ORIGEM_A);
    expect((await publico(token, ORIGEM_A)).status).toBe(200);
    expect((await publico(token, ORIGEM_A)).status).toBe(200);

    const lista = await admin.client.get(`/api/platform/sites/${a.siteId}/keys`);
    const keyId = lista.body.items[0].id as string;
    expect((await admin.client.delete(`/api/platform/sites/${a.siteId}/keys/${keyId}`)).status).toBe(204);

    expect((await publico(token, ORIGEM_A)).status).toBe(401);
  });

  it('uma escrita bem-sucedida no painel descarta o cache da empresa', async () => {
    expect((await a.client.get(`/api/tenants/${a.tenantId}/overview`)).status).toBe(200);
    expect((await a.client.get(`/api/tenants/${a.tenantId}/overview`)).status).toBe(200);
    const antes = (await metrics()).caches.tenant!.misses;

    const escrita = await a.client.patch(`/api/tenants/${a.tenantId}/contact`, {
      email: 'a@empresa-a.test',
      phone: '(19) 99999-0000',
      whatsapp: '',
      whatsappDefaultMessage: '',
      address: { street: '', number: '', neighborhood: '', city: '', state: '', zipCode: '' },
      serviceArea: '',
      businessHours: '',
      social: {},
    });
    expect(escrita.status, escrita.errorMessage ?? '').toBe(200);

    // A entrada foi descartada: a proxima leitura e um miss, nao um acerto velho.
    expect((await a.client.get(`/api/tenants/${a.tenantId}/overview`)).status).toBe(200);
    expect((await metrics()).caches.tenant!.misses).toBeGreaterThan(antes);
  });
});

describe('metricas', () => {
  it('sem segredo (ou com o errado) a rota nao existe', async () => {
    expect((await api.client().get('/api/metrics')).status).toBe(404);
    expect((await api.client().get('/api/metrics', { headers: { authorization: 'Bearer errado' } })).status).toBe(404);
  });

  it('nao expoe dado de empresa', async () => {
    const response = await api.client().get('/api/metrics', { headers: { authorization: `Bearer ${METRICS_SECRET}` } });
    const text = JSON.stringify(response.body);
    expect(text).not.toContain('a@empresa-a.test');
    expect(text).not.toContain(a.tenantId);
  });
});

describe('sobrecarga', () => {
  it('acima do limite de requisicoes em andamento, recusa com 503 e Retry-After; /health segue respondendo', async () => {
    const limitada = await createTestApi({ env: { MAX_CONCURRENT_REQUESTS: '3' } });
    try {
      const conta = await registerAccount(limitada, { email: 'x@limite.test', companyName: 'Limite' });
      const cliente = limitada.client();
      cliente.setCookie('codeca_session', conta.client.sessionCookie!);

      const rajada = await Promise.all(
        Array.from({ length: 30 }, () => cliente.get(`/api/tenants/${conta.tenantId}/overview`)),
      );
      const recusadas = rajada.filter((r) => r.status === 503);
      const atendidas = rajada.filter((r) => r.status === 200);

      expect(recusadas.length).toBeGreaterThan(0);
      expect(atendidas.length).toBeGreaterThan(0);
      // Toda requisicao teve resposta definida: nada de 500 nem de resposta truncada.
      expect(rajada.every((r) => r.status === 200 || r.status === 503)).toBe(true);
      for (const r of recusadas) {
        expect(r.errorCode).toBe('service_unavailable');
        expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      }

      const saude = await Promise.all(Array.from({ length: 10 }, () => cliente.get('/api/health')));
      expect(saude.every((r) => r.status === 200)).toBe(true);
    } finally {
      await limitada.close();
    }
  });
});

describe('banco indisponivel', () => {
  it('vira 503 com Retry-After, sem vazar a causa', async () => {
    const quebrado = new Proxy({} as never, {
      get() {
        throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' });
      },
    });
    const env = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://injected/test',
      AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
      APP_URL: TEST_APP_ORIGIN,
      PLATFORM_HOSTS: 'app.localhost,localhost',
      COOKIE_SECURE: 'false',
    });
    const app = createApp({ context: createContext({ env, db: quebrado }) });

    const response = await app.request(`${TEST_APP_ORIGIN}/api/public/plans`, { headers: { origin: TEST_APP_ORIGIN } });
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(body).toContain('service_unavailable');
    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toContain('10.0.0.1');
  });
});

describe('limpeza de registros vencidos', () => {
  it('apaga sessoes e contadores velhos e preserva os vigentes', async () => {
    const agora = new Date();
    const velho = new Date(agora.getTime() - 60 * 24 * 3600 * 1000);
    const futuro = new Date(agora.getTime() + 3600 * 1000);

    await api.db.insert(schema.rateLimits).values([
      { key: 'velho', count: 1, windowStartedAt: velho, expiresAt: velho },
      { key: 'vigente', count: 1, windowStartedAt: agora, expiresAt: futuro },
    ]);
    await api.db.insert(schema.sessions).values({
      userId: a.userId,
      tokenHash: 'hash-velho',
      csrfTokenHash: 'csrf-velho',
      userAgent: 'teste',
      ipHash: 'ip',
      expiresAt: velho,
    });
    const sessoesAntes = (await api.db.select().from(schema.sessions)).length;

    const job = await api.client().post('/api/billing/reconcile', undefined, {
      headers: { authorization: `Bearer ${TEST_JOB_SECRET}` },
    });
    expect(job.status, job.errorMessage ?? '').toBe(200);
    expect(job.body.housekeeping.sessions).toBeGreaterThanOrEqual(1);

    const limites = (await api.db.select().from(schema.rateLimits)).map((r) => r.key);
    expect(limites).not.toContain('velho');
    expect(limites).toContain('vigente');
    expect((await api.db.select().from(schema.sessions)).length).toBe(sessoesAntes - 1);
    // A sessao do usuario logado continua valendo.
    expect((await a.client.get(`/api/tenants/${a.tenantId}/overview`)).status).toBe(200);
  });
});
