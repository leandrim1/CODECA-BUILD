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
 * Campos personalizados por site.
 *
 * O caso que pediu isto: um cliente tem "CRECI", outro tem "Registro
 * profissional", e nenhum precisa da estrutura do outro.
 *
 * O criterio que organiza este arquivo e a **fronteira entre definicao e
 * valor**. Definir e configurar (painel mestre, CODECA IA); preencher e
 * conteudo (painel do cliente). As duas coisas se encontram em dois lugares
 * delicados, e e neles que os testes insistem:
 *
 * 1. a definicao entra na *mesma* lista de campos que o painel ja desenha, com
 *    `custom: true` -- se ela saisse por um caminho paralelo, a politica de
 *    campos e a conferencia de escrita nao valeriam para ela;
 * 2. remover a definicao esconde o campo mas **nao apaga valor**, porque
 *    nenhum caminho desta plataforma apaga conteudo de cliente.
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
  publicationStatus: 'published',
  commercialStatus: 'disponivel',
};

/** Definicao completa, como o painel mestre a envia. */
const CRECI = {
  fieldKey: 'creci',
  label: 'CRECI do corretor',
  type: 'text',
  required: false,
  help: 'Numero de registro no conselho regional.',
  options: [],
  editable: true,
  sortOrder: 0,
};

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
    email: 'contato@horizonte.com.br',
    companyName: 'Construtora Horizonte',
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

/** Define os campos de um modulo, como o painel mestre faz. */
async function definir(
  moduleKey: string,
  fields: readonly Record<string, unknown>[],
  siteId = empresa.siteId,
) {
  return admin.client.put(`/api/platform/sites/${siteId}/custom-fields/${moduleKey}`, { fields });
}

/** Garante a definicao e falha o teste se a plataforma recusar. */
async function definirOk(moduleKey: string, fields: readonly Record<string, unknown>[]) {
  const response = await definir(moduleKey, fields);
  expect(response.status, response.errorMessage ?? '').toBe(200);
  return response;
}

async function criarImovel(extra: Record<string, unknown> = {}) {
  return empresa.client.post(`${base()}/properties`, { ...IMOVEL, ...extra });
}

/** O campo como ele chega ao painel, dentro da lista do modulo. */
function campoDoModulo(body: unknown, moduleKey: string, fieldKey: string) {
  const modules = (body as { modules: Array<{ key: string; fields: Array<Record<string, unknown>> }> })
    .modules;
  const modulo = modules.find((m) => m.key === moduleKey);
  return modulo?.fields.find((f) => f.key === fieldKey);
}

/**
 * Salva modulos e politica como a tela do painel mestre salva.
 *
 * A tela envia a politica de **todos** os campos da lista, e a lista agora
 * inclui os personalizados -- e exatamente o caso que quebrava.
 */
async function salvarPolitica(extras: readonly Record<string, unknown>[] = []) {
  const atual = await admin.client.get(`/api/platform/sites/${empresa.siteId}`);
  const modules = atual.body.modules as Array<{
    key: string;
    enabled: boolean;
    fields: Array<{ key: string; editable: boolean }>;
  }>;
  const extraKeys = new Set(extras.map((e) => `${e.moduleKey}.${e.fieldKey}`));
  return admin.client.put(`/api/platform/sites/${empresa.siteId}/modules`, {
    modules: modules.map((m) => ({ key: m.key, enabled: m.enabled, settings: {} })),
    fieldPolicies: [
      ...modules.flatMap((m) =>
        m.fields
          .filter((f) => !extraKeys.has(`${m.key}.${f.key}`))
          .map((f) => ({ moduleKey: m.key, fieldKey: f.key, editable: f.editable, note: '' })),
      ),
      ...extras,
    ],
  });
}

function comoSite(path: string) {
  return api
    .client()
    .get(path, { origin: ORIGEM, headers: { authorization: `Bearer ${publicavel}` } });
}

describe('definicao dos campos', () => {
  it('o campo definido entra na mesma lista que o painel desenha, marcado como personalizado', async () => {
    const resposta = await definirOk('imoveis', [CRECI]);

    const campo = campoDoModulo(resposta.body, 'imoveis', 'creci');
    expect(campo).toMatchObject({
      key: 'creci',
      label: 'CRECI do corretor',
      type: 'text',
      custom: true,
      editable: true,
      help: 'Numero de registro no conselho regional.',
    });

    // E a mesma lista: o campo tipado continua la, antes do personalizado.
    const modules = (resposta.body as { modules: Array<{ key: string; fields: Array<{ key: string }> }> })
      .modules;
    const imoveis = modules.find((m) => m.key === 'imoveis')!;
    expect(imoveis.fields.map((f) => f.key)).toContain('title');
    expect(imoveis.fields.at(-1)!.key).toBe('creci');
  });

  it('o painel do cliente recebe o campo pela rota de modulos que ja usava', async () => {
    await definirOk('imoveis', [CRECI]);

    const response = await empresa.client.get(`${base()}/modules`);
    expect(response.status).toBe(200);
    expect(campoDoModulo(response.body, 'imoveis', 'creci')).toMatchObject({ custom: true });
  });

  it('lista as definicoes de todos os modulos do site', async () => {
    await definirOk('imoveis', [CRECI]);
    await definirOk('servicos', [{ ...CRECI, fieldKey: 'prazo', label: 'Prazo medio' }]);

    const response = await admin.client.get(`/api/platform/sites/${empresa.siteId}/custom-fields`);
    expect(response.status).toBe(200);
    const items = response.body.items as Array<{ moduleKey: string; fieldKey: string }>;
    expect(items.map((i) => `${i.moduleKey}.${i.fieldKey}`).sort()).toEqual([
      'imoveis.creci',
      'servicos.prazo',
    ]);
  });

  it('recusa chave que o modulo ja tem no registro', async () => {
    const response = await definir('imoveis', [{ ...CRECI, fieldKey: 'title', label: 'Outro titulo' }]);
    expect(response.status).toBe(409);
    expect(response.errorMessage).toContain('title');
  });

  it('recusa chave repetida na mesma chamada', async () => {
    const response = await definir('imoveis', [CRECI, { ...CRECI, label: 'CRECI de novo' }]);
    expect(response.status).toBe(400);
    expect(response.errorMessage).toContain('creci');
  });

  it('recusa chave que nao serve como chave de JSONB', async () => {
    const response = await definir('imoveis', [{ ...CRECI, fieldKey: 'CRECI do corretor' }]);
    expect(response.status).toBe(422);
  });

  it('recusa escolha com menos de duas opcoes', async () => {
    const response = await definir('imoveis', [
      { ...CRECI, fieldKey: 'padrao', type: 'select', options: ['alto'] },
    ]);
    expect(response.status).toBe(422);
  });

  it('recusa opcoes em campo que nao e escolha', async () => {
    const response = await definir('imoveis', [{ ...CRECI, options: ['alto', 'medio'] }]);
    expect(response.status).toBe(422);
  });

  /**
   * O cliente nao poderia preencher (403) nem omitir (obrigatorio na criacao),
   * e nao existe caminho pelo qual a CODECA IA preencha valor de conteudo: o
   * formulario de cadastro nunca salvaria.
   */
  it('recusa campo obrigatorio e nao editavel ao mesmo tempo', async () => {
    const response = await definir('imoveis', [{ ...CRECI, required: true, editable: false }]);
    expect(response.status).toBe(422);

    // Cada um separado continua valendo.
    expect((await definir('imoveis', [{ ...CRECI, required: true }])).status).toBe(200);
    expect((await definir('imoveis', [{ ...CRECI, editable: false }])).status).toBe(200);
  });

  /**
   * A tela do painel mestre so oferece os modulos que declaram
   * `customFields`. Esta e a conferencia do servidor, que e a que vale.
   */
  it('recusa modulo que nao aceita campo personalizado', async () => {
    const response = await definir('faq', [CRECI]);
    expect(response.status).toBe(400);
    expect(response.errorMessage).toContain('aceita campos personalizados');
  });

  it('so o painel mestre define: o cliente nao alcanca a rota', async () => {
    const response = await empresa.client.put(
      `/api/platform/sites/${empresa.siteId}/custom-fields/imoveis`,
      { fields: [CRECI] },
    );
    expect(response.status).toBe(403);
  });

  /**
   * A tela de modulos do painel mestre reenvia a politica de todos os campos
   * que a lista traz. Como o campo personalizado entra nessa lista, ela passou
   * a enviar tambem o `creci` -- e a rota, que conferia a chave contra o
   * registro, recusava. O efeito era a tela que liga e desliga modulos parar
   * de salvar em todo site que tivesse um campo personalizado.
   */
  it('a tela de modulos continua salvando depois de um campo ser definido', async () => {
    await definirOk('imoveis', [CRECI]);
    const response = await salvarPolitica();
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(campoDoModulo(response.body, 'imoveis', 'creci')).toMatchObject({ custom: true });
  });

  it('a politica so guarda o que difere da definicao', async () => {
    await definirOk('imoveis', [CRECI]);
    // Reenviar `editable: true`, que e o padrao da definicao, nao e excecao.
    await salvarPolitica();
    const semExcecao = await api.db
      .select()
      .from(schema.siteFieldPolicies)
      .where(eq(schema.siteFieldPolicies.fieldKey, 'creci'));
    expect(semExcecao).toHaveLength(0);

    await salvarPolitica([{ moduleKey: 'imoveis', fieldKey: 'creci', editable: false }]);
    const comExcecao = await api.db
      .select()
      .from(schema.siteFieldPolicies)
      .where(eq(schema.siteFieldPolicies.fieldKey, 'creci'));
    expect(comExcecao).toHaveLength(1);
  });

  it('registra na auditoria que valor nenhum foi apagado', async () => {
    await definirOk('imoveis', [CRECI]);
    const [log] = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'site.custom_fields_configured'));
    expect(log?.metadata).toMatchObject({
      moduleKey: 'imoveis',
      fields: ['creci'],
      valuesDeleted: false,
    });
  });
});

describe('gravacao dos valores', () => {
  it('grava o valor na criacao e o devolve no painel', async () => {
    await definirOk('imoveis', [CRECI]);

    const criado = await criarImovel({ customFields: { creci: '123456-F' } });
    expect(criado.status, criado.errorMessage ?? '').toBe(201);
    expect(criado.body.property.customFields).toEqual({ creci: '123456-F' });

    const detalhe = await empresa.client.get(`${base()}/properties/${criado.body.property.id}`);
    expect(detalhe.body.property.customFields).toEqual({ creci: '123456-F' });
  });

  /**
   * Recusar **pelo nome** e o que torna o erro corrigivel. Aceitar em silencio
   * deixaria o JSONB crescer com o que o navegador mandasse.
   */
  it('recusa chave que ninguem definiu, dizendo qual sobrou', async () => {
    await definirOk('imoveis', [CRECI]);

    const response = await criarImovel({ customFields: { creci: '1', inventado: 'x' } });
    expect(response.status).toBe(400);
    expect(response.errorMessage).toContain('inventado');
    expect(response.errorMessage).not.toContain('creci');
  });

  it('recusa campo personalizado quando o site nao tem nenhum definido', async () => {
    const response = await criarImovel({ customFields: { creci: '1' } });
    expect(response.status).toBe(400);
    expect(response.errorMessage).toContain('creci');
  });

  it('recusa envelope que nao e objeto', async () => {
    await definirOk('imoveis', [CRECI]);
    const response = await criarImovel({ customFields: ['creci'] });
    expect(response.status).toBe(400);
  });

  it('exige o campo obrigatorio na criacao', async () => {
    await definirOk('imoveis', [{ ...CRECI, required: true }]);

    const vazio = await criarImovel({ customFields: {} });
    expect(vazio.status).toBe(422);

    const branco = await criarImovel({ customFields: { creci: '   ' } });
    expect(branco.status, 'obrigatorio significa preenchido, nao apenas presente').toBe(422);

    const preenchido = await criarImovel({ customFields: { creci: '123456-F' } });
    expect(preenchido.status, preenchido.errorMessage ?? '').toBe(201);
  });

  it('recusa escolha fora das opcoes definidas', async () => {
    await definirOk('imoveis', [
      { ...CRECI, fieldKey: 'padrao', type: 'select', options: ['alto', 'medio'] },
    ]);

    const fora = await criarImovel({ customFields: { padrao: 'baixo' } });
    expect(fora.status).toBe(422);

    const dentro = await criarImovel({ customFields: { padrao: 'medio' } });
    expect(dentro.status, dentro.errorMessage ?? '').toBe(201);
  });

  it('valida por tipo: numero nao aceita texto, data exige o formato', async () => {
    await definirOk('imoveis', [
      { ...CRECI, fieldKey: 'andares', type: 'number' },
      { ...CRECI, fieldKey: 'entrega', type: 'date' },
    ]);

    expect((await criarImovel({ customFields: { andares: 'doze' } })).status).toBe(422);
    expect((await criarImovel({ customFields: { entrega: '12/2026' } })).status).toBe(422);

    const certo = await criarImovel({ customFields: { andares: 12, entrega: '2026-12-01' } });
    expect(certo.status, certo.errorMessage ?? '').toBe(201);
    expect(certo.body.property.customFields).toEqual({ andares: 12, entrega: '2026-12-01' });
  });

  /**
   * Campo que a CODECA IA mantem. A politica por site vale para campo
   * personalizado tambem -- e e conferida no servidor, porque esconder na tela
   * nao e proteger.
   */
  it('recusa gravacao em campo nao editavel, pela definicao', async () => {
    await definirOk('imoveis', [{ ...CRECI, editable: false }]);

    const response = await criarImovel({ customFields: { creci: '1' } });
    expect(response.status).toBe(403);
    expect(response.errorMessage).toContain('CRECI do corretor');
  });

  it('recusa gravacao em campo travado pela politica do site', async () => {
    await definirOk('imoveis', [CRECI]);
    const politica = await salvarPolitica([
      { moduleKey: 'imoveis', fieldKey: 'creci', editable: false },
    ]);
    expect(politica.status, politica.errorMessage ?? '').toBe(200);

    const response = await criarImovel({ customFields: { creci: '1' } });
    expect(response.status).toBe(403);
  });

  it('a excecao do site libera um campo que a definicao trava', async () => {
    await definirOk('imoveis', [{ ...CRECI, editable: false }]);
    await salvarPolitica([{ moduleKey: 'imoveis', fieldKey: 'creci', editable: true }]);

    const response = await criarImovel({ customFields: { creci: '1' } });
    expect(response.status, response.errorMessage ?? '').toBe(201);
  });

  it('criar sem o envelope nao e erro: o registro nasce sem valores', async () => {
    await definirOk('imoveis', [CRECI]);
    const response = await criarImovel();
    expect(response.status, response.errorMessage ?? '').toBe(201);
    expect(response.body.property.customFields).toEqual({});
  });
});

describe('edicao parcial', () => {
  it('mescla: alterar um campo nao apaga o outro', async () => {
    await definirOk('imoveis', [
      CRECI,
      { ...CRECI, fieldKey: 'responsavel', label: 'Responsavel tecnico' },
    ]);
    const criado = await criarImovel({
      customFields: { creci: '123456-F', responsavel: 'Eng. Marina' },
    });
    expect(criado.status, criado.errorMessage ?? '').toBe(201);

    const response = await empresa.client.patch(
      `${base()}/properties/${criado.body.property.id}`,
      { customFields: { creci: '999999-F' } },
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.property.customFields).toEqual({
      creci: '999999-F',
      responsavel: 'Eng. Marina',
    });
  });

  /**
   * Um registro cadastrado antes de o campo existir nao tem a chave. Exigir
   * obrigatorio numa edicao parcial travaria a edicao de tudo o que ja estava
   * cadastrado -- inclusive de quem so quis corrigir o titulo.
   */
  it('obrigatorio nao bloqueia a edicao de registro antigo', async () => {
    const criado = await criarImovel();
    expect(criado.status, criado.errorMessage ?? '').toBe(201);

    await definirOk('imoveis', [{ ...CRECI, required: true }]);

    const response = await empresa.client.patch(
      `${base()}/properties/${criado.body.property.id}`,
      { title: 'Residencial Aurora II' },
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);
  });

  it('a edicao que nao manda o envelope deixa os valores como estavam', async () => {
    await definirOk('imoveis', [CRECI]);
    const criado = await criarImovel({ customFields: { creci: '123456-F' } });

    const response = await empresa.client.patch(
      `${base()}/properties/${criado.body.property.id}`,
      { title: 'Residencial Aurora II' },
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.property.customFields).toEqual({ creci: '123456-F' });
  });
});

describe('remover a definicao nao apaga valor', () => {
  it('o valor fica guardado e volta quando o campo e redefinido', async () => {
    await definirOk('imoveis', [CRECI]);
    const criado = await criarImovel({ customFields: { creci: '123456-F' } });
    const imovelId = criado.body.property.id as string;

    await definirOk('imoveis', []);

    // Fora do painel e fora da API publica...
    const semCampo = await empresa.client.get(`${base()}/modules`);
    expect(campoDoModulo(semCampo.body, 'imoveis', 'creci')).toBeUndefined();

    // ...mas o conteudo do cliente continua no banco.
    const [linha] = await api.db
      .select({ customFields: schema.properties.customFields })
      .from(schema.properties)
      .where(eq(schema.properties.id, imovelId));
    expect(linha?.customFields).toEqual({ creci: '123456-F' });

    // E volta a aparecer com a mesma chave, sem reescrever conteudo.
    await definirOk('imoveis', [CRECI]);
    const detalhe = await empresa.client.get(`${base()}/properties/${imovelId}`);
    expect(detalhe.body.property.customFields).toEqual({ creci: '123456-F' });
  });

  it('as definicoes de outro modulo sobrevivem a troca', async () => {
    await definirOk('imoveis', [CRECI]);
    await definirOk('servicos', [{ ...CRECI, fieldKey: 'prazo', label: 'Prazo medio' }]);

    await definirOk('imoveis', []);

    const response = await admin.client.get(`/api/platform/sites/${empresa.siteId}/custom-fields`);
    const items = response.body.items as Array<{ moduleKey: string; fieldKey: string }>;
    expect(items.map((i) => `${i.moduleKey}.${i.fieldKey}`)).toEqual(['servicos.prazo']);
  });
});

describe('modulo de documento', () => {
  const DOC = () => `${base()}/modules/institucional/document`;

  it('o documento nasce com a forma vazia dos campos definidos', async () => {
    await definirOk('institucional', [
      { ...CRECI, fieldKey: 'fundacao', label: 'Ano de fundacao', type: 'number' },
      { ...CRECI, fieldKey: 'selos', label: 'Selos', type: 'tags' },
      { ...CRECI, fieldKey: 'associado', label: 'Associado ao sinduscon', type: 'boolean' },
    ]);

    const response = await empresa.client.get(DOC());
    expect(response.status, response.errorMessage ?? '').toBe(200);
    // Forma vazia por tipo: o formulario abre preenchivel, nao com `undefined`.
    expect(response.body.customFields).toEqual({
      fundacao: null,
      selos: [],
      associado: false,
    });
  });

  it('grava os valores fora de `data`, que continua recusando chave desconhecida', async () => {
    await definirOk('institucional', [CRECI]);

    const response = await empresa.client.put(DOC(), {
      companyName: 'Construtora Horizonte',
      customFields: { creci: '123456-J' },
    });
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.customFields).toEqual({ creci: '123456-J' });
    expect(response.body.data).not.toHaveProperty('creci');

    const leitura = await empresa.client.get(DOC());
    expect(leitura.body.customFields).toEqual({ creci: '123456-J' });
  });

  /**
   * O formulario de documento envia tudo o que mostra -- e por isso o campo
   * personalizado travado tem de **sair do corpo**. No campo tipado a
   * verificacao compara valor a valor e reenviar o mesmo passa; no
   * personalizado ela recusa a chave. Era a diferenca que impedia salvar
   * qualquer documento que tivesse um campo travado.
   */
  it('o campo travado nao pode vir no corpo, e omiti-lo preserva o valor', async () => {
    await definirOk('institucional', [CRECI]);
    await empresa.client.put(DOC(), {
      companyName: 'Construtora Horizonte',
      customFields: { creci: '123456-J' },
    });

    await definirOk('institucional', [{ ...CRECI, editable: false }]);

    const reenviando = await empresa.client.put(DOC(), {
      companyName: 'Construtora Horizonte',
      customFields: { creci: '123456-J' },
    });
    expect(reenviando.status).toBe(403);

    const omitindo = await empresa.client.put(DOC(), {
      companyName: 'Construtora Horizonte LTDA',
    });
    expect(omitindo.status, omitindo.errorMessage ?? '').toBe(200);
    expect(omitindo.body.customFields, 'mesclar preserva o que a tela nao enviou').toEqual({
      creci: '123456-J',
    });
  });

  it('o campo definido aparece na lista de campos do documento', async () => {
    await definirOk('institucional', [CRECI]);
    const response = await empresa.client.get(DOC());
    const campos = response.body.fields as Array<{ key: string; custom?: boolean }>;
    expect(campos.find((campo) => campo.key === 'creci')).toMatchObject({ custom: true });
    // E os tipados seguem na mesma lista, antes dele.
    expect(campos.map((campo) => campo.key)).toContain('companyName');
  });
});

describe('API publica', () => {
  it('entrega os valores no mesmo objeto do conteudo', async () => {
    await definirOk('imoveis', [CRECI]);
    const criado = await criarImovel({ customFields: { creci: '123456-F' } });
    expect(criado.status, criado.errorMessage ?? '').toBe(201);

    const response = await comoSite('/api/v1/properties');
    expect(response.status, response.errorMessage ?? '').toBe(200);
    const items = response.body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]!.customFields).toEqual({ creci: '123456-F' });
  });

  it('registro sem valor nenhum chega como objeto vazio, nunca ausente', async () => {
    await definirOk('imoveis', [CRECI]);
    const criado = await criarImovel();
    expect(criado.status, criado.errorMessage ?? '').toBe(201);

    const response = await comoSite('/api/v1/properties');
    const items = response.body.items as Array<Record<string, unknown>>;
    expect(items[0]).toHaveProperty('customFields');
    expect(items[0]!.customFields).toEqual({});
  });
});

describe('isolamento entre sites', () => {
  it('a definicao de um site nao vale para o outro', async () => {
    const outra = await registerAccount(api, {
      email: 'contato@vilanova.com.br',
      companyName: 'Construtora Vila Nova',
    });
    await verifyEmail(api, outra);

    await definirOk('imoveis', [CRECI]);

    // O outro site nao tem o campo: a gravacao e recusada pelo nome.
    const response = await outra.client.post(`/api/tenants/${outra.tenantId}/properties`, {
      ...IMOVEL,
      customFields: { creci: '1' },
    });
    expect(response.status).toBe(400);
    expect(response.errorMessage).toContain('creci');

    // E nao ve a definicao na lista de modulos.
    const modulos = await outra.client.get(`/api/tenants/${outra.tenantId}/modules`);
    expect(campoDoModulo(modulos.body, 'imoveis', 'creci')).toBeUndefined();
  });

  it('a definicao nasce amarrada ao tenant do site', async () => {
    await definirOk('imoveis', [CRECI]);
    const [linha] = await api.db
      .select()
      .from(schema.siteCustomFields)
      .where(
        and(
          eq(schema.siteCustomFields.siteId, empresa.siteId),
          eq(schema.siteCustomFields.fieldKey, 'creci'),
        ),
      );
    expect(linha?.tenantId).toBe(empresa.tenantId);
  });
});
