import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { DEFAULT_SITE_COOKIE_SETTINGS } from '@codeca/shared';
import {
  createTestApi,
  registerAccount,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Cookies e consentimento: o lado da plataforma.
 *
 * Tres criterios organizam estes testes:
 *
 * 1. A CODECA nao se apresenta como controladora dos dados dos visitantes dos
 *    sites dos clientes. Site sem configuracao nao afirma controlador nenhum.
 * 2. Nada e classificado por conveniencia: a lista de ferramentas nasce vazia e
 *    cada categoria e declarada a mao.
 * 3. O registro da escolha nao identifica ninguem, e nenhuma empresa recebe a
 *    escolha feita no site de outra.
 */

const ORIGEM = 'https://clinica-exemplo.com.br';
const OUTRA_ORIGEM = 'https://loja-vizinha.com.br';

let api: TestApi;
let admin: RegisteredAccount;
let clinica: RegisteredAccount;
let agora: Date;

beforeAll(async () => {
  agora = new Date('2026-05-10T09:00:00Z');
  api = await createTestApi({ now: () => agora });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  agora = new Date('2026-05-10T09:00:00Z');
  await api.reset();
  admin = await registerAccount(api, { email: 'admin@codeca.test', companyName: 'Plataforma' });
  await api.db
    .update(schema.users)
    .set({ platformRole: 'platform_admin' })
    .where(eq(schema.users.id, admin.userId));

  clinica = await registerAccount(api, {
    email: 'contato@clinica.com.br',
    companyName: 'Clinica Exemplo',
  });
});

async function autorizarOrigem(siteId: string, origin: string) {
  const r = await admin.client.put(`/api/platform/sites/${siteId}/origins`, {
    origins: [{ origin, note: 'site do cliente' }],
  });
  expect(r.status, r.errorMessage ?? '').toBe(200);
}

async function configurar(siteId: string, mudanca: Record<string, unknown> = {}) {
  const r = await admin.client.put(`/api/platform/sites/${siteId}/cookies`, {
    ...DEFAULT_SITE_COOKIE_SETTINGS,
    controllerName: 'Clinica Exemplo Ltda.',
    ...mudanca,
  });
  expect(r.status, r.errorMessage ?? '').toBe(200);
  return r;
}

function registro(mudanca: Record<string, unknown> = {}) {
  return {
    id: 'b8c2f1a4-0000-4000-8000-000000000001',
    decidedAt: '2026-05-10T08:59:00.000Z',
    domain: 'clinica-exemplo.com.br',
    granted: ['necessarios', 'estatisticas'],
    denied: ['preferencias', 'marketing'],
    policyVersion: '1',
    engineVersion: '1',
    ...mudanca,
  };
}

/** Envia o registro como o navegador do visitante faria. */
function relatar(corpo: unknown, origin: string | null = ORIGEM) {
  return api.client().post('/api/v1/consent', corpo, { origin });
}

async function registrosDe(siteId: string) {
  return api.db
    .select()
    .from(schema.siteConsentRecords)
    .where(eq(schema.siteConsentRecords.siteId, siteId));
}

describe('configuracao por site', () => {
  it('site sem configuracao nao afirma controlador nenhum', async () => {
    const r = await admin.client.get(`/api/platform/sites/${clinica.siteId}/cookies`);

    expect(r.status, r.errorMessage ?? '').toBe(200);
    expect(r.body.settings.controllerName).toBe('');
    // Nada classificado por conveniencia: a lista comeca vazia.
    expect(r.body.settings.tools).toEqual([]);
    expect(r.body.summary.total).toBe(0);
  });

  it('guarda o controlador e as ferramentas declaradas', async () => {
    await configurar(clinica.siteId, {
      controllerDocument: '12.345.678/0001-90',
      controllerContact: 'privacidade@clinica.com.br',
      cookiePolicyUrl: 'https://clinica-exemplo.com.br/cookies',
      policyVersion: '2',
      tools: [
        {
          key: 'google-analytics',
          name: 'Google Analytics 4',
          provider: 'Google LLC',
          category: 'estatisticas',
          purpose: 'Medir visitas por pagina.',
          cookies: ['_ga', '_ga_*'],
          privacyUrl: 'https://policies.google.com/privacy',
        },
      ],
    });

    const r = await admin.client.get(`/api/platform/sites/${clinica.siteId}/cookies`);
    expect(r.body.settings.controllerName).toBe('Clinica Exemplo Ltda.');
    expect(r.body.settings.policyVersion).toBe('2');
    expect(r.body.settings.tools).toHaveLength(1);
    expect(r.body.settings.tools[0].category).toBe('estatisticas');
    expect(r.body.settings.tools[0].cookies).toEqual(['_ga', '_ga_*']);
  });

  it('recusa duas ferramentas com o mesmo identificador', async () => {
    const ferramenta = {
      key: 'google-analytics',
      name: 'Google Analytics',
      provider: '',
      category: 'estatisticas',
      purpose: '',
      cookies: [],
      privacyUrl: '',
    };
    const r = await admin.client.put(`/api/platform/sites/${clinica.siteId}/cookies`, {
      ...DEFAULT_SITE_COOKIE_SETTINGS,
      tools: [ferramenta, { ...ferramenta, name: 'Outro nome' }],
    });

    expect(r.status).toBe(400);
    expect(r.errorMessage).toContain('google-analytics');
  });

  it('a configuracao de um site nao vaza para o site de outra empresa', async () => {
    const loja = await registerAccount(api, {
      email: 'contato@loja.com.br',
      companyName: 'Loja Vizinha',
    });
    await configurar(clinica.siteId);

    const r = await admin.client.get(`/api/platform/sites/${loja.siteId}/cookies`);
    expect(r.body.settings.controllerName).toBe('');
  });

  it('o site le a propria configuracao com a chave publicavel, sem o que nao e dele', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId, { policyVersion: '3' });

    const chave = await admin.client.post(`/api/platform/sites/${clinica.siteId}/keys`, {
      kind: 'publishable',
      name: 'site',
    });
    const token = chave.body.key.token as string;

    const r = await api.client().get('/api/v1/consent/settings', {
      origin: ORIGEM,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(r.status, r.errorMessage ?? '').toBe(200);
    expect(r.body.controllerName).toBe('Clinica Exemplo Ltda.');
    expect(r.body.policyVersion).toBe('3');
    // Decisao entre o cliente e a CODECA, nao informacao do visitante.
    expect(r.body).not.toHaveProperty('recordConsent');
  });
});

describe('registro da escolha', () => {
  it('grava a escolha do visitante do site cadastrado', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId);

    const r = await relatar(registro());
    expect(r.status).toBe(204);

    const linhas = await registrosDe(clinica.siteId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.granted).toEqual(['necessarios', 'estatisticas']);
    expect(linhas[0]!.denied).toEqual(['preferencias', 'marketing']);
    expect(linhas[0]!.policyVersion).toBe('1');
  });

  it('nao guarda IP, agente de navegador nem identificador de visitante', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId);
    await relatar(registro());

    const [linha] = await registrosDe(clinica.siteId);
    const colunas = Object.keys(linha!);
    expect(colunas).not.toContain('ip');
    expect(colunas).not.toContain('ipHash');
    expect(colunas).not.toContain('userAgent');
    expect(colunas).not.toContain('visitorId');
    // O que existe e so o que serve a prova do consentimento.
    expect(colunas.sort()).toEqual(
      [
        'consentId',
        'createdAt',
        'decidedAt',
        'denied',
        'domain',
        'engineVersion',
        'granted',
        'id',
        'policyVersion',
        'siteId',
        'tenantId',
      ].sort(),
    );
  });

  it('origem fora do cadastro responde 204 e nao grava nada', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId);

    const r = await relatar(registro(), 'https://site-de-terceiro.com.br');
    // 204 e nao 403: dizer "nao conheco este endereco" diria a quem tenta
    // quais enderecos existem.
    expect(r.status).toBe(204);
    expect(await registrosDe(clinica.siteId)).toHaveLength(0);
  });

  it('o corpo nao decide de que site a escolha e', async () => {
    const loja = await registerAccount(api, {
      email: 'contato@loja.com.br',
      companyName: 'Loja Vizinha',
    });
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await autorizarOrigem(loja.siteId, OUTRA_ORIGEM);
    await configurar(clinica.siteId);
    await configurar(loja.siteId);

    // Visitante da clinica mentindo o dominio no corpo.
    await relatar(registro({ domain: 'loja-vizinha.com.br' }), ORIGEM);

    expect(await registrosDe(loja.siteId)).toHaveLength(0);
    const [linha] = await registrosDe(clinica.siteId);
    // `domain` vem da origem conferida no servidor.
    expect(linha!.domain).toBe('clinica-exemplo.com.br');
  });

  it('reenvio da mesma decisao nao vira duas linhas', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId);

    await relatar(registro());
    await relatar(registro());

    expect(await registrosDe(clinica.siteId)).toHaveLength(1);
  });

  it('relogio adiantado do navegador nao grava decisao no futuro', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId);

    await relatar(registro({ decidedAt: '2030-01-01T00:00:00.000Z' }));

    const [linha] = await registrosDe(clinica.siteId);
    expect(linha!.decidedAt.getTime()).toBe(agora.getTime());
  });

  it('cliente que desliga o registro nao tem escolha guardada aqui', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId, { recordConsent: false });

    const r = await relatar(registro());
    expect(r.status).toBe(204);
    expect(await registrosDe(clinica.siteId)).toHaveLength(0);
  });

  it('corpo fora do contrato e recusado', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId);

    const r = await relatar(registro({ granted: ['inventada'] }));
    // 422 e o erro de validacao da plataforma, nao 400.
    expect(r.status).toBe(422);
    expect(await registrosDe(clinica.siteId)).toHaveLength(0);
  });

  it('as contagens do painel somam por categoria autorizada', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId);

    await relatar(registro({ id: 'aaaaaaaa-0000-4000-8000-000000000001' }));
    await relatar(
      registro({
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        granted: ['necessarios'],
        denied: ['preferencias', 'estatisticas', 'marketing'],
      }),
    );
    await relatar(
      registro({
        id: 'aaaaaaaa-0000-4000-8000-000000000003',
        granted: ['necessarios', 'preferencias', 'estatisticas', 'marketing'],
        denied: [],
      }),
    );

    const r = await admin.client.get(`/api/platform/sites/${clinica.siteId}/cookies`);
    expect(r.body.summary.total).toBe(3);
    expect(r.body.summary.granted.necessarios).toBe(3);
    expect(r.body.summary.granted.estatisticas).toBe(2);
    expect(r.body.summary.granted.preferencias).toBe(1);
    expect(r.body.summary.granted.marketing).toBe(1);
  });

  it('a lista de registros do painel nao mostra nada de visitante', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId);
    await relatar(registro());

    const r = await admin.client.get(`/api/platform/sites/${clinica.siteId}/cookies/records`);
    expect(r.status, r.errorMessage ?? '').toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(Object.keys(r.body.items[0]).sort()).toEqual(
      [
        'consentId',
        'decidedAt',
        'denied',
        'domain',
        'engineVersion',
        'granted',
        'policyVersion',
        'receivedAt',
      ].sort(),
    );
  });
});

describe('a escolha acompanha os direitos da empresa', () => {
  it('a exportacao leva a configuracao e as escolhas registradas', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId);
    await relatar(registro());

    const r = await clinica.client.get(`/api/tenants/${clinica.tenantId}/dados`);
    expect(r.status, r.errorMessage ?? '').toBe(200);

    expect(r.body.consentimento.configuracao.controllerName).toBe('Clinica Exemplo Ltda.');
    expect(r.body.consentimento.escolhas).toHaveLength(1);
    // O que sai e o mesmo que entrou: nada de visitante foi acrescentado.
    expect(Object.keys(r.body.consentimento.escolhas[0]).sort()).toEqual(
      [
        'consentId',
        'decidedAt',
        'denied',
        'domain',
        'engineVersion',
        'granted',
        'policyVersion',
        'recebidoEm',
      ].sort(),
    );
  });

  it('apagar a empresa apaga as escolhas registradas dos sites dela', async () => {
    await autorizarOrigem(clinica.siteId, ORIGEM);
    await configurar(clinica.siteId);
    await relatar(registro());
    expect(await registrosDe(clinica.siteId)).toHaveLength(1);

    const r = await clinica.client.delete(`/api/tenants/${clinica.tenantId}`, {
      confirmacao: 'Clinica Exemplo',
      password: clinica.password,
    });
    expect(r.status, r.errorMessage ?? '').toBe(200);

    expect(await registrosDe(clinica.siteId)).toHaveLength(0);
    const config = await api.db
      .select()
      .from(schema.siteCookieSettings)
      .where(eq(schema.siteCookieSettings.siteId, clinica.siteId));
    expect(config).toHaveLength(0);
  });
});
