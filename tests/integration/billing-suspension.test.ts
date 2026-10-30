import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, schema } from '@codeca/database';
import type { PanelOnSuspension, PublicSiteOnSuspension } from '@codeca/shared';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';
import { expireTrial, syncPlanCode } from '../helpers/billing.js';

/**
 * Politica de suspensao.
 *
 * A promessa que estes testes existem para garantir, e que ate agora so
 * estava escrita na documentacao: **inadimplencia nao apaga nada**. Nenhum
 * plano pode optar por apagar, e nenhum caminho da politica remove conteudo,
 * imagem, imovel ou configuracao.
 *
 * O resto do arquivo cobre o que a suspensao faz de fato, por eixo, porque o
 * que ela faz deixou de ser fixo: quem decide e o plano.
 */

let api: TestApi;
let admin: RegisteredAccount;
let empresa: RegisteredAccount;
let planId: string;

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

  const plano = await syncPlanCode(api, 'essencial');
  planId = plano.id;
  await api.db
    .update(schema.subscriptions)
    .set({ planId })
    .where(eq(schema.subscriptions.siteId, empresa.siteId));
});

/** Grava a politica do plano que a empresa assina. */
async function definirPolitica(
  publicSite: PublicSiteOnSuspension,
  panel: PanelOnSuspension,
): Promise<void> {
  await api.db
    .update(schema.plans)
    .set({ suspension: { publicSite, panel } })
    .where(eq(schema.plans.id, planId));
}

/**
 * Deixa a assinatura inadimplente de verdade.
 *
 * `expireTrial` encerra a avaliacao e o acesso; a tolerancia vai a zero para
 * nao mascarar o cenario -- durante a tolerancia o site **deve** continuar no
 * ar, e isso e assunto de outro teste.
 */
async function inadimplir(): Promise<void> {
  await expireTrial(api, empresa.siteId);
  await api.db
    .update(schema.subscriptions)
    .set({ status: 'past_due', gracePeriodDays: 0 })
    .where(eq(schema.subscriptions.siteId, empresa.siteId));
}

/** Credencial publicavel do site, como o site do cliente usaria. */
async function credencialPublicavel(): Promise<string> {
  const origem = await admin.client.put(`/api/platform/sites/${empresa.siteId}/origins`, {
    origins: [{ origin: 'https://horizonte.com.br', note: '' }],
  });
  expect(origem.status, origem.errorMessage ?? '').toBe(200);

  const chave = await admin.client.post(`/api/platform/sites/${empresa.siteId}/keys`, {
    kind: 'publishable',
    name: 'site',
  });
  expect(chave.status, chave.errorMessage ?? '').toBe(201);
  return chave.body.key.token as string;
}

function chamarApiPublica(token: string, path = '/api/v1/site') {
  return api.client().get(path, {
    origin: 'https://horizonte.com.br',
    headers: { authorization: `Bearer ${token}` },
  });
}

// ------------------------------------------------- o dado nunca e apagado

describe('inadimplencia nao apaga nada', () => {
  it('o conteudo continua inteiro depois da suspensao', async () => {
    const imovel = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Apartamento Jardim',
      type: 'apartamento',
      purpose: 'venda',
      publicationStatus: 'published',
    });
    expect(imovel.status, imovel.errorMessage ?? '').toBe(201);
    const imovelId = imovel.body.property.id as string;

    await definirPolitica('stop', 'blocked');
    await inadimplir();

    // A politica mais severa possivel, e nada saiu do banco.
    const [linha] = await api.db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.id, imovelId));
    expect(linha).toBeDefined();
    expect(linha?.title).toBe('Apartamento Jardim');
    expect(linha?.publicationStatus).toBe('published');

    const documentos = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(eq(schema.contentDocuments.siteId, empresa.siteId));
    expect(documentos.length).toBeGreaterThan(0);

    const modulos = await api.db
      .select()
      .from(schema.siteModules)
      .where(eq(schema.siteModules.siteId, empresa.siteId));
    expect(modulos.length).toBeGreaterThan(0);
  });

  it('o conteudo volta a aparecer quando a assinatura e regularizada', async () => {
    const imovel = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Casa do Lago',
      type: 'casa',
      purpose: 'venda',
    });
    expect(imovel.status, imovel.errorMessage ?? '').toBe(201);

    await definirPolitica('serve', 'read_only');
    await inadimplir();

    const bloqueada = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Nao deve entrar',
      type: 'casa',
      purpose: 'venda',
    });
    expect(bloqueada.status).toBe(403);

    // Regularizou: volta tudo, inclusive o que estava lá.
    await api.db
      .update(schema.subscriptions)
      .set({ status: 'active', accessUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000) })
      .where(eq(schema.subscriptions.siteId, empresa.siteId));

    const lista = await empresa.client.get(`/api/tenants/${empresa.tenantId}/properties`);
    expect(lista.status, lista.errorMessage ?? '').toBe(200);
    expect(lista.body.items.map((item: { title: string }) => item.title)).toContain('Casa do Lago');

    const nova = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Depois de regularizar',
      type: 'casa',
      purpose: 'venda',
    });
    expect(nova.status, nova.errorMessage ?? '').toBe(201);
  });
});

// ----------------------------------------------------------------- painel

describe('politica do painel', () => {
  it('somente leitura: le tudo e nao grava', async () => {
    await definirPolitica('serve', 'read_only');
    await inadimplir();

    const leitura = await empresa.client.get(`/api/tenants/${empresa.tenantId}/properties`);
    expect(leitura.status, leitura.errorMessage ?? '').toBe(200);

    const escrita = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Recusado',
      type: 'casa',
      purpose: 'venda',
    });
    expect(escrita.status).toBe(403);
    // A mensagem diz as duas coisas: que e somente leitura, e que nada foi
    // apagado. A reacao natural a um painel que parou de gravar e supor que
    // o conteudo se perdeu.
    expect(escrita.errorMessage).toContain('somente leitura');
    expect(escrita.errorMessage).toContain('apagado');
  });

  it('bloqueado: nem a leitura do conteudo responde', async () => {
    await definirPolitica('serve', 'blocked');
    await inadimplir();

    const leitura = await empresa.client.get(`/api/tenants/${empresa.tenantId}/properties`);
    expect(leitura.status).toBe(403);
    expect(leitura.errorMessage).toContain('continua salvo');
  });

  it('a tela de cobranca abre nas duas politicas', async () => {
    for (const panel of ['read_only', 'blocked'] as const) {
      await definirPolitica('serve', panel);
      await inadimplir();

      const cobranca = await empresa.client.get(`/api/tenants/${empresa.tenantId}/billing`);
      // Bloquear quem precisa pagar impediria a propria regularizacao.
      expect(cobranca.status, `politica ${panel}: ${cobranca.errorMessage ?? ''}`).toBe(200);
      expect(cobranca.body.plans.length).toBeGreaterThan(0);
      expect(cobranca.body.subscription.suspension.current).toBe(false);
      expect(cobranca.body.subscription.suspension.dataDeleted).toBe(false);
    }
  });

  it('durante a tolerancia o painel continua gravando', async () => {
    await definirPolitica('stop', 'blocked');
    // Venceu ha dois dias, com dez de tolerancia: ainda dentro dela.
    const doisDiasAtras = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    await api.db
      .update(schema.subscriptions)
      .set({
        status: 'past_due',
        trialEndsAt: doisDiasAtras,
        accessUntil: doisDiasAtras,
        currentPeriodEnd: doisDiasAtras,
        gracePeriodDays: 10,
      })
      .where(eq(schema.subscriptions.siteId, empresa.siteId));

    // Uma falha isolada de pagamento nao e inadimplencia: a tolerancia existe
    // justamente para o cartao recusado que o cliente resolve em dois dias.
    const escrita = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Durante a tolerancia',
      type: 'casa',
      purpose: 'venda',
    });
    expect(escrita.status, escrita.errorMessage ?? '').toBe(201);
  });

  it('o painel informa a restricao junto com os modulos', async () => {
    await definirPolitica('serve', 'read_only');
    await inadimplir();

    const response = await empresa.client.get(`/api/tenants/${empresa.tenantId}/modules`);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.suspension.current).toBe(false);
    expect(response.body.suspension.panel).toBe('read_only');
    expect(response.body.suspension.dataDeleted).toBe(false);
  });
});

// ----------------------------------------------------------- site publico

describe('politica do site publico', () => {
  it('servir: o visitante nao percebe nada', async () => {
    const token = await credencialPublicavel();
    await definirPolitica('serve', 'read_only');
    await inadimplir();

    const response = await chamarApiPublica(token);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.notice).toBeNull();
  });

  it('servir com aviso: responde e traz um aviso neutro', async () => {
    const token = await credencialPublicavel();
    await definirPolitica('serve_with_notice', 'read_only');
    await inadimplir();

    const response = await chamarApiPublica(token);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.notice).toBeTruthy();

    // O aviso chega ao navegador por chave publicavel: o visitante nao tem
    // parte na pendencia e nao deve saber dela.
    const aviso = String(response.body.notice).toLowerCase();
    expect(aviso).not.toContain('inadimpl');
    expect(aviso).not.toContain('pagamento');
    expect(aviso).not.toContain('assinatura');
    expect(aviso).not.toMatch(/r\$|\d{2}\/\d{2}/);
  });

  it('parar: as rotas de conteudo recusam com codigo proprio', async () => {
    const token = await credencialPublicavel();
    await definirPolitica('stop', 'read_only');
    await inadimplir();

    const response = await chamarApiPublica(token, '/api/v1/properties');
    // 402 e nao 403: nao ha nada a corrigir no codigo do site.
    expect(response.status).toBe(402);
    expect(response.errorCode).toBe('subscription_required');
    expect(response.errorMessage).toContain('Nenhum dado foi apagado');
  });

  it('a assinatura em dia nao restringe nada', async () => {
    const token = await credencialPublicavel();
    await definirPolitica('stop', 'blocked');

    const response = await chamarApiPublica(token);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.notice).toBeNull();
  });
});

// ----------------------------------------------------- assinatura do site

describe('a assinatura e do site', () => {
  it('o site principal nasce com assinatura propria', async () => {
    const linhas = await api.db
      .select({ siteId: schema.subscriptions.siteId })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, empresa.tenantId));

    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.siteId).toBe(empresa.siteId);
  });

  it('dois sites da mesma empresa tem assinaturas independentes', async () => {
    const [segundo] = await api.db
      .insert(schema.sites)
      .values({
        tenantId: empresa.tenantId,
        name: 'Portal de lancamentos',
        slug: 'lancamentos',
        status: 'active',
        isPrimary: false,
      })
      .returning({ id: schema.sites.id });
    if (!segundo) throw new Error('Nao foi possivel criar o segundo site.');

    await api.db.insert(schema.subscriptions).values({
      tenantId: empresa.tenantId,
      siteId: segundo.id,
      planId,
      status: 'active',
      accessUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    // O principal fica inadimplente; o segundo nao.
    await inadimplir();

    const [principal] = await api.db
      .select({ status: schema.subscriptions.status })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.siteId, empresa.siteId));
    const [outro] = await api.db
      .select({ status: schema.subscriptions.status })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.siteId, segundo.id));

    expect(principal?.status).toBe('past_due');
    expect(outro?.status).toBe('active');
  });

  it('o mesmo site nao aceita duas assinaturas', async () => {
    await expect(
      api.db.insert(schema.subscriptions).values({
        tenantId: empresa.tenantId,
        siteId: empresa.siteId,
        planId,
        status: 'active',
      }),
    ).rejects.toThrow();
  });
});

// ------------------------------------------------- suspensao pelo painel

describe('suspensao manual nao derruba a empresa', () => {
  it('suspender um site nao altera a situacao dos outros', async () => {
    const [segundo] = await api.db
      .insert(schema.sites)
      .values({
        tenantId: empresa.tenantId,
        name: 'Portal de lancamentos',
        slug: 'lancamentos',
        status: 'active',
        isPrimary: false,
      })
      .returning({ id: schema.sites.id });
    if (!segundo) throw new Error('Nao foi possivel criar o segundo site.');

    await api.db.insert(schema.subscriptions).values({
      tenantId: empresa.tenantId,
      siteId: segundo.id,
      planId,
      status: 'active',
      accessUntil: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });

    const [antes] = await api.db
      .select({ status: schema.tenants.status })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, empresa.tenantId));

    const response = await admin.client.post('/api/platform/billing/publication-hold', {
      siteId: segundo.id,
      hold: true,
      reason: 'Projeto em revisao com a equipe de conteudo.',
    });
    expect(response.status, response.errorMessage ?? '').toBe(200);

    // A situacao da empresa nao muda: suspender um projeto nao tranca a
    // construtora inteira, que e o que acontecia quando a assinatura era
    // unica por empresa.
    const [depois] = await api.db
      .select({ status: schema.tenants.status })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, empresa.tenantId));
    expect(depois?.status).toBe(antes?.status);
    expect(depois?.status).not.toBe('suspended');

    // E o site principal segue publicando.
    const [principal] = await api.db
      .select({ adminHold: schema.subscriptions.adminHold })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.siteId, empresa.siteId),
          eq(schema.subscriptions.tenantId, empresa.tenantId),
        ),
      );
    expect(principal?.adminHold).toBe(false);
  });

  it('o rotulo operacional do site nao e sobrescrito pela cobranca', async () => {
    const response = await admin.client.post('/api/platform/billing/publication-hold', {
      siteId: empresa.siteId,
      hold: true,
      reason: 'Suspensao administrativa para revisao.',
    });
    expect(response.status, response.errorMessage ?? '').toBe(200);

    // `sites.status` e da CODECA IA (`draft`, `active`, ...). Mexer nele aqui
    // faria um site em desenvolvimento virar "no ar" ao liberar a cobranca.
    const [site] = await api.db
      .select({ status: schema.sites.status })
      .from(schema.sites)
      .where(eq(schema.sites.id, empresa.siteId));
    expect(site?.status).toBe('draft');
  });
});
