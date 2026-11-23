import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApi, type TestApi } from '../helpers/api.js';

/**
 * O desafio de bot e opcional -- e as duas metades disso importam.
 *
 * Sem as chaves no ambiente, a plataforma precisa se comportar exatamente como
 * antes: ligar um desafio mal configurado trancaria o cadastro de todo mundo.
 * Com as chaves, o token precisa ser conferido NO SERVIDOR: um desafio
 * resolvido so no navegador nao prova nada, porque quem monta a requisicao a
 * mao escreve o que quiser no campo.
 */

let api: TestApi | null = null;

afterEach(async () => {
  await api?.close();
  api = null;
  vi.restoreAllMocks();
});

const CADASTRO = {
  name: 'Maria Souza',
  email: 'maria@empresa.com.br',
  password: 'uma-senha-boa-123',
  companyName: 'Empresa da Maria',
  phone: '(19) 99999-0000',
  acceptedTerms: true,
};

/** Resposta do provedor, no lugar da rede. */
function provedor(success: boolean, erros: string[] = []) {
  return vi.fn(async () =>
    ({ json: async () => ({ success, 'error-codes': erros }) }) as unknown as Response,
  );
}

describe('desafio desligado (padrao)', () => {
  it('o cadastro funciona sem token nenhum', async () => {
    api = await createTestApi();
    const r = await api.client().post('/api/auth/register', CADASTRO);
    expect(r.status, r.errorMessage ?? '').toBe(201);
  });

  it('um token qualquer no corpo nao atrapalha', async () => {
    api = await createTestApi();
    const r = await api.client().post('/api/auth/register', { ...CADASTRO, botToken: 'qualquer-coisa' });
    expect(r.status, r.errorMessage ?? '').toBe(201);
  });
});

describe('desafio ligado', () => {
  const COM_CHAVES = { TURNSTILE_SITE_KEY: '0x-site', TURNSTILE_SECRET_KEY: '0x-secreta' };

  it('sem token, o cadastro e recusado', async () => {
    api = await createTestApi({ env: COM_CHAVES });
    const r = await api.client().post('/api/auth/register', CADASTRO);
    expect(r.status).toBe(403);
    expect(r.errorCode).toBe('bot_challenge_required');
  });

  it('com token que o provedor recusa, o cadastro e recusado', async () => {
    api = await createTestApi({ env: COM_CHAVES });
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      provedor(false, ['invalid-input-response']) as unknown as typeof fetch,
    );

    const r = await api.client().post('/api/auth/register', { ...CADASTRO, botToken: 'token-falso' });
    expect(r.status).toBe(403);
    expect(r.errorCode).toBe('bot_challenge_required');
  });

  it('com token que o provedor aceita, o cadastro passa', async () => {
    api = await createTestApi({ env: COM_CHAVES });
    const buscar = provedor(true);
    vi.spyOn(globalThis, 'fetch').mockImplementation(buscar as unknown as typeof fetch);

    const r = await api.client().post('/api/auth/register', { ...CADASTRO, botToken: 'token-bom' });
    expect(r.status, r.errorMessage ?? '').toBe(201);

    // O segredo precisa ter ido para o provedor, e nao ficado so no navegador.
    const [, init] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain('secret=0x-secreta');
    expect(String(init.body)).toContain('response=token-bom');
  });

  /**
   * A escolha mais discutivel deste modulo, registrada aqui de proposito:
   * provedor fora do ar deixa passar. Trancar o cadastro da plataforma inteira
   * porque um terceiro caiu seria estrago maior do que o que o desafio evita,
   * e o limite por IP continua valendo.
   */
  it('provedor fora do ar nao tranca o cadastro', async () => {
    api = await createTestApi({ env: COM_CHAVES });
    vi.spyOn(globalThis, 'fetch').mockImplementation((() => {
      throw new Error('rede caiu');
    }) as unknown as typeof fetch);

    const r = await api.client().post('/api/auth/register', { ...CADASTRO, botToken: 'token-bom' });
    expect(r.status, r.errorMessage ?? '').toBe(201);
  });

  it('a recuperacao de senha tambem exige o desafio', async () => {
    // Com provedor de e-mail: sem ele a rota para antes, em "nao configurado".
    api = await createTestApi({ env: { ...COM_CHAVES, RESEND_API_KEY: 're_chave_de_teste' } });
    const r = await api.client().post('/api/auth/forgot-password', { email: 'alguem@empresa.com.br' });
    expect(r.status).toBe(403);
    expect(r.errorCode).toBe('bot_challenge_required');
  });
});
