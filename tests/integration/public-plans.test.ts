import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { DEFAULT_PLANS } from '@codeca/shared';
import { createTestApi, type TestApi } from '../helpers/api.js';

/**
 * Vitrine de planos da pagina inicial.
 *
 * A promessa que estes testes seguram: **a pagina so anuncia o que o sistema
 * cobra**. Preco e limite sao editaveis no painel mestre; se a vitrine lesse
 * constantes, mudar um valor la deixaria a proposta publica diferente da real.
 */

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

const lista = () => api.client().get('/api/public/plans');

describe('GET /api/public/plans', () => {
  it('e publica: funciona sem sessao e sem cabecalho de origem', async () => {
    const resposta = await api.client().get('/api/public/plans', { origin: null });
    expect(resposta.status).toBe(200);
    expect(resposta.body.currency).toBe('BRL');
  });

  it('devolve os quatro planos da instalacao, do mais barato ao mais caro', async () => {
    const { body } = await lista();
    expect(body.plans.map((p: { code: string }) => p.code)).toEqual([
      'trial',
      'essencial',
      'profissional',
      'empresas',
    ]);
    const precos = body.plans.map((p: { priceCents: number }) => p.priceCents);
    expect(precos).toEqual([...precos].sort((a, b) => a - b));
  });

  it('os numeros sao os do banco, e na instalacao nova coincidem com a semente', async () => {
    const { body } = await lista();
    for (const semente of DEFAULT_PLANS) {
      const plano = body.plans.find((p: { code: string }) => p.code === semente.code);
      expect(plano, semente.code).toBeDefined();
      expect(plano.priceCents).toBe(semente.priceCents);
      expect(plano.limits).toEqual(semente.limits);
    }
  });

  it('uma mudanca feita no painel mestre aparece na vitrine (nada e lido de constante)', async () => {
    await api.db
      .update(schema.plans)
      .set({ priceCents: 7777, limits: { ...DEFAULT_PLANS[2]!.limits, maxUsers: 9 } })
      .where(eq(schema.plans.code, 'profissional'));

    const { body } = await lista();
    const plano = body.plans.find((p: { code: string }) => p.code === 'profissional');
    expect(plano.priceCents).toBe(7777);
    expect(plano.limits.maxUsers).toBe(9);
  });

  it('plano inativo ou nao publico nao aparece', async () => {
    await api.db.update(schema.plans).set({ isActive: false }).where(eq(schema.plans.code, 'essencial'));
    await api.db.update(schema.plans).set({ isPublic: false }).where(eq(schema.plans.code, 'empresas'));

    const { body } = await lista();
    const codigos = body.plans.map((p: { code: string }) => p.code);
    expect(codigos).not.toContain('essencial');
    expect(codigos).not.toContain('empresas');
    expect(codigos).toContain('profissional');
  });

  it('nao expoe nada interno: ids, ligacao com a ValidaPay, erro de sincronizacao, suspensao', async () => {
    await api.db
      .update(schema.plans)
      .set({
        externalProductId: 'prod_secreto',
        externalPriceId: 'price_secreto',
        externalCheckoutUrl: 'https://checkout.exemplo/interno',
        externalSyncError: 'falha interna',
      })
      .where(eq(schema.plans.code, 'profissional'));

    const resposta = await lista();
    const texto = JSON.stringify(resposta.body);
    for (const proibido of ['prod_secreto', 'price_secreto', 'checkout.exemplo', 'falha interna']) {
      expect(texto).not.toContain(proibido);
    }
    expect(Object.keys(resposta.body.plans[0]).sort()).toEqual([
      'code',
      'description',
      'limits',
      'name',
      'priceCents',
      'trialDays',
    ]);
  });

  it('informa os dias de avaliacao so onde o plano os tem', async () => {
    const { body } = await lista();
    const por = (codigo: string) => body.plans.find((p: { code: string }) => p.code === codigo);
    expect(por('trial').trialDays).toBeGreaterThan(0);
    expect(por('essencial').trialDays).toBeNull();
  });

  it('pode ser reaproveitada por alguns minutos, ao contrario do resto da API', async () => {
    const publica = await lista();
    expect(publica.headers.get('cache-control')).toMatch(/public, max-age=\d+/);

    const privada = await api.client().get('/api/auth/session');
    expect(privada.headers.get('cache-control')).toBe('no-store');
  });

  it('somente leitura: escrever nesta rota nao existe', async () => {
    const resposta = await api.client().post('/api/public/plans', {});
    expect([404, 405]).toContain(resposta.status);
  });
});
