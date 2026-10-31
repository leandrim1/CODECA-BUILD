import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, schema } from '@codeca/database';
import { DEFAULT_SEGMENTS } from '@codeca/shared';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Modulos por site e politica de campos.
 *
 * O painel mostra o que foi configurado para aquele projeto, e so isso. Mas
 * esconder na tela nao e proteger: a mesma politica e conferida na escrita,
 * porque a API e publica e o painel nao e a unica forma de chegar nela.
 */

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

/** Estado completo dos modulos, como o painel mestre envia. */
async function configurar(
  siteId: string,
  modules: Array<{ key: string; enabled: boolean }>,
  fieldPolicies: Array<{ moduleKey: string; fieldKey: string; editable: boolean }> = [],
) {
  return admin.client.put(`/api/platform/sites/${siteId}/modules`, {
    modules: modules.map((m) => ({ ...m, settings: {} })),
    fieldPolicies,
  });
}

describe('provisionamento do site', () => {
  it('habilita os modulos do segmento e nada alem deles', async () => {
    const response = await empresa.client.get(`/api/tenants/${empresa.tenantId}/modules`);
    expect(response.status, response.errorMessage ?? '').toBe(200);

    const habilitados = (response.body.modules as Array<{ key: string; enabled: boolean }>)
      .filter((m) => m.enabled)
      .map((m) => m.key)
      .sort();

    // Construtora e o segmento padrao: recebe exatamente o conjunto dele,
    // derivado do seed em vez de fixado -- acrescentar um modulo ao segmento
    // e decisao de produto, nao motivo para editar um teste de provisionamento.
    const doSegmento = DEFAULT_SEGMENTS.find((s) => s.code === 'construtora')!;
    expect(habilitados).toEqual([...doSegmento.defaultModules].sort());
  });

  it('o institucional nasce preenchido com o que a empresa ja informou', async () => {
    // Painel que abre vazio parece quebrado: o cliente nao sabe se e assim
    // mesmo ou se o dado dele se perdeu.
    const response = await empresa.client.get(
      `/api/tenants/${empresa.tenantId}/modules/institucional/document`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.companyName).toBe('Construtora Horizonte');
  });

  it('o documento traz os campos com a politica ja aplicada', async () => {
    const response = await empresa.client.get(
      `/api/tenants/${empresa.tenantId}/modules/contato/document`,
    );
    const campos = response.body.fields as Array<{ key: string; editable: boolean }>;
    expect(campos.find((f) => f.key === 'email')!.editable).toBe(true);
  });
});

describe('escrita do documento', () => {
  it('grava e devolve o que foi validado', async () => {
    const response = await empresa.client.put(
      `/api/tenants/${empresa.tenantId}/modules/institucional/document`,
      { companyName: 'Construtora Horizonte', mission: 'Construir bairros.' },
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.data.mission).toBe('Construir bairros.');

    const [row] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.siteId, empresa.siteId),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    expect(row!.data.mission).toBe('Construir bairros.');
  });

  it('recusa conteudo invalido antes de chegar ao banco', async () => {
    const response = await empresa.client.put(
      `/api/tenants/${empresa.tenantId}/modules/institucional/document`,
      { companyName: '' },
    );
    expect(response.status).toBe(422);
  });

  it('nao aceita documento de um modulo de colecao', async () => {
    const response = await empresa.client.put(
      `/api/tenants/${empresa.tenantId}/modules/imoveis/document`,
      { companyName: 'x' },
    );
    expect(response.status).toBe(400);
  });

  it('recusa escrita em modulo desabilitado', async () => {
    const site = await configurar(empresa.siteId, [{ key: 'contato', enabled: false }]);
    expect(site.status, site.errorMessage ?? '').toBe(200);

    const response = await empresa.client.put(
      `/api/tenants/${empresa.tenantId}/modules/contato/document`,
      { email: 'novo@horizonte.com.br' },
    );
    expect(response.status).toBe(403);
  });
});

describe('campos travados pela CODECA IA', () => {
  beforeEach(async () => {
    await configurar(
      empresa.siteId,
      [{ key: 'institucional', enabled: true }],
      [{ moduleKey: 'institucional', fieldKey: 'companyName', editable: false }],
    );
  });

  it('bloqueia a alteracao e diz qual campo', async () => {
    const response = await empresa.client.put(
      `/api/tenants/${empresa.tenantId}/modules/institucional/document`,
      { companyName: 'Outro Nome' },
    );
    expect(response.status).toBe(403);
    expect(response.errorMessage).toMatch(/Nome da empresa/);
  });

  it('aceita quando o campo travado volta com o mesmo valor', async () => {
    // O formulario reenvia tudo; so o que mudou conta.
    const response = await empresa.client.put(
      `/api/tenants/${empresa.tenantId}/modules/institucional/document`,
      { companyName: 'Construtora Horizonte', mission: 'Nova missao.' },
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.data.mission).toBe('Nova missao.');
  });

  it('o painel do cliente ve o campo como nao editavel', async () => {
    const response = await empresa.client.get(`/api/tenants/${empresa.tenantId}/modules`);
    const institucional = (response.body.modules as Array<{ key: string; fields: Array<{ key: string; editable: boolean }> }>)
      .find((m) => m.key === 'institucional');
    expect(institucional!.fields.find((f) => f.key === 'companyName')!.editable).toBe(false);
  });

  it('grava apenas as excecoes, nao a politica inteira', async () => {
    // Gravar uma linha por campo congelaria os campos de hoje: um campo novo
    // no registro ficaria invisivel para todo site ja configurado.
    const linhas = await api.db
      .select()
      .from(schema.siteFieldPolicies)
      .where(eq(schema.siteFieldPolicies.siteId, empresa.siteId));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.fieldKey).toBe('companyName');
  });
});

describe('banners', () => {
  it('cria, lista e remove quando o modulo esta habilitado', async () => {
    const criado = await empresa.client.post(`/api/tenants/${empresa.tenantId}/banners`, {
      title: 'Lancamento Aurora',
      subtitle: 'Tres dormitorios no Cambui',
      buttonLabel: 'Conhecer',
      buttonUrl: 'https://horizonte.com.br/aurora',
    });
    expect(criado.status, criado.errorMessage ?? '').toBe(201);

    const lista = await empresa.client.get(`/api/tenants/${empresa.tenantId}/banners`);
    expect(lista.body.items).toHaveLength(1);

    const removido = await empresa.client.delete(
      `/api/tenants/${empresa.tenantId}/banners/${criado.body.banner.id}`,
    );
    expect(removido.status).toBe(204);
  });

  it('exige o link quando ha texto no botao', async () => {
    const response = await empresa.client.post(`/api/tenants/${empresa.tenantId}/banners`, {
      title: 'Sem link',
      buttonLabel: 'Conhecer',
    });
    expect(response.status).toBe(422);
  });

  it('recusa janela de exibicao invertida', async () => {
    const response = await empresa.client.post(`/api/tenants/${empresa.tenantId}/banners`, {
      title: 'Campanha',
      startsAt: '2026-12-01T00:00:00Z',
      endsAt: '2026-11-01T00:00:00Z',
    });
    expect(response.status).toBe(422);
  });

  it('some inteiro quando o modulo e desabilitado', async () => {
    await configurar(empresa.siteId, [{ key: 'banners', enabled: false }]);

    const lista = await empresa.client.get(`/api/tenants/${empresa.tenantId}/banners`);
    expect(lista.status).toBe(403);
  });
});

describe('painel mestre', () => {
  it('lista os sites com empresa e segmento', async () => {
    const response = await admin.client.get('/api/platform/sites');
    expect(response.status, response.errorMessage ?? '').toBe(200);

    const site = (response.body.items as Array<{ id: string; tenantName: string; segment: string }>)
      .find((s) => s.id === empresa.siteId);
    expect(site!.tenantName).toBe('Construtora Horizonte');
    expect(site!.segment).toBe('construtora');
  });

  it('recusa politica para campo que nao existe no modulo', async () => {
    const response = await configurar(
      empresa.siteId,
      [{ key: 'imoveis', enabled: true }],
      [{ moduleKey: 'imoveis', fieldKey: 'campoInventado', editable: false }],
    );
    expect(response.status).toBe(400);
  });

  it('uma empresa nao configura o proprio site', async () => {
    // A configuracao do projeto e da CODECA IA, nao do cliente.
    const response = await empresa.client.put(`/api/platform/sites/${empresa.siteId}/modules`, {
      modules: [{ key: 'imoveis', enabled: true, settings: {} }],
      fieldPolicies: [],
    });
    expect(response.status).toBe(403);
  });
});

/**
 * Colecoes: imoveis, obras e servicos.
 *
 * Estas tres nasceram antes do registro de modulos e por isso ficaram de fora
 * da verificacao: a rota respondia a qualquer site, habilitado ou nao, e o
 * endereco na URL -- travado no registro desde o inicio -- podia ser trocado
 * pelo cliente a vontade. O painel que esconde o modulo nao resolvia nada
 * disso.
 */
describe('colecoes respeitam o modulo do site', () => {
  const TODOS = [
    'institucional',
    'contato',
    'banners',
    'imoveis',
    'obras',
    'servicos',
  ] as const;

  /** Deixa habilitado tudo menos o modulo informado. */
  async function desabilitar(moduleKey: string) {
    const response = await configurar(
      empresa.siteId,
      TODOS.map((key) => ({ key, enabled: key !== moduleKey })),
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);
  }

  const cenarios = [
    { modulo: 'imoveis', caminho: 'properties', corpo: { title: 'Casa no centro', type: 'casa', purpose: 'venda' } },
    { modulo: 'obras', caminho: 'projects', corpo: { title: 'Residencial Aurora', category: 'residencial' } },
    { modulo: 'servicos', caminho: 'services', corpo: { title: 'Consultoria' } },
  ];

  it.each(cenarios)('sem o modulo $modulo a listagem nao responde', async ({ modulo, caminho }) => {
    await desabilitar(modulo);

    const response = await empresa.client.get(`/api/tenants/${empresa.tenantId}/${caminho}`);

    // 403 e nao lista vazia: uma lista vazia sugere que poderia ser
    // preenchida, e este site nao tem o modulo.
    expect(response.status).toBe(403);
    expect(response.errorMessage).toContain('nao esta habilitado');
  });

  it.each(cenarios)('sem o modulo $modulo a criacao e recusada', async ({ modulo, caminho, corpo }) => {
    await desabilitar(modulo);

    const response = await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/${caminho}`,
      corpo,
    );

    expect(response.status).toBe(403);
  });

  it.each(cenarios)('com o modulo $modulo habilitado a criacao segue normal', async ({ caminho, corpo }) => {
    const response = await empresa.client.post(
      `/api/tenants/${empresa.tenantId}/${caminho}`,
      corpo,
    );

    expect(response.status, response.errorMessage ?? '').toBe(201);
  });
});

describe('campo travado nas colecoes', () => {
  /** Cria um imovel e devolve o id. */
  async function criarImovel(): Promise<string> {
    const response = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Apartamento Jardim',
      type: 'apartamento',
      purpose: 'venda',
    });
    expect(response.status, response.errorMessage ?? '').toBe(201);
    return response.body.property.id as string;
  }

  it('o endereco na URL nao e alterado pelo cliente', async () => {
    const id = await criarImovel();

    const response = await empresa.client.patch(
      `/api/tenants/${empresa.tenantId}/properties/${id}`,
      { slug: 'outro-endereco' },
    );

    expect(response.status).toBe(403);
    expect(response.errorMessage).toContain('Endereco na URL');
  });

  it('reenviar o mesmo endereco na URL nao e alteracao', async () => {
    const id = await criarImovel();
    const atual = await empresa.client.get(`/api/tenants/${empresa.tenantId}/properties/${id}`);

    // O formulario reenvia tudo: recusar por reenviar o mesmo valor tornaria
    // a tela impossivel de usar.
    const response = await empresa.client.patch(
      `/api/tenants/${empresa.tenantId}/properties/${id}`,
      { slug: atual.body.property.slug, title: 'Apartamento Jardim II' },
    );

    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.property.title).toBe('Apartamento Jardim II');
  });

  it('a moeda do imovel e definida com a CODECA IA', async () => {
    const response = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Sala comercial',
      type: 'sala_comercial',
      purpose: 'venda',
      currency: 'USD',
    });

    expect(response.status).toBe(403);
    expect(response.errorMessage).toContain('Moeda');
  });

  it('a moeda preenchida pelo schema nao conta como escolha do cliente', async () => {
    // O cliente nao mandou `currency`: o Zod preencheu com o padrao. Tratar
    // isso como alteracao recusaria toda criacao de imovel.
    const response = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Terreno na praia',
      type: 'terreno',
      purpose: 'venda',
    });

    expect(response.status, response.errorMessage ?? '').toBe(201);
    expect(response.body.property.currency).toBe('BRL');
  });

  it('a excecao do site libera o campo travado', async () => {
    const id = await criarImovel();
    const liberacao = await configurar(
      empresa.siteId,
      [{ key: 'imoveis', enabled: true }],
      [{ moduleKey: 'imoveis', fieldKey: 'slug', editable: true }],
    );
    expect(liberacao.status, liberacao.errorMessage ?? '').toBe(200);

    const response = await empresa.client.patch(
      `/api/tenants/${empresa.tenantId}/properties/${id}`,
      { slug: 'endereco-escolhido-pelo-cliente' },
    );

    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.property.slug).toBe('endereco-escolhido-pelo-cliente');
  });
});
