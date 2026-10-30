import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
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
 * Painel mestre: cobranca.
 *
 * A regra que estes testes protegem: uma acao administrativa registra uma
 * decisao propria e nao reescreve o que a ValidaPay confirmou. Suspender a
 * publicacao tambem nao apaga nada da empresa.
 */

let api: TestApi;
let admin: RegisteredAccount;
let company: RegisteredAccount;
let planId: string;
let priceCents: number;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  admin = await registerAccount(api, {
    email: 'admin@codecabuild.test',
    companyName: 'Plataforma Codeca',
  });
  await api.db
    .update(schema.users)
    .set({ platformRole: 'platform_admin' })
    .where(eq(schema.users.id, admin.userId));

  company = await registerAccount(api, {
    email: 'contato@construtorahorizonte.com.br',
    companyName: 'Construtora Horizonte',
  });
  await verifyEmail(api, company);

  const plan = await syncPlanCode(api, 'essencial');
  planId = plan.id;
  priceCents = plan.priceCents;
});

/** Deixa a empresa com assinatura ativa e um ciclo pago. */
async function activate(nextChargeDays = 30): Promise<void> {
  await startCheckout(company, planId);
  const subscription = await loadSubscriptionRow(api, company.tenantId);
  await sendWebhook(
    api,
    'payment.success',
    subscriptionPayload({
      subscriptionId: 'sub_horizonte',
      status: 'ACTIVE',
      amountCents: priceCents,
      chargeId: 'cha_horizonte_1',
      nextChargeDate: new Date(Date.now() + nextChargeDays * 24 * 3600 * 1000),
      metadata: { tenantId: company.tenantId, intentToken: subscription.intentToken },
    }),
  );
}

describe('visao geral', () => {
  it('resume assinaturas, recebimentos e estado da integracao', async () => {
    await activate();

    const response = await admin.client.get('/api/platform/billing/overview');
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.subscriptions.active).toBe(1);
    expect(response.body.paidLast30Days.count).toBe(1);
    expect(response.body.paidLast30Days.amountCents).toBe(priceCents);
    expect(response.body.provider.configured).toBe(true);
    expect(response.body.provider.webhooksConfigured).toBe(true);
    expect(response.body.provider.reconciliationConfigured).toBe(true);

    // Planos: o gratuito aparece marcado como nao cobravel.
    const trial = response.body.plans.find((plan: { code: string }) => plan.code === 'trial');
    expect(trial.billable).toBe(false);
    const essencial = response.body.plans.find((plan: { code: string }) => plan.code === 'essencial');
    expect(essencial.synced).toBe(true);
  });

  it('lista as assinaturas com o identificador externo e a ultima sincronizacao', async () => {
    await activate();

    const response = await admin.client.get('/api/platform/billing/subscriptions');
    expect(response.status).toBe(200);
    const row = response.body.items.find(
      (item: { tenantId: string }) => item.tenantId === company.tenantId,
    );
    expect(row.state).toBe('active');
    expect(row.externalSubscriptionId).toBe('sub_horizonte');
    expect(row.publicationState).toBe('allowed');
    expect(row.planName).toBeTruthy();
  });

  it('filtra assinaturas por estado', async () => {
    await activate();
    const response = await admin.client.get(
      '/api/platform/billing/subscriptions?state=trialing',
    );
    expect(response.status).toBe(200);
    expect(
      response.body.items.every((item: { state: string }) => item.state === 'trialing'),
    ).toBe(true);
  });

  it('lista cobrancas por empresa e por valor', async () => {
    await activate();

    const byTenant = await admin.client.get(
      `/api/platform/billing/charges?tenantId=${company.tenantId}`,
    );
    expect(byTenant.status).toBe(200);
    expect(byTenant.body.items).toHaveLength(1);
    expect(byTenant.body.items[0].tenantName).toBe('Construtora Horizonte');

    const byAmount = await admin.client.get(
      `/api/platform/billing/charges?minCents=${priceCents + 1}`,
    );
    expect(byAmount.body.items).toHaveLength(0);
  });

  it('mostra o historico de cobranca com a origem de cada mudanca', async () => {
    await activate();

    const response = await admin.client.get(
      `/api/platform/billing/history?tenantId=${company.tenantId}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    const sources = new Set(response.body.items.map((item: { source: string }) => item.source));
    expect(sources.has('webhook')).toBe(true);
    expect(sources.has('checkout')).toBe(true);
  });
});

describe('suspensao manual da publicacao', () => {
  it('suspende sem alterar o estado financeiro e sem apagar conteudo', async () => {
    await activate();

    const property = await company.client.post(`/api/tenants/${company.tenantId}/properties`, {
      title: 'Residencial Aurora',
      type: 'apartamento',
      purpose: 'venda',
      publicationStatus: 'published',
    });
    expect(property.status).toBe(201);

    const before = await loadSubscriptionRow(api, company.tenantId);

    const response = await admin.client.post('/api/platform/billing/publication-hold', {
      siteId: company.siteId,
      hold: true,
      reason: 'Conteudo em analise pela equipe de confianca.',
    });
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.adminHold).toBe(true);
    expect(response.body.publicationState).toBe('blocked_admin');

    const after = await loadSubscriptionRow(api, company.tenantId);
    // A decisao administrativa fica em campo proprio.
    expect(after.adminHold).toBe(true);
    expect(after.adminHoldReason).toContain('analise');
    expect(after.adminHoldByUserId).toBe(admin.userId);
    expect(after.publicationState).toBe('blocked_admin');
    // O estado financeiro confirmado pela ValidaPay nao muda.
    expect(after.status).toBe(before.status);
    expect(after.providerStatus).toBe(before.providerStatus);
    expect(after.accessUntil?.toISOString()).toBe(before.accessUntil?.toISOString());

    // O conteudo continua salvo.
    const properties = await company.client.get(`/api/tenants/${company.tenantId}/properties`);
    expect(properties.body.items).toHaveLength(1);

    // A auditoria registra a decisao com justificativa e autor.
    const history = await api.db
      .select()
      .from(schema.billingAuditLogs)
      .where(eq(schema.billingAuditLogs.tenantId, company.tenantId));
    const entry = history.find((item) => item.action === 'billing.admin_hold_applied');
    expect(entry?.source).toBe('admin');
    expect(entry?.actorUserId).toBe(admin.userId);
    expect(entry?.reason).toContain('analise');
    expect(entry?.newPublication).toBe('blocked_admin');
  });

  it('reativa e devolve a publicacao ao estado da assinatura', async () => {
    await activate();
    await admin.client.post('/api/platform/billing/publication-hold', {
      siteId: company.siteId,
      hold: true,
      reason: 'Suspensao temporaria para revisao.',
    });

    const response = await admin.client.post('/api/platform/billing/publication-hold', {
      siteId: company.siteId,
      hold: false,
      reason: 'Revisao concluida sem problemas.',
    });
    expect(response.status).toBe(200);
    expect(response.body.publicationState).toBe('allowed');

    const subscription = await loadSubscriptionRow(api, company.tenantId);
    expect(subscription.adminHold).toBe(false);
    expect(subscription.adminHoldReason).toBe('');
    expect(subscription.publicationState).toBe('allowed');
  });

  it('exige justificativa com ao menos dez caracteres', async () => {
    await activate();
    const response = await admin.client.post('/api/platform/billing/publication-hold', {
      siteId: company.siteId,
      hold: true,
      reason: 'nao',
    });
    expect(response.status).toBe(422);
  });

  it('um evento do provedor nao desfaz a suspensao administrativa', async () => {
    await activate();
    await admin.client.post('/api/platform/billing/publication-hold', {
      siteId: company.siteId,
      hold: true,
      reason: 'Suspensao administrativa em vigor.',
    });

    // Renovacao paga chega normalmente.
    await sendWebhook(
      api,
      'subscription.renewed',
      subscriptionPayload({
        subscriptionId: 'sub_horizonte',
        status: 'ACTIVE',
        amountCents: priceCents,
        chargeId: 'cha_horizonte_2',
        cycleNumber: 2,
        nextChargeDate: new Date(Date.now() + 60 * 24 * 3600 * 1000),
      }),
    );

    const subscription = await loadSubscriptionRow(api, company.tenantId);
    // O pagamento e registrado, mas o site segue suspenso pela plataforma.
    expect(subscription.adminHold).toBe(true);
    expect(subscription.publicationState).toBe('blocked_admin');
    expect(subscription.accessUntil!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('tolerancia por empresa', () => {
  it('ajusta a tolerancia e recalcula a publicacao', async () => {
    await expireTrial(api, company.siteId);
    await api.db
      .update(schema.subscriptions)
      .set({
        status: 'past_due',
        accessUntil: new Date(Date.now() - 3 * 24 * 3600 * 1000),
        gracePeriodDays: 5,
      })
      .where(eq(schema.subscriptions.tenantId, company.tenantId));

    // Com 5 dias de tolerancia e 3 dias de atraso, o site esta no ar.
    const toZero = await admin.client.post('/api/platform/billing/grace-period', {
      siteId: company.siteId,
      gracePeriodDays: 0,
      reason: 'Politica comercial para inadimplencia recorrente.',
    });
    expect(toZero.status, toZero.errorMessage ?? '').toBe(200);
    expect(toZero.body.publicationState).toBe('blocked_overdue');

    const back = await admin.client.post('/api/platform/billing/grace-period', {
      siteId: company.siteId,
      gracePeriodDays: 10,
      reason: 'Acordo de regularizacao com o cliente.',
    });
    expect(back.body.gracePeriodDays).toBe(10);
    expect(back.body.publicationState).toBe('allowed');
  });
});

describe('sincronizacao de planos', () => {
  it('sincroniza um plano e grava os identificadores externos', async () => {
    const [plan] = await api.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.code, 'profissional'));

    const response = await admin.client.post(`/api/platform/billing/plans/${plan!.id}/sync`);
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.externalProductId).toMatch(/^prod_/);
    expect(response.body.externalPriceId).toMatch(/^price_/);

    const [synced] = await api.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, plan!.id));
    expect(synced?.externalPriceId).toBe(response.body.externalPriceId);
    expect(synced?.externalSyncedAt).not.toBeNull();
    expect(synced?.externalSyncError).toBe('');
  });

  it('recusa sincronizar um plano gratuito', async () => {
    const [trial] = await api.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.code, 'trial'));

    const response = await admin.client.post(`/api/platform/billing/plans/${trial!.id}/sync`);
    expect(response.status).toBe(400);
    expect(response.errorMessage).toMatch(/gratuito|maior que zero/i);
  });

  it('mudar o preco desfaz o vinculo e pede nova sincronizacao', async () => {
    const [plan] = await api.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.code, 'essencial'));
    expect(plan?.externalPriceId).toBeTruthy();

    const response = await admin.client.patch(`/api/platform/plans/${plan!.id}`, {
      priceCents: 24900,
    });
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.notice).toMatch(/sincronize/i);
    expect(response.body.plan.externalPriceId).toBeNull();
  });

  it('registra a falha de sincronizacao sem derrubar a rota', async () => {
    const [plan] = await api.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.code, 'profissional'));
    api.billing.failNext('syncPlan', new Error('provedor indisponivel'));

    const response = await admin.client.post(`/api/platform/billing/plans/${plan!.id}/sync`);
    expect(response.status).toBeGreaterThanOrEqual(400);

    const [after] = await api.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, plan!.id));
    expect(after?.externalSyncError).toContain('provedor indisponivel');
  });
});

describe('eventos de webhook no painel', () => {
  it('lista eventos por situacao e permite inspecionar um deles', async () => {
    await activate();

    const processed = await admin.client.get('/api/platform/billing/webhooks?status=processed');
    expect(processed.status).toBe(200);
    expect(processed.body.items.length).toBeGreaterThan(0);

    const first = processed.body.items[0];
    const detail = await admin.client.get(`/api/platform/billing/webhooks/${first.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.event.event).toBe(first.event);
    // O payload fica disponivel para auditoria.
    expect(detail.body.event.payload).toBeTruthy();
  });
});
