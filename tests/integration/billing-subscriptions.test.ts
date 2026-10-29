import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { createUnconfiguredBillingProvider, type MemoryBillingProvider } from '@codeca/api';
import { AppError } from '@codeca/shared';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';
import {
  loadSubscriptionRow,
  startCheckout,
  syncPlanCode,
  usePlanCode,
} from '../helpers/billing.js';

/**
 * Contratacao de planos.
 *
 * O ponto central: a ValidaPay nao cria assinaturas por API -- elas nascem de
 * uma cobranca recorrente paga. Logo, contratar cria uma sessao de checkout, e
 * nada mais: nenhum acesso, nenhuma publicacao, nenhum limite novo e liberado
 * antes da confirmacao do pagamento.
 */

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
  account = await registerAccount(api, {
    email: 'contato@construtorahorizonte.com.br',
    companyName: 'Construtora Horizonte',
  });
  await verifyEmail(api, account);
});

describe('contratacao de plano', () => {
  it('cria a sessao de checkout sem liberar nada antes do pagamento', async () => {
    const plan = await syncPlanCode(api, 'essencial');

    const result = await startCheckout(account, plan.id);

    expect(result.checkoutUrl).toMatch(/^https:\/\//);
    expect(result.checkoutSessionId).toMatch(/^cs_/);

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    // A assinatura segue na avaliacao: o plano desejado fica pendente.
    expect(subscription.pendingPlanId).toBe(plan.id);
    expect(subscription.planId).not.toBe(plan.id);
    expect(subscription.externalSubscriptionId).toBeNull();
    expect(subscription.checkoutSessionId).toBe(result.checkoutSessionId);
    expect(subscription.intentToken).toBeTruthy();

    // A empresa continua com os limites do plano de avaliacao.
    const [tenant] = await api.db
      .select({ planId: schema.tenants.planId })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, account.tenantId));
    expect(tenant?.planId).not.toBe(plan.id);

    // O metadata enviado a ValidaPay carrega a empresa e o token da intencao.
    const session = api.billing.sessions.get(result.checkoutSessionId);
    expect(session?.input.metadata).toMatchObject({
      tenantId: account.tenantId,
      planId: plan.id,
      intentToken: subscription.intentToken,
    });
    // O preco enviado vem do banco, em reais, e nunca do navegador.
    expect(session?.input.priceId).toBe(plan.priceId);
  });

  it('sincroniza o plano na primeira contratacao quando ainda nao ha preco', async () => {
    const [plan] = await api.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.code, 'essencial'));
    expect(plan?.externalPriceId).toBeNull();

    await startCheckout(account, plan!.id);

    const [synced] = await api.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, plan!.id));
    expect(synced?.externalProductId).toMatch(/^prod_/);
    expect(synced?.externalPriceId).toMatch(/^price_/);
    expect(api.billing.calls).toContain('syncPlan');
  });

  it('recusa um plano inativo', async () => {
    const plan = await syncPlanCode(api, 'essencial');
    await api.db.update(schema.plans).set({ isActive: false }).where(eq(schema.plans.id, plan.id));

    const response = await account.client.post(
      `/api/tenants/${account.tenantId}/billing/checkout`,
      { planId: plan.id, paymentMethod: 'creditcard' },
    );

    expect(response.status).toBe(409);
    expect(response.errorMessage).toMatch(/inativo/i);
  });

  it('recusa um plano gratuito: a API exige valor maior que zero', async () => {
    const [trial] = await api.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.code, 'trial'));

    const response = await account.client.post(
      `/api/tenants/${account.tenantId}/billing/checkout`,
      { planId: trial!.id, paymentMethod: 'creditcard' },
    );

    expect(response.status).toBe(400);
    expect(response.errorMessage).toMatch(/nao tem preco|avaliacao/i);
  });

  it('ignora qualquer valor enviado pelo navegador e usa o preco do banco', async () => {
    const plan = await syncPlanCode(api, 'essencial');

    const response = await account.client.post(
      `/api/tenants/${account.tenantId}/billing/checkout`,
      {
        planId: plan.id,
        paymentMethod: 'creditcard',
        // Campos maliciosos: nao existem no schema e sao descartados.
        priceCents: 1,
        amount: 0.01,
        price: 0.01,
        priceId: 'price_de_outra_empresa',
      },
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);

    const session = api.billing.sessions.get(response.body.checkoutSessionId as string);
    expect(session?.input.priceId).toBe(plan.priceId);
    expect(session?.input.metadata?.amountCents).toBe(plan.priceCents);
  });

  it('recusa forma de pagamento que o plano nao oferece', async () => {
    const plan = await syncPlanCode(api, 'essencial');
    // O plano Essencial do seed nao oferece boleto.
    const response = await account.client.post(
      `/api/tenants/${account.tenantId}/billing/checkout`,
      { planId: plan.id, paymentMethod: 'boleto' },
    );

    expect(response.status).toBe(400);
    expect(response.errorMessage).toMatch(/nao aceita/i);
  });

  it('recusa Pix Automatico quando o valor fica abaixo do minimo de R$ 4,99', async () => {
    const plan = await syncPlanCode(api, 'profissional');
    await api.db
      .update(schema.plans)
      .set({ priceCents: 400 })
      .where(eq(schema.plans.id, plan.id));

    const response = await account.client.post(
      `/api/tenants/${account.tenantId}/billing/checkout`,
      { planId: plan.id, paymentMethod: 'pix_automatico' },
    );

    expect(response.status).toBe(400);
    expect(response.errorMessage).toMatch(/4,99/);
  });

  it('avisa que Pix comum e boleto nao tem debito automatico', async () => {
    const plan = await syncPlanCode(api, 'profissional');

    const pix = await startCheckout(account, plan.id, 'pix');
    expect(pix.notice).toMatch(/pagamento e manual|nao ha debito automatico/i);

    const automatic = await startCheckout(account, plan.id, 'creditcard');
    expect(automatic.notice).toBeNull();
  });

  it('nao cria duas contratacoes quando a requisicao e repetida', async () => {
    const plan = await syncPlanCode(api, 'essencial');

    const first = await startCheckout(account, plan.id);
    const second = await startCheckout(account, plan.id);

    expect(second.reused).toBe(true);
    expect(second.checkoutSessionId).toBe(first.checkoutSessionId);
    // Apenas uma sessao criada no provedor.
    expect(api.billing.calls.filter((call) => call === 'createCheckoutSession')).toHaveLength(1);
    expect(api.billing.sessions.size).toBe(1);
  });

  it('cria nova sessao quando a forma de pagamento muda', async () => {
    const plan = await syncPlanCode(api, 'profissional');

    const first = await startCheckout(account, plan.id, 'creditcard');
    const second = await startCheckout(account, plan.id, 'pix');

    expect(second.reused).toBe(false);
    expect(second.checkoutSessionId).not.toBe(first.checkoutSessionId);
  });

  it('propaga a falha da API sem registrar uma contratacao fantasma', async () => {
    const plan = await syncPlanCode(api, 'essencial');
    api.billing.failNext(
      'createCheckoutSession',
      new AppError('upstream_error', 'A ValidaPay esta indisponivel.'),
    );

    const response = await account.client.post(
      `/api/tenants/${account.tenantId}/billing/checkout`,
      { planId: plan.id, paymentMethod: 'creditcard' },
    );

    expect(response.status).toBe(502);
    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.checkoutSessionId).toBeNull();
    expect(subscription.pendingPlanId).toBeNull();
  });

  it('exige e-mail verificado para contratar', async () => {
    const plan = await syncPlanCode(api, 'essencial');
    const other = await registerAccount(api, {
      email: 'novo@construtora.com.br',
      companyName: 'Construtora Nova',
    });
    await syncPlanCode(api, 'essencial');

    const response = await other.client.post(
      `/api/tenants/${other.tenantId}/billing/checkout`,
      { planId: plan.id, paymentMethod: 'creditcard' },
    );

    expect(response.status).toBe(403);
    expect(response.errorCode).toBe('email_not_verified');
  });

  it('recusa contratar quando a integracao nao esta configurada, sem simular sucesso', async () => {
    const plan = await syncPlanCode(api, 'essencial');

    // Provedor sem credenciais: toda operacao e recusada explicitamente.
    const unconfigured = createUnconfiguredBillingProvider();
    const isolated = await createTestApi({
      billing: unconfigured as unknown as Parameters<typeof createTestApi>[0] extends never
        ? never
        : MemoryBillingProvider,
    });
    try {
      const other = await registerAccount(isolated, {
        email: 'sem-pagamento@construtora.com.br',
        companyName: 'Construtora Sem Pagamento',
      });
      await verifyEmail(isolated, other);
      const isolatedPlan = await syncPlanCode(isolated, 'essencial');

      const overview = await other.client.get(`/api/tenants/${other.tenantId}/billing`);
      expect(overview.body.available).toBe(false);

      const checkout = await other.client.post(
        `/api/tenants/${other.tenantId}/billing/checkout`,
        { planId: isolatedPlan.id, paymentMethod: 'creditcard' },
      );
      expect(checkout.status).toBe(501);
      expect(checkout.errorCode).toBe('integration_not_configured');
      expect(checkout.errorMessage).toMatch(/VALIDAPAY_CLIENT_ID/);
    } finally {
      await isolated.close();
    }
    void plan;
  });
});

describe('plano de avaliacao', () => {
  it('nasce com acesso liberado e vencimento em 14 dias', async () => {
    const subscription = await loadSubscriptionRow(api, account.tenantId);

    expect(subscription.status).toBe('trialing');
    expect(subscription.publicationState).toBe('allowed');
    expect(subscription.accessUntil).not.toBeNull();
    expect(subscription.trialEndsAt).not.toBeNull();

    const days =
      (subscription.accessUntil!.getTime() - Date.now()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThan(15);
  });

  it('expõe o resumo de cobranca com planos, uso e estado da publicacao', async () => {
    await usePlanCode(api, account.tenantId, 'trial');
    const response = await account.client.get(`/api/tenants/${account.tenantId}/billing`);

    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.subscription.state).toBe('trialing');
    expect(response.body.subscription.publicationState).toBe('allowed');
    expect(response.body.plans.length).toBeGreaterThan(0);
    expect(response.body.usage).toHaveProperty('publishedProperties');
    // O plano gratuito aparece, mas marcado como nao contratavel.
    const trial = response.body.plans.find((plan: { code: string }) => plan.code === 'trial');
    expect(trial?.contractable).toBe(false);
  });
});
