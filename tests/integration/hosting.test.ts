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
 * O projeto de hospedagem de um site, configurado pela CODECA IA.
 *
 * E o que liga a plataforma ao projeto Vercel **do site** -- e o que a separa
 * do projeto dela mesma, que serve o painel. O criterio que organiza este
 * arquivo e o que se perde se uma regra falha:
 *
 * - sem a regra do plano, a hospedagem seria entregue sem ter sido vendida;
 * - sem a unicidade, o dominio de uma empresa abriria o site de outra;
 * - sem o "ausente nao mexe", uma tela desatualizada desvincularia a
 *   hospedagem em silencio.
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
    companyName: 'Empresa Horizonte',
  });
  await verifyEmail(api, empresa);
});

async function usarPlano(code: 'trial' | 'essencial' | 'profissional' | 'empresas', tenantId = empresa.tenantId) {
  const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, code));
  await api.db.update(schema.tenants).set({ planId: plano!.id }).where(eq(schema.tenants.id, tenantId));
}

const site = (siteId = empresa.siteId) => `/api/platform/sites/${siteId}`;

/** Salva o site como a tela salva: o corpo base, mais o que mudou. */
async function salvar(extra: Record<string, unknown> = {}, siteId = empresa.siteId) {
  return admin.client.patch(site(siteId), {
    name: 'Site Horizonte',
    status: 'draft',
    internalNotes: '',
    segmentId: null,
    ...extra,
  });
}

async function projetoGravado(siteId = empresa.siteId): Promise<string | null> {
  const [linha] = await api.db
    .select({ hostingProjectId: schema.sites.hostingProjectId })
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId));
  return linha?.hostingProjectId ?? null;
}

describe('configurar o projeto de hospedagem', () => {
  it('grava num plano que inclui hospedagem', async () => {
    await usarPlano('empresas');

    const response = await salvar({ hostingProjectId: 'prj_horizonte' });
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(await projetoGravado()).toBe('prj_horizonte');
  });

  /**
   * Sem esta regra a CODECA IA poderia ligar a hospedagem de um cliente do
   * Profissional sem que ela tenha sido vendida -- e a plataforma passaria a
   * anexar o dominio dele a um projeto como se fosse parte do plano.
   */
  it('recusa num plano que nao inclui hospedagem, dizendo qual', async () => {
    await usarPlano('profissional');

    const response = await salvar({ hostingProjectId: 'prj_horizonte' });
    expect(response.status).toBe(409);
    expect(response.errorMessage).toMatch(/Profissional/);
    expect(response.errorMessage).toMatch(/não inclui hospedagem/i);
    expect(await projetoGravado()).toBeNull();
  });

  it('recusa identificador que mudaria o caminho da chamada a Vercel', async () => {
    await usarPlano('empresas');

    // O valor entra numa URL (`/v10/projects/<id>/domains`): uma barra ou um
    // `?` ali apontaria a chamada para outro recurso.
    for (const invalido of ['prj/../outro', 'prj?x=1', 'prj abc', '', '../x', 'a'.repeat(101)]) {
      const response = await salvar({ hostingProjectId: invalido });
      expect(response.status, `"${invalido.slice(0, 20)}" deveria ser recusado`).toBe(422);
    }
    expect(await projetoGravado()).toBeNull();
  });

  it('aceita o id (prj_...) e tambem o nome do projeto', async () => {
    await usarPlano('empresas');
    expect((await salvar({ hostingProjectId: 'prj_AbC123xyz' })).status).toBe(200);
    expect((await salvar({ hostingProjectId: 'site-horizonte' })).status).toBe(200);
    expect(await projetoGravado()).toBe('site-horizonte');
  });

  it('registra na auditoria se a hospedagem foi ligada, tirada ou deixada como estava', async () => {
    await usarPlano('empresas');
    await salvar({ hostingProjectId: 'prj_horizonte' });
    await salvar({ hostingProjectId: null });
    await salvar({});

    const registros = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'site.updated'));
    const hosting = registros
      .map((r) => (r.metadata as { hosting: string }).hosting)
      .sort();
    expect(hosting).toEqual(['linked', 'unchanged', 'unlinked']);
  });

  it('so o painel mestre configura: o cliente nao alcanca a rota', async () => {
    await usarPlano('empresas');
    const response = await empresa.client.patch(site(), {
      name: 'x',
      status: 'draft',
      internalNotes: '',
      segmentId: null,
      hostingProjectId: 'prj_invasao',
    });
    expect(response.status).toBe(403);
    expect(await projetoGravado()).toBeNull();
  });
});

describe('ausente nao mexe, nulo desvincula', () => {
  /**
   * Os outros campos desta rota sao reescritos a cada salvamento; este nao
   * pode ser. Uma tela que nao o envie -- aberta antes de o campo existir, ou
   * de outro cliente da API -- desvincularia a hospedagem em silencio, e na
   * proxima vez que o cliente cadastrasse um dominio ele cairia no modo "so
   * registra" sem que ninguem tivesse pedido.
   */
  it('um salvamento que nao menciona o projeto nao o desvincula', async () => {
    await usarPlano('empresas');
    await salvar({ hostingProjectId: 'prj_horizonte' });

    const response = await salvar({ name: 'Novo nome' });
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(await projetoGravado()).toBe('prj_horizonte');
  });

  it('nulo desvincula', async () => {
    await usarPlano('empresas');
    await salvar({ hostingProjectId: 'prj_horizonte' });

    await salvar({ hostingProjectId: null });
    expect(await projetoGravado()).toBeNull();
  });

  /** Desvincular nunca da algo a mais, entao nunca e recusado -- nem apos um downgrade. */
  it('desvincular continua permitido depois de um downgrade', async () => {
    await usarPlano('empresas');
    await salvar({ hostingProjectId: 'prj_horizonte' });
    await usarPlano('profissional');

    const response = await salvar({ hostingProjectId: null });
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(await projetoGravado()).toBeNull();
  });
});

describe('um projeto pertence a um unico site', () => {
  /**
   * Dois sites no mesmo projeto anexariam o dominio de uma empresa ao site de
   * outra: o endereco do cliente B passaria a servir o conteudo do cliente A.
   */
  it('recusa o projeto de outro site, dizendo qual o usa', async () => {
    await usarPlano('empresas');
    await salvar({ hostingProjectId: 'prj_compartilhado' });

    const outra = await registerAccount(api, {
      email: 'dono@beta.com.br',
      companyName: 'Empresa Beta',
    });
    await verifyEmail(api, outra);
    await usarPlano('empresas', outra.tenantId);

    const response = await salvar({ hostingProjectId: 'prj_compartilhado' }, outra.siteId);
    expect(response.status).toBe(409);
    expect(response.errorMessage).toContain('Empresa Horizonte');
    expect(await projetoGravado(outra.siteId)).toBeNull();
  });

  it('o proprio site pode regravar o mesmo valor', async () => {
    await usarPlano('empresas');
    await salvar({ hostingProjectId: 'prj_horizonte' });
    const response = await salvar({ hostingProjectId: 'prj_horizonte' });
    expect(response.status, response.errorMessage ?? '').toBe(200);
  });

  /** A conferencia da rota e a mensagem; o indice e a garantia. */
  it('o banco tambem recusa, mesmo sem passar pela rota', async () => {
    const outra = await registerAccount(api, {
      email: 'dono@beta.com.br',
      companyName: 'Empresa Beta',
    });
    await api.db
      .update(schema.sites)
      .set({ hostingProjectId: 'prj_unico' })
      .where(eq(schema.sites.id, empresa.siteId));

    await expect(
      api.db
        .update(schema.sites)
        .set({ hostingProjectId: 'prj_unico' })
        .where(eq(schema.sites.id, outra.siteId)),
    ).rejects.toThrow();
  });

  it('varios sites sem projeto convivem: nulo nao conta como repeticao', async () => {
    const a = await registerAccount(api, { email: 'a@x.com.br', companyName: 'Empresa A' });
    const b = await registerAccount(api, { email: 'b@x.com.br', companyName: 'Empresa B' });
    expect(await projetoGravado(a.siteId)).toBeNull();
    expect(await projetoGravado(b.siteId)).toBeNull();
  });
});

describe('o que o painel mestre mostra', () => {
  it('o detalhe do site traz o projeto e se a plataforma gerencia', async () => {
    await usarPlano('empresas');
    await salvar({ hostingProjectId: 'prj_horizonte' });

    const response = await admin.client.get(site());
    expect(response.status).toBe(200);
    expect(response.body.site.hostingProjectId).toBe('prj_horizonte');
    expect(response.body.hosting).toEqual({ managed: true, reason: null });
  });

  it('diz o motivo quando nao gerencia: o plano, ou a falta do projeto', async () => {
    await usarPlano('profissional');
    expect((await admin.client.get(site())).body.hosting).toEqual({
      managed: false,
      reason: 'plan_without_hosting',
    });

    await usarPlano('empresas');
    expect((await admin.client.get(site())).body.hosting).toEqual({
      managed: false,
      reason: 'no_hosting_project',
    });
  });

  /** "Registrado" nao esta pendente: nao ha nada aguardando. */
  it('a visao geral nao conta dominio registrado como pendente', async () => {
    await usarPlano('profissional');
    await empresa.client.post(`/api/tenants/${empresa.tenantId}/domains`, { domain: 'www.horizonte.com.br' });

    const response = await admin.client.get('/api/platform/overview');
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.domains).toMatchObject({ total: 1, active: 0, pending: 0, registered: 1 });
  });
});
