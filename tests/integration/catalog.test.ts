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
 * Produtos, categorias e galerias.
 *
 * Os testes aqui conferem sobretudo as **decisoes** que o schema nao explica
 * sozinho: preco sob consulta nao vaza o valor guardado, esgotado continua no
 * site marcado, remover categoria nao apaga produto, e apagar galeria nao
 * apaga arquivo da biblioteca.
 */

const ORIGEM = 'https://cantina-bella.com.br';

let api: TestApi;
let admin: RegisteredAccount;
let empresa: RegisteredAccount;
let publicavel: string;
let secreta: string;

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
    email: 'contato@cantinabella.com.br',
    companyName: 'Cantina Bella',
  });
  await verifyEmail(api, empresa);

  // Os tres modulos nao vem no segmento padrao de construtora: e a CODECA IA
  // que os habilita no projeto que os tem.
  await habilitar(['produtos', 'categorias', 'galerias']);

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

/** Liga modulos sem desligar os que o site ja tem. */
async function habilitar(chaves: readonly string[]) {
  const atual = await empresa.client.get(`/api/tenants/${empresa.tenantId}/modules`);
  const modulos = (atual.body.modules as Array<{ key: string; enabled: boolean }>).map((m) => ({
    key: m.key,
    enabled: m.enabled || chaves.includes(m.key),
    settings: {},
  }));
  const response = await admin.client.put(`/api/platform/sites/${empresa.siteId}/modules`, {
    modules: modulos,
    fieldPolicies: [],
  });
  expect(response.status, response.errorMessage ?? '').toBe(200);
}

const base = () => `/api/tenants/${empresa.tenantId}`;

function comoSite(path: string) {
  return api.client().get(path, { origin: ORIGEM, headers: { authorization: `Bearer ${publicavel}` } });
}

function comoServidor(path: string) {
  return api.client().get(path, { origin: null, headers: { authorization: `Bearer ${secreta}` } });
}

async function criarCategoria(name = 'Pratos principais') {
  const response = await empresa.client.post(`${base()}/categories`, { name });
  expect(response.status, response.errorMessage ?? '').toBe(201);
  return response.body.category as { id: string; slug: string; name: string };
}

async function criarProduto(extra: Record<string, unknown> = {}) {
  const response = await empresa.client.post(`${base()}/products`, {
    title: 'Lasanha da casa',
    summary: 'Massa fresca com molho de tomate artesanal.',
    price: 48.9,
    unit: 'porcao',
    publicationStatus: 'published',
    ...extra,
  });
  expect(response.status, response.errorMessage ?? '').toBe(201);
  return response.body.product as Record<string, unknown> & { id: string; slug: string };
}

async function enviarImagem(nome: string) {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(2048)], nome, { type: 'image/jpeg' }));
  form.set('alt', 'Ambiente da cantina');
  form.set('width', '1200');
  form.set('height', '800');
  const response = await empresa.client.request('POST', `${base()}/media`, { formData: form });
  expect(response.status, response.errorMessage ?? '').toBe(201);
  return response.body.asset.id as string;
}

describe('produtos no painel', () => {
  it('cria com slug derivado do nome', async () => {
    const produto = await criarProduto();
    expect(produto.slug).toBe('lasanha-da-casa');
    expect(produto.price).toBe(48.9);
  });

  it('recusa preco com mais de duas casas', async () => {
    // O banco guarda `NUMERIC(14,2)`: `19.999` seria gravado como `20.00` em
    // silencio, e o cliente veria outro valor no site.
    const response = await empresa.client.post(`${base()}/products`, {
      title: 'Cafe especial',
      price: 19.999,
    });
    expect(response.status).toBe(422);
  });

  it('aceita produto sem preco', async () => {
    const produto = await criarProduto({ title: 'Prato do dia', price: null });
    expect(produto.price).toBeNull();
  });

  it('recusa categoria de outro site', async () => {
    const outra = await registerAccount(api, {
      email: 'contato@outra.com.br',
      companyName: 'Outra Empresa',
    });
    await verifyEmail(api, outra);
    const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'profissional'));
    await api.db.update(schema.tenants).set({ planId: plano!.id }).where(eq(schema.tenants.id, outra.tenantId));

    // Categoria criada direto no banco, para o site dela.
    const [categoriaDaOutra] = await api.db
      .insert(schema.categories)
      .values({
        tenantId: outra.tenantId,
        siteId: outra.siteId,
        moduleKey: 'produtos',
        name: 'Da outra empresa',
        slug: 'da-outra-empresa',
      })
      .returning();

    // O `categoryId` chega do navegador. A chave estrangeira aponta so para
    // `categories(id)`, sem o par com o site: sem a conferencia na rota, o
    // produto apontaria para a categoria de outra empresa.
    const response = await empresa.client.post(`${base()}/products`, {
      title: 'Lasanha',
      categoryId: categoriaDaOutra!.id,
    });
    expect(response.status).toBe(404);
  });

  it('filtra por categoria', async () => {
    const pratos = await criarCategoria('Pratos');
    await criarProduto({ title: 'Lasanha', categoryId: pratos.id });
    await criarProduto({ title: 'Agua com gas' });

    const comFiltro = await empresa.client.get(`${base()}/products?categoryId=${pratos.id}`);
    expect(comFiltro.body.items).toHaveLength(1);
    expect(comFiltro.body.items[0].title).toBe('Lasanha');
  });

  it('o modulo desabilitado recusa no painel com 403 e na API publica com 404', async () => {
    const atual = await empresa.client.get(`${base()}/modules`);
    const modulos = (atual.body.modules as Array<{ key: string; enabled: boolean }>).map((m) => ({
      key: m.key,
      enabled: m.key === 'produtos' ? false : m.enabled,
      settings: {},
    }));
    await admin.client.put(`/api/platform/sites/${empresa.siteId}/modules`, {
      modules: modulos,
      fieldPolicies: [],
    });

    // A diferenca de codigo e deliberada. No painel quem chama esta
    // autenticado e a mensagem e acionavel -- "este site nao tem o modulo",
    // fale com a CODECA IA. Na API publica, 404 nao conta a quem tem a chave
    // o que o site tem ou nao tem configurado.
    expect((await empresa.client.get(`${base()}/products`)).status).toBe(403);
    expect((await comoSite('/api/v1/products')).status).toBe(404);
  });
});

describe('produtos na API publica', () => {
  it('preco sob consulta nao vaza o valor guardado', async () => {
    // O cliente pode ter informado um preco e depois marcado "sob consulta".
    // Devolver o numero faria o site exibir um valor que a empresa decidiu
    // nao divulgar.
    await criarProduto({ price: 48.9, priceOnRequest: true });

    const response = await comoSite('/api/v1/products');
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.items[0].priceOnRequest).toBe(true);
    expect(response.body.items[0].price).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('48.9');
  });

  it('esgotado continua no site, marcado', async () => {
    await criarProduto({ title: 'Lasanha', isAvailable: false });

    // Despublicar o esgotado faria o cliente recadastrar amanha. Riscar,
    // esmaecer ou esconder e decisao do projeto, nao da plataforma.
    const todos = await comoSite('/api/v1/products');
    expect(todos.body.items).toHaveLength(1);
    expect(todos.body.items[0].isAvailable).toBe(false);

    const soDisponiveis = await comoSite('/api/v1/products?availableOnly=true');
    expect(soDisponiveis.body.items).toHaveLength(0);
  });

  it('a categoria vem embutida, nao como identificador', async () => {
    const pratos = await criarCategoria('Pratos principais');
    await criarProduto({ categoryId: pratos.id });

    const response = await comoSite('/api/v1/products');
    expect(response.body.items[0].category.name).toBe('Pratos principais');
    expect(response.body.items[0].category.slug).toBe('pratos-principais');
  });

  it('filtra pelo slug da categoria', async () => {
    const pratos = await criarCategoria('Pratos');
    await criarProduto({ title: 'Lasanha', categoryId: pratos.id });
    await criarProduto({ title: 'Agua' });

    const response = await comoSite('/api/v1/products?category=pratos');
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].title).toBe('Lasanha');
  });

  it('o rascunho fica fora da chave publicavel e aparece na previa', async () => {
    await criarProduto({ publicationStatus: 'draft' });

    expect((await comoSite('/api/v1/products')).body.items).toHaveLength(0);
    expect((await comoServidor('/api/v1/products?preview=true')).body.items).toHaveLength(1);
  });

  it('abre o produto pelo endereco na URL, com a galeria', async () => {
    const imagem = await enviarImagem('prato.jpg');
    const produto = await criarProduto({ galleryImageIds: [imagem] });

    const lista = await comoSite('/api/v1/products');
    // A listagem nao carrega galeria: seria uma consulta de imagens por linha.
    expect(lista.body.items[0].gallery).toEqual([]);

    const detalhe = await comoSite(`/api/v1/products/${produto.slug}`);
    expect(detalhe.status, detalhe.errorMessage ?? '').toBe(200);
    expect(detalhe.body.product.gallery).toHaveLength(1);
  });

  it('nao entrega campo interno da plataforma', async () => {
    await criarProduto();
    const response = await comoSite('/api/v1/products');
    const corpo = JSON.stringify(response.body);

    expect(corpo).not.toContain('tenantId');
    expect(corpo).not.toContain('siteId');
    expect(corpo).not.toContain('publicationStatus');
  });
});

describe('categorias', () => {
  it('conta quantos produtos usam cada categoria', async () => {
    const pratos = await criarCategoria('Pratos');
    await criarProduto({ title: 'Lasanha', categoryId: pratos.id });
    await criarProduto({ title: 'Nhoque', categoryId: pratos.id });

    const response = await empresa.client.get(`${base()}/categories`);
    const categoria = (response.body.items as Array<{ name: string; productCount: number }>)
      .find((c) => c.name === 'Pratos');
    // A tela usa este numero para avisar antes de remover.
    expect(categoria!.productCount).toBe(2);
  });

  it('remover a categoria nao apaga produto: ele fica sem agrupamento', async () => {
    const pratos = await criarCategoria('Pratos');
    const produto = await criarProduto({ categoryId: pratos.id });

    const remocao = await empresa.client.delete(`${base()}/categories/${pratos.id}`);
    expect(remocao.status, remocao.errorMessage ?? '').toBe(204);

    const depois = await empresa.client.get(`${base()}/products/${produto.id}`);
    expect(depois.status, depois.errorMessage ?? '').toBe(200);
    expect(depois.body.product.title).toBe('Lasanha da casa');
    expect(depois.body.product.categoryId).toBeNull();
  });

  it('o slug e unico dentro do modulo', async () => {
    const primeira = await criarCategoria('Bebidas');
    const segunda = await criarCategoria('Bebidas');
    expect(primeira.slug).toBe('bebidas');
    expect(segunda.slug).not.toBe('bebidas');
  });

  it('a API publica entrega so as publicadas', async () => {
    await criarCategoria('Pratos');
    const oculta = await criarCategoria('Em preparo');
    await empresa.client.patch(`${base()}/categories/${oculta.id}`, { publicationStatus: 'draft' });

    const response = await comoSite('/api/v1/categories');
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect((response.body.items as Array<{ name: string }>).map((c) => c.name)).toEqual(['Pratos']);
  });
});

describe('galerias', () => {
  async function criarGaleria(imageIds: string[], extra: Record<string, unknown> = {}) {
    const response = await empresa.client.post(`${base()}/galleries`, {
      title: 'Nossa estrutura',
      imageIds,
      publicationStatus: 'published',
      ...extra,
    });
    expect(response.status, response.errorMessage ?? '').toBe(201);
    return response.body.gallery as { id: string; slug: string };
  }

  it('a primeira imagem da ordem e a capa', async () => {
    const primeira = await enviarImagem('salao.jpg');
    const segunda = await enviarImagem('cozinha.jpg');
    await criarGaleria([primeira, segunda]);

    // Nao ha coluna de capa: seria mais um estado a manter coerente com a
    // lista, e sairiam de sincronia na primeira reordenacao.
    const lista = await comoSite('/api/v1/galleries');
    expect(lista.status, lista.errorMessage ?? '').toBe(200);
    expect(lista.body.items[0].cover.id).toBe(primeira);
    expect(lista.body.items[0].imageCount).toBe(2);
  });

  it('a listagem nao carrega as imagens; o detalhe carrega', async () => {
    const imagem = await enviarImagem('salao.jpg');
    const galeria = await criarGaleria([imagem]);

    // Uma galeria pode ter duzentas imagens: todas de todas numa resposta
    // seria pesado para o site e para o banco.
    const lista = await comoSite('/api/v1/galleries');
    expect(lista.body.items[0].images).toBeUndefined();

    const detalhe = await comoSite(`/api/v1/galleries/${galeria.slug}`);
    expect(detalhe.status, detalhe.errorMessage ?? '').toBe(200);
    expect(detalhe.body.gallery.images).toHaveLength(1);
  });

  it('apagar a galeria nao apaga a imagem da biblioteca', async () => {
    const imagem = await enviarImagem('salao.jpg');
    const galeria = await criarGaleria([imagem]);

    const remocao = await empresa.client.delete(`${base()}/galleries/${galeria.id}`);
    expect(remocao.status, remocao.errorMessage ?? '').toBe(204);

    // Apagar o conjunto nao e apagar os arquivos: eles seguem disponiveis
    // para outros usos, e o cliente nao perde o upload.
    const [arquivo] = await api.db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.id, imagem));
    expect(arquivo).toBeDefined();
  });

  it('a ordem informada e a ordem entregue', async () => {
    const a = await enviarImagem('a.jpg');
    const b = await enviarImagem('b.jpg');
    const c = await enviarImagem('c.jpg');
    const galeria = await criarGaleria([c, a, b]);

    const detalhe = await comoSite(`/api/v1/galleries/${galeria.slug}`);
    expect((detalhe.body.gallery.images as Array<{ id: string }>).map((i) => i.id)).toEqual([c, a, b]);
  });

  it('recusa imagem que nao e da biblioteca desta empresa', async () => {
    const response = await empresa.client.post(`${base()}/galleries`, {
      title: 'Nossa estrutura',
      imageIds: ['11111111-1111-4111-8111-111111111111'],
    });
    expect(response.status).toBe(404);
  });
});

describe('isolamento', () => {
  it('o produto de uma empresa nao aparece para a outra', async () => {
    await criarProduto();

    const outra = await registerAccount(api, {
      email: 'contato@outra.com.br',
      companyName: 'Outra Empresa',
    });
    await verifyEmail(api, outra);
    const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'profissional'));
    await api.db.update(schema.tenants).set({ planId: plano!.id }).where(eq(schema.tenants.id, outra.tenantId));

    const response = await outra.client.get(`/api/tenants/${outra.tenantId}/products`);
    // A outra empresa nasceu sem o modulo, entao a recusa vem antes da
    // consulta -- e o conteudo nao atravessa de nenhuma das duas formas.
    expect(response.status).toBe(403);

    // Com o modulo habilitado, a lista dela vem vazia: o produto e do site
    // da primeira, e a restricao composta `(site_id, tenant_id)` garante
    // isso no banco, nao apenas no filtro da consulta.
    await api.db.insert(schema.siteModules).values({
      tenantId: outra.tenantId,
      siteId: outra.siteId,
      moduleKey: 'produtos',
      enabled: true,
    });

    const comModulo = await outra.client.get(`/api/tenants/${outra.tenantId}/products`);
    expect(comModulo.status, comModulo.errorMessage ?? '').toBe(200);
    expect(comModulo.body.items).toHaveLength(0);
  });
});
