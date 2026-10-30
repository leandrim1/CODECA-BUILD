import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { CodecaError, createClient } from '@codeca/sdk';
import { createServerClient } from '@codeca/sdk/server';
import {
  createTestApi,
  registerAccount,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * O SDK contra a API de verdade.
 *
 * As comparacoes de tipo garantem que os contratos coincidem no papel; este
 * arquivo garante que coincidem na pratica. O `fetch` injetado entrega a
 * requisicao a propria aplicacao, entao o caminho exercitado e o mesmo de
 * producao, menos a rede.
 */

const BASE_URL = 'https://app.codecabuild.test';
const ORIGEM = 'https://construtora-horizonte.com.br';

let api: TestApi;
let admin: RegisteredAccount;
let empresa: RegisteredAccount;
let publicavel: string;
let secreta: string;

/**
 * `fetch` que entrega a requisicao a aplicacao.
 *
 * Acrescenta o `Origin` porque e o navegador quem o envia -- o SDK nao tem
 * como, e nem deveria: um cliente que mandasse a propria origem tornaria a
 * conferencia inutil.
 */
function fetchDoNavegador(): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('origin', ORIGEM);
    return api.app.request(String(input), { ...init, headers });
  }) as typeof globalThis.fetch;
}

/** `fetch` do servidor do site: sem `Origin`, como numa chamada server-side. */
function fetchDoServidor(): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    api.app.request(String(input), init)) as typeof globalThis.fetch;
}

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

  await admin.client.put(`/api/platform/sites/${empresa.siteId}/origins`, {
    origins: [{ origin: ORIGEM, note: '' }],
  });
  publicavel = (
    await admin.client.post(`/api/platform/sites/${empresa.siteId}/keys`, { kind: 'publishable' })
  ).body.key.token;
  secreta = (
    await admin.client.post(`/api/platform/sites/${empresa.siteId}/keys`, { kind: 'secret' })
  ).body.key.token;
});

function siteClient() {
  return createClient({ baseUrl: BASE_URL, publishableKey: publicavel, fetch: fetchDoNavegador() });
}

function serverClient() {
  return createServerClient({ baseUrl: BASE_URL, secretKey: secreta, fetch: fetchDoServidor() });
}

async function criarImovel(extra: Record<string, unknown> = {}) {
  const response = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
    title: 'Residencial Aurora',
    type: 'apartamento',
    purpose: 'venda',
    price: 780000,
    publicationStatus: 'published',
    ...extra,
  });
  expect(response.status, response.errorMessage ?? '').toBe(201);
  return response.body.property as { id: string; slug: string };
}

describe('leitura pelo site', () => {
  it('identifica o site pela propria credencial', async () => {
    const info = await siteClient().site.get();
    expect(info.site.id).toBe(empresa.siteId);
    expect(info.modules.map((m) => m.key)).toContain('imoveis');
  });

  it('le o institucional ja desembrulhado', async () => {
    // A API responde `{ data: ... }`; o site recebe o conteudo direto.
    const institucional = await siteClient().institutional.get();
    expect(institucional.companyName).toBe('Construtora Horizonte');
  });

  it('lista imoveis com paginacao', async () => {
    await criarImovel();
    const pagina = await siteClient().properties.list({ purpose: 'venda' });
    expect(pagina.items).toHaveLength(1);
    expect(pagina.total).toBe(1);
    expect(pagina.items[0]!.title).toBe('Residencial Aurora');
  });

  it('abre um imovel pelo endereco na URL', async () => {
    const criado = await criarImovel();
    const imovel = await siteClient().properties.get(criado.slug);
    expect(imovel.id).toBe(criado.id);
  });

  it('lista banners', async () => {
    await empresa.client.post(`/api/tenants/${empresa.tenantId}/banners`, { title: 'Aurora' });
    const banners = await siteClient().banners.list();
    expect(banners).toHaveLength(1);
    expect(banners[0]!.title).toBe('Aurora');
  });

  it('envia o formulario de contato', async () => {
    const resultado = await siteClient().leads.create({
      name: 'Marina Souza',
      phone: '(19) 98888-7777',
      interestType: 'compra_imovel',
      consent: true,
    });
    expect(resultado.received).toBe(true);

    const [lead] = await api.db.select().from(schema.leads);
    expect(lead!.siteId).toBe(empresa.siteId);
  });
});

describe('erros chegam utilizaveis ao site', () => {
  it('recurso inexistente vira isNotFound', async () => {
    // O site precisa decidir entre renderizar 404 e tentar de novo.
    await expect(siteClient().properties.get('nao-existe')).rejects.toSatisfy(
      (erro: unknown) => erro instanceof CodecaError && erro.isNotFound,
    );
  });

  it('previa com chave publicavel vira isAuthError', async () => {
    await expect(siteClient().properties.list({ preview: true })).rejects.toSatisfy(
      (erro: unknown) => erro instanceof CodecaError && erro.isAuthError,
    );
  });

  it('plataforma inalcancavel vira isNetworkError', async () => {
    const cliente = createClient({
      baseUrl: BASE_URL,
      publishableKey: publicavel,
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof globalThis.fetch,
    });

    await expect(cliente.site.get()).rejects.toSatisfy(
      (erro: unknown) => erro instanceof CodecaError && erro.isNetworkError,
    );
  });

  it('plataforma lenta nao prende a renderizacao do site', async () => {
    const cliente = createClient({
      baseUrl: BASE_URL,
      publishableKey: publicavel,
      timeoutMs: 50,
      fetch: ((_input: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
        })) as unknown as typeof globalThis.fetch,
    });

    const erro = await cliente.site.get().catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(CodecaError);
    expect((erro as CodecaError).isNetworkError).toBe(true);
    expect((erro as CodecaError).message).toMatch(/50 ms/);
  });
});

describe('cliente de servidor', () => {
  it('le rascunho com a chave secreta, sem origem', async () => {
    await criarImovel({ publicationStatus: 'draft', title: 'Em preparo' });

    const pagina = await serverClient().properties.list({ preview: true });
    expect(pagina.items).toHaveLength(1);
    expect(pagina.items[0]!.title).toBe('Em preparo');
  });

  it('sem pedir previa, enxerga so o publicado', async () => {
    await criarImovel({ publicationStatus: 'draft', title: 'Em preparo' });
    const pagina = await serverClient().properties.list();
    expect(pagina.items).toHaveLength(0);
  });
});
