import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, schema } from '@codeca/database';
import { hashPassword } from '@codeca/shared/server';
import {
  createTestApi,
  registerAccount,
  seedPlatformAdmin,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Isolamento multiempresa.
 *
 * Cada caso tenta alcancar dados de outra construtora trocando identificadores
 * na URL ou no corpo da requisicao. A resposta esperada e sempre 404 -- e nao
 * 403 -- para nao confirmar que o registro existe em outra empresa.
 */

let api: TestApi;
let alpha: RegisteredAccount;
let beta: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  // A instalacao ja tem um administrador (como apos o `pnpm db:seed`): assim
  // as contas abaixo sao usuarios comuns, e nao a primeira conta da
  // instalacao, que assumiria o painel mestre.
  await seedPlatformAdmin(api);
  alpha = await registerAccount(api, { email: 'alpha@construtora.com.br', companyName: 'Construtora Alpha' });
  beta = await registerAccount(api, { email: 'beta@construtora.com.br', companyName: 'Construtora Beta' });
  await verifyEmail(api, alpha);
  await verifyEmail(api, beta);
});

const PROPERTY_PAYLOAD = {
  title: 'Residencial Aurora',
  description: 'Descricao do imovel',
  shortDescription: 'Resumo',
  type: 'apartamento',
  purpose: 'venda',
  price: 500000,
  publicationStatus: 'published',
  commercialStatus: 'disponivel',
};

async function createProperty(account: RegisteredAccount, overrides: Record<string, unknown> = {}) {
  const response = await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
    ...PROPERTY_PAYLOAD,
    ...overrides,
  });
  expect(response.status, response.errorMessage ?? '').toBe(201);
  return response.body.property as { id: string; slug: string };
}

describe('empresa', () => {
  it('nao expoe a empresa de outro usuario', async () => {
    const response = await alpha.client.get(`/api/tenants/${beta.tenantId}`);
    expect(response.status).toBe(404);
    expect(response.errorCode).toBe('not_found');
  });

  it('nao altera os dados de outra empresa', async () => {
    const response = await alpha.client.patch(`/api/tenants/${beta.tenantId}`, {
      legalName: 'Invadida Ltda',
      displayName: 'Invadida',
      taxId: '',
      description: '',
      foundedYear: null,
      creaNumber: '',
    });
    expect(response.status).toBe(404);

    const [unchanged] = await api.db.select().from(schema.tenants).where(eq(schema.tenants.id, beta.tenantId));
    expect(unchanged?.displayName).toBe('Construtora Beta');
  });

  it('nao altera a identidade visual de outra empresa', async () => {
    const response = await alpha.client.put(`/api/tenants/${beta.tenantId}/theme`, {
      schemaVersion: 1,
      colors: { primary: '#FF0000' },
    });
    expect(response.status).toBe(404);
  });

  it('nao devolve a visao geral de outra empresa', async () => {
    const response = await alpha.client.get(`/api/tenants/${beta.tenantId}/overview`);
    expect(response.status).toBe(404);
  });
});

describe('imoveis', () => {
  it('a listagem traz apenas os imoveis da propria empresa', async () => {
    await createProperty(alpha, { title: 'Imovel da Alpha' });
    await createProperty(beta, { title: 'Imovel da Beta' });

    const response = await alpha.client.get(`/api/tenants/${alpha.tenantId}/properties`);
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].title).toBe('Imovel da Alpha');
  });

  it('nao le o imovel de outra empresa trocando o id na URL', async () => {
    const property = await createProperty(beta);
    const response = await alpha.client.get(`/api/tenants/${alpha.tenantId}/properties/${property.id}`);
    expect(response.status).toBe(404);
  });

  it('nao le o imovel de outra empresa trocando tambem o tenantId', async () => {
    const property = await createProperty(beta);
    const response = await alpha.client.get(`/api/tenants/${beta.tenantId}/properties/${property.id}`);
    expect(response.status).toBe(404);
  });

  it('nao edita o imovel de outra empresa', async () => {
    const property = await createProperty(beta, { title: 'Original da Beta' });

    const viaOwnTenant = await alpha.client.patch(
      `/api/tenants/${alpha.tenantId}/properties/${property.id}`,
      { title: 'Alterado pela Alpha' },
    );
    expect(viaOwnTenant.status).toBe(404);

    const viaOtherTenant = await alpha.client.patch(
      `/api/tenants/${beta.tenantId}/properties/${property.id}`,
      { title: 'Alterado pela Alpha' },
    );
    expect(viaOtherTenant.status).toBe(404);

    const [unchanged] = await api.db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.id, property.id));
    expect(unchanged?.title).toBe('Original da Beta');
  });

  it('nao exclui o imovel de outra empresa', async () => {
    const property = await createProperty(beta);
    const response = await alpha.client.delete(`/api/tenants/${alpha.tenantId}/properties/${property.id}`);
    expect(response.status).toBe(404);

    const rows = await api.db.select().from(schema.properties).where(eq(schema.properties.id, property.id));
    expect(rows).toHaveLength(1);
  });

  it('nao reordena imoveis de outra empresa', async () => {
    const mine = await createProperty(alpha, { title: 'Meu' });
    const theirs = await createProperty(beta, { title: 'Dele' });

    const response = await alpha.client.post(`/api/tenants/${alpha.tenantId}/properties/reorder`, {
      ids: [mine.id, theirs.id],
    });
    expect(response.status).toBe(404);

    const [untouched] = await api.db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.id, theirs.id));
    expect(untouched?.sortOrder).toBe(0);
  });
});

describe('obras', () => {
  it('nao le nem edita a obra de outra empresa', async () => {
    const createdResponse = await beta.client.post(`/api/tenants/${beta.tenantId}/projects`, {
      title: 'Obra da Beta',
      category: 'residencial',
      status: 'em_andamento',
      stage: 'estrutura',
      publicationStatus: 'published',
    });
    expect(createdResponse.status).toBe(201);
    const project = createdResponse.body.project as { id: string };

    expect((await alpha.client.get(`/api/tenants/${alpha.tenantId}/projects/${project.id}`)).status).toBe(404);
    expect(
      (
        await alpha.client.patch(`/api/tenants/${alpha.tenantId}/projects/${project.id}`, {
          title: 'Titulo alterado indevidamente',
        })
      ).status,
    ).toBe(404);
    expect((await alpha.client.delete(`/api/tenants/${alpha.tenantId}/projects/${project.id}`)).status).toBe(404);
  });

  it('nao adiciona registro de evolucao na obra de outra empresa', async () => {
    const created = await beta.client.post(`/api/tenants/${beta.tenantId}/projects`, {
      title: 'Obra da Beta',
      category: 'comercial',
    });
    const project = created.body.project as { id: string };

    const response = await alpha.client.post(
      `/api/tenants/${alpha.tenantId}/projects/${project.id}/updates`,
      { title: 'Registro invasor', note: '', progressPercent: null, imageIds: [] },
    );
    expect(response.status).toBe(404);
  });
});

describe('conteudos', () => {
  it('nao edita servico, depoimento, equipe ou pergunta de outra empresa', async () => {
    const service = (
      await beta.client.post(`/api/tenants/${beta.tenantId}/services`, { title: 'Servico da Beta' })
    ).body.service as { id: string };

    const testimonial = (
      await beta.client.post(`/api/tenants/${beta.tenantId}/testimonials`, {
        authorName: 'Cliente da Beta',
        content: 'Depoimento autorizado pelo cliente.',
        authorizationConfirmed: true,
        publicationStatus: 'published',
      })
    ).body.testimonial as { id: string };

    const member = (
      await beta.client.post(`/api/tenants/${beta.tenantId}/team`, { name: 'Engenheiro da Beta' })
    ).body.member as { id: string };

    const faq = (
      await beta.client.post(`/api/tenants/${beta.tenantId}/faqs`, {
        question: 'Pergunta da Beta?',
        answer: 'Resposta da Beta.',
      })
    ).body.faq as { id: string };

    expect(
      (
        await alpha.client.patch(`/api/tenants/${alpha.tenantId}/services/${service.id}`, {
          title: 'Servico alterado indevidamente',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await alpha.client.patch(`/api/tenants/${alpha.tenantId}/testimonials/${testimonial.id}`, {
          authorName: 'Autor alterado',
          content: 'Conteudo alterado indevidamente.',
          authorizationConfirmed: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await alpha.client.patch(`/api/tenants/${alpha.tenantId}/team/${member.id}`, {
          name: 'Integrante alterado',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await alpha.client.patch(`/api/tenants/${alpha.tenantId}/faqs/${faq.id}`, {
          question: 'Pergunta alterada?',
          answer: 'Resposta alterada.',
        })
      ).status,
    ).toBe(404);
  });
});


describe('biblioteca de midia', () => {
  it('nao referencia arquivo de outra empresa ao cadastrar conteudo', async () => {
    const [asset] = await api.db
      .insert(schema.mediaAssets)
      .values({
        tenantId: beta.tenantId,
        blobUrl: 'https://blob.test/tenants/beta/foto.jpg',
        blobPathname: `tenants/${beta.tenantId}/foto.jpg`,
        fileName: 'foto.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      })
      .returning();

    const response = await alpha.client.post(`/api/tenants/${alpha.tenantId}/properties`, {
      ...PROPERTY_PAYLOAD,
      coverImageId: asset!.id,
    });
    expect(response.status).toBe(404);
    expect(response.errorMessage).toMatch(/biblioteca desta empresa/i);
  });

  it('nao exclui arquivo de outra empresa', async () => {
    const [asset] = await api.db
      .insert(schema.mediaAssets)
      .values({
        tenantId: beta.tenantId,
        blobUrl: 'https://blob.test/tenants/beta/planta.pdf',
        blobPathname: `tenants/${beta.tenantId}/planta.pdf`,
        fileName: 'planta.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      })
      .returning();

    const response = await alpha.client.delete(`/api/tenants/${alpha.tenantId}/media/${asset!.id}`);
    expect(response.status).toBe(404);

    const rows = await api.db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.id, asset!.id));
    expect(rows).toHaveLength(1);
  });

  it('a listagem de midia traz apenas arquivos da propria empresa', async () => {
    await api.db.insert(schema.mediaAssets).values([
      {
        tenantId: alpha.tenantId,
        blobUrl: 'https://blob.test/a.jpg',
        blobPathname: `tenants/${alpha.tenantId}/a.jpg`,
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
      },
      {
        tenantId: beta.tenantId,
        blobUrl: 'https://blob.test/b.jpg',
        blobPathname: `tenants/${beta.tenantId}/b.jpg`,
        fileName: 'b.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
      },
    ]);

    const response = await alpha.client.get(`/api/tenants/${alpha.tenantId}/media`);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].fileName).toBe('a.jpg');
  });
});

describe('interessados', () => {
  it('nao le, atualiza nem comenta interessado de outra empresa', async () => {
    const [lead] = await api.db
      .insert(schema.leads)
      .values({
        tenantId: beta.tenantId,
        name: 'Cliente da Beta',
        phone: '(19) 90000-0000',
        interestType: 'compra_imovel',
      })
      .returning();

    expect((await alpha.client.get(`/api/tenants/${alpha.tenantId}/leads/${lead!.id}`)).status).toBe(404);
    expect(
      (await alpha.client.patch(`/api/tenants/${alpha.tenantId}/leads/${lead!.id}`, { status: 'convertido' })).status,
    ).toBe(404);
    expect(
      (await alpha.client.post(`/api/tenants/${alpha.tenantId}/leads/${lead!.id}/notes`, { note: 'nota' })).status,
    ).toBe(404);
    expect((await alpha.client.delete(`/api/tenants/${alpha.tenantId}/leads/${lead!.id}`)).status).toBe(404);
  });

  it('nao atribui um interessado a alguem de fora da equipe', async () => {
    const [lead] = await api.db
      .insert(schema.leads)
      .values({
        tenantId: alpha.tenantId,
        name: 'Interessado',
        phone: '(19) 90000-0000',
        interestType: 'orcamento',
      })
      .returning();

    const response = await alpha.client.patch(`/api/tenants/${alpha.tenantId}/leads/${lead!.id}`, {
      assignedToUserId: beta.userId,
    });
    expect(response.status).toBe(400);
    expect(response.errorMessage).toMatch(/equipe desta empresa/i);
  });
});

describe('equipe', () => {
  it('nao lista nem remove membros de outra empresa', async () => {
    const members = await beta.client.get(`/api/tenants/${beta.tenantId}/members`);
    const membershipId = members.body.members[0].membershipId as string;

    expect((await alpha.client.get(`/api/tenants/${beta.tenantId}/members`)).status).toBe(404);
    expect(
      (await alpha.client.delete(`/api/tenants/${alpha.tenantId}/members/${membershipId}`)).status,
    ).toBe(404);
  });
});

describe('dominios', () => {
  it('nao vincula um dominio ja usado por outra empresa', async () => {
    await api.db.insert(schema.domains).values({
      tenantId: beta.tenantId,
      hostname: 'www.disputado.com.br',
      status: 'active',
    });

    // Plano profissional para liberar o recurso de dominio proprio.
    await upgradeToProfessional(alpha.tenantId);

    const response = await alpha.client.post(`/api/tenants/${alpha.tenantId}/domains`, {
      domain: 'www.disputado.com.br',
    });
    expect(response.status).toBe(409);
    expect(response.errorMessage).toMatch(/outra empresa/i);
  });

  it('nao desvincula dominio de outra empresa', async () => {
    const [domain] = await api.db
      .insert(schema.domains)
      .values({ tenantId: beta.tenantId, hostname: 'www.beta.com.br', status: 'active' })
      .returning();

    const response = await alpha.client.delete(`/api/tenants/${alpha.tenantId}/domains/${domain!.id}`);
    expect(response.status).toBe(404);

    const rows = await api.db.select().from(schema.domains).where(eq(schema.domains.id, domain!.id));
    expect(rows).toHaveLength(1);
  });
});

describe('administrador da plataforma', () => {
  it('nao recebe acesso ao conteudo das empresas apenas pelo papel global', async () => {
    const adminClient = await createPlatformAdmin('admin@plataforma.com.br');

    // O painel mestre responde...
    expect((await adminClient.get('/api/platform/overview')).status).toBe(200);
    expect((await adminClient.get('/api/platform/tenants')).status).toBe(200);

    // ...mas o painel da construtora, nao.
    expect((await adminClient.get(`/api/tenants/${alpha.tenantId}`)).status).toBe(404);
    expect((await adminClient.get(`/api/tenants/${alpha.tenantId}/leads`)).status).toBe(404);
    expect((await adminClient.get(`/api/tenants/${alpha.tenantId}/properties`)).status).toBe(404);
  });

  it('acessa somente leitura apos conceder acesso de suporte, e o acesso expira', async () => {
    const adminClient = await createPlatformAdmin('suporte@plataforma.com.br');

    const grantResponse = await adminClient.post('/api/platform/support-access', {
      tenantId: alpha.tenantId,
      reason: 'Investigacao de chamado tecnico aberto pelo cliente.',
      expiresInMinutes: 30,
      readOnly: true,
    });
    expect(grantResponse.status).toBe(201);
    const grantId = grantResponse.body.grant.id as string;

    // Leitura liberada.
    const read = await adminClient.get(`/api/tenants/${alpha.tenantId}/properties`);
    expect(read.status).toBe(200);

    // Escrita continua proibida: a concessao e somente leitura.
    const write = await adminClient.post(`/api/tenants/${alpha.tenantId}/properties`, PROPERTY_PAYLOAD);
    expect(write.status).toBe(403);
    expect(write.errorMessage).toMatch(/somente leitura/i);

    // A concessao fica registrada em auditoria.
    const logs = await api.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.tenantId, alpha.tenantId),
          eq(schema.auditLogs.action, 'platform.support_access_granted'),
        ),
      );
    expect(logs).toHaveLength(1);
    expect(logs[0]?.metadata).toMatchObject({ readOnly: true });

    // Revogada, o acesso cai imediatamente.
    expect((await adminClient.delete(`/api/platform/support-access/${grantId}`)).status).toBe(204);
    expect((await adminClient.get(`/api/tenants/${alpha.tenantId}/properties`)).status).toBe(404);
  });

  it('concessao de suporte nao vale para outra empresa', async () => {
    const adminClient = await createPlatformAdmin('escopo@plataforma.com.br');
    await adminClient.post('/api/platform/support-access', {
      tenantId: alpha.tenantId,
      reason: 'Chamado tecnico restrito a esta empresa.',
      expiresInMinutes: 30,
      readOnly: true,
    });

    expect((await adminClient.get(`/api/tenants/${alpha.tenantId}/properties`)).status).toBe(200);
    expect((await adminClient.get(`/api/tenants/${beta.tenantId}/properties`)).status).toBe(404);
  });
});

describe('rotas do painel mestre', () => {
  it('estao fechadas para usuarios comuns', async () => {
    for (const path of [
      '/api/platform/overview',
      '/api/platform/tenants',
      '/api/platform/plans',
      '/api/platform/domains',
      '/api/platform/audit',
      '/api/platform/support-access',
    ]) {
      const response = await alpha.client.get(path);
      expect(response.status, path).toBe(403);
    }
  });

  it('exigem autenticacao', async () => {
    const anonymous = api.client();
    expect((await anonymous.get('/api/platform/overview')).status).toBe(401);
  });
});

async function upgradeToProfessional(tenantId: string): Promise<void> {
  const [plan] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'profissional'));
  await api.db
    .update(schema.tenants)
    .set({ planId: plan!.id })
    .where(eq(schema.tenants.id, tenantId));
}

async function createPlatformAdmin(email: string) {
  await api.db.insert(schema.users).values({
    email,
    name: 'Administrador da Plataforma',
    passwordHash: await hashPassword('senhaSegura123'),
    platformRole: 'platform_admin',
    emailVerifiedAt: new Date(),
  });

  const client = api.client();
  const login = await client.post('/api/auth/login', { email, password: 'senhaSegura123' });
  expect(login.status).toBe(200);
  return client;
}
