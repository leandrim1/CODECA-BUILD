import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, schema } from '@codeca/database';
import { MODULE_KEYS } from '@codeca/shared';
import {
  createTestApi,
  registerAccount,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Segmentos no painel mestre.
 *
 * O criterio que organiza este arquivo: **um segmento e o ponto de partida de
 * um projeto novo, nunca uma trava sobre projetos existentes.** Editar um
 * segmento nao pode reconfigurar site nenhum -- um site ajustado a mao ha
 * meses nao pode perder uma tela que o cliente usa porque alguem mexeu na
 * classificacao do ramo. Aplicar o conjunto a um site e um ato separado.
 *
 * O segundo criterio e que atender um ramo novo nao exija implantacao: antes
 * da etapa 7 `segments.code` era um enum do Postgres com tres valores, e
 * cadastrar "Restaurante" pedia ALTER TYPE.
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
});

function listar() {
  return admin.client.get('/api/platform/segments');
}

async function segmentoPorCodigo(code: string) {
  const response = await listar();
  return (response.body.items as Array<Record<string, unknown>>).find((s) => s.code === code);
}

/**
 * Deixa o site **somente** com os modulos pedidos.
 *
 * Derivado de `MODULE_KEYS` em vez de listado a mao: a rota nao desliga modulo
 * por omissao, entao um corpo com a lista fixa deixaria habilitado todo modulo
 * acrescentado ao registro depois -- e o teste passaria a medir outra coisa.
 */
async function deixarSoCom(ligados: readonly string[]) {
  const response = await admin.client.put(`/api/platform/sites/${empresa.siteId}/modules`, {
    modules: MODULE_KEYS.map((key) => ({
      key,
      enabled: ligados.includes(key),
      settings: {},
    })),
    fieldPolicies: [],
  });
  expect(response.status, response.errorMessage ?? '').toBe(200);
}

/** Modulos habilitados de um site, como o painel do cliente os veria. */
async function modulosDoSite(siteId: string): Promise<string[]> {
  const linhas = await api.db
    .select({ moduleKey: schema.siteModules.moduleKey, enabled: schema.siteModules.enabled })
    .from(schema.siteModules)
    .where(eq(schema.siteModules.siteId, siteId));
  return linhas.filter((l) => l.enabled).map((l) => l.moduleKey).sort();
}

describe('catalogo de segmentos', () => {
  it('lista os tres da instalacao com a contagem de sites', async () => {
    const response = await listar();
    expect(response.status, response.errorMessage ?? '').toBe(200);

    const items = response.body.items as Array<{ code: string; siteCount: number; isDefault: boolean }>;
    expect(items.map((s) => s.code).sort()).toEqual(['construtora', 'corretor', 'imobiliaria']);

    // Duas empresas cadastradas no beforeEach, as duas construtoras.
    expect(items.find((s) => s.code === 'construtora')!.siteCount).toBe(2);
    expect(items.find((s) => s.code === 'corretor')!.siteCount).toBe(0);
  });

  it('exatamente um segmento e o padrao de empresas novas', async () => {
    const items = (await listar()).body.items as Array<{ code: string; isDefault: boolean }>;
    expect(items.filter((s) => s.isDefault).map((s) => s.code)).toEqual(['construtora']);
  });

  it('um administrador de empresa nao alcanca o catalogo', async () => {
    const response = await empresa.client.get('/api/platform/segments');
    expect(response.status).toBe(403);
  });
});

describe('cadastro de um ramo novo', () => {
  it('cria um segmento fora do mercado imobiliario, sem migracao', async () => {
    // O ponto da etapa: `code` era um enum do Postgres. Hoje e uma linha.
    const response = await admin.client.post('/api/platform/segments', {
      code: 'clinica-odontologica',
      name: 'Clinica odontologica',
      description: 'Procedimentos, convenios e contato.',
      defaultModules: ['institucional', 'contato', 'banners', 'servicos'],
    });
    expect(response.status, response.errorMessage ?? '').toBe(201);

    const criado = await segmentoPorCodigo('clinica-odontologica');
    expect(criado).toBeDefined();
    expect(criado!.defaultModules).toEqual(['institucional', 'contato', 'banners', 'servicos']);
    expect(criado!.siteCount).toBe(0);
  });

  it('recusa um codigo que ja existe', async () => {
    const response = await admin.client.post('/api/platform/segments', {
      code: 'construtora',
      name: 'Outra construtora',
      defaultModules: ['institucional'],
    });
    expect(response.status).toBe(409);
    expect(response.errorMessage).toMatch(/construtora/);
  });

  it('recusa um codigo fora do formato de slug', async () => {
    // O codigo viaja para o site do cliente em `site.segment`.
    const response = await admin.client.post('/api/platform/segments', {
      code: 'Clinica Odontologica!',
      name: 'Clinica',
      defaultModules: ['institucional'],
    });
    expect(response.status).toBe(422);
  });

  it('recusa um modulo que o registro nao conhece', async () => {
    // Sem esta conferencia o modulo seria descartado em silencio no cadastro
    // do site, e o projeto nasceria sem uma tela que alguem configurou.
    const response = await admin.client.post('/api/platform/segments', {
      code: 'restaurante',
      name: 'Restaurante',
      defaultModules: ['institucional', 'cardapio'],
    });
    expect(response.status).toBe(422);
  });

  it('remove da lista um segmento que nenhum site usa', async () => {
    await admin.client.post('/api/platform/segments', {
      code: 'barbearia',
      name: 'Barbearia',
      defaultModules: ['institucional', 'contato'],
    });
    const criado = await segmentoPorCodigo('barbearia');

    const response = await admin.client.delete(`/api/platform/segments/${criado!.id}`);
    expect(response.status, response.errorMessage ?? '').toBe(204);
    expect(await segmentoPorCodigo('barbearia')).toBeUndefined();
  });

  it('nao remove um segmento que organiza sites: manda desativar', async () => {
    const construtora = await segmentoPorCodigo('construtora');
    const response = await admin.client.delete(`/api/platform/segments/${construtora!.id}`);

    expect(response.status).toBe(409);
    expect(response.errorMessage).toMatch(/Desative/i);
    // A chave estrangeira e `on delete set null`: remover desligaria o
    // segmento de dois sites no ar sem avisar ninguem.
    expect(await segmentoPorCodigo('construtora')).toBeDefined();
  });
});

describe('o segmento padrao', () => {
  it('a empresa nova nasce com os modulos do padrao vigente', async () => {
    await admin.client.post('/api/platform/segments', {
      code: 'advocacia',
      name: 'Escritorio de advocacia',
      defaultModules: ['institucional', 'contato', 'servicos'],
      isDefault: true,
    });

    const nova = await registerAccount(api, {
      email: 'contato@vieira.adv.br',
      companyName: 'Vieira Advogados',
    });

    // Antes da etapa 7 isto vinha de `'construtora'` fixo no codigo: um
    // escritorio de advocacia nascia com os modulos de uma construtora.
    expect(await modulosDoSite(nova.siteId)).toEqual(['contato', 'institucional', 'servicos']);
  });

  it('marcar outro como padrao desmarca o anterior', async () => {
    const imobiliaria = await segmentoPorCodigo('imobiliaria');
    const response = await admin.client.patch(`/api/platform/segments/${imobiliaria!.id}`, {
      name: 'Imobiliaria',
      description: '',
      defaultModules: ['institucional', 'imoveis', 'contato'],
      isActive: true,
      isDefault: true,
    });
    expect(response.status, response.errorMessage ?? '').toBe(200);

    const items = (await listar()).body.items as Array<{ code: string; isDefault: boolean }>;
    expect(items.filter((s) => s.isDefault).map((s) => s.code)).toEqual(['imobiliaria']);
  });

  it('nao deixa a instalacao sem padrao', async () => {
    // Sem padrao, uma empresa nova nasceria com todos os modulos ligados --
    // inclusive os que o projeto dela nao tem.
    const construtora = await segmentoPorCodigo('construtora');
    const response = await admin.client.patch(`/api/platform/segments/${construtora!.id}`, {
      name: 'Construtora',
      description: '',
      defaultModules: ['institucional'],
      isActive: true,
      isDefault: false,
    });
    expect(response.status).toBe(400);
    expect(response.errorMessage).toMatch(/outro segmento/i);
  });

  it('um segmento desativado nao pode ser o padrao', async () => {
    const corretor = await segmentoPorCodigo('corretor');
    const response = await admin.client.patch(`/api/platform/segments/${corretor!.id}`, {
      name: 'Corretor autonomo',
      description: '',
      defaultModules: ['institucional', 'imoveis'],
      isActive: false,
      isDefault: true,
    });
    expect(response.status).toBe(400);
  });

  it('nao remove o segmento padrao', async () => {
    await admin.client.post('/api/platform/segments', {
      code: 'academia',
      name: 'Academia',
      defaultModules: ['institucional'],
      isDefault: true,
    });
    const academia = await segmentoPorCodigo('academia');

    const response = await admin.client.delete(`/api/platform/segments/${academia!.id}`);
    expect(response.status).toBe(400);
    expect(response.errorMessage).toMatch(/padrao/i);
  });
});

describe('editar um segmento nao alcanca os sites', () => {
  it('tirar um modulo do segmento nao desliga o modulo de quem ja o tem', async () => {
    // O teste mais importante do arquivo. Um site configurado ha meses pode
    // ter sido ajustado a mao; se a edicao do segmento o reconfigurasse, o
    // cliente perderia uma tela que usa, sem que ninguem tivesse pedido.
    const antes = await modulosDoSite(empresa.siteId);
    expect(antes).toContain('obras');

    const construtora = await segmentoPorCodigo('construtora');
    const response = await admin.client.patch(`/api/platform/segments/${construtora!.id}`, {
      name: 'Construtora',
      description: 'Sem obras a partir de agora.',
      defaultModules: ['institucional', 'contato'],
      isActive: true,
      isDefault: true,
    });
    expect(response.status, response.errorMessage ?? '').toBe(200);

    expect(await modulosDoSite(empresa.siteId)).toEqual(antes);
  });

  it('a trilha de auditoria diz que a edicao nao mexeu em site nenhum', async () => {
    const construtora = await segmentoPorCodigo('construtora');
    await admin.client.patch(`/api/platform/segments/${construtora!.id}`, {
      name: 'Construtora',
      description: '',
      defaultModules: ['institucional'],
      isActive: true,
      isDefault: true,
    });

    const [registro] = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'platform.segment_updated'));

    expect(registro).toBeDefined();
    expect((registro!.metadata as { appliedToExistingSites: boolean }).appliedToExistingSites)
      .toBe(false);
  });

  it('trocar o segmento do site nao mexe nos modulos dele', async () => {
    const antes = await modulosDoSite(empresa.siteId);
    const corretor = await segmentoPorCodigo('corretor');

    const response = await admin.client.patch(`/api/platform/sites/${empresa.siteId}`, {
      name: 'Construtora Horizonte',
      status: 'active',
      internalNotes: '',
      segmentId: corretor!.id,
    });
    expect(response.status, response.errorMessage ?? '').toBe(200);

    expect(await modulosDoSite(empresa.siteId)).toEqual(antes);
  });

  it('recusa apontar o site para um segmento que nao existe', async () => {
    const response = await admin.client.patch(`/api/platform/sites/${empresa.siteId}`, {
      name: 'Construtora Horizonte',
      status: 'active',
      internalNotes: '',
      segmentId: '11111111-1111-4111-8111-111111111111',
    });
    expect(response.status).toBe(404);
  });
});

describe('aplicar o segmento a um site existente', () => {
  it('liga o que falta e nao desliga o que esta em uso', async () => {
    // Site enxuto: so institucional e servicos. O segmento traz mais.
    await deixarSoCom(['institucional', 'servicos']);
    expect(await modulosDoSite(empresa.siteId)).toEqual(['institucional', 'servicos']);

    const corretor = await segmentoPorCodigo('corretor');
    await admin.client.patch(`/api/platform/sites/${empresa.siteId}`, {
      name: 'Construtora Horizonte',
      status: 'active',
      internalNotes: '',
      segmentId: corretor!.id,
    });

    const response = await admin.client.post(
      `/api/platform/sites/${empresa.siteId}/apply-segment`,
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);

    // O esperado vem do proprio segmento: ligou o que ele traz e o site ainda
    // nao tinha. Acrescentar um modulo ao segmento nao deve custar a edicao
    // deste teste, que mede outra coisa.
    const doSegmento = [...corretor!.defaultModules].sort();
    const faltavam = doSegmento.filter((key) => key !== 'institucional');
    expect((response.body.enabled as string[]).sort()).toEqual(faltavam);

    // `servicos` nao esta no segmento corretor e continua ligado: desligar um
    // modulo em uso e decisao site a site, na tela de modulos.
    expect(await modulosDoSite(empresa.siteId)).toEqual(
      [...new Set([...doSegmento, 'institucional', 'servicos'])].sort(),
    );
  });

  it('o modulo recem-ligado nao abre vazio', async () => {
    await deixarSoCom(['institucional']);
    await api.db
      .delete(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.siteId, empresa.siteId),
          eq(schema.contentDocuments.moduleKey, 'contato'),
        ),
      );

    await admin.client.post(`/api/platform/sites/${empresa.siteId}/apply-segment`);

    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.siteId, empresa.siteId),
          eq(schema.contentDocuments.moduleKey, 'contato'),
        ),
      );

    // Painel que abre vazio parece quebrado: o cliente nao sabe se e assim
    // mesmo ou se o dado dele se perdeu.
    expect(documento).toBeDefined();
    expect((documento!.data as { email: string }).email).toBe('contato@horizonte.com.br');
  });

  it('recusa aplicar quando o site nao tem segmento', async () => {
    await admin.client.patch(`/api/platform/sites/${empresa.siteId}`, {
      name: 'Construtora Horizonte',
      status: 'active',
      internalNotes: '',
      segmentId: null,
    });

    const response = await admin.client.post(
      `/api/platform/sites/${empresa.siteId}/apply-segment`,
    );
    expect(response.status).toBe(400);
    expect(response.errorMessage).toMatch(/segmento/i);
  });

  it('registra na auditoria o que foi ligado', async () => {
    const response = await admin.client.post(
      `/api/platform/sites/${empresa.siteId}/apply-segment`,
    );
    expect(response.status).toBe(200);

    const [registro] = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'site.segment_applied'));

    expect(registro).toBeDefined();
    expect(registro!.entityId).toBe(empresa.siteId);
    expect((registro!.metadata as { segment: string }).segment).toBe('construtora');
  });

  it('um administrador de empresa nao aplica segmento no proprio site', async () => {
    const response = await empresa.client.post(
      `/api/platform/sites/${empresa.siteId}/apply-segment`,
    );
    expect(response.status).toBe(403);
  });
});
