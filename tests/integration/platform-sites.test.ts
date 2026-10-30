import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Configuracao de um site pelo painel mestre.
 *
 * Os modulos e as chaves tem testes proprios; aqui ficam as chamadas que a
 * tela de configuracao faz ao redor delas -- ler o projeto, corrigir
 * identidade e situacao, e conferir as origens ja autorizadas. O criterio: a
 * nota interna existe para a CODECA IA e nenhum caminho do cliente pode
 * devolve-la, e um usuario comum nao le nem escreve a configuracao de site
 * nenhum, inclusive do proprio.
 */

let api: TestApi;
let admin: RegisteredAccount;
let empresa: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  admin = await registerAccount(api, { email: 'admin@codeca.test', companyName: 'Plataforma' });
  await api.db
    .update(schema.users)
    .set({ platformRole: 'platform_admin' })
    .where(eq(schema.users.id, admin.userId));

  empresa = await registerAccount(api, {
    email: 'contato@horizonte.com.br',
    companyName: 'Construtora Horizonte',
  });
});

describe('leitura do site no painel mestre', () => {
  it('devolve o projeto com os modulos, como a tela carrega', async () => {
    const response = await admin.client.get(`/api/platform/sites/${empresa.siteId}`);

    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.site.id).toBe(empresa.siteId);
    expect(response.body.site.tenantId).toBe(empresa.tenantId);
    expect(response.body.site.isPrimary).toBe(true);
    // Um site recem-criado comeca em rascunho: quem o coloca no ar e a CODECA
    // IA, depois de integrar.
    expect(response.body.site.status).toBe('draft');
    expect(Array.isArray(response.body.modules)).toBe(true);
    expect(response.body.modules.length).toBeGreaterThan(0);
  });

  it('a lista traz a empresa dona de cada site', async () => {
    const response = await admin.client.get('/api/platform/sites');

    expect(response.status, response.errorMessage ?? '').toBe(200);
    const site = response.body.items.find((item: { id: string }) => item.id === empresa.siteId);
    expect(site).toBeDefined();
    expect(site.tenantName).toBe('Construtora Horizonte');
  });

  it('recusa um site que nao existe em vez de responder vazio', async () => {
    const response = await admin.client.get(
      '/api/platform/sites/00000000-0000-4000-8000-000000000000',
    );

    expect(response.status).toBe(404);
  });
});

describe('identidade e situacao do site', () => {
  it('grava nome, situacao e nota interna', async () => {
    const response = await admin.client.patch(`/api/platform/sites/${empresa.siteId}`, {
      name: 'Horizonte - institucional',
      status: 'active',
      internalNotes: 'Projeto em React, deploy no Vercel do cliente.',
    });

    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.site.name).toBe('Horizonte - institucional');
    expect(response.body.site.status).toBe('active');
    expect(response.body.site.internalNotes).toContain('React');

    const [linha] = await api.db
      .select({ name: schema.sites.name, status: schema.sites.status })
      .from(schema.sites)
      .where(eq(schema.sites.id, empresa.siteId));
    expect(linha?.name).toBe('Horizonte - institucional');
    expect(linha?.status).toBe('active');
  });

  it('nao aceita uma situacao inventada', async () => {
    const response = await admin.client.patch(`/api/platform/sites/${empresa.siteId}`, {
      name: 'Horizonte',
      status: 'no-ar-talvez',
      internalNotes: '',
    });

    expect(response.status).toBe(422);
  });

  it('suspender o site nao apaga o conteudo da empresa', async () => {
    const [antes] = await api.db
      .select({ id: schema.contentDocuments.id })
      .from(schema.contentDocuments)
      .where(eq(schema.contentDocuments.siteId, empresa.siteId));
    expect(antes).toBeDefined();

    const response = await admin.client.patch(`/api/platform/sites/${empresa.siteId}`, {
      name: 'Construtora Horizonte',
      status: 'suspended',
      internalNotes: 'inadimplente',
    });
    expect(response.status, response.errorMessage ?? '').toBe(200);

    const depois = await api.db
      .select({ id: schema.contentDocuments.id })
      .from(schema.contentDocuments)
      .where(eq(schema.contentDocuments.siteId, empresa.siteId));
    expect(depois.length).toBeGreaterThan(0);
  });
});

describe('origens autorizadas', () => {
  it('a lista devolve o que foi gravado, na forma normalizada', async () => {
    const gravacao = await admin.client.put(`/api/platform/sites/${empresa.siteId}/origins`, {
      origins: [
        { origin: 'https://Horizonte.com.br:443/', note: 'producao' },
        { origin: 'http://localhost:5173', note: 'desenvolvimento' },
      ],
    });
    expect(gravacao.status, gravacao.errorMessage ?? '').toBe(200);

    const leitura = await admin.client.get(`/api/platform/sites/${empresa.siteId}/origins`);
    expect(leitura.status, leitura.errorMessage ?? '').toBe(200);

    const origens = leitura.body.items.map((item: { origin: string }) => item.origin);
    // A porta padrao e o caminho saem, e o host perde a caixa alta: a
    // comparacao em tempo de requisicao e exata.
    expect(origens).toContain('https://horizonte.com.br');
    expect(origens).toContain('http://localhost:5173');
    expect(leitura.body.items).toHaveLength(2);
  });

  it('gravar de novo substitui a lista inteira', async () => {
    await admin.client.put(`/api/platform/sites/${empresa.siteId}/origins`, {
      origins: [{ origin: 'https://antiga.com.br', note: '' }],
    });
    await admin.client.put(`/api/platform/sites/${empresa.siteId}/origins`, {
      origins: [{ origin: 'https://nova.com.br', note: '' }],
    });

    const leitura = await admin.client.get(`/api/platform/sites/${empresa.siteId}/origins`);
    const origens = leitura.body.items.map((item: { origin: string }) => item.origin);
    expect(origens).toEqual(['https://nova.com.br']);
  });
});

describe('quem pode configurar', () => {
  it('o usuario da empresa nao le a configuracao do proprio site', async () => {
    const response = await empresa.client.get(`/api/platform/sites/${empresa.siteId}`);

    expect(response.status).toBe(403);
  });

  it('o usuario da empresa nao altera a situacao do proprio site', async () => {
    const response = await empresa.client.patch(`/api/platform/sites/${empresa.siteId}`, {
      name: 'Construtora Horizonte',
      status: 'active',
      internalNotes: '',
    });

    expect(response.status).toBe(403);

    const [linha] = await api.db
      .select({ status: schema.sites.status })
      .from(schema.sites)
      .where(eq(schema.sites.id, empresa.siteId));
    expect(linha?.status).toBe('draft');
  });

  it('o visitante sem sessao nao enxerga a lista de sites', async () => {
    const response = await api.client().get('/api/platform/sites');

    expect(response.status).toBe(401);
  });
});
