import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Visao geral do painel do cliente.
 *
 * Estes testes existem por causa de uma falha concreta: a Etapa 0 removeu o
 * renderizador e a rota parou de enviar `pages` e `site`, mas a tela continuou
 * lendo `data.pages.published`. O `typecheck` passava -- o painel tinha a sua
 * propria copia do tipo -- e a tela inicial quebrava ao renderizar.
 *
 * O contrato agora e unico (`TenantOverview` em `@codeca/shared`) e o
 * compilador cobre a forma. O que ele nao cobre, e o que estes testes cobrem,
 * e o conteudo: se os numeros sao do site certo e se a situacao da integracao
 * diz a verdade.
 */

const ORIGEM = 'https://horizonte.com.br';

/** Chaves do primeiro nivel da resposta. A tela conta com todas. */
const CAMPOS = [
  'site',
  'properties',
  'projects',
  'services',
  'banners',
  'leads',
  'media',
  'recentLeads',
  'domains',
  'plan',
  'usage',
].sort();

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
  await verifyEmail(api, empresa);
});

function visaoGeral(conta: RegisteredAccount = empresa) {
  return conta.client.get(`/api/tenants/${conta.tenantId}/overview`);
}

describe('forma da resposta', () => {
  it('entrega exatamente os campos que a tela le', async () => {
    const response = await visaoGeral();
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(CAMPOS);
  });

  it('nao sobrou nada do renderizador', async () => {
    // `pages` e `site.publishedVersion` vinham do editor visual, que saiu na
    // Etapa 0. Se um deles voltar, voltou tambem o modelo que o pedido diz
    // para nao ter.
    const { body } = await visaoGeral();
    expect(body.pages).toBeUndefined();
    expect(body.site.publishedVersion).toBeUndefined();
    expect(body.site.lastPublishedAt).toBeUndefined();
  });

  it('a contagem de todos os modulos vem sempre, habilitados ou nao', async () => {
    // A tela decide o que mostrar pelos modulos do site; a resposta tem forma
    // fixa. Forma variavel obrigaria cada leitor a testar a presenca de cada
    // campo -- e foi justamente esse teste que a tela nao fazia.
    await admin.client.put(`/api/platform/sites/${empresa.siteId}/modules`, {
      modules: [
        { key: 'imoveis', enabled: false, settings: {} },
        { key: 'obras', enabled: false, settings: {} },
        { key: 'banners', enabled: false, settings: {} },
      ],
      fieldPolicies: [],
    });

    const { body } = await visaoGeral();
    expect(body.properties.published).toBe(0);
    expect(body.projects.total).toBe(0);
    expect(body.banners).toEqual({ total: 0, active: 0 });
  });
});

describe('situacao do site', () => {
  it('traz o nome e o estado do site da empresa', async () => {
    const { body } = await visaoGeral();
    expect(body.site.id).toBe(empresa.siteId);
    expect(body.site.name).toBe('Construtora Horizonte');
    expect(body.site.status).toBe('draft');
  });

  it('o site de outra empresa nao aparece', async () => {
    const outra = await registerAccount(api, {
      email: 'contato@vizinha.com.br',
      companyName: 'Construtora Vizinha',
    });

    const minha = await visaoGeral();
    const dela = await visaoGeral(outra);

    expect(minha.body.site.id).toBe(empresa.siteId);
    expect(dela.body.site.id).toBe(outra.siteId);
    expect(minha.body.site.id).not.toBe(dela.body.site.id);
  });

  it('a integracao fica sem acesso registrado ate o site buscar conteudo', async () => {
    // E a diferenca entre "cadastrado" e "integrado", e a tela precisa dela
    // para nao dizer que esta tudo pronto no primeiro dia.
    const { body } = await visaoGeral();
    expect(body.site.lastApiAccessAt).toBeNull();
  });

  it('registra o acesso depois de o site usar a chave', async () => {
    await admin.client.put(`/api/platform/sites/${empresa.siteId}/origins`, {
      origins: [{ origin: ORIGEM, note: 'site do cliente' }],
    });
    const emissao = await admin.client.post(`/api/platform/sites/${empresa.siteId}/keys`, {
      kind: 'publishable',
      name: 'chave do site',
    });
    expect(emissao.status, emissao.errorMessage ?? '').toBe(201);

    const chamada = await api.client().get('/api/v1/site', {
      origin: ORIGEM,
      headers: { authorization: `Bearer ${emissao.body.key.token}` },
    });
    expect(chamada.status, chamada.errorMessage ?? '').toBe(200);

    const { body } = await visaoGeral();
    expect(body.site.lastApiAccessAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(body.site.lastApiAccessAt))).toBe(false);
  });

  it('uma chave revogada nao conta como integracao viva', async () => {
    await admin.client.put(`/api/platform/sites/${empresa.siteId}/origins`, {
      origins: [{ origin: ORIGEM, note: 'site do cliente' }],
    });
    const emissao = await admin.client.post(`/api/platform/sites/${empresa.siteId}/keys`, {
      kind: 'publishable',
      name: 'chave antiga',
    });
    await api.client().get('/api/v1/site', {
      origin: ORIGEM,
      headers: { authorization: `Bearer ${emissao.body.key.token}` },
    });

    const antes = await visaoGeral();
    expect(antes.body.site.lastApiAccessAt).not.toBeNull();

    await admin.client.delete(`/api/platform/sites/${empresa.siteId}/keys/${emissao.body.key.id}`);

    // Chave revogada e integracao que nao existe mais: manter a data diria ao
    // cliente que o site segue conectado quando ele nao consegue mais ler.
    const depois = await visaoGeral();
    expect(depois.body.site.lastApiAccessAt).toBeNull();
  });
});

describe('contagens', () => {
  it('conta os banners ativos separados do total', async () => {
    const criar = (titulo: string, isActive: boolean) =>
      empresa.client.post(`/api/tenants/${empresa.tenantId}/banners`, {
        title: titulo,
        isActive,
      });

    expect((await criar('Lancamento', true)).status).toBe(201);
    expect((await criar('Fora de epoca', false)).status).toBe(201);

    const { body } = await visaoGeral();
    expect(body.banners).toEqual({ total: 2, active: 1 });
  });

  it('nao conta o conteudo de outra empresa', async () => {
    const outra = await registerAccount(api, {
      email: 'contato@vizinha.com.br',
      companyName: 'Construtora Vizinha',
    });
    await verifyEmail(api, outra);
    await outra.client.post(`/api/tenants/${outra.tenantId}/banners`, {
      title: 'Banner da vizinha',
      isActive: true,
    });

    const { body } = await visaoGeral();
    expect(body.banners).toEqual({ total: 0, active: 0 });
  });
});
