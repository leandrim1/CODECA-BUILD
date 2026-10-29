import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { createTestApi, registerAccount, verifyEmail, type RegisteredAccount, type TestApi } from '../helpers/api.js';

/**
 * Site publico: resolucao por dominio verificado, conteudo exclusivamente
 * publicado e formulario de contato com protecao contra abuso.
 */

let api: TestApi;
let alpha: RegisteredAccount;
let beta: RegisteredAccount;

const ALPHA_HOST = 'www.construtora-alpha.com.br';
const BETA_HOST = 'www.construtora-beta.com.br';

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  alpha = await registerAccount(api, { email: 'alpha@a.com.br', companyName: 'Construtora Alpha' });
  beta = await registerAccount(api, { email: 'beta@b.com.br', companyName: 'Construtora Beta' });
  await verifyEmail(api, alpha);
  await verifyEmail(api, beta);
});

/** Vincula um dominio ja ativo, como ficaria apos a verificacao de DNS. */
async function attachDomain(tenantId: string, hostname: string, status = 'active' as const): Promise<void> {
  await api.db.insert(schema.domains).values({
    tenantId,
    hostname,
    status,
    isPrimary: true,
    ownershipVerified: status === 'active',
    dnsConfigured: status === 'active',
    sslStatus: status === 'active' ? 'active' : 'pending',
    verifiedAt: status === 'active' ? new Date() : null,
  });
}

async function publishAllPages(account: RegisteredAccount): Promise<void> {
  const pages = await account.client.get(`/api/tenants/${account.tenantId}/pages`);
  for (const page of pages.body.pages as Array<{ id: string }>) {
    const response = await account.client.post(
      `/api/tenants/${account.tenantId}/pages/${page.id}/publish`,
      { note: 'publicacao de teste' },
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);
  }
}

describe('resolucao por dominio', () => {
  it('serve o site da empresa dona do dominio verificado', async () => {
    await attachDomain(alpha.tenantId, ALPHA_HOST);
    await publishAllPages(alpha);

    const visitor = api.client().withHost(ALPHA_HOST);
    const response = await visitor.get('/api/public/site?path=/');

    expect(response.status).toBe(200);
    expect(response.body.tenant.displayName).toBe('Construtora Alpha');
    expect(response.body.context.routeKind).toBe('page');
    expect(response.body.page.isHome).toBe(true);
  });

  it('nao serve site por dominio ainda nao verificado', async () => {
    await attachDomain(alpha.tenantId, ALPHA_HOST, 'awaiting_dns');
    await publishAllPages(alpha);

    const visitor = api.client().withHost(ALPHA_HOST);
    const response = await visitor.get('/api/public/site?path=/');
    expect(response.status).toBe(404);
  });

  it('nao serve site de empresa suspensa', async () => {
    await attachDomain(alpha.tenantId, ALPHA_HOST);
    await publishAllPages(alpha);
    await api.db
      .update(schema.tenants)
      .set({ status: 'suspended' })
      .where(eq(schema.tenants.id, alpha.tenantId));

    const visitor = api.client().withHost(ALPHA_HOST);
    expect((await visitor.get('/api/public/site?path=/')).status).toBe(404);
  });

  it('nao resolve para host da propria plataforma', async () => {
    await attachDomain(alpha.tenantId, ALPHA_HOST);
    const visitor = api.client().withHost('app.localhost');
    expect((await visitor.get('/api/public/site?path=/')).status).toBe(404);
  });

  it('cada dominio serve apenas o conteudo da sua empresa', async () => {
    await attachDomain(alpha.tenantId, ALPHA_HOST);
    await attachDomain(beta.tenantId, BETA_HOST);
    await publishAllPages(alpha);
    await publishAllPages(beta);

    await alpha.client.post(`/api/tenants/${alpha.tenantId}/properties`, {
      title: 'Imovel exclusivo da Alpha',
      type: 'casa',
      purpose: 'venda',
      publicationStatus: 'published',
    });
    await beta.client.post(`/api/tenants/${beta.tenantId}/properties`, {
      title: 'Imovel exclusivo da Beta',
      type: 'casa',
      purpose: 'venda',
      publicationStatus: 'published',
    });

    const alphaSite = await api.client().withHost(ALPHA_HOST).get('/api/public/site?path=/');
    const betaSite = await api.client().withHost(BETA_HOST).get('/api/public/site?path=/');

    expect(alphaSite.body.properties.map((p: { title: string }) => p.title)).toEqual([
      'Imovel exclusivo da Alpha',
    ]);
    expect(betaSite.body.properties.map((p: { title: string }) => p.title)).toEqual([
      'Imovel exclusivo da Beta',
    ]);
  });
});

describe('somente conteudo publicado', () => {
  beforeEach(async () => {
    await attachDomain(alpha.tenantId, ALPHA_HOST);
  });

  it('pagina sem versao publicada responde como nao encontrada', async () => {
    // Nenhuma pagina foi publicada ainda.
    const visitor = api.client().withHost(ALPHA_HOST);
    const response = await visitor.get('/api/public/site?path=/');
    expect(response.status).toBe(200);
    expect(response.body.context.routeKind).toBe('not_found');
    expect(response.body.page).toBeNull();
  });

  it('o site serve a versao publicada, nao o rascunho em edicao', async () => {
    await publishAllPages(alpha);

    const pages = await alpha.client.get(`/api/tenants/${alpha.tenantId}/pages`);
    const pageId = pages.body.pages.find((p: { isHome: boolean }) => p.isHome).id as string;

    await alpha.client.put(`/api/tenants/${alpha.tenantId}/pages/${pageId}/draft`, {
      layout: {
        schemaVersion: 1,
        sections: [
          {
            id: 'hero-rascunho',
            type: 'hero',
            props: { title: 'TITULO SOMENTE NO RASCUNHO' },
            style: {},
            responsive: {},
            visible: true,
            order: 0,
            name: '',
          },
        ],
      },
    });

    const visitor = api.client().withHost(ALPHA_HOST);
    const live = await visitor.get('/api/public/site?path=/');
    expect(JSON.stringify(live.body.page.layout)).not.toContain('TITULO SOMENTE NO RASCUNHO');

    // A previa autenticada, sim, mostra o rascunho.
    const preview = await alpha.client.get(`/api/public/preview/${alpha.tenantId}?path=/`);
    expect(preview.status).toBe(200);
    expect(JSON.stringify(preview.body.page.layout)).toContain('TITULO SOMENTE NO RASCUNHO');
    expect(preview.body.context.preview).toBe(true);
  });

  it('a previa exige sessao com vinculo na empresa', async () => {
    const anonymous = api.client();
    expect((await anonymous.get(`/api/public/preview/${alpha.tenantId}?path=/`)).status).toBe(401);
    expect((await beta.client.get(`/api/public/preview/${alpha.tenantId}?path=/`)).status).toBe(404);
  });

  it('imoveis e obras em rascunho nao aparecem no site', async () => {
    await publishAllPages(alpha);

    await alpha.client.post(`/api/tenants/${alpha.tenantId}/properties`, {
      title: 'Publicado',
      type: 'casa',
      purpose: 'venda',
      publicationStatus: 'published',
    });
    await alpha.client.post(`/api/tenants/${alpha.tenantId}/properties`, {
      title: 'Em rascunho',
      type: 'casa',
      purpose: 'venda',
      publicationStatus: 'draft',
    });
    await alpha.client.post(`/api/tenants/${alpha.tenantId}/projects`, {
      title: 'Obra publicada',
      category: 'residencial',
      publicationStatus: 'published',
    });
    await alpha.client.post(`/api/tenants/${alpha.tenantId}/projects`, {
      title: 'Obra em rascunho',
      category: 'residencial',
      publicationStatus: 'draft',
    });

    const site = await api.client().withHost(ALPHA_HOST).get('/api/public/site?path=/');
    expect(site.body.properties.map((p: { title: string }) => p.title)).toEqual(['Publicado']);
    expect(site.body.projects.map((p: { title: string }) => p.title)).toEqual(['Obra publicada']);
  });

  it('depoimento sem autorizacao do autor nunca aparece no site', async () => {
    await publishAllPages(alpha);

    await alpha.client.post(`/api/tenants/${alpha.tenantId}/testimonials`, {
      authorName: 'Autorizado',
      content: 'Depoimento com autorizacao registrada pela empresa.',
      authorizationConfirmed: true,
      publicationStatus: 'published',
    });
    // Publicado no banco, mas sem a declaracao de autorizacao.
    await api.db.insert(schema.testimonials).values({
      tenantId: alpha.tenantId,
      authorName: 'Sem autorizacao',
      content: 'Texto que nao pode ir ao ar.',
      authorizationConfirmed: false,
      publicationStatus: 'published',
    });

    const site = await api.client().withHost(ALPHA_HOST).get('/api/public/site?path=/');
    expect(site.body.testimonials.map((t: { authorName: string }) => t.authorName)).toEqual(['Autorizado']);
  });

  it('nao expoe dados privados no payload publico', async () => {
    await publishAllPages(alpha);
    const [lead] = await api.db
      .insert(schema.leads)
      .values({
        tenantId: alpha.tenantId,
        name: 'Cliente Confidencial',
        phone: '(19) 90000-1111',
        email: 'confidencial@cliente.com.br',
        interestType: 'compra_imovel',
        message: 'Mensagem privada do cliente.',
      })
      .returning();
    await api.db.insert(schema.leadNotes).values({
      tenantId: alpha.tenantId,
      leadId: lead!.id,
      note: 'Observacao interna da equipe comercial.',
    });

    const site = await api.client().withHost(ALPHA_HOST).get('/api/public/site?path=/');
    const payload = JSON.stringify(site.body);

    for (const secret of [
      'Cliente Confidencial',
      'confidencial@cliente.com.br',
      'Mensagem privada do cliente.',
      'Observacao interna da equipe comercial.',
      'scrypt$',
    ]) {
      expect(payload, `payload publico contem "${secret}"`).not.toContain(secret);
    }
    expect(payload).not.toContain('passwordHash');
    expect(payload).not.toContain('ipHash');
    expect(payload).not.toContain('internalNotes');
    expect(payload).not.toContain('limitOverrides');

    // O e-mail de contato da empresa e publico por definicao (aparece no site e
    // recebe os avisos de novos interessados); o cadastro o preenche com o
    // e-mail do responsavel e a empresa pode troca-lo nas configuracoes.
    expect(site.body.tenant.email).toBe('alpha@a.com.br');
    // Ja o cadastro de usuarios nao aparece em lugar algum do payload.
    expect(payload).not.toContain('memberships');
    expect(payload).not.toContain('emailVerified');
  });

  it('respeita o endereco oculto do imovel', async () => {
    await publishAllPages(alpha);
    await alpha.client.post(`/api/tenants/${alpha.tenantId}/properties`, {
      title: 'Imovel com endereco reservado',
      type: 'casa',
      purpose: 'venda',
      publicationStatus: 'published',
      address: {
        street: 'Rua das Acacias',
        number: '120',
        neighborhood: 'Centro',
        city: 'Campinas',
        state: 'SP',
        showFullAddress: false,
      },
    });

    const site = await api.client().withHost(ALPHA_HOST).get('/api/public/site?path=/');
    const property = site.body.properties[0];
    expect(property.addressLine).not.toContain('Acacias');
    expect(property.addressLine).toContain('Centro');
    expect(property.neighborhood).toBe('Centro');
  });

  it('secoes desabilitadas nao enviam conteudo', async () => {
    await publishAllPages(alpha);
    await alpha.client.post(`/api/tenants/${alpha.tenantId}/properties`, {
      title: 'Imovel oculto por configuracao',
      type: 'casa',
      purpose: 'venda',
      publicationStatus: 'published',
    });

    await alpha.client.put(`/api/tenants/${alpha.tenantId}/sections`, {
      showProperties: false,
      showProjects: true,
      showServices: true,
      showGallery: true,
      showTestimonials: true,
      showTeam: true,
      showFaq: true,
      floatingWhatsApp: true,
      privacyPolicyUrl: '',
      privacyPolicyText: '',
    });

    const site = await api.client().withHost(ALPHA_HOST).get('/api/public/site?path=/');
    expect(site.body.sections.showProperties).toBe(false);
    expect(site.body.properties).toHaveLength(0);
  });
});

describe('rotas do site', () => {
  beforeEach(async () => {
    await attachDomain(alpha.tenantId, ALPHA_HOST);
    await publishAllPages(alpha);
  });

  it('resolve pagina interna, detalhe de imovel e detalhe de obra', async () => {
    const property = await alpha.client.post(`/api/tenants/${alpha.tenantId}/properties`, {
      title: 'Residencial Aurora',
      type: 'apartamento',
      purpose: 'venda',
      publicationStatus: 'published',
    });
    const project = await alpha.client.post(`/api/tenants/${alpha.tenantId}/projects`, {
      title: 'Obra Mirante',
      category: 'residencial',
      publicationStatus: 'published',
    });

    const visitor = api.client().withHost(ALPHA_HOST);

    const page = await visitor.get('/api/public/site?path=/sobre');
    expect(page.body.context.routeKind).toBe('page');
    expect(page.body.page.slug).toBe('sobre');

    const detail = await visitor.get(`/api/public/site?path=/imoveis/${property.body.property.slug}`);
    expect(detail.body.context.routeKind).toBe('property');
    expect(detail.body.property.title).toBe('Residencial Aurora');

    const projectDetail = await visitor.get(`/api/public/site?path=/obras/${project.body.project.slug}`);
    expect(projectDetail.body.context.routeKind).toBe('project');
    expect(projectDetail.body.project.title).toBe('Obra Mirante');

    const missing = await visitor.get('/api/public/site?path=/pagina-que-nao-existe');
    expect(missing.body.context.routeKind).toBe('not_found');
  });

  it('aplica redirecionamento configurado', async () => {
    await alpha.client.post(`/api/tenants/${alpha.tenantId}/redirects`, {
      fromPath: '/antiga',
      toPath: '/sobre',
      statusCode: 301,
      enabled: true,
    });

    const visitor = api.client().withHost(ALPHA_HOST);
    const response = await visitor.get('/api/public/site?path=/antiga');
    expect(response.body.redirect).toEqual({ toPath: '/sobre', statusCode: 301 });
  });

  it('gera sitemap com paginas, imoveis e obras publicados', async () => {
    await alpha.client.post(`/api/tenants/${alpha.tenantId}/properties`, {
      title: 'Casa Jardim',
      type: 'casa',
      purpose: 'venda',
      publicationStatus: 'published',
    });
    await alpha.client.post(`/api/tenants/${alpha.tenantId}/projects`, {
      title: 'Obra Jardim',
      category: 'residencial',
      publicationStatus: 'published',
    });

    const visitor = api.client().withHost(ALPHA_HOST);
    const response = await visitor.get('/api/public/sitemap.xml');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/xml');

    const xml = response.body as unknown as string;
    expect(xml).toContain('<urlset');
    expect(xml).toContain('/imoveis/casa-jardim');
    expect(xml).toContain('/obras/obra-jardim');
    expect(xml).toContain('/sobre');
  });

  it('robots.txt bloqueia tudo quando o SEO esta como noindex', async () => {
    const visitor = api.client().withHost(ALPHA_HOST);

    const allowed = await visitor.get('/api/public/robots.txt');
    expect(allowed.body as unknown as string).toContain('Allow: /');

    await alpha.client.put(`/api/tenants/${alpha.tenantId}/seo`, {
      defaultTitle: 'Alpha',
      titleTemplate: '%s',
      defaultDescription: '',
      shareImageUrl: '',
      canonicalBaseUrl: '',
      robots: 'noindex',
      googleSiteVerification: '',
      sitemapEnabled: true,
    });

    const blocked = await visitor.get('/api/public/robots.txt');
    expect(blocked.body as unknown as string).toContain('Disallow: /');
  });

  it('o cache do site e invalidado quando uma pagina e publicada', async () => {
    const visitor = api.client().withHost(ALPHA_HOST);
    const before = await visitor.get('/api/public/site?path=/');
    const versionBefore = Number(before.body.context.siteVersion);
    expect(before.headers.get('cache-control')).toContain('s-maxage');
    const etagBefore = before.headers.get('etag');

    const pages = await alpha.client.get(`/api/tenants/${alpha.tenantId}/pages`);
    const pageId = pages.body.pages.find((p: { isHome: boolean }) => p.isHome).id as string;
    await alpha.client.post(`/api/tenants/${alpha.tenantId}/pages/${pageId}/publish`, { note: 'nova' });

    const after = await visitor.get('/api/public/site?path=/');
    expect(Number(after.body.context.siteVersion)).toBeGreaterThan(versionBefore);
    expect(after.headers.get('etag')).not.toBe(etagBefore);
  });
});

describe('formulario publico de contato', () => {
  beforeEach(async () => {
    await attachDomain(alpha.tenantId, ALPHA_HOST);
    await attachDomain(beta.tenantId, BETA_HOST);
    await publishAllPages(alpha);
  });

  const LEAD = {
    name: 'Patricia Nunes',
    phone: '(19) 99111-2233',
    email: 'patricia@exemplo.com.br',
    interestType: 'compra_imovel',
    message: 'Gostaria de visitar o empreendimento.',
    sourcePath: '/imoveis/residencial-aurora',
    consent: true,
  };

  it('grava o interessado na empresa dona do dominio', async () => {
    const visitor = api.client().withHost(ALPHA_HOST);
    const response = await visitor.post('/api/public/leads', LEAD, { origin: `https://${ALPHA_HOST}` });
    expect(response.status, response.errorMessage ?? '').toBe(201);

    const leads = await api.db.select().from(schema.leads);
    expect(leads).toHaveLength(1);
    expect(leads[0]?.tenantId).toBe(alpha.tenantId);
    expect(leads[0]?.name).toBe('Patricia Nunes');
    expect(leads[0]?.status).toBe('novo');
    // O IP e guardado apenas como hash.
    expect(leads[0]?.ipHash ?? '').not.toContain('.');
    expect(leads[0]?.consentAt).toBeInstanceOf(Date);
  });

  it('ignora um tenantId enviado no corpo da requisicao', async () => {
    const visitor = api.client().withHost(ALPHA_HOST);
    const response = await visitor.post(
      '/api/public/leads',
      { ...LEAD, tenantId: beta.tenantId },
      { origin: `https://${ALPHA_HOST}` },
    );
    expect(response.status).toBe(201);

    const leads = await api.db.select().from(schema.leads);
    expect(leads).toHaveLength(1);
    // A empresa vem do dominio, nunca do corpo.
    expect(leads[0]?.tenantId).toBe(alpha.tenantId);
  });

  it('exige consentimento explicito', async () => {
    const visitor = api.client().withHost(ALPHA_HOST);
    const response = await visitor.post(
      '/api/public/leads',
      { ...LEAD, consent: false },
      { origin: `https://${ALPHA_HOST}` },
    );
    expect(response.status).toBe(422);
    expect(await api.db.select().from(schema.leads)).toHaveLength(0);
  });

  it('valida os campos no servidor', async () => {
    const visitor = api.client().withHost(ALPHA_HOST);
    const response = await visitor.post(
      '/api/public/leads',
      { ...LEAD, name: 'A', phone: '123', interestType: 'inexistente' },
      { origin: `https://${ALPHA_HOST}` },
    );
    expect(response.status).toBe(422);
  });

  it('descarta envio automatizado identificado pelo campo oculto', async () => {
    const visitor = api.client().withHost(ALPHA_HOST);
    const response = await visitor.post(
      '/api/public/leads',
      { ...LEAD, honeypot: 'http://spam.example' },
      { origin: `https://${ALPHA_HOST}` },
    );
    // Responde como sucesso para nao ensinar o robo, mas nada e gravado.
    expect(response.status).toBe(201);
    expect(await api.db.select().from(schema.leads)).toHaveLength(0);
  });

  it('aplica rate limiting por IP', async () => {
    const visitor = api.client().withHost(ALPHA_HOST);
    const headers = { 'x-forwarded-for': '203.0.113.10' };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await visitor.post('/api/public/leads', LEAD, {
        origin: `https://${ALPHA_HOST}`,
        headers,
      });
      expect(response.status).toBe(201);
    }

    const blocked = await visitor.post('/api/public/leads', LEAD, {
      origin: `https://${ALPHA_HOST}`,
      headers,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  it('ignora vinculo a imovel de outra empresa', async () => {
    const theirs = await beta.client.post(`/api/tenants/${beta.tenantId}/properties`, {
      title: 'Imovel da Beta',
      type: 'casa',
      purpose: 'venda',
      publicationStatus: 'published',
    });

    const visitor = api.client().withHost(ALPHA_HOST);
    const response = await visitor.post(
      '/api/public/leads',
      { ...LEAD, propertyId: theirs.body.property.id },
      { origin: `https://${ALPHA_HOST}` },
    );
    expect(response.status).toBe(201);

    const leads = await api.db.select().from(schema.leads);
    expect(leads[0]?.tenantId).toBe(alpha.tenantId);
    // O vinculo e descartado por nao pertencer a esta empresa.
    expect(leads[0]?.propertyId).toBeNull();
  });

  it('avisa a empresa por e-mail sem expor o interessado no site', async () => {
    const visitor = api.client().withHost(ALPHA_HOST);
    await visitor.post('/api/public/leads', LEAD, { origin: `https://${ALPHA_HOST}` });

    const notification = api.outbox.find((m) => m.kind === 'lead_notification');
    expect(notification).toBeDefined();
    expect(notification?.to).toBe('alpha@a.com.br');

    const site = await visitor.get('/api/public/site?path=/');
    expect(JSON.stringify(site.body)).not.toContain('Patricia Nunes');
  });
});
