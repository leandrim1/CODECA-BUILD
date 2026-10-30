import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
  seedPlatformAdmin,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';
import {
  expireTrial,
  loadSubscriptionRow,
  sendWebhook,
  startCheckout,
  subscriptionPayload,
  syncPlanCode,
} from '../helpers/billing.js';

/**
 * Isolamento multiempresa e publicacao na cobranca.
 *
 * A pergunta que estes testes respondem: uma empresa consegue ver, alterar ou
 * pagar pela assinatura de outra trocando identificadores? E: o site fica
 * publicado exatamente quando a assinatura permite?
 */

let api: TestApi;
let alpha: RegisteredAccount;
let beta: RegisteredAccount;
let planId: string;
let priceCents: number;

const ALPHA_HOST = 'www.construtora-alpha.com.br';

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  // A instalacao ja tem um administrador (como apos o `pnpm db:seed`): assim
  // as contas abaixo sao usuarios comuns, e nao a primeira conta da
  // instalacao, que assumiria o painel mestre.
  await seedPlatformAdmin(api);
  alpha = await registerAccount(api, {
    email: 'alpha@alpha.com.br',
    companyName: 'Construtora Alpha',
  });
  beta = await registerAccount(api, { email: 'beta@beta.com.br', companyName: 'Construtora Beta' });
  await verifyEmail(api, alpha);
  await verifyEmail(api, beta);

  const plan = await syncPlanCode(api, 'essencial');
  planId = plan.id;
  priceCents = plan.priceCents;
});

/** Vincula um dominio ativo, como ficaria apos a verificacao de DNS. */
async function attachDomain(tenantId: string, hostname: string): Promise<void> {
  await api.db.insert(schema.domains).values({
    tenantId,
    hostname,
    status: 'active',
    isPrimary: true,
    ownershipVerified: true,
    dnsConfigured: true,
    sslStatus: 'active',
    verifiedAt: new Date(),
  });
}

async function publishAllPages(account: RegisteredAccount): Promise<void> {
  const pages = await account.client.get(`/api/tenants/${account.tenantId}/pages`);
  for (const page of pages.body.pages as Array<{ id: string }>) {
    const result = await account.client.post(
      `/api/tenants/${account.tenantId}/pages/${page.id}/publish`,
      { note: 'teste' },
    );
    expect(result.status, result.errorMessage ?? '').toBe(200);
  }
}

async function visit(path = '/'): Promise<number> {
  const response = await api.siteApp.request(`https://${ALPHA_HOST}${path}`, {
    headers: { host: ALPHA_HOST, 'x-forwarded-proto': 'https' },
  });
  return response.status;
}

describe('isolamento entre empresas', () => {
  it('nao le o resumo de cobranca de outra empresa', async () => {
    const response = await alpha.client.get(`/api/tenants/${beta.tenantId}/billing`);
    expect(response.status).toBe(404);
  });

  it('nao contrata plano em nome de outra empresa', async () => {
    const response = await alpha.client.post(
      `/api/tenants/${beta.tenantId}/billing/checkout`,
      { planId, paymentMethod: 'creditcard' },
    );
    expect(response.status).toBe(404);

    const subscription = await loadSubscriptionRow(api, beta.tenantId);
    expect(subscription.checkoutSessionId).toBeNull();
  });

  it('nao cancela a assinatura de outra empresa', async () => {
    await startCheckout(beta, planId);
    await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_da_beta',
        status: 'ACTIVE',
        amountCents: priceCents,
        nextChargeDate: new Date(Date.now() + 2.6e9),
        chargeId: 'cha_da_beta',
        metadata: {
          tenantId: beta.tenantId,
          intentToken: (await loadSubscriptionRow(api, beta.tenantId)).intentToken,
        },
      }),
    );

    const response = await alpha.client.post(
      `/api/tenants/${beta.tenantId}/billing/cancel`,
      { reason: 'tentativa indevida', mode: 'period_end' },
    );
    expect(response.status).toBe(404);

    const subscription = await loadSubscriptionRow(api, beta.tenantId);
    expect(subscription.status).toBe('active');
    expect(subscription.cancelRequestedAt).toBeNull();
  });

  it('nao consulta uma cobranca de outra empresa, nem com o id correto', async () => {
    const [charge] = await api.db
      .insert(schema.charges)
      .values({
        tenantId: beta.tenantId,
        externalChargeId: 'cha_exclusiva_da_beta',
        status: 'paid',
        amountCents: priceCents,
        paidAt: new Date(),
      })
      .returning();

    // Mesmo informando o id real, o escopo da empresa vem da sessao.
    const byTenant = await alpha.client.get(
      `/api/tenants/${alpha.tenantId}/billing/charges/${charge!.id}`,
    );
    expect(byTenant.status).toBe(404);

    const byPath = await alpha.client.get(
      `/api/tenants/${beta.tenantId}/billing/charges/${charge!.id}`,
    );
    expect(byPath.status).toBe(404);

    const refresh = await alpha.client.post(
      `/api/tenants/${alpha.tenantId}/billing/charges/${charge!.id}/refresh`,
    );
    expect(refresh.status).toBe(404);
  });

  it('a listagem de cobrancas traz apenas as da propria empresa', async () => {
    await api.db.insert(schema.charges).values([
      {
        tenantId: alpha.tenantId,
        externalChargeId: 'cha_alpha_1',
        status: 'paid',
        amountCents: 19900,
        paidAt: new Date(),
      },
      {
        tenantId: beta.tenantId,
        externalChargeId: 'cha_beta_1',
        status: 'paid',
        amountCents: 39900,
        paidAt: new Date(),
      },
    ]);

    const response = await alpha.client.get(`/api/tenants/${alpha.tenantId}/billing/charges`);
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].externalChargeId).toBe('cha_alpha_1');
  });

  it('nao troca o plano de outra empresa', async () => {
    const response = await alpha.client.post(
      `/api/tenants/${beta.tenantId}/billing/change-plan`,
      { planId, preview: false },
    );
    expect(response.status).toBe(404);
  });

  it('um evento nao credita o pagamento na empresa errada', async () => {
    const alphaSub = await loadSubscriptionRow(api, alpha.tenantId);
    await startCheckout(beta, planId);
    const betaSub = await loadSubscriptionRow(api, beta.tenantId);

    // Evento legitimo da Beta, com o token da Beta.
    await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_beta',
        status: 'ACTIVE',
        amountCents: priceCents,
        chargeId: 'cha_beta',
        nextChargeDate: new Date(Date.now() + 2.6e9),
        metadata: { tenantId: beta.tenantId, intentToken: betaSub.intentToken },
      }),
    );

    const alphaAfter = await loadSubscriptionRow(api, alpha.tenantId);
    expect(alphaAfter.externalSubscriptionId).toBeNull();
    expect(alphaAfter.accessUntil?.toISOString()).toBe(alphaSub.accessUntil?.toISOString());

    const betaAfter = await loadSubscriptionRow(api, beta.tenantId);
    expect(betaAfter.status).toBe('active');
  });

  it('um tenantId falso no metadata nao desvia o pagamento', async () => {
    await startCheckout(beta, planId);
    const betaSub = await loadSubscriptionRow(api, beta.tenantId);

    // Vincula a assinatura a Beta pelo token.
    await sendWebhook(
      api,
      'subscription.created',
      subscriptionPayload({
        subscriptionId: 'sub_beta',
        status: 'PENDING',
        amountCents: priceCents,
        paidAt: null,
        cycleStatus: 'PENDING',
        timestamp: new Date(Date.now() - 60_000),
        metadata: { tenantId: beta.tenantId, intentToken: betaSub.intentToken },
      }),
    );

    // Evento seguinte diz, mentindo, que a assinatura e da Alpha.
    await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_beta',
        status: 'ACTIVE',
        amountCents: priceCents,
        chargeId: 'cha_beta',
        nextChargeDate: new Date(Date.now() + 2.6e9),
        metadata: { tenantId: alpha.tenantId, intentToken: 'inventado' },
      }),
    );

    // O vinculo gravado prevalece sobre o que o corpo afirma.
    const betaAfter = await loadSubscriptionRow(api, beta.tenantId);
    expect(betaAfter.status).toBe('active');
    const alphaAfter = await loadSubscriptionRow(api, alpha.tenantId);
    expect(alphaAfter.status).toBe('trialing');
  });

  it('usuario comum nao acessa o painel de cobranca da plataforma', async () => {
    for (const path of [
      '/api/platform/billing/overview',
      '/api/platform/billing/subscriptions',
      '/api/platform/billing/charges',
      '/api/platform/billing/webhooks',
      '/api/platform/billing/history',
    ]) {
      const response = await alpha.client.get(path);
      expect(response.status, path).toBe(403);
    }

    const reconcile = await alpha.client.post('/api/platform/billing/reconcile', {
      force: false,
      limit: 10,
    });
    expect(reconcile.status).toBe(403);

    const hold = await alpha.client.post('/api/platform/billing/publication-hold', {
      tenantId: beta.tenantId,
      hold: true,
      reason: 'tentativa indevida de suspensao',
    });
    expect(hold.status).toBe(403);
  });

  it('o job de reconciliacao exige o segredo proprio', async () => {
    const noSecret = await api.app.request('http://app.localhost:5173/api/billing/reconcile', {
      method: 'POST',
    });
    expect(noSecret.status).toBe(401);

    const wrongSecret = await api.app.request('http://app.localhost:5173/api/billing/reconcile', {
      method: 'POST',
      headers: { authorization: 'Bearer segredo-errado' },
    });
    expect(wrongSecret.status).toBe(401);

    // Estar autenticado no painel nao substitui o segredo do job.
    const asUser = await alpha.client.post('/api/billing/reconcile');
    expect(asUser.status).toBe(401);
  });

  it('a cobranca de uma empresa nao e reatribuida por evento de outra', async () => {
    await api.db.insert(schema.charges).values({
      tenantId: beta.tenantId,
      externalChargeId: 'cha_disputada',
      status: 'pending',
      amountCents: priceCents,
    });

    await startCheckout(alpha, planId);
    const alphaSub = await loadSubscriptionRow(api, alpha.tenantId);
    await sendWebhook(
      api,
      'subscription.created',
      subscriptionPayload({
        subscriptionId: 'sub_alpha',
        status: 'PENDING',
        amountCents: priceCents,
        paidAt: null,
        cycleStatus: 'PENDING',
        timestamp: new Date(Date.now() - 60_000),
        metadata: { tenantId: alpha.tenantId, intentToken: alphaSub.intentToken },
      }),
    );

    // Evento da Alpha citando a cobranca que pertence a Beta.
    const response = await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_alpha',
        status: 'ACTIVE',
        amountCents: priceCents,
        chargeId: 'cha_disputada',
        nextChargeDate: new Date(Date.now() + 2.6e9),
        metadata: { tenantId: alpha.tenantId, intentToken: alphaSub.intentToken },
      }),
      { eventId: 'evt_conflito' },
    );

    // O evento e recusado no processamento e fica registrado para revisao.
    expect(response.body.data?.status).toBe('failed');

    const [charge] = await api.db
      .select()
      .from(schema.charges)
      .where(eq(schema.charges.externalChargeId, 'cha_disputada'));
    expect(charge?.tenantId).toBe(beta.tenantId);
    expect(charge?.status).toBe('pending');
  });
});

describe('publicacao conforme a assinatura', () => {
  beforeEach(async () => {
    await attachDomain(alpha.tenantId, ALPHA_HOST);
    await publishAllPages(alpha);
  });

  it('publica durante a avaliacao', async () => {
    expect(await visit()).toBe(200);
  });

  it('nao publica enquanto a contratacao esta pendente e a avaliacao venceu', async () => {
    await expireTrial(api, alpha.tenantId);
    await startCheckout(alpha, planId);
    const subscription = await loadSubscriptionRow(api, alpha.tenantId);

    await sendWebhook(
      api,
      'subscription.created',
      subscriptionPayload({
        subscriptionId: 'sub_alpha',
        status: 'PENDING',
        amountCents: priceCents,
        paidAt: null,
        cycleStatus: 'PENDING',
        metadata: { tenantId: alpha.tenantId, intentToken: subscription.intentToken },
      }),
    );

    expect(await loadSubscriptionRow(api, alpha.tenantId)).toMatchObject({
      status: 'pending',
      publicationState: 'blocked_pending',
    });
    expect(await visit()).toBe(404);
  });

  it('publica apos a confirmacao do pagamento', async () => {
    await expireTrial(api, alpha.tenantId);
    await startCheckout(alpha, planId);
    const subscription = await loadSubscriptionRow(api, alpha.tenantId);
    expect(await visit()).toBe(404);

    await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_alpha',
        status: 'ACTIVE',
        amountCents: priceCents,
        chargeId: 'cha_alpha',
        nextChargeDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        metadata: { tenantId: alpha.tenantId, intentToken: subscription.intentToken },
      }),
    );

    expect(await visit()).toBe(200);
  });

  it('mantem o site no ar durante a tolerancia e suspende quando ela vence', async () => {
    await expireTrial(api, alpha.tenantId);
    const subscription = await loadSubscriptionRow(api, alpha.tenantId);
    await startCheckout(alpha, planId);
    const withToken = await loadSubscriptionRow(api, alpha.tenantId);
    void subscription;

    // Pagamento cujo ciclo venceu ontem.
    await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_alpha',
        status: 'ACTIVE',
        amountCents: priceCents,
        chargeId: 'cha_alpha_1',
        nextChargeDate: new Date(Date.now() - 24 * 3600 * 1000),
        metadata: { tenantId: alpha.tenantId, intentToken: withToken.intentToken },
      }),
    );
    await sendWebhook(
      api,
      'payment.overdue',
      subscriptionPayload({
        subscriptionId: 'sub_alpha',
        status: 'DEFAULT',
        amountCents: priceCents,
        cycleStatus: 'FAILED',
        paidAt: null,
        cycleNumber: 2,
      }),
    );

    // Dentro da tolerancia: o site continua no ar.
    expect(await visit()).toBe(200);

    // A tolerancia vence: o site sai do ar na requisicao seguinte, sem
    // depender de nenhum job ter rodado.
    await api.db
      .update(schema.subscriptions)
      .set({ accessUntil: new Date(Date.now() - 10 * 24 * 3600 * 1000) })
      .where(eq(schema.subscriptions.tenantId, alpha.tenantId));

    expect(await visit()).toBe(404);
  });

  it('reativa a publicacao quando o pagamento e regularizado', async () => {
    await expireTrial(api, alpha.tenantId);
    await startCheckout(alpha, planId);
    const subscription = await loadSubscriptionRow(api, alpha.tenantId);

    await api.db
      .update(schema.subscriptions)
      .set({
        status: 'past_due',
        externalSubscriptionId: 'sub_alpha',
        accessUntil: new Date(Date.now() - 10 * 24 * 3600 * 1000),
        publicationState: 'blocked_overdue',
      })
      .where(eq(schema.subscriptions.tenantId, alpha.tenantId));
    expect(await visit()).toBe(404);

    await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_alpha',
        status: 'ACTIVE',
        amountCents: priceCents,
        chargeId: 'cha_regularizada',
        nextChargeDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        metadata: { tenantId: alpha.tenantId, intentToken: subscription.intentToken },
      }),
    );

    expect(await visit()).toBe(200);
  });

  it('a suspensao preserva conteudo, imagens e acesso ao painel', async () => {
    const property = await alpha.client.post(`/api/tenants/${alpha.tenantId}/properties`, {
      title: 'Residencial Aurora',
      type: 'apartamento',
      purpose: 'venda',
      publicationStatus: 'published',
    });
    expect(property.status).toBe(201);

    const [asset] = await api.db
      .insert(schema.mediaAssets)
      .values({
        tenantId: alpha.tenantId,
        blobUrl: 'https://blob.test/tenants/alpha/fachada.jpg',
        blobPathname: `tenants/${alpha.tenantId}/fachada.jpg`,
        downloadUrl: 'https://blob.test/tenants/alpha/fachada.jpg',
        fileName: 'fachada.jpg',
        mimeType: 'image/jpeg',
        kind: 'image',
        sizeBytes: 2048,
      })
      .returning();

    // Suspende por inadimplencia vencida.
    await api.db
      .update(schema.subscriptions)
      .set({
        status: 'past_due',
        accessUntil: new Date(Date.now() - 30 * 24 * 3600 * 1000),
        publicationState: 'blocked_overdue',
      })
      .where(eq(schema.subscriptions.tenantId, alpha.tenantId));
    expect(await visit()).toBe(404);

    // Conteudo intacto e painel acessivel para regularizar.
    const properties = await alpha.client.get(`/api/tenants/${alpha.tenantId}/properties`);
    expect(properties.status).toBe(200);
    expect(properties.body.items).toHaveLength(1);

    const media = await alpha.client.get(`/api/tenants/${alpha.tenantId}/media`);
    expect(media.status).toBe(200);
    expect(media.body.items.some((item: { id: string }) => item.id === asset!.id)).toBe(true);

    const pages = await alpha.client.get(`/api/tenants/${alpha.tenantId}/pages`);
    expect(pages.status).toBe(200);
    expect(pages.body.pages.length).toBeGreaterThan(0);

    const billing = await alpha.client.get(`/api/tenants/${alpha.tenantId}/billing`);
    expect(billing.status).toBe(200);
    expect(billing.body.subscription.publicationState).toBe('blocked_overdue');
  });

  it('a previa do painel continua funcionando com o site suspenso', async () => {
    await api.db
      .update(schema.subscriptions)
      .set({
        status: 'past_due',
        accessUntil: new Date(Date.now() - 30 * 24 * 3600 * 1000),
        publicationState: 'blocked_overdue',
      })
      .where(eq(schema.subscriptions.tenantId, alpha.tenantId));
    expect(await visit()).toBe(404);

    // A previa autenticada existe justamente para o cliente ver o que tem.
    const preview = await alpha.client.get(`/api/render/preview/${alpha.tenantId}?path=/`);
    expect(preview.status).toBe(200);
  });
});
