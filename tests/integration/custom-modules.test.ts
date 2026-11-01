import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, schema } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Modulos cuja existencia e dado.
 *
 * O criterio que organiza este arquivo sao as **garantias que a rota generica
 * nao abre mao**. Um CRUD escrito a mao por modulo teria cada uma de graca,
 * pelo tipo; aqui elas precisam ser conferidas em tempo de execucao, entao
 * cada uma tem teste proprio:
 *
 * 1. isolamento entre sites (quem garante e a chave estrangeira composta);
 * 2. chave desconhecida em `data`, recusada pelo nome;
 * 3. politica de campo valendo igual a do conteudo tipado;
 * 4. modulo desligado invisivel no painel **e** na API publica;
 * 5. conteudo do cliente nunca apagado por configuracao.
 *
 * E a fronteira que a etapa toda defende: a rota publica mora em
 * `/api/v1/custom/...`, nunca na raiz, para uma chave que entre no registro
 * amanha nao mudar o significado de um endereco que ja existe.
 */

const ORIGEM = 'https://cantina-bella.com.br';

/** Modulo do caso que motivou a etapa: um cardapio. */
const CARDAPIO = {
  key: 'cardapio',
  name: 'Cardapio',
  description: 'Pratos da semana.',
  kind: 'collection',
  icon: '',
  sortOrder: 0,
  enabled: true,
};

const CAMPOS = [
  {
    fieldKey: 'preco',
    label: 'Preco',
    type: 'number',
    required: false,
    help: '',
    options: [],
    editable: true,
    sortOrder: 0,
  },
  {
    fieldKey: 'categoria',
    label: 'Categoria',
    type: 'select',
    required: false,
    help: '',
    options: ['entrada', 'principal', 'sobremesa'],
    editable: true,
    sortOrder: 1,
  },
];

let api: TestApi;
let admin: RegisteredAccount;
let empresa: RegisteredAccount;
let publicavel: string;

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

  await admin.client.put(`/api/platform/sites/${empresa.siteId}/origins`, {
    origins: [{ origin: ORIGEM, note: '' }],
  });
  publicavel = (
    await admin.client.post(`/api/platform/sites/${empresa.siteId}/keys`, { kind: 'publishable' })
  ).body.key.token;
});

const base = () => `/api/tenants/${empresa.tenantId}`;
const plataforma = (siteId = empresa.siteId) => `/api/platform/sites/${siteId}`;

async function criarModulo(extra: Record<string, unknown> = {}, siteId = empresa.siteId) {
  return admin.client.post(`${plataforma(siteId)}/custom-modules`, { ...CARDAPIO, ...extra });
}

async function criarModuloOk(extra: Record<string, unknown> = {}) {
  const response = await criarModulo(extra);
  expect(response.status, response.errorMessage ?? '').toBe(201);
  return response.body.module as { key: string; name: string; kind: string };
}

async function definirCampos(
  moduleKey: string,
  fields: readonly Record<string, unknown>[] = CAMPOS,
) {
  const response = await admin.client.put(`${plataforma()}/custom-fields/${moduleKey}`, { fields });
  expect(response.status, response.errorMessage ?? '').toBe(200);
  return response;
}

async function criarRegistro(moduleKey: string, corpo: Record<string, unknown> = {}) {
  return empresa.client.post(`${base()}/custom/${moduleKey}`, {
    title: 'Lasanha da casa',
    publicationStatus: 'published',
    ...corpo,
  });
}

function comoSite(path: string) {
  return api
    .client()
    .get(path, { origin: ORIGEM, headers: { authorization: `Bearer ${publicavel}` } });
}

describe('criar o modulo', () => {
  it('cria e entrega ao painel do cliente numa lista propria', async () => {
    await criarModuloOk();

    const response = await empresa.client.get(`${base()}/modules`);
    expect(response.status, response.errorMessage ?? '').toBe(200);

    const proprios = response.body.customModules as Array<{ key: string; name: string }>;
    expect(proprios.map((m) => m.key)).toEqual(['cardapio']);

    // E **nao** entra na lista dos modulos da plataforma: sao duas listas, e e
    // a separacao que mantem `modules[].key` tipada como `ModuleKey`.
    const plataformaModulos = response.body.modules as Array<{ key: string }>;
    expect(plataformaModulos.map((m) => m.key)).not.toContain('cardapio');
  });

  it('recusa chave que a plataforma ja usa', async () => {
    const response = await criarModulo({ key: 'imoveis' });
    expect(response.status).toBe(409);
    expect(response.errorMessage).toContain('imoveis');
  });

  it('recusa chave repetida no mesmo site', async () => {
    await criarModuloOk();
    const response = await criarModulo({ name: 'Outro cardapio' });
    expect(response.status).toBe(409);
  });

  it('a mesma chave vale em sites diferentes', async () => {
    await criarModuloOk();

    const outra = await registerAccount(api, {
      email: 'contato@trattoria.com.br',
      companyName: 'Trattoria',
    });
    await verifyEmail(api, outra);

    const response = await criarModulo({}, outra.siteId);
    expect(response.status, response.errorMessage ?? '').toBe(201);
  });

  it('recusa chave que nao serve como chave de rota', async () => {
    expect((await criarModulo({ key: 'Cardapio da Semana' })).status).toBe(422);
  });

  it('recusa icone que o painel nao sabe desenhar', async () => {
    // Lista fechada: guardar um nome que nao desenha seria configuracao sem
    // efeito visivel, e `SafeIcon` receberia um nome que nao esta no mapa.
    expect((await criarModulo({ icon: 'foguete' })).status).toBe(422);
  });

  it('respeita o limite por site', async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await criarModulo({ key: `modulo_${i}`, name: `Modulo ${i}` });
      expect(response.status, response.errorMessage ?? '').toBe(201);
    }
    const excedente = await criarModulo({ key: 'modulo_11', name: 'Modulo 11' });
    expect(excedente.status).toBe(400);
    expect(excedente.errorMessage).toContain('10');
  });

  it('so o painel mestre cria: o cliente nao alcanca a rota', async () => {
    const response = await empresa.client.post(`${plataforma()}/custom-modules`, CARDAPIO);
    expect(response.status).toBe(403);
  });

  it('registra na auditoria quem criou', async () => {
    await criarModuloOk();
    const [log] = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'site.custom_module_created'));
    expect(log?.metadata).toMatchObject({ key: 'cardapio', kind: 'collection' });
  });
});

describe('alterar o modulo', () => {
  /**
   * A chave e o tipo nao mudam. A chave porque o site do cliente a usa em
   * codigo; o tipo porque trocar lista por documento deixaria registros que a
   * tela nova nao sabe mostrar.
   */
  it('recusa trocar o tipo depois de criado', async () => {
    await criarModuloOk();
    const response = await admin.client.patch(`${plataforma()}/custom-modules/cardapio`, {
      kind: 'document',
    });
    expect(response.status).toBe(400);
    expect(response.errorMessage).toContain('tipo');
  });

  it('a chave nao e alteravel: o corpo que a traz nao a muda', async () => {
    await criarModuloOk();
    const response = await admin.client.patch(`${plataforma()}/custom-modules/cardapio`, {
      key: 'menu',
      name: 'Menu',
    });
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.module.key).toBe('cardapio');
    expect(response.body.module.name).toBe('Menu');
  });

  it('a trilha diz quem tirou do ar', async () => {
    await criarModuloOk();
    await admin.client.patch(`${plataforma()}/custom-modules/cardapio`, { enabled: false });

    const [log] = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'site.custom_module_updated'));
    expect(log?.metadata).toMatchObject({ key: 'cardapio', enabled: false, wasEnabled: true });
  });
});

describe('campos do modulo', () => {
  it('reaproveita a definicao de campo da etapa F', async () => {
    const modulo = await criarModuloOk();
    await definirCampos(modulo.key);

    const response = await empresa.client.get(`${base()}/modules`);
    const proprio = (
      response.body.customModules as Array<{ key: string; fields: Array<Record<string, unknown>> }>
    ).find((m) => m.key === 'cardapio');

    expect(proprio?.fields.map((campo) => campo.key)).toEqual(['preco', 'categoria']);
    expect(proprio?.fields[0]).toMatchObject({ custom: true, type: 'number', editable: true });
  });

  it('recusa campo para um modulo que nao existe neste site', async () => {
    const response = await admin.client.put(`${plataforma()}/custom-fields/cardapio`, {
      fields: CAMPOS,
    });
    expect(response.status).toBe(404);
  });
});

describe('conteudo: a rota generica', () => {
  it('grava e devolve os valores dos campos definidos', async () => {
    const modulo = await criarModuloOk();
    await definirCampos(modulo.key);

    const criado = await criarRegistro(modulo.key, {
      data: { preco: 48.9, categoria: 'principal' },
    });
    expect(criado.status, criado.errorMessage ?? '').toBe(201);
    expect(criado.body.record.data).toEqual({ preco: 48.9, categoria: 'principal' });
    expect(criado.body.record.slug).toBe('lasanha-da-casa');
  });

  /**
   * Recusar **pelo nome** e o que torna o erro corrigivel. Aceitar em silencio
   * deixaria o JSONB crescer com o que o navegador mandasse, e nenhuma tela
   * mostraria o que ficou guardado.
   */
  it('recusa chave que ninguem definiu, dizendo qual sobrou', async () => {
    const modulo = await criarModuloOk();
    await definirCampos(modulo.key);

    const response = await criarRegistro(modulo.key, {
      data: { preco: 1, inventado: 'x' },
    });
    expect(response.status).toBe(400);
    expect(response.errorMessage).toContain('inventado');
    expect(response.errorMessage).not.toContain('preco');
  });

  it('valida por tipo e recusa escolha fora das opcoes', async () => {
    const modulo = await criarModuloOk();
    await definirCampos(modulo.key);

    expect((await criarRegistro(modulo.key, { data: { preco: 'caro' } })).status).toBe(422);
    expect((await criarRegistro(modulo.key, { data: { categoria: 'bebida' } })).status).toBe(422);
  });

  it('exige campo obrigatorio na criacao', async () => {
    const modulo = await criarModuloOk();
    await definirCampos(modulo.key, [
      { ...CAMPOS[0]!, fieldKey: 'origem', type: 'text', required: true },
    ]);

    expect((await criarRegistro(modulo.key, { data: {} })).status).toBe(422);
    const ok = await criarRegistro(modulo.key, { data: { origem: 'Cozinha propria' } });
    expect(ok.status, ok.errorMessage ?? '').toBe(201);
  });

  /** A politica por site vale igual: `policyKey` nao distingue a origem. */
  it('recusa gravacao em campo travado', async () => {
    const modulo = await criarModuloOk();
    await definirCampos(modulo.key, [{ ...CAMPOS[0]!, editable: false }]);

    const response = await criarRegistro(modulo.key, { data: { preco: 1 } });
    expect(response.status).toBe(403);
    expect(response.errorMessage).toContain('Preco');
  });

  it('a edicao parcial mescla: alterar um campo nao apaga o outro', async () => {
    const modulo = await criarModuloOk();
    await definirCampos(modulo.key);
    const criado = await criarRegistro(modulo.key, {
      data: { preco: 48.9, categoria: 'principal' },
    });

    const response = await empresa.client.patch(
      `${base()}/custom/${modulo.key}/${criado.body.record.id}`,
      { data: { preco: 52 } },
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.record.data).toEqual({ preco: 52, categoria: 'principal' });
  });

  it('gera endereco unico dentro do modulo', async () => {
    const modulo = await criarModuloOk();
    const primeiro = await criarRegistro(modulo.key);
    const segundo = await criarRegistro(modulo.key);
    expect(primeiro.body.record.slug).toBe('lasanha-da-casa');
    expect(segundo.body.record.slug).toBe('lasanha-da-casa-2');
  });

  it('o mesmo endereco vale em modulos diferentes do mesmo site', async () => {
    const um = await criarModuloOk();
    const dois = await criarModuloOk({ key: 'vinhos', name: 'Vinhos' });

    const a = await criarRegistro(um.key);
    const b = await criarRegistro(dois.key);
    expect(a.body.record.slug).toBe('lasanha-da-casa');
    expect(b.body.record.slug).toBe('lasanha-da-casa');
  });

  it('lista com busca pelo titulo e filtro de situacao', async () => {
    const modulo = await criarModuloOk();
    await criarRegistro(modulo.key, { title: 'Lasanha', publicationStatus: 'published' });
    await criarRegistro(modulo.key, { title: 'Tiramisu', publicationStatus: 'draft' });

    const busca = await empresa.client.get(`${base()}/custom/${modulo.key}?search=Tira`);
    expect((busca.body.items as unknown[]).length).toBe(1);

    const rascunhos = await empresa.client.get(
      `${base()}/custom/${modulo.key}?publicationStatus=draft`,
    );
    expect((rascunhos.body.items as Array<{ title: string }>).map((r) => r.title)).toEqual([
      'Tiramisu',
    ]);
  });

  it('recusa criar registro de lista num modulo de documento', async () => {
    const modulo = await criarModuloOk({ key: 'horarios', name: 'Horarios', kind: 'document' });
    const response = await criarRegistro(modulo.key);
    expect(response.status).toBe(400);
    expect(response.errorMessage).toContain('documento');
  });
});

describe('modulo de documento', () => {
  it('grava um registro unico, sem endereco', async () => {
    const modulo = await criarModuloOk({ key: 'horarios', name: 'Horarios', kind: 'document' });
    await definirCampos(modulo.key, [
      { ...CAMPOS[0]!, fieldKey: 'semana', type: 'text', label: 'Dias de semana' },
    ]);

    const primeiro = await empresa.client.put(`${base()}/custom/${modulo.key}/document`, {
      title: 'Horarios de funcionamento',
      publicationStatus: 'published',
      data: { semana: '11h as 15h' },
    });
    expect(primeiro.status, primeiro.errorMessage ?? '').toBe(200);
    expect(primeiro.body.record.slug).toBe('');

    const segundo = await empresa.client.put(`${base()}/custom/${modulo.key}/document`, {
      title: 'Horarios de funcionamento',
      publicationStatus: 'published',
      data: { semana: '12h as 16h' },
    });
    expect(segundo.status, segundo.errorMessage ?? '').toBe(200);
    // O mesmo registro, nao um segundo: e o indice de slug que garante.
    expect(segundo.body.record.id).toBe(primeiro.body.record.id);

    const linhas = await api.db
      .select()
      .from(schema.customRecords)
      .where(eq(schema.customRecords.moduleKey, modulo.key));
    expect(linhas).toHaveLength(1);
  });

  it('o documento ausente nao e erro: a tela abre preenchivel', async () => {
    const modulo = await criarModuloOk({ key: 'horarios', name: 'Horarios', kind: 'document' });
    const response = await empresa.client.get(`${base()}/custom/${modulo.key}/document`);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.record).toBeNull();
  });

  it('recusa a rota de documento num modulo de lista', async () => {
    const modulo = await criarModuloOk();
    const response = await empresa.client.get(`${base()}/custom/${modulo.key}/document`);
    expect(response.status).toBe(400);
  });
});

describe('API publica', () => {
  it('entrega o conteudo em /api/v1/custom/:moduleKey', async () => {
    const modulo = await criarModuloOk();
    await definirCampos(modulo.key);
    await criarRegistro(modulo.key, { data: { preco: 48.9, categoria: 'principal' } });

    const response = await comoSite(`/api/v1/custom/${modulo.key}`);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    const items = response.body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Lasanha da casa',
      slug: 'lasanha-da-casa',
      data: { preco: 48.9, categoria: 'principal' },
    });
  });

  it('entrega um registro pelo endereco', async () => {
    const modulo = await criarModuloOk();
    await criarRegistro(modulo.key);

    const response = await comoSite(`/api/v1/custom/${modulo.key}/lasanha-da-casa`);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.record.title).toBe('Lasanha da casa');
  });

  it('nao entrega rascunho sem previa', async () => {
    const modulo = await criarModuloOk();
    await criarRegistro(modulo.key, { publicationStatus: 'draft' });

    const response = await comoSite(`/api/v1/custom/${modulo.key}`);
    expect(response.body.items).toEqual([]);
  });

  it('anuncia os modulos deste projeto em /api/v1/site', async () => {
    await criarModuloOk();
    const response = await comoSite('/api/v1/site');
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(
      (response.body.customModules as Array<{ key: string }>).map((m) => m.key),
    ).toEqual(['cardapio']);
  });

  /**
   * A razao do namespace. Um modulo personalizado nunca ocupa a raiz, entao o
   * dia em que a plataforma acrescentar `cardapio` ao registro, a rota do site
   * continua lendo o mesmo conteudo.
   */
  it('nao responde na raiz de /api/v1', async () => {
    const modulo = await criarModuloOk();
    await criarRegistro(modulo.key);

    const response = await comoSite(`/api/v1/${modulo.key}`);
    expect(response.status).toBe(404);
  });

  it('modulo que nao existe responde 404, nao 403', async () => {
    const response = await comoSite('/api/v1/custom/inexistente');
    expect(response.status, 'dizer "proibido" revelaria que a rota existe alhures').toBe(404);
  });
});

describe('desligar e apagar', () => {
  it('desligado some do painel e da API publica, sem apagar registro', async () => {
    const modulo = await criarModuloOk();
    const criado = await criarRegistro(modulo.key);

    await admin.client.patch(`${plataforma()}/custom-modules/${modulo.key}`, { enabled: false });

    const painel = await empresa.client.get(`${base()}/modules`);
    expect(painel.body.customModules).toEqual([]);

    const publico = await comoSite(`/api/v1/custom/${modulo.key}`);
    expect(publico.status).toBe(404);

    const escrita = await criarRegistro(modulo.key);
    expect(escrita.status).toBe(404);

    // O conteudo continua no banco, e volta quando o modulo religa.
    const [linha] = await api.db
      .select()
      .from(schema.customRecords)
      .where(eq(schema.customRecords.id, criado.body.record.id));
    expect(linha).toBeDefined();

    await admin.client.patch(`${plataforma()}/custom-modules/${modulo.key}`, { enabled: true });
    const devolta = await comoSite(`/api/v1/custom/${modulo.key}`);
    expect((devolta.body.items as unknown[]).length).toBe(1);
  });

  /**
   * A etapa F guarda o valor de um campo removido porque ele e pedaco de um
   * registro que continua existindo. Aqui o modulo *e* o conteudo: apagar a
   * definicao deixaria a lista invisivel e orfa, sem tela por onde recuperar.
   */
  it('apagar e recusado enquanto houver registro, e aponta o caminho reversivel', async () => {
    const modulo = await criarModuloOk();
    await criarRegistro(modulo.key);

    const response = await admin.client.delete(`${plataforma()}/custom-modules/${modulo.key}`);
    expect(response.status).toBe(409);
    expect(response.errorMessage).toContain('Desabilite');

    const [linha] = await api.db
      .select()
      .from(schema.siteCustomModules)
      .where(eq(schema.siteCustomModules.key, modulo.key));
    expect(linha, 'a recusa nao apaga nada').toBeDefined();
  });

  it('apaga o modulo vazio junto com as definicoes de campo', async () => {
    const modulo = await criarModuloOk();
    await definirCampos(modulo.key);

    const response = await admin.client.delete(`${plataforma()}/custom-modules/${modulo.key}`);
    expect(response.status, response.errorMessage ?? '').toBe(204);

    const campos = await api.db
      .select()
      .from(schema.siteCustomFields)
      .where(eq(schema.siteCustomFields.moduleKey, modulo.key));
    expect(campos, 'campo sem modulo nao pertence a nada').toHaveLength(0);

    const [log] = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'site.custom_module_deleted'));
    expect(log?.metadata).toMatchObject({ key: modulo.key, recordsDeleted: 0 });
  });
});

/**
 * As duas politicas do painel valem aqui tambem.
 *
 * Nao por codigo novo: a rota entra em `tenantScoped`, que ja aplica as duas.
 * E exatamente por isso que o teste existe -- a cobertura vem de *onde a rota
 * foi registrada*, nao de nada visivel no arquivo da rota. Registra-la fora de
 * `tenantScoped`, ou acrescentar o caminho a lista de excecoes, abriria
 * conteudo para quem nao contratou o painel sem alterar uma linha deste
 * modulo. Nenhum `typecheck` acusa isso; este teste acusa.
 *
 * (A confusao de prefixo entre caminhos parecidos -- `/modules` casando com
 * `/modules-algo` -- e outra coisa, e quem a cobre e
 * `tests/unit/tenant-path.test.ts`.)
 */
describe('plano e suspensao', () => {
  async function colocarNoPlano(code: string) {
    const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, code));
    expect(plano, `plano ${code} nao existe no seed`).toBeDefined();
    await api.db
      .update(schema.tenants)
      .set({ planId: plano!.id })
      .where(eq(schema.tenants.id, empresa.tenantId));
  }

  it('o plano sem painel recusa o conteudo de um modulo proprio', async () => {
    const modulo = await criarModuloOk();
    await colocarNoPlano('essencial');

    const leitura = await empresa.client.get(`${base()}/custom/${modulo.key}`);
    expect(leitura.status).toBe(402);
    expect(leitura.errorCode).toBe('plan_without_panel');

    const escrita = await criarRegistro(modulo.key);
    expect(escrita.status).toBe(402);
    expect(escrita.errorCode).toBe('plan_without_panel');
  });

  /**
   * `/custom-modules` nao herda a liberacao de `/modules`.
   *
   * `/modules` e liberada de proposito -- e por ela que a tela descobre que nao
   * ha painel a desenhar. A lista dos modulos proprios e conteudo, e nao: o par
   * de assercoes abaixo fixa a diferenca, que hoje e so uma entrada ausente de
   * uma lista.
   */
  it('a lista de modulos proprios nao escapa pela excecao de `/modules`', async () => {
    await criarModuloOk();
    await colocarNoPlano('essencial');

    const response = await empresa.client.get(`${base()}/custom-modules`);
    expect(response.status).toBe(402);
    expect(response.errorCode).toBe('plan_without_panel');

    // A rota liberada continua liberada.
    const modulos = await empresa.client.get(`${base()}/modules`);
    expect(modulos.status, modulos.errorMessage ?? '').toBe(200);
  });
});

describe('isolamento entre sites', () => {
  it('o modulo de um site nao existe no outro', async () => {
    const outra = await registerAccount(api, {
      email: 'contato@trattoria.com.br',
      companyName: 'Trattoria',
    });
    await verifyEmail(api, outra);
    const modulo = await criarModuloOk();
    await criarRegistro(modulo.key);

    // Nem para ler...
    const leitura = await outra.client.get(`/api/tenants/${outra.tenantId}/custom/${modulo.key}`);
    expect(leitura.status).toBe(404);

    // ...nem para escrever.
    const escrita = await outra.client.post(`/api/tenants/${outra.tenantId}/custom/${modulo.key}`, {
      title: 'Invasao',
    });
    expect(escrita.status).toBe(404);
  });

  it('um id de registro de outro site nao e alcancavel', async () => {
    const outra = await registerAccount(api, {
      email: 'contato@trattoria.com.br',
      companyName: 'Trattoria',
    });
    await verifyEmail(api, outra);
    await criarModulo({}, outra.siteId);

    const modulo = await criarModuloOk();
    const meu = await criarRegistro(modulo.key);

    const response = await outra.client.patch(
      `/api/tenants/${outra.tenantId}/custom/${modulo.key}/${meu.body.record.id}`,
      { title: 'Alterado de fora' },
    );
    expect(response.status).toBe(404);
  });

  it('o registro nasce amarrado ao tenant do site', async () => {
    const modulo = await criarModuloOk();
    const criado = await criarRegistro(modulo.key);

    const [linha] = await api.db
      .select()
      .from(schema.customRecords)
      .where(
        and(
          eq(schema.customRecords.id, criado.body.record.id),
          eq(schema.customRecords.siteId, empresa.siteId),
        ),
      );
    expect(linha?.tenantId).toBe(empresa.tenantId);
  });
});
