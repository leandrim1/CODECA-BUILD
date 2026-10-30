import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, schema } from '@codeca/database';
import { createTestApi, registerAccount, verifyEmail, type RegisteredAccount, type TestApi } from '../helpers/api.js';

/** CRUDs de conteudo, rascunho/publicacao/restauracao e limites de plano. */

let api: TestApi;
let account: RegisteredAccount;

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
});

async function usePlan(code: 'trial' | 'essencial' | 'profissional'): Promise<void> {
  const [plan] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, code));
  await api.db.update(schema.tenants).set({ planId: plan!.id }).where(eq(schema.tenants.id, account.tenantId));
}

const BASE_PROPERTY = {
  title: 'Residencial Aurora',
  description: 'Apartamento de tres dormitorios com varanda gourmet.',
  shortDescription: 'Tres dormitorios no Cambui',
  type: 'apartamento',
  purpose: 'venda',
  price: 780000,
  bedrooms: 3,
  suites: 1,
  bathrooms: 2,
  parkingSpots: 2,
  builtAreaM2: 94,
  features: ['Varanda gourmet', 'Lazer completo'],
  address: { city: 'Campinas', state: 'SP', neighborhood: 'Cambui', showFullAddress: false },
  publicationStatus: 'draft',
  commercialStatus: 'disponivel',
};

describe('imoveis', () => {
  it('cria com slug derivado do titulo e persiste os dados', async () => {
    const response = await account.client.post(`/api/tenants/${account.tenantId}/properties`, BASE_PROPERTY);
    expect(response.status, response.errorMessage ?? '').toBe(201);
    expect(response.body.property.slug).toBe('residencial-aurora');
    expect(response.body.property.price).toBe(780000);
    expect(response.body.property.features).toEqual(['Varanda gourmet', 'Lazer completo']);

    const [row] = await api.db
      .select()
      .from(schema.properties)
      .where(eq(schema.properties.id, response.body.property.id));
    expect(row?.bedrooms).toBe(3);
    expect(row?.address.showFullAddress).toBe(false);
  });

  it('gera slug unico quando o titulo repete na mesma empresa', async () => {
    const first = await account.client.post(`/api/tenants/${account.tenantId}/properties`, BASE_PROPERTY);
    const second = await account.client.post(`/api/tenants/${account.tenantId}/properties`, BASE_PROPERTY);
    expect(first.body.property.slug).toBe('residencial-aurora');
    expect(second.body.property.slug).toBe('residencial-aurora-2');
  });

  it('separa o estado editorial do estado comercial', async () => {
    const created = await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
      ...BASE_PROPERTY,
      publicationStatus: 'published',
      commercialStatus: 'vendido',
    });
    expect(created.status).toBe(201);
    expect(created.body.property.publicationStatus).toBe('published');
    expect(created.body.property.commercialStatus).toBe('vendido');
    expect(created.body.property.publishedAt).not.toBeNull();
  });

  it('filtra, ordena e pagina', async () => {
    await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
      ...BASE_PROPERTY,
      title: 'Casa Vila Verde',
      type: 'casa',
      price: 1450000,
      publicationStatus: 'published',
    });
    await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
      ...BASE_PROPERTY,
      title: 'Studio Centro',
      type: 'studio',
      price: 395000,
      publicationStatus: 'draft',
    });

    const published = await account.client.get(
      `/api/tenants/${account.tenantId}/properties?publicationStatus=published`,
    );
    expect(published.body.items).toHaveLength(1);
    expect(published.body.items[0].title).toBe('Casa Vila Verde');

    const byType = await account.client.get(`/api/tenants/${account.tenantId}/properties?type=studio`);
    expect(byType.body.items).toHaveLength(1);

    const search = await account.client.get(`/api/tenants/${account.tenantId}/properties?search=Vila`);
    expect(search.body.items).toHaveLength(1);

    const cheapest = await account.client.get(
      `/api/tenants/${account.tenantId}/properties?sortBy=price&sortDir=asc`,
    );
    expect(cheapest.body.items[0].title).toBe('Studio Centro');

    const paged = await account.client.get(`/api/tenants/${account.tenantId}/properties?pageSize=1&page=2`);
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.total).toBe(2);
    expect(paged.body.totalPages).toBe(2);
  });

  it('respeita o limite de imoveis publicados do plano', async () => {
    await usePlan('trial'); // maxPublishedProperties = 5

    for (let index = 0; index < 5; index += 1) {
      const response = await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
        ...BASE_PROPERTY,
        title: `Imovel publicado ${index + 1}`,
        publicationStatus: 'published',
      });
      expect(response.status).toBe(201);
    }

    const blocked = await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
      ...BASE_PROPERTY,
      title: 'Imovel que excede',
      publicationStatus: 'published',
    });
    expect(blocked.status).toBe(402);
    expect(blocked.errorCode).toBe('plan_limit_reached');

    // Rascunho continua permitido: o limite conta apenas o que esta publicado.
    const draft = await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
      ...BASE_PROPERTY,
      title: 'Imovel em rascunho',
      publicationStatus: 'draft',
    });
    expect(draft.status).toBe(201);

    // Publicar o rascunho tambem e bloqueado.
    const publishing = await account.client.patch(
      `/api/tenants/${account.tenantId}/properties/${draft.body.property.id}`,
      { publicationStatus: 'published' },
    );
    expect(publishing.status).toBe(402);
  });

  it('exclui o imovel e as referencias de galeria em cascata', async () => {
    const [asset] = await api.db
      .insert(schema.mediaAssets)
      .values({
        tenantId: account.tenantId,
        blobUrl: 'https://blob.test/foto.jpg',
        blobPathname: `tenants/${account.tenantId}/foto.jpg`,
        fileName: 'foto.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      })
      .returning();

    const created = await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
      ...BASE_PROPERTY,
      coverImageId: asset!.id,
      galleryImageIds: [asset!.id],
    });
    expect(created.status).toBe(201);
    const propertyId = created.body.property.id as string;

    const images = await api.db
      .select()
      .from(schema.propertyImages)
      .where(eq(schema.propertyImages.propertyId, propertyId));
    expect(images).toHaveLength(1);

    expect((await account.client.delete(`/api/tenants/${account.tenantId}/properties/${propertyId}`)).status).toBe(204);

    const orphans = await api.db
      .select()
      .from(schema.propertyImages)
      .where(eq(schema.propertyImages.propertyId, propertyId));
    expect(orphans).toHaveLength(0);

    // O arquivo permanece na biblioteca, agora sem referencias.
    const remaining = await api.db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.id, asset!.id));
    expect(remaining).toHaveLength(1);
  });
});

describe('obras', () => {
  it('registra a evolucao e atualiza a etapa da obra', async () => {
    const created = await account.client.post(`/api/tenants/${account.tenantId}/projects`, {
      title: 'Residencial Aurora',
      category: 'residencial',
      status: 'em_andamento',
      stage: 'fundacao',
      publicationStatus: 'published',
    });
    expect(created.status).toBe(201);
    const projectId = created.body.project.id as string;
    expect(created.body.project.progressPercent).toBeNull();

    const update = await account.client.post(
      `/api/tenants/${account.tenantId}/projects/${projectId}/updates`,
      {
        title: 'Estrutura concluida',
        note: 'Lajes concretadas.',
        stage: 'estrutura',
        progressPercent: 45,
        recordedAt: '2025-06-01',
        imageIds: [],
      },
    );
    expect(update.status).toBe(201);

    const detail = await account.client.get(`/api/tenants/${account.tenantId}/projects/${projectId}`);
    expect(detail.body.project.stage).toBe('estrutura');
    expect(detail.body.project.progressPercent).toBe(45);
    expect(detail.body.updates).toHaveLength(1);
  });

  it('mantem o percentual nulo quando a empresa nao informa', async () => {
    const created = await account.client.post(`/api/tenants/${account.tenantId}/projects`, {
      title: 'Obra sem percentual',
      category: 'comercial',
    });
    const projectId = created.body.project.id as string;

    await account.client.post(`/api/tenants/${account.tenantId}/projects/${projectId}/updates`, {
      title: 'Inicio dos servicos',
      note: '',
      progressPercent: null,
      imageIds: [],
    });

    const detail = await account.client.get(`/api/tenants/${account.tenantId}/projects/${projectId}`);
    expect(detail.body.project.progressPercent).toBeNull();
  });

  it('respeita o limite de obras do plano', async () => {
    await usePlan('trial'); // maxProjects = 3
    for (let index = 0; index < 3; index += 1) {
      const response = await account.client.post(`/api/tenants/${account.tenantId}/projects`, {
        title: `Obra ${index + 1}`,
        category: 'residencial',
      });
      expect(response.status).toBe(201);
    }
    const blocked = await account.client.post(`/api/tenants/${account.tenantId}/projects`, {
      title: 'Obra que excede',
      category: 'residencial',
    });
    expect(blocked.status).toBe(402);
  });
});

describe('depoimentos', () => {
  it('nao publica depoimento sem autorizacao declarada do autor', async () => {
    const blocked = await account.client.post(`/api/tenants/${account.tenantId}/testimonials`, {
      authorName: 'Cliente Satisfeito',
      content: 'Obra entregue no prazo combinado e com otimo acabamento.',
      authorizationConfirmed: false,
      publicationStatus: 'published',
    });
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body)).toMatch(/autorizacao/i);

    const asDraft = await account.client.post(`/api/tenants/${account.tenantId}/testimonials`, {
      authorName: 'Cliente Satisfeito',
      content: 'Obra entregue no prazo combinado e com otimo acabamento.',
      authorizationConfirmed: false,
      publicationStatus: 'draft',
    });
    expect(asDraft.status).toBe(201);

    const authorized = await account.client.post(`/api/tenants/${account.tenantId}/testimonials`, {
      authorName: 'Outro Cliente',
      content: 'Recomendo a construtora para obras comerciais.',
      authorizationConfirmed: true,
      authorizationNote: 'Autorizacao por escrito em 10/01/2025.',
      publicationStatus: 'published',
    });
    expect(authorized.status).toBe(201);
  });
});


describe('auditoria', () => {
  it('registra as operacoes sem guardar dados sensiveis', async () => {
    await account.client.post(`/api/tenants/${account.tenantId}/properties`, BASE_PROPERTY);

    const logs = await api.db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.tenantId, account.tenantId), eq(schema.auditLogs.action, 'property.created')));

    expect(logs).toHaveLength(1);
    expect(logs[0]?.actorEmail).toBe('dono@alpha.com.br');
    expect(logs[0]?.ipHash).not.toContain('.');

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('senhaSegura123');
    expect(serialized.toLowerCase()).not.toContain('"password"');
  });
});
