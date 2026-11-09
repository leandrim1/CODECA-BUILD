import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { createTestApi, registerAccount, type RegisteredAccount, type TestApi } from '../helpers/api.js';

/**
 * "O envio de e-mail funciona?" no painel mestre.
 *
 * Por que isto existe: recuperacao de senha, convite de usuario e codigo de
 * acesso dependem todos do mesmo caminho, e nada no produto avisa sozinho
 * quando ele para. Os dois motivos reais de "o e-mail nao chega" sao chave
 * recusada e dominio do remetente nao verificado -- e os dois so aparecem
 * perguntando ao provedor.
 *
 * O que estes testes garantem, alem do caminho feliz:
 * - a chave NUNCA aparece na resposta;
 * - o teste de envio vai somente para o e-mail de quem pediu, nunca para um
 *   destinatario escolhido na requisicao;
 * - quem nao e administrador da plataforma nao ve nada disso.
 */

/** Resposta do provedor no lugar da rede. */
function providerStub(options: {
  status?: number;
  domains?: Array<{ name: string; status: string }>;
}): { fetch: typeof globalThis.fetch; calls: Array<{ url: string; authorization: string | null }> } {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers ?? {});
    calls.push({ url, authorization: headers.get('authorization') });
    const status = options.status ?? 200;
    if (status !== 200) return new Response('{"message":"invalid api key"}', { status });
    return new Response(JSON.stringify({ data: options.domains ?? [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const CHAVE = 'chave-secreta-de-teste-nunca-exposta';

async function adminDe(api: TestApi): Promise<RegisteredAccount> {
  const conta = await registerAccount(api, { email: 'admin@codeca.test', companyName: 'Plataforma' });
  await api.db
    .update(schema.users)
    .set({ platformRole: 'platform_admin' })
    .where(eq(schema.users.id, conta.userId));
  return conta;
}

describe('sem provedor configurado', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await createTestApi();
  });
  afterAll(async () => {
    await api.close();
  });
  beforeEach(async () => {
    await api.reset();
  });

  it('diz que nao esta configurado e explica o que falta, sem chamar o provedor', async () => {
    const admin = await adminDe(api);
    const response = await admin.client.get('/api/platform/email-status');

    expect(response.status).toBe(200);
    expect(response.body.configured).toBe(false);
    expect(response.body.probe).toBeNull();
    expect(response.body.senderVerified).toBeNull();
    expect(response.body.hint).toMatch(/RESEND_API_KEY/);
  });

  it('o teste de envio recusa em vez de fingir que enviou', async () => {
    const admin = await adminDe(api);
    const response = await admin.client.post('/api/platform/email-test');
    expect(response.status).toBe(501);
    expect(response.errorCode).toBe('integration_not_configured');
  });
});

describe('com provedor configurado', () => {
  let api: TestApi;
  let provider: ReturnType<typeof providerStub>;

  beforeAll(async () => {
    provider = providerStub({ domains: [{ name: 'codecabuild.com', status: 'verified' }] });
    api = await createTestApi({
      fetch: provider.fetch,
      env: { RESEND_API_KEY: CHAVE, MAIL_FROM: 'CODECA Build <nao-responda@codecabuild.com>' },
    });
  });
  afterAll(async () => {
    await api.close();
  });
  beforeEach(async () => {
    await api.reset();
    provider.calls.length = 0;
  });

  it('pergunta ao provedor e confirma o dominio do remetente', async () => {
    const admin = await adminDe(api);
    const response = await admin.client.get('/api/platform/email-status');

    expect(response.status).toBe(200);
    expect(response.body.configured).toBe(true);
    expect(response.body.probe.ok).toBe(true);
    expect(response.body.senderDomain).toBe('codecabuild.com');
    expect(response.body.senderVerified).toBe(true);
    expect(response.body.hint).toBeNull();

    // Foi uma leitura no provedor, nao um envio.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.url).toBe('https://api.resend.com/domains');
  });

  it('a chave nao aparece em lugar nenhum da resposta', async () => {
    const admin = await adminDe(api);
    const response = await admin.client.get('/api/platform/email-status');
    expect(JSON.stringify(response.body)).not.toContain(CHAVE);
    // Ela vai para o provedor, e so para ele.
    expect(provider.calls[0]!.authorization).toBe(`Bearer ${CHAVE}`);
  });

  it('o teste de envio vai para o e-mail de quem pediu, e nao para um destino escolhido na requisicao', async () => {
    const admin = await adminDe(api);
    const response = await admin.client.post('/api/platform/email-test', { to: 'vitima@terceiro.com.br' });

    expect(response.status).toBe(200);
    expect(response.body.delivered).toBe(true);
    expect(response.body.to).toBe('admin@codeca.test');
    // O corpo pediu outro destinatario; a plataforma ignorou.
    expect(api.outbox.map((m) => m.to)).not.toContain('vitima@terceiro.com.br');
    expect(api.outbox.some((m) => m.to === 'admin@codeca.test')).toBe(true);

    const registros = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'platform.email_tested'));
    expect(registros).toHaveLength(1);
  });

  it('quem nao e administrador da plataforma nao ve o diagnostico nem dispara o teste', async () => {
    await adminDe(api);
    const cliente = await registerAccount(api, { email: 'cliente@empresa.com.br', companyName: 'Empresa' });

    expect((await cliente.client.get('/api/platform/email-status')).status).toBe(403);
    expect((await cliente.client.post('/api/platform/email-test')).status).toBe(403);
    expect((await api.client().get('/api/platform/email-status')).status).toBe(401);
  });
});

describe('provedor que recusa a chave, e dominio sem verificacao', () => {
  it('chave recusada aparece como recusa, com o motivo legivel', async () => {
    const provider = providerStub({ status: 401 });
    const api = await createTestApi({ fetch: provider.fetch, env: { RESEND_API_KEY: CHAVE } });
    try {
      const admin = await adminDe(api);
      const response = await admin.client.get('/api/platform/email-status');
      expect(response.body.probe.ok).toBe(false);
      expect(response.body.probe.reason).toMatch(/recusou a chave/);
      expect(JSON.stringify(response.body)).not.toContain(CHAVE);
    } finally {
      await api.close();
    }
  });

  it('dominio do remetente ainda nao verificado e sinalizado, mesmo com a chave valida', async () => {
    const provider = providerStub({ domains: [{ name: 'codecabuild.com', status: 'pending' }] });
    const api = await createTestApi({
      fetch: provider.fetch,
      env: { RESEND_API_KEY: CHAVE, MAIL_FROM: 'CODECA Build <nao-responda@codecabuild.com>' },
    });
    try {
      const admin = await adminDe(api);
      const response = await admin.client.get('/api/platform/email-status');
      expect(response.body.probe.ok).toBe(true);
      // Chave boa e envio recusado na mesma resposta: e exatamente o caso que
      // "a chave esta configurada" nao consegue distinguir.
      expect(response.body.senderVerified).toBe(false);
      expect(response.body.hint).toMatch(/não está verificado/);
    } finally {
      await api.close();
    }
  });

  it('remetente de dominio que nem esta na conta do provedor tambem e sinalizado', async () => {
    const provider = providerStub({ domains: [{ name: 'outro-dominio.com', status: 'verified' }] });
    const api = await createTestApi({
      fetch: provider.fetch,
      env: { RESEND_API_KEY: CHAVE, MAIL_FROM: 'CODECA Build <nao-responda@codecabuild.com>' },
    });
    try {
      const admin = await adminDe(api);
      const response = await admin.client.get('/api/platform/email-status');
      expect(response.body.senderVerified).toBe(false);
    } finally {
      await api.close();
    }
  });
});
