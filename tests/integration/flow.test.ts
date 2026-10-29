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
 * Fluxo completo, do cadastro da construtora ao site no ar.
 *
 * Este teste nao verifica uma regra isolada: ele percorre a jornada inteira na
 * ordem em que um cliente real a percorre, usando a API publicada, e confirma
 * que cada etapa deixou o efeito esperado no banco e no HTML servido no
 * dominio da empresa. E a prova de que as partes funcionam juntas.
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

/** Requisicao ao site publico, como um navegador faria no dominio do cliente. */
async function visit(path: string): Promise<{ status: number; body: string }> {
  const response = await api.siteApp.request(`https://${HOST}${path}`, {
    method: 'GET',
    headers: { host: HOST, 'x-forwarded-proto': 'https' },
  });
  return { status: response.status, body: await response.text() };
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
  // O plano Essencial libera dominio proprio e historico de versoes.
  const [plan] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'essencial'));
  await api.db
    .update(schema.tenants)
    .set({ planId: plan!.id })
    .where(eq(schema.tenants.id, account.tenantId));
});

describe('da criacao da empresa ate o site publicado', () => {
  it('percorre cadastro, conteudo, editor, publicacao, dominio e site no ar', async () => {
    const { client, tenantId } = account;

    // ----------------------------------------------------------- 1. provisionamento
    // O cadastro ja criou site, paginas iniciais e assinatura de avaliacao.
    const pages = await client.get(`/api/tenants/${tenantId}/pages`);
    expect(pages.status, pages.errorMessage ?? '').toBe(200);
    expect(pages.body.pages.length).toBeGreaterThan(1);

    const home = pages.body.pages.find((page: { isHome: boolean }) => page.isHome) as {
      id: string;
      slug: string;
    };
    expect(home).toBeDefined();

    // --------------------------------------------------------- 2. identidade visual
    const theme = await client.put(`/api/tenants/${tenantId}/theme`, {
      colors: { primary: '#1f4ed8', secondary: '#0f172a', accent: '#f59e0b' },
      typography: { headingFont: 'manrope', bodyFont: 'inter', baseSizePx: 16 },
      buttons: { style: 'solid', shape: 'pill' },
      radiusPx: 12,
      contentWidth: 'wide',
      cardStyle: 'outlined',
      header: { style: 'light', sticky: true },
      footer: { style: 'dark', showSocial: true },
    });
    expect(theme.status, theme.errorMessage ?? '').toBe(200);

    // -------------------------------------------------------- 3. biblioteca de midia
    const form = new FormData();
    form.set('file', new File([new Uint8Array(4096)], 'fachada-aurora.jpg', { type: 'image/jpeg' }));
    form.set('alt', 'Fachada do Residencial Aurora');
    const upload = await client.request('POST', `/api/tenants/${tenantId}/media`, { formData: form });
    expect(upload.status, upload.errorMessage ?? '').toBe(201);
    const mediaId = upload.body.asset.id as string;
    expect(api.blobFiles.size).toBe(1);

    // -------------------------------------------------------------- 4. conteudo
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
    const propertyId = property.body.property.id as string;
    const propertySlug = property.body.property.slug as string;

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

    // ------------------------------------------------------------- 5. editor visual
    // Mesma operacao que o painel faz ao editar o titulo do hero e salvar.
    const homeBefore = await client.get(`/api/tenants/${tenantId}/pages/${home.id}`);
    const draftLayout = homeBefore.body.page.draftLayout as {
      schemaVersion: 1;
      sections: Array<{ type: string; props: Record<string, unknown> }>;
    };
    const hero = draftLayout.sections.find((section) => section.type === 'hero');
    expect(hero, 'a pagina inicial precisa comecar com um hero').toBeDefined();
    hero!.props.title = 'Construimos o bairro onde voce quer morar';

    const savedDraft = await client.put(`/api/tenants/${tenantId}/pages/${home.id}/draft`, {
      layout: draftLayout,
      baseRevision: homeBefore.body.page.draftRevision,
    });
    expect(savedDraft.status, savedDraft.errorMessage ?? '').toBe(200);

    // O site ainda nao mostra nada: o rascunho nao e conteudo publicado.
    await attachDomainByApi(tenantId);
    expect((await visit('/')).status).toBe(404);

    // --------------------------------------------------------------- 6. publicacao
    for (const page of pages.body.pages as Array<{ id: string }>) {
      const published = await client.post(`/api/tenants/${tenantId}/pages/${page.id}/publish`, {
        note: 'Primeira publicacao',
      });
      expect(published.status, published.errorMessage ?? '').toBe(200);
    }

    // ------------------------------------------------------------- 7. site no ar
    const site = await visit('/');
    expect(site.status).toBe(200);
    const html = site.body;

    expect(html).toContain('Construimos o bairro onde voce quer morar');
    expect(html).toContain('Construtora Horizonte');
    expect(html).toContain('Residencial Aurora');
    expect(html).toContain('Incorporacao e lancamentos');
    // O tema da empresa chega como variavel CSS.
    expect(html).toContain('#1f4ed8');
    // Nada de dado privado no HTML publico.
    expect(html).not.toContain('senhaSegura123');

    const detail = await visit(`/imoveis/${propertySlug}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toContain('Varanda gourmet');

    const sitemap = await visit('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(sitemap.body).toContain(`/imoveis/${propertySlug}`);

    // -------------------------------------------------- 8. interessado pelo site
    const visitor = api.client().withHost(HOST);
    const lead = await visitor.post(
      '/api/public/leads',
      {
        name: 'Marina Souza',
        phone: '(19) 98888-7777',
        email: 'marina@exemplo.com.br',
        interestType: 'compra_imovel',
        message: 'Gostaria de visitar o decorado.',
        propertyId,
        sourcePath: `/imoveis/${propertySlug}`,
        consent: true,
      },
      { origin: `http://${HOST}` },
    );
    expect(lead.status, lead.errorMessage ?? '').toBe(201);

    const leads = await client.get(`/api/tenants/${tenantId}/leads`);
    expect(leads.body.items).toHaveLength(1);
    expect(leads.body.items[0].name).toBe('Marina Souza');
    expect(leads.body.items[0].propertyTitle ?? leads.body.items[0].propertyId).toBeTruthy();

    // ------------------------------------------------ 9. nova versao e restauracao
    const heroEdit = await client.get(`/api/tenants/${tenantId}/pages/${home.id}`);
    const secondLayout = heroEdit.body.page.draftLayout as {
      sections: Array<{ type: string; props: Record<string, unknown> }>;
    };
    secondLayout.sections.find((section) => section.type === 'hero')!.props.title = 'Titulo trocado por engano';
    await client.put(`/api/tenants/${tenantId}/pages/${home.id}/draft`, { layout: secondLayout });
    await client.post(`/api/tenants/${tenantId}/pages/${home.id}/publish`, { note: 'Segunda' });

    expect((await visit('/')).body).toContain('Titulo trocado por engano');

    const versions = await client.get(`/api/tenants/${tenantId}/pages/${home.id}/versions`);
    expect(versions.body.versions.length).toBeGreaterThanOrEqual(2);
    const firstVersion = (versions.body.versions as Array<{ id: string; version: number }>).find(
      (version) => version.version === 1,
    );
    expect(firstVersion).toBeDefined();

    const restored = await client.post(`/api/tenants/${tenantId}/pages/${home.id}/restore`, {
      versionId: firstVersion!.id,
      publish: true,
    });
    expect(restored.status, restored.errorMessage ?? '').toBe(200);

    const restoredHtml = (await visit('/')).body;
    expect(restoredHtml).toContain('Construimos o bairro onde voce quer morar');
    expect(restoredHtml).not.toContain('Titulo trocado por engano');

    // ------------------------------------------------------- 10. registro no banco
    const [siteSettings] = await api.db
      .select()
      .from(schema.siteSettings)
      .where(eq(schema.siteSettings.tenantId, tenantId));
    expect(siteSettings!.publishedVersion).toBeGreaterThan(1);
    expect(siteSettings!.lastPublishedAt).not.toBeNull();

    // Cada versao registra quem publicou e quando.
    const versionRows = await api.db
      .select()
      .from(schema.pageVersions)
      .where(eq(schema.pageVersions.pageId, home.id));
    expect(versionRows.length).toBeGreaterThanOrEqual(3); // v1, v2 e a restauracao
    for (const row of versionRows) {
      expect(row.publishedByUserId).toBe(account.userId);
      expect(row.tenantId).toBe(tenantId);
    }

    const audit = await client.get(`/api/tenants/${tenantId}/overview`);
    expect(audit.status).toBe(200);
    expect(audit.body.properties.published).toBe(1);
    expect(audit.body.projects.published).toBe(1);
    expect(audit.body.leads.total).toBe(1);
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
