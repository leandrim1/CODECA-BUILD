import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import type { DomainProvider, DomainProviderStatus } from '@codeca/api';
import {
  TEST_JOB_SECRET,
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Reverificacao periodica dos dominios, dentro do job diario.
 *
 * O que se quer garantir: o painel nao diz "Ativo" por causa de uma checagem de
 * semanas atras, e uma falha da Vercel ou da nossa configuracao nunca rebaixa
 * um dominio que esta no ar.
 */

let api: TestApi;
let account: RegisteredAccount;

const OK: DomainProviderStatus = {
  ownershipVerified: true,
  dnsConfigured: true,
  sslActive: true,
  challenges: [],
  message: 'Domínio verificado.',
  providerDomainId: 'dom_1',
};
const DNS_QUEBRADO: DomainProviderStatus = {
  ...OK,
  dnsConfigured: false,
  message: 'O DNS deixou de apontar para a plataforma.',
};

function fakeProvider(configured = true) {
  const respostas = new Map<string, DomainProviderStatus | Error>();
  const chamadas: string[] = [];
  const provider: DomainProvider & { respostas: typeof respostas; chamadas: string[] } = {
    configured,
    respostas,
    chamadas,
    async add(_p, hostname) {
      chamadas.push(`add:${hostname}`);
      return resposta(hostname);
    },
    async status(_p, hostname) {
      chamadas.push(`status:${hostname}`);
      return resposta(hostname);
    },
    async verify(_p, hostname) {
      chamadas.push(`verify:${hostname}`);
      return resposta(hostname);
    },
    async remove() {},
  };
  function resposta(hostname: string): DomainProviderStatus {
    const valor = respostas.get(hostname) ?? OK;
    if (valor instanceof Error) throw valor;
    return valor;
  }
  return provider;
}

let provider: ReturnType<typeof fakeProvider>;

async function iniciar(domains: ReturnType<typeof fakeProvider>) {
  provider = domains;
  api = await createTestApi({ domains });
}

afterAll(async () => {
  await api?.close();
});

async function prepararEmpresa(hospedagem: boolean) {
  await api.reset();
  provider.respostas.clear();
  provider.chamadas.length = 0;
  account = await registerAccount(api, { email: 'dono@alpha.com.br', companyName: 'Construtora Alpha' });
  await verifyEmail(api, account);
  const [plano] = await api.db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.code, hospedagem ? 'empresas' : 'profissional'));
  await api.db.update(schema.tenants).set({ planId: plano!.id }).where(eq(schema.tenants.id, account.tenantId));
  if (hospedagem) {
    await api.db
      .update(schema.sites)
      .set({ hostingProjectId: 'prj_site_alpha' })
      .where(eq(schema.sites.id, account.siteId));
  }
}

async function cadastrar(hostname: string) {
  const response = await account.client.post(`/api/tenants/${account.tenantId}/domains`, { domain: hostname });
  expect(response.status, response.errorMessage ?? '').toBe(201);
  return response.body.domain.id as string;
}

async function dominio(id: string) {
  const [linha] = await api.db.select().from(schema.domains).where(eq(schema.domains.id, id));
  return linha!;
}

async function rodarJob() {
  const response = await api.app.request('http://app.localhost:5173/api/billing/reconcile', {
    method: 'GET',
    headers: { authorization: `Bearer ${TEST_JOB_SECRET}` },
  });
  expect(response.status).toBe(200);
  const json = (await response.json()) as {
    data: {
      domains: {
        providerConfigured: boolean;
        checked: number;
        unchanged: number;
        becameActive: Array<{ hostname: string }>;
        lostActive: Array<{ hostname: string; status: string }>;
        skippedExternal: number;
        failures: Array<{ hostname: string; error: string }>;
      };
    };
  };
  return json.data.domains;
}

async function auditorias(action: string) {
  return api.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, action));
}

describe('com a Vercel configurada', () => {
  beforeAll(async () => {
    await iniciar(fakeProvider(true));
  });

  describe('dominio gerenciado', () => {
    beforeEach(() => prepararEmpresa(true));

    it('promove a ativo o dominio cujo DNS ja foi ajustado, sem o cliente voltar ao painel', async () => {
      provider.respostas.set('www.alpha.com.br', {
        ...OK,
        ownershipVerified: false,
        dnsConfigured: false,
        challenges: [{ type: 'TXT', domain: '_vercel.alpha.com.br', value: 'x', reason: 'pending' }],
      });
      const id = await cadastrar('www.alpha.com.br');
      expect((await dominio(id)).status).toBe('verifying_ownership');

      provider.respostas.set('www.alpha.com.br', OK);
      const relatorio = await rodarJob();

      expect(relatorio.becameActive).toEqual([{ hostname: 'www.alpha.com.br' }]);
      const depois = await dominio(id);
      expect(depois.status).toBe('active');
      expect(depois.verifiedAt).not.toBeNull();
      expect(depois.sslStatus).toBe('active');
      expect(await auditorias('domain.verified')).toHaveLength(1);
    });

    it('rebaixa o dominio ativo cujo DNS deixou de apontar, com o motivo, e deixa na auditoria', async () => {
      provider.respostas.set('www.alpha.com.br', OK);
      const id = await cadastrar('www.alpha.com.br');
      expect((await dominio(id)).status).toBe('active');

      provider.respostas.set('www.alpha.com.br', DNS_QUEBRADO);
      const relatorio = await rodarJob();

      expect(relatorio.lostActive).toEqual([{ hostname: 'www.alpha.com.br', status: 'misconfigured' }]);
      const depois = await dominio(id);
      expect(depois.status).toBe('misconfigured');
      expect(depois.lastError).toBe('O DNS deixou de apontar para a plataforma.');
      expect(depois.verifiedAt).toBeNull();

      const [registro] = await auditorias('domain.verification_lost');
      expect(registro?.tenantId).toBe(account.tenantId);
      expect(registro?.metadata).toMatchObject({ hostname: 'www.alpha.com.br', source: 'recheck' });
    });

    it('um dominio que continua certo nao gera ruido na auditoria', async () => {
      provider.respostas.set('www.alpha.com.br', OK);
      await cadastrar('www.alpha.com.br');
      const antes = await auditorias('domain.verified');

      const relatorio = await rodarJob();

      expect(relatorio.unchanged).toBe(1);
      expect(relatorio.becameActive).toEqual([]);
      expect(relatorio.lostActive).toEqual([]);
      expect(await auditorias('domain.verified')).toHaveLength(antes.length);
      expect(await auditorias('domain.verification_lost')).toHaveLength(0);
    });

    it('falha da Vercel nao rebaixa o dominio no ar; so registra que tentou', async () => {
      provider.respostas.set('www.alpha.com.br', OK);
      const id = await cadastrar('www.alpha.com.br');
      const antes = await dominio(id);

      provider.respostas.set('www.alpha.com.br', new Error('Vercel indisponivel (503)'));
      const relatorio = await rodarJob();

      expect(relatorio.failures).toEqual([{ hostname: 'www.alpha.com.br', error: 'Vercel indisponivel (503)' }]);
      expect(relatorio.lostActive).toEqual([]);
      const depois = await dominio(id);
      expect(depois.status).toBe('active');
      expect(depois.lastError).toBe('');
      expect(depois.lastCheckedAt!.getTime()).toBeGreaterThanOrEqual(antes.lastCheckedAt!.getTime());
    });

    it('um dominio que sempre falha nao tira a vez dos outros', async () => {
      // Cadastra os dois com resposta boa e so entao estraga um.
      provider.respostas.set('quebrado.alpha.com.br', OK);
      const quebrado = await cadastrar('quebrado.alpha.com.br');
      await cadastrar('bom.alpha.com.br');
      provider.respostas.set('quebrado.alpha.com.br', new Error('falha permanente'));
      // O que falha comeca como o mais antigo da fila.
      await api.db
        .update(schema.domains)
        .set({ lastCheckedAt: new Date('2020-01-01T00:00:00Z') })
        .where(eq(schema.domains.id, quebrado));

      const primeira = await rodarJob();
      expect(primeira.failures).toHaveLength(1);
      // A falha ja foi anotada em `lastCheckedAt`: nao fica parado na frente.
      expect((await dominio(quebrado)).lastCheckedAt!.getFullYear()).toBeGreaterThan(2020);
      provider.chamadas.length = 0;
      await rodarJob();

      expect(provider.chamadas.sort()).toEqual(['verify:bom.alpha.com.br', 'verify:quebrado.alpha.com.br']);
    });

    it('respeita o limite por execucao, comecando pelo verificado ha mais tempo', async () => {
      provider.respostas.set('a.alpha.com.br', OK);
      provider.respostas.set('b.alpha.com.br', OK);
      const a = await cadastrar('a.alpha.com.br');
      const b = await cadastrar('b.alpha.com.br');
      await api.db
        .update(schema.domains)
        .set({ lastCheckedAt: new Date('2020-01-01T00:00:00Z') })
        .where(eq(schema.domains.id, b));
      provider.chamadas.length = 0;

      const response = await api.app.request('http://app.localhost:5173/api/billing/reconcile?limit=1', {
        method: 'GET',
        headers: { authorization: `Bearer ${TEST_JOB_SECRET}` },
      });
      expect(response.status).toBe(200);

      expect(provider.chamadas).toEqual(['verify:b.alpha.com.br']);
      expect((await dominio(a)).lastCheckedAt!.getFullYear()).toBeGreaterThan(2020);
    });
  });

  describe('dominio em modo registro', () => {
    beforeEach(() => prepararEmpresa(false));

    it('nunca consulta a Vercel nem muda o estado', async () => {
      const id = await cadastrar('www.alpha.com.br');
      expect((await dominio(id)).status).toBe('registered');
      provider.chamadas.length = 0;

      const relatorio = await rodarJob();

      expect(provider.chamadas).toEqual([]);
      expect(relatorio.checked).toBe(0);
      expect((await dominio(id)).status).toBe('registered');
    });
  });

  describe('estados que nao entram na fila', () => {
    beforeEach(() => prepararEmpresa(true));

    it('ignora dominio desvinculado', async () => {
      provider.respostas.set('www.alpha.com.br', OK);
      const id = await cadastrar('www.alpha.com.br');
      await api.db.update(schema.domains).set({ status: 'unlinked' }).where(eq(schema.domains.id, id));
      provider.chamadas.length = 0;

      const relatorio = await rodarJob();

      expect(provider.chamadas).toEqual([]);
      expect(relatorio.checked).toBe(0);
    });
  });
});

describe('sem a integracao com a Vercel', () => {
  beforeAll(async () => {
    await api?.close();
    await iniciar(fakeProvider(false));
  });

  beforeEach(() => prepararEmpresa(true));

  it('nao consulta nada e nao rebaixa dominio ativo por falta de configuracao nossa', async () => {
    const id = await cadastrar('www.alpha.com.br');
    await api.db
      .update(schema.domains)
      .set({ status: 'active', ownershipVerified: true, dnsConfigured: true })
      .where(eq(schema.domains.id, id));
    provider.chamadas.length = 0;

    const relatorio = await rodarJob();

    expect(relatorio.providerConfigured).toBe(false);
    expect(relatorio.checked).toBe(0);
    expect(provider.chamadas).toEqual([]);
    expect((await dominio(id)).status).toBe('active');
  });
});
