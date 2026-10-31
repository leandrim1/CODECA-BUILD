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
 * O plano que nao inclui o painel de conteudo.
 *
 * O Essencial vende site e dominio com o conteudo mantido pela CODECA IA. O
 * cliente continua entrando -- ve a cobranca e pede upgrade -- mas nao
 * administra conteudo.
 *
 * O criterio que organiza este arquivo e a **diferenca com a suspensao**. As
 * duas bloqueiam as mesmas rotas e dizem coisas opostas: uma manda regularizar
 * o pagamento, a outra informa que o plano, em dia, nao cobre aquilo.
 * Confundi-las faria um cliente pagante achar que esta devendo -- e ligar para
 * o suporte em vez de contratar o plano acima.
 */

const ORIGEM = 'https://horizonte.com.br';

/** Imovel minimo que a validacao aceita. */
const IMOVEL = {
  title: 'Residencial Aurora',
  description: 'Apartamento de tres dormitorios com varanda gourmet.',
  type: 'apartamento',
  purpose: 'venda',
  price: 780000,
  address: { city: 'Campinas', state: 'SP', neighborhood: 'Cambui', showFullAddress: false },
  publicationStatus: 'draft',
  commercialStatus: 'disponivel',
};

let api: TestApi;
let admin: RegisteredAccount;
let empresa: RegisteredAccount;

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
});

/** Coloca a empresa em um plano do seed, pelo codigo. */
async function colocarNoPlano(code: string) {
  const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, code));
  expect(plano, `plano ${code} nao existe no seed`).toBeDefined();
  await api.db
    .update(schema.tenants)
    .set({ planId: plano!.id })
    .where(eq(schema.tenants.id, empresa.tenantId));
  return plano!;
}

const base = () => `/api/tenants/${empresa.tenantId}`;

describe('catalogo comercial', () => {
  it('os quatro planos existem com os precos contratados', async () => {
    const linhas = await api.db.select().from(schema.plans);
    const porCodigo = new Map(linhas.map((p) => [p.code, p]));

    expect(porCodigo.get('trial')!.priceCents).toBe(0);
    expect(porCodigo.get('essencial')!.priceCents).toBe(1590);
    expect(porCodigo.get('profissional')!.priceCents).toBe(5990);
    expect(porCodigo.get('empresas')!.priceCents).toBe(11990);
  });

  it('o painel e recurso apenas dos planos que o vendem', async () => {
    const linhas = await api.db.select().from(schema.plans);
    const comPainel = linhas
      .filter((p) => (p.limits.features as string[]).includes('cms_panel'))
      .map((p) => p.code)
      .sort();

    // O Essencial fica de fora; a avaliacao entra, porque o painel e
    // justamente o que se quer avaliar.
    expect(comPainel).toEqual(['empresas', 'profissional', 'trial']);
  });

  it('nenhum plano anuncia recurso do editor visual removido', async () => {
    // Os cinco recursos fantasma nao eram verificados em lugar nenhum, mas
    // apareciam na tela de plano: a plataforma vendia o que nao faz mais.
    const linhas = await api.db.select().from(schema.plans);
    const todos = linhas.flatMap((p) => p.limits.features as string[]);

    for (const fantasma of [
      'visual_editor_advanced_blocks',
      'version_history',
      'multi_page',
      'seo_advanced',
      'remove_platform_badge',
    ]) {
      expect(todos, fantasma).not.toContain(fantasma);
    }
  });
});

describe('o painel sabe por que esta vazio', () => {
  it('no plano com painel, responde incluido e lista os modulos', async () => {
    const response = await empresa.client.get(`${base()}/modules`);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.panel.included).toBe(true);
    expect((response.body.modules as unknown[]).length).toBeGreaterThan(0);
  });

  it('no Essencial, responde nao incluido com o nome do plano', async () => {
    await colocarNoPlano('essencial');

    // Esta rota fica fora do bloqueio de proposito: e por ela que a tela
    // descobre que nao ha painel. Deduzir de um erro faria o menu aparecer e
    // sumir -- o cliente veria por um instante o que nao contratou.
    const response = await empresa.client.get(`${base()}/modules`);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.panel.included).toBe(false);
    expect(response.body.panel.planName).toBe('Essencial');
    expect(response.body.modules).toEqual([]);
  });
});

describe('conteudo recusado sem painel no plano', () => {
  beforeEach(async () => {
    await colocarNoPlano('essencial');
  });

  it('recusa a leitura, e nao apenas a escrita', async () => {
    // Uma lista vazia sugere que ela poderia ser preenchida: o cliente
    // tentaria cadastrar e so ai descobriria.
    const response = await empresa.client.get(`${base()}/properties`);
    expect(response.status).toBe(402);
    expect(response.errorCode).toBe('plan_without_panel');
  });

  it('recusa a escrita', async () => {
    const response = await empresa.client.post(`${base()}/banners`, { title: 'Lancamento' });
    expect(response.status).toBe(402);
    expect(response.errorCode).toBe('plan_without_panel');
  });

  it('a mensagem fala de upgrade, nunca de regularizar pagamento', async () => {
    // O cliente do Essencial esta em dia. Ler "regularize sua assinatura"
    // geraria uma ligacao para o suporte em vez de um upgrade.
    const response = await empresa.client.get(`${base()}/properties`);

    expect(response.errorMessage).toMatch(/Essencial/);
    expect(response.errorMessage).toMatch(/Profissional/);
    expect(response.errorMessage).not.toMatch(/regulariz/i);
    expect(response.errorMessage).not.toMatch(/pendencia|atraso|inadimpl/i);
  });

  it('o codigo do erro distingue plano de inadimplencia', async () => {
    const response = await empresa.client.get(`${base()}/properties`);
    expect(response.errorCode).toBe('plan_without_panel');
    expect(response.errorCode).not.toBe('subscription_required');
  });

  it('a cobranca continua acessivel: e por onde se faz o upgrade', async () => {
    // Bloquear aqui seria impedir a propria saida da limitacao.
    const response = await empresa.client.get(`${base()}/billing`);
    expect(response.status, response.errorMessage ?? '').toBe(200);
  });

  it('a empresa continua em dia: nada de estado de suspensao', async () => {
    const [tenant] = await api.db
      .select({ status: schema.tenants.status })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, empresa.tenantId));

    expect(tenant!.status).not.toBe('suspended');

    const modules = await empresa.client.get(`${base()}/modules`);
    expect(modules.body.suspension.current).toBe(true);
  });
});

describe('o conteudo nao e apagado', () => {
  it('passar para o Essencial preserva tudo o que estava cadastrado', async () => {
    const criado = await empresa.client.post(`${base()}/properties`, IMOVEL);
    expect(criado.status, criado.errorMessage ?? '').toBe(201);

    await colocarNoPlano('essencial');

    // A regra vale para qualquer motivo de bloqueio, nao so inadimplencia:
    // nenhum caminho da plataforma apaga conteudo de cliente.
    const linhas = await api.db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.tenantId, empresa.tenantId));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.title).toBe('Residencial Aurora');
  });

  it('o upgrade devolve o painel e o conteudo continua la', async () => {
    const criado = await empresa.client.post(`${base()}/properties`, IMOVEL);
    expect(criado.status, criado.errorMessage ?? '').toBe(201);

    await colocarNoPlano('essencial');
    expect((await empresa.client.get(`${base()}/properties`)).status).toBe(402);

    await colocarNoPlano('profissional');
    const depois = await empresa.client.get(`${base()}/properties`);
    expect(depois.status, depois.errorMessage ?? '').toBe(200);
    expect(depois.body.items).toHaveLength(1);
  });
});

describe('a API publica nao depende do painel', () => {
  it('o site continua lendo conteudo mesmo sem painel no plano', async () => {
    // Decisao deliberada: `cms_panel` controla **o painel do cliente**, nao a
    // integracao. Num site do Essencial e a CODECA IA que mantem o conteudo,
    // e o site precisa continuar lendo. Quem decide se um site do Essencial e
    // integrado e a CODECA IA, ao emitir ou nao a chave.
    await admin.client.put(`/api/platform/sites/${empresa.siteId}/origins`, {
      origins: [{ origin: ORIGEM, note: 'site do cliente' }],
    });
    const emissao = await admin.client.post(`/api/platform/sites/${empresa.siteId}/keys`, {
      kind: 'publishable',
      name: 'chave do site',
    });
    expect(emissao.status, emissao.errorMessage ?? '').toBe(201);

    await colocarNoPlano('essencial');

    const resposta = await api.client().get('/api/v1/site', {
      origin: ORIGEM,
      headers: { authorization: `Bearer ${emissao.body.key.token}` },
    });
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
  });
});
