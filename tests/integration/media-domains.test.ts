import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import type { DomainProvider, DomainProviderStatus } from '@codeca/api';
import { createTestApi, registerAccount, verifyEmail, type RegisteredAccount, type TestApi } from '../helpers/api.js';

/** Biblioteca de midia sobre o Blob e gestao de dominios proprios. */

let api: TestApi;
let account: RegisteredAccount;

/** Provedor de dominios controlado pelo teste, no lugar da API da Vercel. */
function createFakeDomainProvider(): DomainProvider & {
  state: Map<string, DomainProviderStatus>;
  calls: string[];
} {
  const state = new Map<string, DomainProviderStatus>();
  const calls: string[] = [];

  const pending = (hostname: string): DomainProviderStatus => ({
    ownershipVerified: false,
    dnsConfigured: false,
    sslActive: false,
    challenges: [{ type: 'TXT', domain: `_vercel.${hostname}`, value: 'desafio-123', reason: 'pending' }],
    message: 'Aguardando os registros de DNS.',
    providerDomainId: hostname,
  });

  return {
    state,
    calls,
    configured: true,
    async add(hostname) {
      calls.push(`add:${hostname}`);
      const status = state.get(hostname) ?? pending(hostname);
      state.set(hostname, status);
      return status;
    },
    async status(hostname) {
      calls.push(`status:${hostname}`);
      return state.get(hostname) ?? pending(hostname);
    },
    async verify(hostname) {
      calls.push(`verify:${hostname}`);
      return state.get(hostname) ?? pending(hostname);
    },
    async remove(hostname) {
      calls.push(`remove:${hostname}`);
      state.delete(hostname);
    },
  };
}

let provider: ReturnType<typeof createFakeDomainProvider>;

beforeAll(async () => {
  provider = createFakeDomainProvider();
  api = await createTestApi({ domains: provider });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  provider.state.clear();
  provider.calls.length = 0;
  account = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Construtora Alpha' });
  await verifyEmail(api, account);
  await usePlan('profissional');
});

async function usePlan(code: 'trial' | 'essencial' | 'profissional'): Promise<void> {
  const [plan] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, code));
  await api.db.update(schema.tenants).set({ planId: plan!.id }).where(eq(schema.tenants.id, account.tenantId));
}

function imageUpload(name: string, bytes = 2048, type = 'image/jpeg'): FormData {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], name, { type }));
  form.set('alt', 'Fachada do empreendimento');
  form.set('tag', 'fachadas');
  form.set('width', '1200');
  form.set('height', '800');
  return form;
}

describe('upload de midia', () => {
  it('grava o arquivo no Blob sob o prefixo da empresa e registra no banco', async () => {
    const response = await account.client.request('POST', `/api/tenants/${account.tenantId}/media`, {
      formData: imageUpload('Fachada Principal.JPG'),
    });

    expect(response.status, response.errorMessage ?? '').toBe(201);
    const asset = response.body.asset as {
      id: string;
      blobPathname: string;
      fileName: string;
      alt: string;
      sizeBytes: number;
      width: number;
      kind: string;
    };

    // O caminho e sempre prefixado pelo id da empresa.
    expect(asset.blobPathname.startsWith(`tenants/${account.tenantId}/`)).toBe(true);
    // O nome e normalizado antes de compor o caminho.
    expect(asset.fileName).toBe('fachada-principal.jpg');
    expect(asset.alt).toBe('Fachada do empreendimento');
    expect(asset.sizeBytes).toBe(2048);
    expect(asset.width).toBe(1200);
    expect(asset.kind).toBe('image');
    expect(api.blobFiles.size).toBe(1);

    const [row] = await api.db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.id, asset.id));
    expect(row?.tenantId).toBe(account.tenantId);
    expect(row?.uploadedByUserId).toBe(account.userId);
  });

  it('recusa tipo de arquivo nao permitido', async () => {
    const form = new FormData();
    form.set('file', new File(['<?php echo 1; ?>'], 'script.php', { type: 'application/x-php' }));

    const response = await account.client.request('POST', `/api/tenants/${account.tenantId}/media`, {
      formData: form,
    });
    expect(response.status).toBe(415);
    expect(api.blobFiles.size).toBe(0);
  });

  it('recusa arquivo acima do limite por arquivo', async () => {
    const response = await account.client.request('POST', `/api/tenants/${account.tenantId}/media`, {
      formData: imageUpload('grande.jpg', 5 * 1024 * 1024),
    });
    expect(response.status).toBe(413);
    expect(api.blobFiles.size).toBe(0);
  });

  it('recusa upload quando o armazenamento do plano esta esgotado', async () => {
    // Plano com 1 KB de armazenamento, para o limite ser alcancado no primeiro envio.
    const [plan] = await api.db
      .insert(schema.plans)
      .values({
        code: 'minusculo',
        name: 'Minusculo',
        limits: {
          maxUsers: 2,
          maxPublishedProperties: 5,
          maxProjects: 3,
          maxPages: 10,
          maxDomains: 1,
          storageBytes: 1024,
          features: ['custom_domain'],
        },
      })
      .returning();
    await api.db.update(schema.tenants).set({ planId: plan!.id }).where(eq(schema.tenants.id, account.tenantId));

    const response = await account.client.request('POST', `/api/tenants/${account.tenantId}/media`, {
      formData: imageUpload('foto.jpg', 2048),
    });
    expect(response.status).toBe(402);
    expect(response.errorCode).toBe('storage_limit_reached');
  });

  it('atualiza o texto alternativo', async () => {
    const uploaded = await account.client.request('POST', `/api/tenants/${account.tenantId}/media`, {
      formData: imageUpload('foto.jpg'),
    });
    const id = uploaded.body.asset.id as string;

    const response = await account.client.patch(`/api/tenants/${account.tenantId}/media/${id}`, {
      alt: 'Vista da piscina ao anoitecer',
      title: 'Piscina',
    });
    expect(response.status).toBe(200);
    expect(response.body.asset.alt).toBe('Vista da piscina ao anoitecer');
  });
});

describe('exclusao de midia', () => {
  it('impede excluir arquivo em uso e informa onde esta referenciado', async () => {
    const uploaded = await account.client.request('POST', `/api/tenants/${account.tenantId}/media`, {
      formData: imageUpload('capa.jpg'),
    });
    const mediaId = uploaded.body.asset.id as string;

    await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
      title: 'Imovel com capa',
      type: 'casa',
      purpose: 'venda',
      coverImageId: mediaId,
    });

    const usage = await account.client.get(`/api/tenants/${account.tenantId}/media/${mediaId}/usage`);
    expect(usage.body.usage.propertyCovers).toBe(1);
    expect(usage.body.usage.total).toBe(1);

    const blocked = await account.client.delete(`/api/tenants/${account.tenantId}/media/${mediaId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.errorMessage).toMatch(/em uso/i);
    expect(api.blobFiles.size).toBe(1);
  });

  it('exclui arquivo sem referencias, tambem do Blob', async () => {
    const uploaded = await account.client.request('POST', `/api/tenants/${account.tenantId}/media`, {
      formData: imageUpload('solta.jpg'),
    });
    const mediaId = uploaded.body.asset.id as string;
    expect(api.blobFiles.size).toBe(1);

    const response = await account.client.delete(`/api/tenants/${account.tenantId}/media/${mediaId}`);
    expect(response.status).toBe(204);
    expect(api.blobFiles.size).toBe(0);

    const rows = await api.db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.id, mediaId));
    expect(rows).toHaveLength(0);
  });


  it('lista apenas arquivos sem referencia quando pedido', async () => {
    const used = await account.client.request('POST', `/api/tenants/${account.tenantId}/media`, {
      formData: imageUpload('usada.jpg'),
    });
    await account.client.request('POST', `/api/tenants/${account.tenantId}/media`, {
      formData: imageUpload('livre.jpg'),
    });

    await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
      title: 'Imovel',
      type: 'casa',
      purpose: 'venda',
      coverImageId: used.body.asset.id,
    });

    const all = await account.client.get(`/api/tenants/${account.tenantId}/media`);
    expect(all.body.items).toHaveLength(2);

    const unused = await account.client.get(`/api/tenants/${account.tenantId}/media?unusedOnly=true`);
    expect(unused.body.items).toHaveLength(1);
    expect(unused.body.items[0].fileName).toBe('livre.jpg');
  });
});

describe('dominios proprios', () => {
  it('cadastra o dominio como pendente, nunca como ativo', async () => {
    const response = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'https://WWW.Construtora-Alpha.com.br/sobre',
    });

    expect(response.status, response.errorMessage ?? '').toBe(201);
    // A entrada do usuario e normalizada.
    expect(response.body.domain.hostname).toBe('www.construtora-alpha.com.br');
    // Mesmo recem-cadastrado, o dominio nao e considerado ativo.
    expect(response.body.domain.status).not.toBe('active');
    expect(response.body.domain.sslStatus).toBe('pending');
    expect(provider.calls).toContain('add:www.construtora-alpha.com.br');

    // As instrucoes de DNS trazem CNAME para subdominio.
    expect(response.body.dns.records[0].type).toBe('CNAME');
    expect(response.body.dns.records.some((r: { type: string }) => r.type === 'TXT')).toBe(true);
  });

  it('sugere registro A quando o dominio e apex', async () => {
    const response = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'construtora-alpha.com.br',
    });
    expect(response.body.dns.records[0].type).toBe('A');
    expect(response.body.dns.apex).toBe(true);
  });

  it('recusa dominio invalido', async () => {
    const response = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'nao-e-um-dominio',
    });
    expect(response.status).toBe(422);
  });

  it('recusa host da propria plataforma', async () => {
    const response = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'app.localhost',
    });
    expect(response.status).not.toBe(201);
  });

  it('recusa subdominio reservado para servicos administrativos', async () => {
    const response = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'admin.construtora-alpha.com.br',
    });
    expect(response.status).toBe(409);
    expect(response.errorMessage).toMatch(/reservado/i);
  });

  it('ativa somente quando o provedor confirma propriedade e DNS', async () => {
    const created = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'www.construtora-alpha.com.br',
    });
    const domainId = created.body.domain.id as string;

    // Primeira verificacao: DNS ainda nao propagado.
    const stillPending = await account.client.post(
      `/api/tenants/${account.tenantId}/domains/${domainId}/verify`,
    );
    expect(stillPending.body.domain.status).not.toBe('active');

    // Propriedade comprovada, mas DNS apontando errado.
    provider.state.set('www.construtora-alpha.com.br', {
      ownershipVerified: true,
      dnsConfigured: false,
      sslActive: false,
      challenges: [],
      message: 'Ajuste os registros de DNS.',
      providerDomainId: 'www.construtora-alpha.com.br',
    });
    const misconfigured = await account.client.post(
      `/api/tenants/${account.tenantId}/domains/${domainId}/verify`,
    );
    expect(misconfigured.body.domain.status).toBe('misconfigured');
    expect(misconfigured.body.domain.lastError).not.toBe('');

    // Tudo correto: o dominio fica ativo com HTTPS.
    provider.state.set('www.construtora-alpha.com.br', {
      ownershipVerified: true,
      dnsConfigured: true,
      sslActive: true,
      challenges: [],
      message: 'Dominio ativo.',
      providerDomainId: 'www.construtora-alpha.com.br',
    });
    const active = await account.client.post(`/api/tenants/${account.tenantId}/domains/${domainId}/verify`);
    expect(active.body.domain.status).toBe('active');
    expect(active.body.domain.sslStatus).toBe('active');
    expect(active.body.domain.verifiedAt).not.toBeNull();
  });

  it('somente dominio ativo pode ser principal', async () => {
    const created = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'www.construtora-alpha.com.br',
    });
    const domainId = created.body.domain.id as string;

    const blocked = await account.client.post(`/api/tenants/${account.tenantId}/domains/${domainId}/primary`);
    expect(blocked.status).toBe(400);

    await api.db
      .update(schema.domains)
      .set({ status: 'active' })
      .where(eq(schema.domains.id, domainId));

    const allowed = await account.client.post(`/api/tenants/${account.tenantId}/domains/${domainId}/primary`);
    expect(allowed.status).toBe(200);
  });

  it('mantem apenas um dominio principal por empresa', async () => {
    const first = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'www.alpha-um.com.br',
    });
    const second = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'www.alpha-dois.com.br',
    });
    await api.db.update(schema.domains).set({ status: 'active' }).where(eq(schema.domains.tenantId, account.tenantId));

    await account.client.post(`/api/tenants/${account.tenantId}/domains/${first.body.domain.id}/primary`);
    await account.client.post(`/api/tenants/${account.tenantId}/domains/${second.body.domain.id}/primary`);

    const rows = await api.db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.tenantId, account.tenantId));
    expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
    expect(rows.find((r) => r.isPrimary)?.hostname).toBe('www.alpha-dois.com.br');
  });

  it('dominio proprio e um recurso de plano', async () => {
    await usePlan('trial');
    const response = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'www.construtora-alpha.com.br',
    });
    expect(response.status).toBe(402);
    expect(response.errorMessage).toMatch(/Dominio proprio/i);
  });

  it('respeita a quantidade de dominios do plano', async () => {
    await usePlan('essencial'); // maxDomains = 1
    const first = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'www.alpha-um.com.br',
    });
    expect(first.status).toBe(201);

    const second = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'www.alpha-dois.com.br',
    });
    expect(second.status).toBe(402);
  });

  it('desvincula o dominio tambem no provedor', async () => {
    const created = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'www.remover.com.br',
    });
    const domainId = created.body.domain.id as string;

    const response = await account.client.delete(`/api/tenants/${account.tenantId}/domains/${domainId}`);
    expect(response.status).toBe(204);
    expect(provider.calls).toContain('remove:www.remover.com.br');

    const rows = await api.db.select().from(schema.domains).where(eq(schema.domains.id, domainId));
    expect(rows).toHaveLength(0);
  });
});
