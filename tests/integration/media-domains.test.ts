import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import type { DomainProvider, DomainProviderStatus } from '@codeca/api';
import { createTestApi, registerAccount, verifyEmail, type RegisteredAccount, type TestApi } from '../helpers/api.js';
import { jpegBytes } from '../helpers/media.js';

/** Biblioteca de midia sobre o Blob e gestao de dominios proprios. */

let api: TestApi;
let account: RegisteredAccount;

/** Provedor de dominios controlado pelo teste, no lugar da API da Vercel. */
function createFakeDomainProvider(): DomainProvider & {
  state: Map<string, DomainProviderStatus>;
  calls: string[];
  /** Cada projeto que recebeu uma chamada, na ordem. */
  projects: string[];
} {
  const state = new Map<string, DomainProviderStatus>();
  const calls: string[] = [];
  const projects: string[] = [];

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
    projects,
    configured: true,
    // `projectId` primeiro, como na interface real. Declarar so `(hostname)`
    // compila -- uma funcao com menos parametros e atribuivel -- e receberia o
    // projeto no lugar do hostname, em silencio.
    async add(projectId, hostname) {
      projects.push(projectId);
      calls.push(`add:${hostname}`);
      const status = state.get(hostname) ?? pending(hostname);
      state.set(hostname, status);
      return status;
    },
    async status(projectId, hostname) {
      projects.push(projectId);
      calls.push(`status:${hostname}`);
      return state.get(hostname) ?? pending(hostname);
    },
    async verify(projectId, hostname) {
      projects.push(projectId);
      calls.push(`verify:${hostname}`);
      return state.get(hostname) ?? pending(hostname);
    },
    async remove(projectId, hostname) {
      projects.push(projectId);
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
  provider.projects.length = 0;
  account = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Construtora Alpha' });
  await verifyEmail(api, account);
  await usePlan('profissional');
});

async function usePlan(code: 'trial' | 'essencial' | 'profissional' | 'empresas'): Promise<void> {
  const [plan] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, code));
  await api.db.update(schema.tenants).set({ planId: plan!.id }).where(eq(schema.tenants.id, account.tenantId));
}

/** Projeto Vercel do site do cliente, como a CODECA IA o configuraria. */
const PROJETO_DO_SITE = 'prj_site_alpha';

/**
 * Coloca a empresa no regime em que a plataforma **gerencia** o dominio.
 *
 * Sao duas condicoes, e as duas sao necessarias: o plano inclui hospedagem
 * **e** o site tem projeto configurado. Os testes que exercitam a Vercel
 * chamam isto; os demais ficam no padrao do `beforeEach`, o Profissional, em
 * que a plataforma so registra o dominio.
 */
async function useHostedSite(projectId: string = PROJETO_DO_SITE): Promise<void> {
  await usePlan('empresas');
  await api.db
    .update(schema.sites)
    .set({ hostingProjectId: projectId })
    .where(eq(schema.sites.id, account.siteId));
}

function imageUpload(name: string, bytes = 2048, type = 'image/jpeg'): FormData {
  const form = new FormData();
  form.set('file', new File([jpegBytes(bytes)], name, { type }));
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
          maxContentRecords: 5,
          maxDomains: 1,
          storageBytes: 1024,
          // `cms_panel` porque o teste e sobre o limite de armazenamento: sem
          // o painel no plano, a recusa viria antes e por outro motivo.
          features: ['cms_panel', 'custom_domain'],
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
    await useHostedSite();
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
    // A chamada vai ao projeto **do site** -- nao ao da plataforma, que serve o
    // painel e abriria o login no endereco do cliente.
    expect(provider.projects).toEqual([PROJETO_DO_SITE]);

    // As instrucoes de DNS trazem CNAME para subdominio.
    expect(response.body.dns.records[0].type).toBe('CNAME');
    expect(response.body.dns.records.some((r: { type: string }) => r.type === 'TXT')).toBe(true);
  });

  it('sugere registro A quando o dominio e apex', async () => {
    await useHostedSite();
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
    await useHostedSite();
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
    // Empresas: o unico plano com mais de um dominio, e este teste precisa de
    // dois para ter o que disputar.
    await usePlan('empresas');

    const first = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'www.alpha-um.com.br',
    });
    expect(first.status, first.errorMessage ?? '').toBe(201);
    const second = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'www.alpha-dois.com.br',
    });
    expect(second.status, second.errorMessage ?? '').toBe(201);
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
    expect(response.errorMessage).toMatch(/Domínio próprio/i);
  });

  it('respeita a quantidade de dominios do plano', async () => {
    await usePlan('profissional'); // maxDomains = 1, com painel
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
    await useHostedSite();
    const created = await account.client.post(`/api/tenants/${account.tenantId}/domains`, {
      domain: 'www.remover.com.br',
    });
    const domainId = created.body.domain.id as string;

    const response = await account.client.delete(`/api/tenants/${account.tenantId}/domains/${domainId}`);
    expect(response.status).toBe(204);
    expect(provider.calls).toContain('remove:www.remover.com.br');
    // E o desfazer tambem: o projeto do site, nunca outro.
    expect(provider.projects.at(-1)).toBe(PROJETO_DO_SITE);

    const rows = await api.db.select().from(schema.domains).where(eq(schema.domains.id, domainId));
    expect(rows).toHaveLength(0);
  });
});

/**
 * Quem hospeda o site decide o que a plataforma pode afirmar sobre o dominio.
 *
 * A especificacao comercial separa as duas coisas: dominio incluido nos tres
 * planos, hospedagem so no Empresas. Entao a plataforma nao pode assumir que
 * hospeda -- e quando nao hospeda, nao tem como verificar nem configurar o DNS
 * de um site que esta em outro lugar.
 *
 * O erro que isto corrige: o provedor usava um projeto unico do ambiente, o da
 * propria plataforma, que serve o painel. Anexar a ele o dominio de um cliente
 * faria o endereco dele abrir o login do painel.
 */
describe('quem hospeda o site', () => {
  const HOST = 'www.construtora-alpha.com.br';
  const base = () => `/api/tenants/${account.tenantId}/domains`;

  describe('plano sem hospedagem: a plataforma so registra', () => {
    // O `beforeEach` do arquivo ja deixa a empresa no Profissional.

    it('registra o dominio sem chamar a Vercel', async () => {
      const response = await account.client.post(base(), { domain: HOST });

      expect(response.status, response.errorMessage ?? '').toBe(201);
      expect(response.body.domain.status).toBe('registered');
      // Nenhuma chamada: nao ha projeto algum a que ela pudesse se dirigir.
      expect(provider.calls).toEqual([]);
      expect(provider.projects).toEqual([]);
    });

    /**
     * O que o cliente nao pode ler: um alvo de DNS. A plataforma nao sabe para
     * onde o endereco deve apontar, e inventar um mandaria o cliente apontar o
     * dominio dele para um lugar que nao serve o site.
     */
    it('nao inventa instrucao de DNS', async () => {
      const criado = await account.client.post(base(), { domain: HOST });
      expect(criado.body.dns).toBeNull();

      const lista = await account.client.get(base());
      expect(lista.body.domains[0].dns).toBeNull();
    });

    it('nao afirma nada que nao pode saber: propriedade, DNS e HTTPS ficam falsos', async () => {
      const response = await account.client.post(base(), { domain: HOST });
      const dominio = response.body.domain;

      expect(dominio.ownershipVerified).toBe(false);
      expect(dominio.dnsConfigured).toBe(false);
      expect(dominio.sslStatus).toBe('pending');
      expect(dominio.verifiedAt).toBeNull();
      expect(dominio.status).not.toBe('active');
    });

    it('diz com todas as letras que a hospedagem e externa', async () => {
      const response = await account.client.post(base(), { domain: HOST });
      expect(response.body.message).toMatch(/não é hospedado pela plataforma/i);
      expect(response.body.message).toMatch(/não verifica nem configura o DNS/i);
    });

    it('a listagem informa o motivo, para a tela explicar', async () => {
      const lista = await account.client.get(base());
      expect(lista.body.hosting).toEqual({ managed: false, reason: 'plan_without_hosting' });
    });

    it('recusa verificar: nao ha o que verificar', async () => {
      const criado = await account.client.post(base(), { domain: HOST });
      const response = await account.client.post(`${base()}/${criado.body.domain.id}/verify`);

      expect(response.status).toBe(400);
      expect(response.errorMessage).toMatch(/não verifica nem configura/i);
      expect(provider.calls).toEqual([]);
    });

    it('desvincular tambem nao toca na Vercel', async () => {
      const criado = await account.client.post(base(), { domain: HOST });
      const response = await account.client.delete(`${base()}/${criado.body.domain.id}`);

      expect(response.status).toBe(204);
      expect(provider.calls).toEqual([]);
    });

    /** Os limites do plano e a unicidade valem igual: so o provedor some. */
    it('continua recusando dominio de outra empresa e o limite do plano', async () => {
      await account.client.post(base(), { domain: HOST });

      const outra = await registerAccount(api, {
        email: 'dono@beta.com.br',
        companyName: 'Construtora Beta',
      });
      await verifyEmail(api, outra);
      const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'profissional'));
      await api.db.update(schema.tenants).set({ planId: plano!.id }).where(eq(schema.tenants.id, outra.tenantId));

      const roubo = await outra.client.post(`/api/tenants/${outra.tenantId}/domains`, { domain: HOST });
      expect(roubo.status).toBe(409);

      const excedente = await account.client.post(base(), { domain: 'www.outro-endereco.com.br' });
      expect(excedente.status).toBe(402);
    });
  });

  describe('plano com hospedagem, mas sem projeto configurado', () => {
    it('tambem so registra: sem projeto a plataforma nao sabe onde anexar', async () => {
      await usePlan('empresas');

      const response = await account.client.post(base(), { domain: HOST });
      expect(response.status, response.errorMessage ?? '').toBe(201);
      expect(response.body.domain.status).toBe('registered');
      expect(provider.calls).toEqual([]);

      const lista = await account.client.get(base());
      expect(lista.body.hosting).toEqual({ managed: false, reason: 'no_hosting_project' });
    });
  });

  describe('plano com hospedagem e projeto configurado: a plataforma gerencia', () => {
    it('anexa o dominio ao projeto DO SITE', async () => {
      await useHostedSite();

      const response = await account.client.post(base(), { domain: HOST });
      expect(response.status, response.errorMessage ?? '').toBe(201);

      expect(provider.calls).toEqual([`add:${HOST}`]);
      expect(provider.projects).toEqual([PROJETO_DO_SITE]);
      expect(response.body.dns).not.toBeNull();
    });

    it('a listagem diz que e gerenciado', async () => {
      await useHostedSite();
      const lista = await account.client.get(base());
      expect(lista.body.hosting).toEqual({ managed: true, reason: null });
    });

    it('dois sites de empresas diferentes usam projetos diferentes', async () => {
      await useHostedSite('prj_site_alpha');

      const outra = await registerAccount(api, {
        email: 'dono@beta.com.br',
        companyName: 'Construtora Beta',
      });
      await verifyEmail(api, outra);
      const [empresas] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'empresas'));
      await api.db.update(schema.tenants).set({ planId: empresas!.id }).where(eq(schema.tenants.id, outra.tenantId));
      await api.db
        .update(schema.sites)
        .set({ hostingProjectId: 'prj_site_beta' })
        .where(eq(schema.sites.id, outra.siteId));

      await account.client.post(base(), { domain: 'www.alpha.com.br' });
      await outra.client.post(`/api/tenants/${outra.tenantId}/domains`, { domain: 'www.beta.com.br' });

      // Cada dominio foi ao projeto do proprio site, na ordem: nenhum caiu no
      // projeto do vizinho.
      expect(provider.projects).toEqual(['prj_site_alpha', 'prj_site_beta']);
    });

    /**
     * Um dominio registrado antes de a hospedagem existir precisa ser
     * **anexado**, nao verificado: a Vercel responde 404 a um `verify` de
     * dominio que o projeto nao conhece.
     */
    it('anexa, em vez de verificar, o dominio registrado antes da hospedagem', async () => {
      const criado = await account.client.post(base(), { domain: HOST });
      expect(criado.body.domain.status).toBe('registered');
      expect(provider.calls).toEqual([]);

      // A CODECA IA configura a hospedagem depois.
      await useHostedSite();

      const primeira = await account.client.post(`${base()}/${criado.body.domain.id}/verify`);
      expect(primeira.status, primeira.errorMessage ?? '').toBe(200);
      expect(provider.calls).toEqual([`add:${HOST}`]);
      expect(primeira.body.domain.status).not.toBe('registered');

      // Ja esta no projeto: as proximas verificam.
      await account.client.post(`${base()}/${criado.body.domain.id}/verify`);
      expect(provider.calls).toEqual([`add:${HOST}`, `verify:${HOST}`]);
      expect(new Set(provider.projects)).toEqual(new Set([PROJETO_DO_SITE]));
    });
  });

  describe('downgrade depois de gerenciado', () => {
    it('o dominio continua removivel pelo projeto do site, mesmo sem o recurso no plano', async () => {
      await useHostedSite();
      const criado = await account.client.post(base(), { domain: HOST });
      expect(provider.projects).toEqual([PROJETO_DO_SITE]);

      // Rebaixado: o plano deixa de incluir hospedagem.
      await usePlan('profissional');
      const lista = await account.client.get(base());
      expect(lista.body.hosting.managed).toBe(false);

      // Remover usa o projeto do SITE, e nao o plano atual: senao o dominio
      // ficaria preso a um projeto que a plataforma deixou de enxergar.
      const response = await account.client.delete(`${base()}/${criado.body.domain.id}`);
      expect(response.status).toBe(204);
      expect(provider.calls).toContain(`remove:${HOST}`);
      expect(provider.projects.at(-1)).toBe(PROJETO_DO_SITE);
    });

    it('recusa verificar depois do downgrade, em vez de fingir que verificou', async () => {
      await useHostedSite();
      const criado = await account.client.post(base(), { domain: HOST });
      await usePlan('profissional');

      const response = await account.client.post(`${base()}/${criado.body.domain.id}/verify`);
      expect(response.status).toBe(400);
    });
  });
});
