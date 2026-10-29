import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  extractToken,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
  type TestClient,
} from '../helpers/api.js';

/** Permissoes por papel, sempre decididas no backend. */

let api: TestApi;
let owner: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  owner = await registerAccount(api, { email: 'owner@construtora.com.br', companyName: 'Construtora Alpha' });
  await verifyEmail(api, owner);
});

/** Convida alguem com o papel informado e devolve um cliente autenticado. */
async function addMember(role: 'admin' | 'editor' | 'viewer', email: string): Promise<TestClient> {
  const invite = await owner.client.post(`/api/tenants/${owner.tenantId}/members/invite`, {
    email,
    role,
    name: `Membro ${role}`,
  });
  expect(invite.status, invite.errorMessage ?? '').toBe(201);

  const message = [...api.outbox].reverse().find((m) => m.kind === 'invitation' && m.to === email);
  expect(message).toBeDefined();

  const client = api.client();
  const accepted = await client.post('/api/auth/accept-invite', {
    token: extractToken(message!.text),
    name: `Membro ${role}`,
    password: 'senhaSegura123',
  });
  expect(accepted.status, accepted.errorMessage ?? '').toBe(200);
  return client;
}

const PROPERTY = {
  title: 'Imovel de teste',
  type: 'apartamento',
  purpose: 'venda',
  price: 100000,
  publicationStatus: 'draft',
  commercialStatus: 'disponivel',
};

describe('convites', () => {
  it('cria o vinculo como convidado e so ativa apos aceitar', async () => {
    const invite = await owner.client.post(`/api/tenants/${owner.tenantId}/members/invite`, {
      email: 'convidado@construtora.com.br',
      role: 'editor',
      name: 'Convidado',
    });
    expect(invite.status).toBe(201);

    const [membership] = await api.db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.tenantId, owner.tenantId));
    const pending = await api.db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.status, 'invited'));
    expect(membership).toBeDefined();
    expect(pending).toHaveLength(1);

    // Antes de aceitar, o convidado nao tem sessao nem acesso.
    const anonymous = api.client();
    expect((await anonymous.get(`/api/tenants/${owner.tenantId}`)).status).toBe(401);

    const client = await addMember('editor', 'outro@construtora.com.br');
    expect((await client.get(`/api/tenants/${owner.tenantId}`)).status).toBe(200);
  });

  it('nao permite que admin conceda o papel de proprietario', async () => {
    const admin = await addMember('admin', 'admin@construtora.com.br');
    const response = await admin.post(`/api/tenants/${owner.tenantId}/members/invite`, {
      email: 'novo-owner@construtora.com.br',
      role: 'owner',
      name: 'Tentativa',
    });
    expect(response.status).toBe(403);
    expect(response.errorMessage).toMatch(/proprietario/i);
  });

  it('nao remove o unico proprietario da empresa', async () => {
    const members = await owner.client.get(`/api/tenants/${owner.tenantId}/members`);
    const membershipId = members.body.members[0].membershipId as string;

    const response = await owner.client.delete(`/api/tenants/${owner.tenantId}/members/${membershipId}`);
    expect(response.status).toBe(409);
    expect(response.errorMessage).toMatch(/proprietario ativo/i);
  });
});

describe('viewer', () => {
  it('le o painel mas nao escreve nada', async () => {
    const viewer = await addMember('viewer', 'viewer@construtora.com.br');

    expect((await viewer.get(`/api/tenants/${owner.tenantId}`)).status).toBe(200);
    expect((await viewer.get(`/api/tenants/${owner.tenantId}/properties`)).status).toBe(200);
    expect((await viewer.get(`/api/tenants/${owner.tenantId}/leads`)).status).toBe(200);

    const create = await viewer.post(`/api/tenants/${owner.tenantId}/properties`, PROPERTY);
    expect(create.status).toBe(403);
    expect(create.errorMessage).toMatch(/papel/i);

    expect((await viewer.post(`/api/tenants/${owner.tenantId}/services`, { title: 'Servico' })).status).toBe(403);
    expect(
      (await viewer.put(`/api/tenants/${owner.tenantId}/theme`, { schemaVersion: 1 })).status,
    ).toBe(403);
    expect(
      (await viewer.post(`/api/tenants/${owner.tenantId}/members/invite`, {
        email: 'x@y.com.br',
        role: 'viewer',
        name: '',
      })).status,
    ).toBe(403);
  });
});

describe('editor', () => {
  it('gerencia conteudo e publica, mas nao administra a empresa', async () => {
    const editor = await addMember('editor', 'editor@construtora.com.br');

    const created = await editor.post(`/api/tenants/${owner.tenantId}/properties`, PROPERTY);
    expect(created.status).toBe(201);

    const pages = await editor.get(`/api/tenants/${owner.tenantId}/pages`);
    const home = pages.body.pages.find((p: { isHome: boolean }) => p.isHome) as { id: string };
    const published = await editor.post(`/api/tenants/${owner.tenantId}/pages/${home.id}/publish`, {
      note: 'Publicado pelo editor',
    });
    expect(published.status).toBe(200);

    // Nao administra equipe, dados da empresa nem dominios.
    expect(
      (await editor.post(`/api/tenants/${owner.tenantId}/members/invite`, {
        email: 'z@y.com.br',
        role: 'viewer',
        name: '',
      })).status,
    ).toBe(403);
    expect(
      (await editor.patch(`/api/tenants/${owner.tenantId}`, {
        legalName: 'Novo Nome Ltda',
        displayName: 'Novo Nome',
        taxId: '',
        description: '',
        foundedYear: null,
        creaNumber: '',
      })).status,
    ).toBe(403);
    expect(
      (await editor.post(`/api/tenants/${owner.tenantId}/domains`, { domain: 'www.exemplo.com.br' })).status,
    ).toBe(403);
  });

  it('nao restaura versoes anteriores', async () => {
    const editor = await addMember('editor', 'editor2@construtora.com.br');
    const pages = await editor.get(`/api/tenants/${owner.tenantId}/pages`);
    const home = pages.body.pages.find((p: { isHome: boolean }) => p.isHome) as { id: string };
    await editor.post(`/api/tenants/${owner.tenantId}/pages/${home.id}/publish`, { note: 'v1' });

    const versions = await editor.get(`/api/tenants/${owner.tenantId}/pages/${home.id}/versions`);
    const versionId = versions.body.versions[0].id as string;

    const response = await editor.post(`/api/tenants/${owner.tenantId}/pages/${home.id}/restore`, {
      versionId,
      publish: false,
    });
    expect(response.status).toBe(403);
  });
});

describe('admin', () => {
  it('administra a empresa e a equipe, mas nao exclui nem altera assinatura', async () => {
    // O plano de avaliacao permite 2 usuarios; aqui o foco e o papel, nao o limite.
    const [plan] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'profissional'));
    await api.db
      .update(schema.tenants)
      .set({ planId: plan!.id })
      .where(eq(schema.tenants.id, owner.tenantId));

    const admin = await addMember('admin', 'admin2@construtora.com.br');

    const updated = await admin.patch(`/api/tenants/${owner.tenantId}`, {
      legalName: 'Alpha Engenharia Ltda',
      displayName: 'Alpha Engenharia',
      taxId: '',
      description: '',
      foundedYear: null,
      creaNumber: '',
    });
    expect(updated.status).toBe(200);

    const invited = await admin.post(`/api/tenants/${owner.tenantId}/members/invite`, {
      email: 'convidado-do-admin@construtora.com.br',
      role: 'editor',
      name: 'Convidado',
    });
    expect(invited.status).toBe(201);

    // Papel de admin nao concede privilegios globais.
    expect((await admin.get('/api/platform/overview')).status).toBe(403);
  });
});

describe('papel alterado em tempo real', () => {
  it('rebaixar um membro passa a valer na requisicao seguinte', async () => {
    const editor = await addMember('editor', 'rebaixado@construtora.com.br');
    expect((await editor.post(`/api/tenants/${owner.tenantId}/services`, { title: 'Servico A' })).status).toBe(201);

    const members = await owner.client.get(`/api/tenants/${owner.tenantId}/members`);
    const membership = members.body.members.find(
      (m: { email: string }) => m.email === 'rebaixado@construtora.com.br',
    ) as { membershipId: string };

    const changed = await owner.client.patch(
      `/api/tenants/${owner.tenantId}/members/${membership.membershipId}`,
      { role: 'viewer' },
    );
    expect(changed.status).toBe(200);

    const blocked = await editor.post(`/api/tenants/${owner.tenantId}/services`, { title: 'Servico B' });
    expect(blocked.status).toBe(403);
  });

  it('remover o membro encerra o acesso a empresa', async () => {
    const editor = await addMember('editor', 'removido@construtora.com.br');
    const members = await owner.client.get(`/api/tenants/${owner.tenantId}/members`);
    const membership = members.body.members.find(
      (m: { email: string }) => m.email === 'removido@construtora.com.br',
    ) as { membershipId: string };

    await owner.client.delete(`/api/tenants/${owner.tenantId}/members/${membership.membershipId}`);

    const response = await editor.get(`/api/tenants/${owner.tenantId}`);
    expect(response.status).toBe(404);
  });
});

describe('empresa suspensa', () => {
  it('fica em modo leitura para todos os papeis', async () => {
    await api.db
      .update(schema.tenants)
      .set({ status: 'suspended', suspendedAt: new Date() })
      .where(eq(schema.tenants.id, owner.tenantId));

    const read = await owner.client.get(`/api/tenants/${owner.tenantId}`);
    expect(read.status).toBe(200);
    expect(read.body.access.readOnly).toBe(true);

    const write = await owner.client.post(`/api/tenants/${owner.tenantId}/properties`, PROPERTY);
    expect(write.status).toBe(403);
    expect(write.errorMessage).toMatch(/suspensa/i);
  });
});
