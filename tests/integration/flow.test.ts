import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import type { DomainProvider, DomainProviderStatus } from '@codeca/api';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Fluxo completo do painel, do cadastro da construtora ao conteudo pronto.
 *
 * Nao verifica uma regra isolada: percorre a jornada na ordem em que um
 * cliente real a percorre, pela API publicada, e confirma que cada etapa
 * deixou o efeito esperado no banco. E a prova de que as partes funcionam
 * juntas.
 *
 * O que este teste **nao** cobre mais: a entrega do conteudo ao site do
 * cliente. A plataforma deixou de renderizar os sites, e a verificacao ponta a
 * ponta volta contra a API publica, quando ela existir (etapa 5).
 */

let api: TestApi;
let account: RegisteredAccount;

const HOST = 'www.construtora-horizonte.com.br';

/** Provedor de dominios que o teste controla: aqui o DNS "ja esta apontado". */
function createVerifiedDomainProvider(): DomainProvider {
  const verified = (hostname: string): DomainProviderStatus => ({
    ownershipVerified: true,
    dnsConfigured: true,
    sslActive: true,
    challenges: [],
    message: 'Dominio verificado.',
    providerDomainId: hostname,
  });

  return {
    configured: true,
    add: async (hostname) => verified(hostname),
    status: async (hostname) => verified(hostname),
    verify: async (hostname) => verified(hostname),
    remove: async () => undefined,
  };
}

beforeAll(async () => {
  api = await createTestApi({ domains: createVerifiedDomainProvider() });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  account = await registerAccount(api, {
    email: 'contato@construtorahorizonte.com.br',
    companyName: 'Construtora Horizonte',
  });
  await verifyEmail(api, account);
  // O plano Essencial libera dominio proprio.
  const [plan] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'essencial'));
  await api.db
    .update(schema.tenants)
    .set({ planId: plan!.id })
    .where(eq(schema.tenants.id, account.tenantId));
});

describe('da criacao da empresa ao conteudo pronto', () => {
  it('percorre cadastro, midia, conteudo, dominio e resumo', async () => {
    const { client, tenantId } = account;

    // ------------------------------------------------------- 1. cadastro
    const [membership] = await api.db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.tenantId, tenantId));
    expect(membership?.role).toBe('owner');

    // ------------------------------------------------ 2. biblioteca de midia
    const form = new FormData();
    form.set('file', new File([new Uint8Array(4096)], 'fachada-aurora.jpg', { type: 'image/jpeg' }));
    form.set('alt', 'Fachada do Residencial Aurora');
    const upload = await client.request('POST', `/api/tenants/${tenantId}/media`, { formData: form });
    expect(upload.status, upload.errorMessage ?? '').toBe(201);
    const mediaId = upload.body.asset.id as string;
    expect(api.blobFiles.size).toBe(1);

    // O caminho no Blob e prefixado pela empresa: uma empresa nao escreve no
    // espaco de outra nem por engano.
    const [asset] = await api.db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.id, mediaId));
    expect(asset!.blobPathname.startsWith(`tenants/${tenantId}/`)).toBe(true);

    // -------------------------------------------------------- 3. conteudo
    const property = await client.post(`/api/tenants/${tenantId}/properties`, {
      title: 'Residencial Aurora',
      description: 'Apartamentos de tres dormitorios com varanda gourmet no Cambui.',
      shortDescription: 'Tres dormitorios no Cambui',
      type: 'apartamento',
      purpose: 'venda',
      price: 780000,
      bedrooms: 3,
      bathrooms: 2,
      builtAreaM2: 94,
      features: ['Varanda gourmet', 'Lazer completo'],
      address: { city: 'Campinas', state: 'SP', neighborhood: 'Cambui', showFullAddress: false },
      coverImageId: mediaId,
      galleryImageIds: [mediaId],
      publicationStatus: 'published',
      featured: true,
    });
    expect(property.status, property.errorMessage ?? '').toBe(201);

    const project = await client.post(`/api/tenants/${tenantId}/projects`, {
      title: 'Edificio Horizonte Norte',
      description: 'Obra residencial de 12 pavimentos.',
      category: 'residencial',
      status: 'em_andamento',
      stage: 'estrutura',
      publicationStatus: 'published',
    });
    expect(project.status, project.errorMessage ?? '').toBe(201);
    const projectId = project.body.project.id as string;

    const projectUpdate = await client.post(`/api/tenants/${tenantId}/projects/${projectId}/updates`, {
      title: 'Terceiro pavimento concluido',
      note: 'Estrutura do terceiro pavimento finalizada neste mes.',
      progressPercent: 35,
      imageIds: [mediaId],
      publicationStatus: 'published',
    });
    expect(projectUpdate.status, projectUpdate.errorMessage ?? '').toBe(201);

    const service = await client.post(`/api/tenants/${tenantId}/services`, {
      title: 'Incorporacao e lancamentos',
      summary: 'Do estudo de viabilidade a entrega das chaves.',
      icon: 'building-2',
      publicationStatus: 'published',
    });
    expect(service.status, service.errorMessage ?? '').toBe(201);

    // --------------------------------------------------------- 4. dominio
    await attachDomainByApi(tenantId);

    // ----------------------------------------------- 5. resumo do painel
    const overview = await client.get(`/api/tenants/${tenantId}/overview`);
    expect(overview.status).toBe(200);
    expect(overview.body.properties.published).toBe(1);
    expect(overview.body.projects.published).toBe(1);
    expect(overview.body.services.published).toBe(1);
    expect(overview.body.media.total).toBe(1);
    expect(overview.body.domains[0].hostname).toBe(HOST);
  });

  /** Cadastra o dominio pelo painel, como o cliente faz, e o torna principal. */
  async function attachDomainByApi(tenantId: string): Promise<void> {
    const added = await account.client.post(`/api/tenants/${tenantId}/domains`, {
      domain: HOST,
      setAsPrimary: true,
    });
    expect(added.status, added.errorMessage ?? '').toBe(201);
    expect(added.body.domain.status).toBe('active');

    const list = await account.client.get(`/api/tenants/${tenantId}/domains`);
    expect(list.body.domains[0].isPrimary).toBe(true);
  }
});
