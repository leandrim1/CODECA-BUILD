import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { parseApiKey } from '@codeca/shared';
import {
  createTestApi,
  registerAccount,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Credenciais de integracao dos sites.
 *
 * O criterio que organiza estes testes: uma chave publicavel vazada nao pode
 * dar acesso a nada que ja nao fosse publico, e uma chave secreta nunca pode
 * ser lida de volta -- nem pelo painel, nem do banco.
 */

const ORIGEM = 'https://construtora-horizonte.com.br';
const OUTRA_ORIGEM = 'https://concorrente.com.br';

let api: TestApi;
let admin: RegisteredAccount;
let empresa: RegisteredAccount;
let agora: Date;

beforeAll(async () => {
  agora = new Date('2026-03-01T12:00:00Z');
  api = await createTestApi({ now: () => agora });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  agora = new Date('2026-03-01T12:00:00Z');
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

async function criarChave(siteId: string, kind: 'publishable' | 'secret'): Promise<string> {
  const response = await admin.client.post(`/api/platform/sites/${siteId}/keys`, {
    kind,
    name: `chave ${kind}`,
  });
  expect(response.status, response.errorMessage ?? '').toBe(201);
  return response.body.key.token as string;
}

async function autorizarOrigem(siteId: string, origin = ORIGEM) {
  const response = await admin.client.put(`/api/platform/sites/${siteId}/origins`, {
    origins: [{ origin, note: 'site do cliente' }],
  });
  expect(response.status, response.errorMessage ?? '').toBe(200);
}

/** Chamada a API publica, como o site do cliente faria. */
function chamar(token: string, origin: string | null = ORIGEM, path = '/api/v1/site') {
  return api.client().get(path, {
    origin,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('emissao', () => {
  it('a chave secreta aparece uma unica vez e some do painel', async () => {
    const token = await criarChave(empresa.siteId, 'secret');
    expect(token.startsWith('cb_sec_')).toBe(true);

    const lista = await admin.client.get(`/api/platform/sites/${empresa.siteId}/keys`);
    const chave = (lista.body.items as Array<{ kind: string; token: string }>)
      .find((k) => k.kind === 'secret');

    expect(chave!.token).not.toBe(token);
    expect(chave!.token).toContain('•');
  });

  it('o segredo nao fica legivel no banco', async () => {
    const token = await criarChave(empresa.siteId, 'secret');
    const [row] = await api.db
      .select()
      .from(schema.siteApiKeys)
      .where(eq(schema.siteApiKeys.siteId, empresa.siteId));

    expect(row!.token).toBeNull();
    // Pelo proprio `parseApiKey`, e nao por `split('_')`: o alfabeto base64url
    // inclui `_`, entao cortar no ultimo deles devolve um pedaco do segredo --
    // e devolve string vazia quando o segredo termina em `_`, caso em que
    // `not.toContain('')` falha sempre. Era uma falha intermitente de ~1 em 64.
    const parsed = parseApiKey(token)!;
    expect(parsed).not.toBeNull();
    expect(parsed.secret.length).toBeGreaterThan(24);
    expect(row!.secretHash).not.toContain(parsed.secret);
    expect(JSON.stringify(row)).not.toContain(parsed.secret);
  });

  it('a chave publicavel continua legivel: ela nao e segredo', async () => {
    const token = await criarChave(empresa.siteId, 'publishable');
    const lista = await admin.client.get(`/api/platform/sites/${empresa.siteId}/keys`);
    const chave = (lista.body.items as Array<{ kind: string; token: string }>)
      .find((k) => k.kind === 'publishable');
    expect(chave!.token).toBe(token);
  });

  it('uma empresa nao emite chave para o proprio site', async () => {
    const response = await empresa.client.post(`/api/platform/sites/${empresa.siteId}/keys`, {
      kind: 'secret',
    });
    expect(response.status).toBe(403);
  });
});

describe('chave publicavel no navegador', () => {
  it('sem origem cadastrada, nao atende', async () => {
    const token = await criarChave(empresa.siteId, 'publishable');
    const response = await chamar(token);
    expect(response.status).toBe(403);
    expect(response.errorMessage).toMatch(/origem/i);
  });

  it('atende a origem autorizada e libera a leitura no navegador', async () => {
    await autorizarOrigem(empresa.siteId);
    const token = await criarChave(empresa.siteId, 'publishable');

    const response = await chamar(token);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.site.id).toBe(empresa.siteId);
    // Sem este cabecalho o navegador descarta a resposta.
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGEM);
  });

  it('recusa origem de outro site', async () => {
    await autorizarOrigem(empresa.siteId);
    const token = await criarChave(empresa.siteId, 'publishable');

    const response = await chamar(token, OUTRA_ORIGEM);
    expect(response.status).toBe(403);
  });

  it('recusa requisicao sem origem', async () => {
    // Chave publicavel e para navegador. Sem `Origin`, nao ha o que conferir.
    await autorizarOrigem(empresa.siteId);
    const token = await criarChave(empresa.siteId, 'publishable');

    const response = await chamar(token, null);
    expect(response.status).toBe(403);
  });

  it('nao recebe escopo de rascunho', async () => {
    await autorizarOrigem(empresa.siteId);
    const token = await criarChave(empresa.siteId, 'publishable');
    const response = await chamar(token);
    expect(response.body.scopes).not.toContain('content:draft');
  });
});

describe('chave secreta no servidor', () => {
  it('atende sem origem nenhuma', async () => {
    // Ela roda no servidor do site, onde `Origin` nao existe.
    const token = await criarChave(empresa.siteId, 'secret');
    const response = await chamar(token, null);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.scopes).toContain('content:draft');
  });

  it('nao e limitada pela lista de origens', async () => {
    await autorizarOrigem(empresa.siteId);
    const token = await criarChave(empresa.siteId, 'secret');
    const response = await chamar(token, OUTRA_ORIGEM);
    expect(response.status).toBe(200);
  });
});

describe('credencial invalida', () => {
  it.each([
    ['token ausente', ''],
    ['lixo', 'nao-e-um-token'],
    ['prefixo certo, resto inventado', 'cb_sec_abcdefghijkl_ssssssssssssssssssssssssssssssss'],
  ])('recusa com 401: %s', async (_nome, token) => {
    const response = await chamar(token, null);
    expect(response.status).toBe(401);
  });

  it('segredo adulterado com localizador valido tambem e 401', async () => {
    const token = await criarChave(empresa.siteId, 'secret');
    const [prefixo, tipo, lookup] = token.split('_');
    const adulterado = `${prefixo}_${tipo}_${lookup}_${'x'.repeat(32)}`;

    const response = await chamar(adulterado, null);
    expect(response.status).toBe(401);
  });

  it('a mensagem nao distingue chave inexistente de segredo errado', async () => {
    // Mensagens diferentes entregariam um oraculo a quem sonda.
    const inexistente = await chamar('cb_sec_abcdefghijkl_ssssssssssssssssssssssssssssssss', null);
    const token = await criarChave(empresa.siteId, 'secret');
    const errado = await chamar(`${token.slice(0, -4)}zzzz`, null);

    expect(inexistente.errorMessage).toBe(errado.errorMessage);
  });

  it('chave revogada para de atender na hora', async () => {
    const token = await criarChave(empresa.siteId, 'secret');
    const [chave] = await api.db
      .select({ id: schema.siteApiKeys.id })
      .from(schema.siteApiKeys)
      .where(eq(schema.siteApiKeys.siteId, empresa.siteId));

    expect((await chamar(token, null)).status).toBe(200);

    const revogada = await admin.client.delete(
      `/api/platform/sites/${empresa.siteId}/keys/${chave!.id}`,
    );
    expect(revogada.status).toBe(204);

    expect((await chamar(token, null)).status).toBe(401);
  });
});

describe('rotacao com sobreposicao', () => {
  it('a chave antiga continua valendo durante a janela e morre depois', async () => {
    const antiga = await criarChave(empresa.siteId, 'secret');
    const [chave] = await api.db
      .select({ id: schema.siteApiKeys.id })
      .from(schema.siteApiKeys)
      .where(eq(schema.siteApiKeys.siteId, empresa.siteId));

    const response = await admin.client.post(
      `/api/platform/sites/${empresa.siteId}/keys/${chave!.id}/rotate`,
      { graceMinutes: 60 },
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);
    const nova = response.body.key.token as string;

    // Durante a janela as duas atendem: o site do cliente nao troca a
    // credencial no mesmo instante em que a plataforma rotaciona.
    expect((await chamar(antiga, null)).status).toBe(200);
    expect((await chamar(nova, null)).status).toBe(200);

    agora = new Date(agora.getTime() + 61 * 60_000);

    expect((await chamar(antiga, null)).status).toBe(401);
    expect((await chamar(nova, null)).status).toBe(200);
  });
});

describe('isolamento entre sites', () => {
  it('a chave de um site nao enxerga o outro', async () => {
    const outra = await registerAccount(api, {
      email: 'contato@beta.com.br',
      companyName: 'Construtora Beta',
    });
    const token = await criarChave(outra.siteId, 'secret');

    const response = await chamar(token, null);
    expect(response.status).toBe(200);
    // O site vem da credencial, nunca de um parametro da requisicao.
    expect(response.body.site.id).toBe(outra.siteId);
    expect(response.body.site.id).not.toBe(empresa.siteId);
  });
});

describe('preflight', () => {
  it('responde sem autenticacao, porque o navegador nao manda a chave nele', async () => {
    const response = await api.client().request('OPTIONS', '/api/v1/site', { origin: ORIGEM });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
  });
});
