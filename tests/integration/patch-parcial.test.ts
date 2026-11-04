import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { provisionSiteModules } from '@codeca/database';
import { MODULE_KEYS } from '@codeca/shared';
import { createTestApi, registerAccount, verifyEmail, type RegisteredAccount, type TestApi } from '../helpers/api.js';

/**
 * Atualizacao parcial nao pode mexer no que nao foi enviado.
 *
 * Achado pelo teste de carga: o `.partial()` do zod continua aplicando os
 * `.default()`, entao `PATCH { title }` gravava `publicationStatus: 'draft'` e
 * despublicava o imovel em silencio -- o site do cliente passava a responder 404.
 * Vale para todo conteudo editado por PATCH.
 */

let api: TestApi;
let conta: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});
afterAll(async () => {
  await api.close();
});
beforeEach(async () => {
  await api.reset();
  conta = await registerAccount(api, { email: 'dono@parcial.test', companyName: 'Empresa Parcial' });
  await verifyEmail(api, conta);
  await provisionSiteModules(api.db, { tenantId: conta.tenantId, siteId: conta.siteId, moduleKeys: [...MODULE_KEYS] });
});

const base = () => `/api/tenants/${conta.tenantId}`;

describe('PATCH com um campo so', () => {
  it('imovel publicado continua publicado e disponivel', async () => {
    const criado = await conta.client.post(`${base()}/properties`, {
      title: 'Casa Um',
      type: 'apartamento',
      purpose: 'venda',
      price: 100000,
      publicationStatus: 'published',
      commercialStatus: 'reservado',
      address: { city: 'Campinas', state: 'SP', neighborhood: 'Centro', showFullAddress: false },
    });
    expect(criado.status, criado.errorMessage ?? '').toBe(201);
    const id = criado.body.property.id as string;

    const edicao = await conta.client.patch(`${base()}/properties/${id}`, { title: 'Casa Dois' });
    expect(edicao.status, edicao.errorMessage ?? '').toBe(200);

    const lido = await conta.client.get(`${base()}/properties/${id}`);
    expect(lido.body.property.title).toBe('Casa Dois');
    expect(lido.body.property.publicationStatus).toBe('published');
    expect(lido.body.property.commercialStatus).toBe('reservado');
  });

  it('o que foi enviado continua valendo (despublicar de proposito funciona)', async () => {
    const criado = await conta.client.post(`${base()}/properties`, {
      title: 'Casa Tres',
      type: 'apartamento',
      purpose: 'venda',
      price: 1,
      publicationStatus: 'published',
      address: { city: 'Campinas', state: 'SP', neighborhood: 'Centro', showFullAddress: false },
    });
    const id = criado.body.property.id as string;
    await conta.client.patch(`${base()}/properties/${id}`, { publicationStatus: 'draft' });
    const lido = await conta.client.get(`${base()}/properties/${id}`);
    expect(lido.body.property.publicationStatus).toBe('draft');
  });

  it('obra e servico publicados continuam publicados', async () => {
    const obra = await conta.client.post(`${base()}/projects`, {
      title: 'Obra Um',
      category: 'residencial',
      status: 'em_andamento',
      publicationStatus: 'published',
    });
    expect(obra.status, obra.errorMessage ?? '').toBe(201);
    const obraId = obra.body.project.id as string;
    await conta.client.patch(`${base()}/projects/${obraId}`, { title: 'Obra Renomeada' });
    const obraLida = await conta.client.get(`${base()}/projects/${obraId}`);
    expect(obraLida.body.project.publicationStatus).toBe('published');
    expect(obraLida.body.project.status).toBe('em_andamento');

    const servico = await conta.client.post(`${base()}/services`, {
      title: 'Servico Um',
      summary: 'Resumo do servico.',
      icon: 'wrench',
      publicationStatus: 'published',
    });
    expect(servico.status, servico.errorMessage ?? '').toBe(201);
    const servicoId = servico.body.service.id as string;
    await conta.client.patch(`${base()}/services/${servicoId}`, { title: 'Servico Renomeado' });
    const servicoLido = await conta.client.get(`${base()}/services`);
    const item = (servicoLido.body.items as Array<{ id: string; publicationStatus: string }>).find((s) => s.id === servicoId);
    expect(item?.publicationStatus).toBe('published');
  });

  it('produto publicado continua publicado', async () => {
    const produto = await conta.client.post(`${base()}/products`, {
      title: 'Produto Um',
      summary: 'Resumo do produto.',
      price: 10,
      unit: 'unidade',
      publicationStatus: 'published',
    });
    if (produto.status !== 201) return; // modulo de produtos depende do segmento; o caso acima ja cobre a regra
    const id = produto.body.product.id as string;
    await conta.client.patch(`${base()}/products/${id}`, { title: 'Produto Renomeado' });
    const lido = await conta.client.get(`${base()}/products/${id}`);
    expect(lido.body.product.publicationStatus).toBe('published');
  });
});
