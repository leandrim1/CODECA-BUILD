import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, schema } from '@codeca/database';
import {
  createTestApi,
  primarySiteId,
  registerAccount,
  seedPlatformAdmin,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * A entidade `site` e o isolamento em dois niveis.
 *
 * Antes, `tenants` acumulava empresa e site, e o isolamento dependia de todo
 * caminho de escrita lembrar de filtrar por empresa. Agora o conteudo aponta
 * para o site, e o banco confere o par `(site_id, tenant_id)` contra o indice
 * unico de `sites`.
 *
 * A diferenca pratica: um `site_id` de outra empresa que chegue a uma escrita
 * -- por bug, por parametro forjado ou por uma consulta que esqueceu um filtro
 * -- para no banco, nao na revisao de codigo.
 */

let api: TestApi;
let alpha: RegisteredAccount;
let beta: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  await seedPlatformAdmin(api);
  alpha = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Alpha' });
  beta = await registerAccount(api, { email: 'dono@beta.com.br', companyName: 'Beta' });
});

/** Imovel minimo valido, sem o vinculo que cada teste quer variar. */
const IMOVEL = {
  slug: 'residencial-aurora',
  title: 'Residencial Aurora',
  type: 'apartamento' as const,
  purpose: 'venda' as const,
  address: {
    street: '', number: '', complement: '', neighborhood: '',
    city: 'Campinas', state: 'SP', postalCode: '', showFullAddress: true,
  },
};

describe('site da empresa', () => {
  it('toda empresa nasce com um site principal', async () => {
    const [site] = await api.db
      .select()
      .from(schema.sites)
      .where(eq(schema.sites.tenantId, alpha.tenantId));

    expect(site).toBeDefined();
    expect(site!.isPrimary).toBe(true);
    expect(site!.slug).toBe('principal');
    // Rascunho ate a CODECA IA concluir a integracao do site do cliente.
    expect(site!.status).toBe('draft');
  });

  it('o segmento padrao vem da migracao, com os modulos do segmento', async () => {
    const segmentos = await api.db.select().from(schema.segments);
    expect(segmentos.map((s) => s.code).sort()).toEqual(['construtora', 'corretor', 'imobiliaria']);

    const [construtora] = segmentos.filter((s) => s.code === 'construtora');
    expect(construtora!.defaultModules).toContain('imoveis');
    expect(construtora!.defaultModules).toContain('obras');

    // Corretor nao recebe obras por padrao -- mas pode habilitar depois.
    const [corretor] = segmentos.filter((s) => s.code === 'corretor');
    expect(corretor!.defaultModules).not.toContain('obras');
  });

  it('uma empresa nao tem dois sites principais', async () => {
    await expect(
      api.db.insert(schema.sites).values({
        tenantId: alpha.tenantId,
        name: 'Segundo',
        slug: 'segundo',
        isPrimary: true,
      }),
    ).rejects.toThrow();
  });

  it('aceita um segundo site nao principal na mesma empresa', async () => {
    // O modelo preve mais de um site por empresa; o que e unico e o principal.
    const [extra] = await api.db
      .insert(schema.sites)
      .values({ tenantId: alpha.tenantId, name: 'Lancamento', slug: 'lancamento' })
      .returning();
    expect(extra!.isPrimary).toBe(false);
  });
});

describe('isolamento conferido pelo banco', () => {
  it('recusa conteudo cujo site pertence a outra empresa', async () => {
    // O cruzamento que o isolamento por aplicacao nao pegaria sozinho: a
    // empresa esta certa, o site e de outra.
    await expect(
      api.db.insert(schema.properties).values({
        ...IMOVEL,
        tenantId: alpha.tenantId,
        siteId: beta.siteId,
      }),
    ).rejects.toThrow();
  });

  it('aceita o par correto', async () => {
    const [row] = await api.db
      .insert(schema.properties)
      .values({ ...IMOVEL, tenantId: alpha.tenantId, siteId: alpha.siteId })
      .returning();
    expect(row!.siteId).toBe(alpha.siteId);
  });

  it('apagar o site leva o conteudo dele junto, sem tocar no da outra empresa', async () => {
    await api.db
      .insert(schema.properties)
      .values({ ...IMOVEL, tenantId: alpha.tenantId, siteId: alpha.siteId });
    await api.db
      .insert(schema.properties)
      .values({ ...IMOVEL, tenantId: beta.tenantId, siteId: beta.siteId });

    await api.db.delete(schema.sites).where(eq(schema.sites.id, alpha.siteId));

    const restantes = await api.db.select().from(schema.properties);
    expect(restantes).toHaveLength(1);
    expect(restantes[0]!.tenantId).toBe(beta.tenantId);
  });
});

describe('o painel grava no site da propria empresa', () => {
  it('o imovel criado pela API nasce vinculado ao site principal', async () => {
    const response = await alpha.client.post(`/api/tenants/${alpha.tenantId}/properties`, {
      title: 'Residencial Aurora',
      type: 'apartamento',
      purpose: 'venda',
    });
    expect(response.status, response.errorMessage ?? '').toBe(201);

    const [row] = await api.db
      .select({ siteId: schema.properties.siteId, tenantId: schema.properties.tenantId })
      .from(schema.properties)
      .where(eq(schema.properties.id, response.body.property.id));

    expect(row!.siteId).toBe(await primarySiteId(api, alpha.tenantId));
    expect(row!.tenantId).toBe(alpha.tenantId);
  });

  it('a assinatura tambem e do site, nao so da empresa', async () => {
    // O pedido vincula a contratacao ao cliente e ao site contratado: uma
    // empresa com dois sites pode ter um pago e outro nao.
    const [subscription] = await api.db
      .select({ siteId: schema.subscriptions.siteId })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, alpha.tenantId));
    expect(subscription!.siteId).toBe(alpha.siteId);
  });

  it('a midia enviada fica no site da empresa que enviou', async () => {
    const form = new FormData();
    form.set('file', new File([new Uint8Array(2048)], 'fachada.jpg', { type: 'image/jpeg' }));
    const upload = await alpha.client.request('POST', `/api/tenants/${alpha.tenantId}/media`, {
      formData: form,
    });
    expect(upload.status, upload.errorMessage ?? '').toBe(201);

    const [asset] = await api.db
      .select()
      .from(schema.mediaAssets)
      .where(
        and(
          eq(schema.mediaAssets.id, upload.body.asset.id),
          eq(schema.mediaAssets.siteId, alpha.siteId),
        ),
      );
    expect(asset).toBeDefined();
  });
});
