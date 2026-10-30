import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Conteudo entregue aos sites dos clientes.
 *
 * Duas perguntas organizam estes testes: o site recebe o que foi publicado, e
 * **nada alem disso**? E o que nao e publico -- rascunho, endereco escondido,
 * dado de interessado -- fica mesmo fora?
 */

const ORIGEM = 'https://construtora-horizonte.com.br';

let api: TestApi;
let admin: RegisteredAccount;
let empresa: RegisteredAccount;
let publicavel: string;
let secreta: string;
let agora: Date;

beforeAll(async () => {
  agora = new Date('2026-05-10T12:00:00Z');
  api = await createTestApi({ now: () => agora });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  agora = new Date('2026-05-10T12:00:00Z');
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

/** Leitura como o navegador do site faria. */
function comoSite(path: string, token = publicavel) {
  return api.client().get(path, { origin: ORIGEM, headers: { authorization: `Bearer ${token}` } });
}

/** Leitura como o servidor do site faria, com a chave secreta. */
function comoServidor(path: string) {
  return api.client().get(path, { origin: null, headers: { authorization: `Bearer ${secreta}` } });
}

async function criarImovel(extra: Record<string, unknown> = {}) {
  const response = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
    title: 'Residencial Aurora',
    type: 'apartamento',
    purpose: 'venda',
    price: 780000,
    bedrooms: 3,
    address: { city: 'Campinas', state: 'SP', neighborhood: 'Cambui', street: 'Rua das Flores', number: '100' },
    publicationStatus: 'published',
    ...extra,
  });
  expect(response.status, response.errorMessage ?? '').toBe(201);
  return response.body.property as { id: string; slug: string };
}

describe('conteudo publicado', () => {
  it('entrega o institucional do site', async () => {
    const response = await comoSite('/api/v1/content/institucional');
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.data.companyName).toBe('Construtora Horizonte');
  });

  it('lista imoveis publicados', async () => {
    await criarImovel();
    const response = await comoSite('/api/v1/properties');
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].title).toBe('Residencial Aurora');
    expect(response.body.total).toBe(1);
  });

  it('nao entrega rascunho para a chave publicavel', async () => {
    await criarImovel({ publicationStatus: 'draft', title: 'Em preparo' });
    const response = await comoSite('/api/v1/properties');
    expect(response.body.items).toHaveLength(0);
  });

  it('abre o imovel pelo endereco na URL', async () => {
    const imovel = await criarImovel();
    const response = await comoSite(`/api/v1/properties/${imovel.slug}`);
    expect(response.status).toBe(200);
    expect(response.body.property.id).toBe(imovel.id);
  });

  it('modulo nao habilitado responde 404, nao 403', async () => {
    // Para quem le o site, um modulo que o projeto dele nao tem simplesmente
    // nao existe. "Proibido" revelaria que a rota existe em outros sites.
    await admin.client.put(`/api/platform/sites/${empresa.siteId}/modules`, {
      modules: [{ key: 'obras', enabled: false, settings: {} }],
      fieldPolicies: [],
    });
    const response = await comoSite('/api/v1/projects');
    expect(response.status).toBe(404);
  });
});

describe('previa de rascunho', () => {
  it('a chave secreta ve o rascunho', async () => {
    await criarImovel({ publicationStatus: 'draft', title: 'Em preparo' });
    const response = await comoServidor('/api/v1/properties?preview=true');
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.items).toHaveLength(1);
  });

  it('a chave publicavel nao pede previa', async () => {
    // Seria conteudo nao publicado chegando ao navegador de um visitante.
    const response = await comoSite('/api/v1/properties?preview=true');
    expect(response.status).toBe(403);
  });

  it('sem pedir previa, a chave secreta tambem so ve o publicado', async () => {
    await criarImovel({ publicationStatus: 'draft', title: 'Em preparo' });
    const response = await comoServidor('/api/v1/properties');
    expect(response.body.items).toHaveLength(0);
  });
});

describe('o que nao pode sair', () => {
  it('o endereco completo some quando o cliente escolhe esconder', async () => {
    const imovel = await criarImovel({
      address: {
        city: 'Campinas',
        state: 'SP',
        neighborhood: 'Cambui',
        street: 'Rua das Flores',
        number: '100',
        showFullAddress: false,
      },
    });

    const response = await comoSite(`/api/v1/properties/${imovel.slug}`);
    const endereco = response.body.property.address;
    expect(endereco.street).toBe('');
    expect(endereco.number).toBe('');
    // Bairro e cidade continuam: e o que torna o anuncio util.
    expect(endereco.neighborhood).toBe('Cambui');
    expect(endereco.city).toBe('Campinas');
  });

  it('nenhuma resposta carrega campo interno da plataforma', async () => {
    await criarImovel();
    const lista = await comoSite('/api/v1/properties');
    const texto = JSON.stringify(lista.body);

    expect(texto).not.toContain('tenantId');
    expect(texto).not.toContain('publicationStatus');
    expect(texto).not.toContain('internalNotes');
  });

  it('nao existe rota para ler interessados', async () => {
    const response = await comoServidor('/api/v1/leads');
    // Nome, telefone e e-mail sao dado pessoal: ficam atras do painel.
    expect(response.status).toBe(404);
  });
});

describe('banners e a janela de exibicao', () => {
  async function criarBanner(extra: Record<string, unknown> = {}) {
    const response = await empresa.client.post(`/api/tenants/${empresa.tenantId}/banners`, {
      title: 'Lancamento Aurora',
      ...extra,
    });
    expect(response.status, response.errorMessage ?? '').toBe(201);
  }

  it('entrega os ativos', async () => {
    await criarBanner();
    const response = await comoSite('/api/v1/banners');
    expect(response.body.items).toHaveLength(1);
  });

  it('esconde o desativado', async () => {
    await criarBanner({ isActive: false });
    const response = await comoSite('/api/v1/banners');
    expect(response.body.items).toHaveLength(0);
  });

  it('a campanha entra e sai sozinha pela data', async () => {
    await criarBanner({
      title: 'Campanha de junho',
      startsAt: '2026-06-01T00:00:00Z',
      endsAt: '2026-06-30T00:00:00Z',
    });

    // Em maio ainda nao apareceu.
    expect((await comoSite('/api/v1/banners')).body.items).toHaveLength(0);

    agora = new Date('2026-06-15T12:00:00Z');
    expect((await comoSite('/api/v1/banners')).body.items).toHaveLength(1);

    agora = new Date('2026-07-15T12:00:00Z');
    expect((await comoSite('/api/v1/banners')).body.items).toHaveLength(0);
  });
});

describe('filtros', () => {
  beforeEach(async () => {
    await criarImovel({ title: 'Casa no Cambui', purpose: 'venda', price: 500000 });
    await criarImovel({ title: 'Apartamento para alugar', purpose: 'locacao', price: 2500 });
  });

  it('filtra por finalidade', async () => {
    const response = await comoSite('/api/v1/properties?purpose=locacao');
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].purpose).toBe('locacao');
  });

  it('filtra por faixa de preco com valores vindos como texto', async () => {
    // Tudo chega como texto na query string. Um `z.number()` aqui recusaria
    // "100000" e o site do cliente receberia 422 sem motivo aparente.
    const response = await comoSite('/api/v1/properties?minPrice=100000');
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.items).toHaveLength(1);
  });

  it('pagina', async () => {
    const response = await comoSite('/api/v1/properties?pageSize=1&page=2');
    expect(response.body.items).toHaveLength(1);
    expect(response.body.total).toBe(2);
    expect(response.body.totalPages).toBe(2);
  });
});

describe('formulario de contato', () => {
  const contato = {
    name: 'Marina Souza',
    phone: '(19) 98888-7777',
    email: 'marina@exemplo.com.br',
    interestType: 'compra_imovel',
    message: 'Gostaria de visitar o decorado.',
    consent: true,
  };

  const IP_VISITANTE = '203.0.113.42';

  function enviar(body: Record<string, unknown>) {
    return api.client().post('/api/v1/leads', body, {
      origin: ORIGEM,
      headers: {
        authorization: `Bearer ${publicavel}`,
        'x-forwarded-for': IP_VISITANTE,
      },
    });
  }

  it('aceita o envio pelo navegador e confirma sem devolver dado', async () => {
    const response = await enviar(contato);
    expect(response.status, response.errorMessage ?? '').toBe(201);
    // Quem envia nao consegue ler de volta: uma resposta com o registro viraria
    // caminho para ler dado pessoal de terceiros.
    expect(JSON.stringify(response.body)).not.toContain('Marina');

    const [lead] = await api.db.select().from(schema.leads);
    expect(lead!.name).toBe('Marina Souza');
    expect(lead!.siteId).toBe(empresa.siteId);
  });

  it('guarda o IP apenas como hash', async () => {
    // Permite limitar e auditar sem guardar o endereco em claro (LGPD).
    await enviar(contato);
    const [lead] = await api.db.select().from(schema.leads);
    expect(lead!.ipHash).not.toBe('');
    expect(lead!.ipHash).not.toContain(IP_VISITANTE);
    expect(JSON.stringify(lead)).not.toContain(IP_VISITANTE);
  });

  it('exige o consentimento', async () => {
    const response = await enviar({ ...contato, consent: false });
    expect(response.status).toBe(422);
  });

  it('o campo-armadilha responde sucesso e nao grava nada', async () => {
    // Responder erro ensinaria o robo a contornar a armadilha.
    const response = await enviar({ ...contato, honeypot: 'http://spam' });
    expect(response.status).toBe(201);
    expect(await api.db.select().from(schema.leads)).toHaveLength(0);
  });

  it('nao anexa um imovel de outro site ao interessado', async () => {
    const outra = await registerAccount(api, {
      email: 'contato@beta.com.br',
      companyName: 'Construtora Beta',
    });
    const alheio = await outra.client.post(`/api/tenants/${outra.tenantId}/properties`, {
      title: 'Imovel da Beta',
      type: 'apartamento',
      purpose: 'venda',
    });

    await enviar({ ...contato, propertyId: alheio.body.property.id });

    const [lead] = await api.db.select().from(schema.leads);
    // O vinculo vem do visitante; o id de outra empresa simplesmente nao cola.
    expect(lead!.propertyId).toBeNull();
    expect(lead!.siteId).toBe(empresa.siteId);
  });
});
