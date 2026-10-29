import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { createTestApi, registerAccount, verifyEmail, type RegisteredAccount, type TestApi } from '../helpers/api.js';

/**
 * Renderizacao no servidor dos sites publicos.
 *
 * Os testes conferem o HTML entregue ao navegador: metadados de SEO, conteudo
 * publicado, escape de texto do editor, cache por ETag e status 404.
 */

let api: TestApi;
let account: RegisteredAccount;

const HOST = 'www.construtora-alpha.com.br';

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  account = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Construtora Alpha' });
  await verifyEmail(api, account);

  await api.db.insert(schema.domains).values({
    tenantId: account.tenantId,
    hostname: HOST,
    status: 'active',
    isPrimary: true,
    ownershipVerified: true,
    dnsConfigured: true,
    sslStatus: 'active',
    verifiedAt: new Date(),
  });
});

/** Requisicao ao site publico, como um navegador faria no dominio do cliente. */
async function visit(path: string, headers: Record<string, string> = {}) {
  const response = await api.siteApp.request(`https://${HOST}${path}`, {
    method: 'GET',
    headers: { host: HOST, 'x-forwarded-proto': 'https', ...headers },
  });
  const body = await response.text();
  return { status: response.status, body, headers: response.headers };
}

async function publishAll(): Promise<void> {
  const pages = await account.client.get(`/api/tenants/${account.tenantId}/pages`);
  for (const page of pages.body.pages as Array<{ id: string }>) {
    const result = await account.client.post(
      `/api/tenants/${account.tenantId}/pages/${page.id}/publish`,
      { note: 'publicacao de teste' },
    );
    expect(result.status, result.errorMessage ?? '').toBe(200);
  }
}

describe('documento HTML', () => {
  it('entrega a pagina montada no servidor com os metadados de SEO', async () => {
    await publishAll();
    const page = await visit('/');

    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.body.startsWith('<!doctype html>')).toBe(true);
    expect(page.body).toContain('<html lang="pt-BR"');

    // Titulo, descricao e canonical vem do que a empresa cadastrou.
    expect(page.body).toContain('<title>Construtora Alpha</title>');
    expect(page.body).toContain('name="description"');
    expect(page.body).toContain(`<link rel="canonical" href="https://${HOST}/">`);
    expect(page.body).toContain('name="robots" content="index, follow"');
    expect(page.body).toContain('property="og:title"');
    expect(page.body).toContain('property="og:locale" content="pt_BR"');

    // O conteudo esta no HTML, nao apenas em JavaScript.
    expect(page.body).toContain('Construtora Alpha');
    expect(page.body).toContain('ct-header');
    expect(page.body).toContain('ct-footer');
  });

  it('aplica as cores e as fontes do tema como variaveis CSS', async () => {
    await publishAll();
    await account.client.put(`/api/tenants/${account.tenantId}/theme`, {
      schemaVersion: 1,
      colors: { primary: '#0E5C4A', secondary: '#10261F', accent: '#E0A422' },
      typography: { headingFont: 'playfair', bodyFont: 'inter', baseSizePx: 17, headingScale: 1.3 },
      radiusPx: 14,
      cardStyle: 'outlined',
      buttons: { style: 'outline', shape: 'pill', uppercase: true },
    });

    const page = await visit('/');
    expect(page.body).toContain('--ct-primary: #0E5C4A');
    expect(page.body).toContain('--ct-accent: #E0A422');
    expect(page.body).toContain('--ct-radius: 14px');
    expect(page.body).toContain('--ct-radius-button: 999px');
    expect(page.body).toContain('data-card="outlined"');
    expect(page.body).toContain('data-buttons="outline"');
    // A fonte escolhida e carregada do Google Fonts.
    expect(page.body).toContain('Playfair+Display');
  });

  it('gera media queries reais para as variacoes por tamanho de tela', async () => {
    const pages = await account.client.get(`/api/tenants/${account.tenantId}/pages`);
    const pageId = pages.body.pages.find((p: { isHome: boolean }) => p.isHome).id as string;

    await account.client.put(`/api/tenants/${account.tenantId}/pages/${pageId}/draft`, {
      layout: {
        schemaVersion: 1,
        sections: [
          {
            id: 'grade-imoveis',
            type: 'property_grid',
            props: { title: 'Imoveis', columns: 3, limit: 6 },
            style: { padding: { top: 80, bottom: 80, left: 0, right: 0 } },
            responsive: {
              tablet: { columns: 2, padding: { top: 48, bottom: 48 } },
              mobile: { columns: 1, align: 'center' },
            },
            visible: true,
            order: 0,
            name: '',
          },
        ],
      },
    });
    await account.client.post(`/api/tenants/${account.tenantId}/pages/${pageId}/publish`, { note: '' });

    const page = await visit('/');
    expect(page.body).toContain('.ct-s-grade-imoveis{');
    expect(page.body).toContain('padding: 80px 0px 80px 0px');
    expect(page.body).toContain('@media (max-width:1024px)');
    expect(page.body).toContain('@media (max-width:640px)');
    expect(page.body).toContain('--ct-cols: 3');
    expect(page.body).toContain('--ct-cols: 2');
    expect(page.body).toContain('--ct-cols: 1');
  });

  it('escapa o texto digitado no editor em vez de interpreta-lo como HTML', async () => {
    const pages = await account.client.get(`/api/tenants/${account.tenantId}/pages`);
    const pageId = pages.body.pages.find((p: { isHome: boolean }) => p.isHome).id as string;

    const payload = '<script>window.alert("xss")</script>';
    await account.client.put(`/api/tenants/${account.tenantId}/pages/${pageId}/draft`, {
      layout: {
        schemaVersion: 1,
        sections: [
          {
            id: 'texto-xss',
            type: 'text',
            props: { title: payload, body: `Corpo ${payload}`, subtitle: '', columns: 1 },
            style: {},
            responsive: {},
            visible: true,
            order: 0,
            name: '',
          },
        ],
      },
    });
    await account.client.post(`/api/tenants/${account.tenantId}/pages/${pageId}/publish`, { note: '' });

    const page = await visit('/');
    expect(page.status).toBe(200);
    // O texto aparece escapado...
    expect(page.body).toContain('&lt;script&gt;');
    // ...e nunca como script executavel.
    expect(page.body).not.toContain('<script>window.alert');
  });

  it('inclui dados estruturados apenas com o que foi cadastrado', async () => {
    await publishAll();
    await account.client.patch(`/api/tenants/${account.tenantId}`, {
      legalName: 'Alpha Engenharia Ltda',
      displayName: 'Construtora Alpha',
      taxId: '12.345.678/0001-90',
      description: 'Construtora com atuacao em obras residenciais.',
      foundedYear: 2010,
      creaNumber: 'CREA-SP 123456',
    });

    const page = await visit('/');
    expect(page.body).toContain('application/ld+json');
    expect(page.body).toContain('"@type":"GeneralContractor"');
    expect(page.body).toContain('Alpha Engenharia Ltda');
    expect(page.body).toContain('"foundingDate":"2010"');
    // Sem avaliacoes inventadas.
    expect(page.body).not.toContain('aggregateRating');
    expect(page.body).not.toContain('reviewCount');
  });

  it('nao permite que o JSON-LD feche a tag de script', async () => {
    await publishAll();
    await account.client.patch(`/api/tenants/${account.tenantId}`, {
      legalName: 'Alpha </script><script>alert(1)</script> Ltda',
      displayName: 'Construtora Alpha',
      taxId: '',
      description: '',
      foundedYear: null,
      creaNumber: '',
    });

    const page = await visit('/');
    expect(page.body).toContain('\\u003c/script');
    expect(page.body).not.toContain('</script><script>alert(1)');
  });
});

describe('rotas e status', () => {
  it('responde 404 com pagina propria e sem indexacao', async () => {
    await publishAll();
    const page = await visit('/endereco-que-nao-existe');

    expect(page.status).toBe(404);
    expect(page.body).toContain('Pagina nao encontrada');
    expect(page.body).toContain('name="robots" content="noindex, nofollow"');
    // Mantem a moldura do site, com cabecalho e rodape da empresa.
    expect(page.body).toContain('ct-header');
    expect(page.body).toContain('ct-footer');
  });

  it('renderiza o detalhe do imovel com preco e caracteristicas', async () => {
    await publishAll();
    const created = await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
      title: 'Residencial Aurora',
      description: 'Apartamento com varanda gourmet e lazer completo.',
      shortDescription: 'Tres dormitorios no Cambui',
      type: 'apartamento',
      purpose: 'venda',
      price: 780000,
      bedrooms: 3,
      suites: 1,
      bathrooms: 2,
      parkingSpots: 2,
      builtAreaM2: 94,
      features: ['Varanda gourmet', 'Portaria 24 horas'],
      publicationStatus: 'published',
      commercialStatus: 'disponivel',
      address: { city: 'Campinas', state: 'SP', neighborhood: 'Cambui', showFullAddress: false },
    });

    const slug = created.body.property.slug as string;
    const page = await visit(`/imoveis/${slug}`);

    expect(page.status).toBe(200);
    expect(page.body).toContain('Residencial Aurora');
    expect(page.body).toContain('780.000');
    expect(page.body).toContain('3 dorm.');
    expect(page.body).toContain('Varanda gourmet');
    expect(page.body).toContain('Cambui');
    // Endereco reservado: rua e numero nao vao ao ar.
    expect(page.body).not.toContain('showFullAddress');
    expect(page.body).toContain('"@type":"Residence"');
    expect(page.body).toContain(`<link rel="canonical" href="https://${HOST}/imoveis/${slug}">`);
  });

  it('renderiza o detalhe da obra e a evolucao publicada', async () => {
    await publishAll();
    const created = await account.client.post(`/api/tenants/${account.tenantId}/projects`, {
      title: 'Obra Mirante',
      description: 'Edificio residencial de oito pavimentos.',
      category: 'residencial',
      status: 'em_andamento',
      stage: 'estrutura',
      progressPercent: 45,
      publicationStatus: 'published',
      city: 'Campinas',
      state: 'SP',
    });
    const projectId = created.body.project.id as string;
    const slug = created.body.project.slug as string;

    await account.client.post(`/api/tenants/${account.tenantId}/projects/${projectId}/updates`, {
      title: 'Lajes concretadas',
      note: 'Concretagem do sexto pavimento concluida.',
      stage: 'estrutura',
      progressPercent: 52,
      recordedAt: '2025-08-12',
      imageIds: [],
    });

    const page = await visit(`/obras/${slug}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('Obra Mirante');
    expect(page.body).toContain('Lajes concretadas');
    expect(page.body).toContain('12 de agosto de 2025');
    expect(page.body).toContain('role="progressbar"');
    expect(page.body).toContain('aria-valuenow="52"');
  });

  it('nao exibe barra de progresso quando a empresa nao informou o percentual', async () => {
    await publishAll();
    const created = await account.client.post(`/api/tenants/${account.tenantId}/projects`, {
      title: 'Obra sem percentual',
      category: 'comercial',
      publicationStatus: 'published',
    });

    const page = await visit(`/obras/${created.body.project.slug}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('Obra sem percentual');
    expect(page.body).not.toContain('role="progressbar"');
  });

  it('aplica redirecionamento configurado pela empresa', async () => {
    await publishAll();
    await account.client.post(`/api/tenants/${account.tenantId}/redirects`, {
      fromPath: '/pagina-antiga',
      toPath: '/sobre',
      statusCode: 301,
      enabled: true,
    });

    const response = await api.siteApp.request(`https://${HOST}/pagina-antiga`, {
      headers: { host: HOST, 'x-forwarded-proto': 'https' },
    });
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/sobre');
  });

  it('serve sitemap e robots no proprio dominio do cliente', async () => {
    await publishAll();
    const sitemap = await visit('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get('content-type')).toContain('application/xml');
    expect(sitemap.body).toContain(`https://${HOST}/sobre`);

    const robots = await visit('/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.body).toContain(`Sitemap: https://${HOST}/sitemap.xml`);
  });

  it('nao atende host que nao pertence a nenhum site publicado', async () => {
    const response = await api.siteApp.request('https://dominio-desconhecido.com.br/', {
      headers: { host: 'dominio-desconhecido.com.br' },
    });
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain('Nenhum site responde por este endereco');
    expect(body).toContain('name="robots" content="noindex"');
  });
});

describe('cache', () => {
  it('declara cache de borda e responde 304 quando nada mudou', async () => {
    await publishAll();
    const first = await visit('/');
    const etag = first.headers.get('etag');

    expect(first.headers.get('cache-control')).toContain('s-maxage=300');
    expect(first.headers.get('cache-control')).toContain('stale-while-revalidate');
    expect(etag).toBeTruthy();

    const second = await visit('/', { 'if-none-match': etag as string });
    expect(second.status).toBe(304);
    expect(second.body).toBe('');
  });

  it('o ETag muda quando uma nova versao e publicada', async () => {
    await publishAll();
    const before = await visit('/');
    const etagBefore = before.headers.get('etag');

    const pages = await account.client.get(`/api/tenants/${account.tenantId}/pages`);
    const pageId = pages.body.pages.find((p: { isHome: boolean }) => p.isHome).id as string;
    await account.client.post(`/api/tenants/${account.tenantId}/pages/${pageId}/publish`, { note: 'nova' });

    const after = await visit('/');
    expect(after.headers.get('etag')).not.toBe(etagBefore);

    // A requisicao com o ETag antigo volta a receber o HTML completo.
    const revalidated = await visit('/', { 'if-none-match': etagBefore as string });
    expect(revalidated.status).toBe(200);
  });
});

describe('previa do editor', () => {
  it('usa o mesmo renderizador, exibe o rascunho e nunca e indexada', async () => {
    await publishAll();
    const pages = await account.client.get(`/api/tenants/${account.tenantId}/pages`);
    const pageId = pages.body.pages.find((p: { isHome: boolean }) => p.isHome).id as string;

    await account.client.put(`/api/tenants/${account.tenantId}/pages/${pageId}/draft`, {
      layout: {
        schemaVersion: 1,
        sections: [
          {
            id: 'hero-previa',
            type: 'hero',
            props: { title: 'Titulo em rascunho', subtitle: '', eyebrow: '', buttons: [] },
            style: {},
            responsive: {},
            visible: true,
            order: 0,
            name: '',
          },
        ],
      },
    });

    const preview = await account.client.get(`/api/render/preview/${account.tenantId}?path=/`);
    expect(preview.status).toBe(200);
    const html = preview.body as unknown as string;
    expect(html).toContain('Titulo em rascunho');
    expect(html).toContain('Previa do rascunho');
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(preview.headers.get('cache-control')).toBe('no-store');
    expect(preview.headers.get('x-robots-tag')).toContain('noindex');

    // O site publicado continua com o conteudo anterior.
    const live = await visit('/');
    expect(live.body).not.toContain('Titulo em rascunho');
  });

  it('exige sessao com vinculo na empresa', async () => {
    const anonymous = api.client();
    expect((await anonymous.get(`/api/render/preview/${account.tenantId}`)).status).toBe(401);

    const other = await registerAccount(api, { email: 'outro@beta.com.br', companyName: 'Beta' });
    expect((await other.client.get(`/api/render/preview/${account.tenantId}`)).status).toBe(404);
  });
});

describe('acessibilidade e conteudo', () => {
  it('traz link para o conteudo, idioma e textos alternativos', async () => {
    await publishAll();
    const page = await visit('/');
    expect(page.body).toContain('class="ct-skip"');
    expect(page.body).toContain('Ir para o conteudo');
    expect(page.body).toContain('lang="pt-BR"');
    expect(page.body).toContain('aria-label="Navegacao principal"');
  });

  it('as perguntas frequentes usam acordeao nativo, sem JavaScript', async () => {
    await account.client.post(`/api/tenants/${account.tenantId}/faqs`, {
      question: 'Voces fazem projeto?',
      answer: 'Sim, desenvolvemos o projeto completo.',
    });
    await publishAll();

    const page = await visit('/sobre');
    const home = await visit('/');
    const html = `${page.body}${home.body}`;
    expect(html).toContain('<details');
    expect(html).toContain('<summary>');
  });

  it('envia apenas o script do formulario de contato', async () => {
    await publishAll();
    const page = await visit('/contato');
    const scripts = page.body.match(/<script(?![^>]*application\/ld\+json)/g) ?? [];
    expect(scripts).toHaveLength(1);
    expect(page.body).toContain('data-ct-lead-form');
    expect(page.body).toContain('<noscript>');
  });
});
