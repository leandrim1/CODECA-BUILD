import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  TEST_JOB_SECRET,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';
import {
  expireTrial,
  loadChargeRows,
  loadEventRows,
  loadSubscriptionRow,
  sendWebhook,
  startCheckout,
  subscriptionPayload,
  syncPlanCode,
} from '../helpers/billing.js';

/**
 * Reconciliacao.
 *
 * Existe para os casos em que o webhook nao chegou, chegou incompleto ou nao
 * pode ser aplicado. Dois cuidados sao verificados aqui: a reconciliacao
 * corrige divergencias e **nao** duplica pagamento nem periodo, porque passa
 * pelas mesmas funcoes monotonicas do webhook.
 */

let api: TestApi;
let account: RegisteredAccount;
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
  account = await registerAccount(api, {
    email: 'contato@construtorahorizonte.com.br',
    companyName: 'Construtora Horizonte',
  });
  await verifyEmail(api, account);
  // Documento da empresa: usado para localizar a assinatura no provedor.
  await api.db
    .update(schema.tenants)
    .set({ taxId: '12345678000199' })
    .where(eq(schema.tenants.id, account.tenantId));

  const plan = await syncPlanCode(api, 'essencial');
  planId = plan.id;
  priceCents = plan.priceCents;
});

/** Dispara o job como a Vercel Cron faria. */
async function runJob(method: 'GET' | 'POST' = 'POST', secret = TEST_JOB_SECRET) {
  const response = await api.app.request('http://app.localhost:5173/api/billing/reconcile', {
    method,
    headers: { authorization: `Bearer ${secret}` },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as { data?: Record<string, unknown> }) : {},
  };
}

describe('recuperacao de pagamento sem webhook', () => {
  it('encontra a assinatura paga quando o evento nunca chegou', async () => {
    await expireTrial(api, account.tenantId);
    const checkout = await startCheckout(account, planId);

    // O cliente paga, mas nenhum webhook e entregue.
    const { subscription: remote } = api.billing.simulatePaidSession(checkout.checkoutSessionId);
    expect((await loadSubscriptionRow(api, account.tenantId)).externalSubscriptionId).toBeNull();

    const job = await runJob();
    expect(job.status).toBe(200);

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.externalSubscriptionId).toBe(remote.subscriptionId);
    expect(subscription.status).toBe('active');
    expect(subscription.publicationState).toBe('allowed');
    expect(subscription.accessUntil).not.toBeNull();
    expect(subscription.lastSyncedAt).not.toBeNull();

    // A cobranca do ciclo pago tambem foi registrada.
    const charges = await loadChargeRows(api, account.tenantId);
    expect(charges).toHaveLength(1);
    expect(charges[0]?.status).toBe('paid');
    expect(charges[0]?.amountCents).toBe(priceCents);
  });

  it('nao duplica periodo nem cobranca quando roda duas vezes', async () => {
    await expireTrial(api, account.tenantId);
    const checkout = await startCheckout(account, planId);
    api.billing.simulatePaidSession(checkout.checkoutSessionId);

    await runJob();
    const first = await loadSubscriptionRow(api, account.tenantId);
    const firstCharges = await loadChargeRows(api, account.tenantId);

    // Segunda e terceira passagens, forcando a reconsulta.
    await api.db
      .update(schema.subscriptions)
      .set({ lastSyncedAt: new Date(Date.now() - 24 * 3600 * 1000) })
      .where(eq(schema.subscriptions.tenantId, account.tenantId));
    await runJob();
    await runJob();

    const after = await loadSubscriptionRow(api, account.tenantId);
    expect(after.accessUntil?.toISOString()).toBe(first.accessUntil?.toISOString());
    expect(await loadChargeRows(api, account.tenantId)).toHaveLength(firstCharges.length);
  });

  it('nao vincula uma assinatura que nao aponta para a nossa sessao', async () => {
    await expireTrial(api, account.tenantId);
    const checkout = await startCheckout(account, planId);

    // Assinatura existe no provedor com o mesmo documento, mas de outra
    // sessao: o documento sozinho nao prova de quem e.
    const other = api.billing.simulatePaidSession(checkout.checkoutSessionId);
    other.subscription.checkoutId = 'cs_de_outra_origem';

    const job = await runJob();
    expect(job.status).toBe(200);

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.externalSubscriptionId).toBeNull();
    expect(subscription.status).toBe('pending');
    expect(subscription.publicationState).toBe('blocked_pending');

    const report = job.body.data as { divergences: unknown[] };
    expect(report.divergences.length).toBeGreaterThan(0);
  });

  it('descobre o pagamento de uma cobranca em aberto', async () => {
    await expireTrial(api, account.tenantId);
    await startCheckout(account, planId);
    const subscription = await loadSubscriptionRow(api, account.tenantId);

    // Cobranca aberta pelo webhook `charge.created`.
    await sendWebhook(api, 'subscription.created', subscriptionPayload({
      subscriptionId: 'sub_horizonte',
      status: 'PENDING',
      amountCents: priceCents,
      paidAt: null,
      cycleStatus: 'PENDING',
      timestamp: new Date(Date.now() - 120_000),
      metadata: { tenantId: account.tenantId, intentToken: subscription.intentToken },
    }));

    await sendWebhook(api, 'charge.created', {
      timestamp: new Date(Date.now() - 60_000).toISOString(),
      accountNumber: '4231833',
      subscriptionId: 'sub_horizonte',
      chargeId: 'cha_pix_em_aberto',
      status: 'AWAITING_PAYMENT',
      amount: priceCents / 100,
      currency: 'BRL',
      paymentType: 'PIX',
      dueDate: new Date(Date.now() + 86_400_000).toISOString(),
      paidAt: null,
    });

    let charges = await loadChargeRows(api, account.tenantId);
    expect(charges[0]?.status).toBe('awaiting_payment');

    // O provedor registra o pagamento; nenhum webhook chega.
    api.billing.charges.set('cha_pix_em_aberto', {
      chargeId: 'cha_pix_em_aberto',
      status: 'PAID',
      amount: priceCents / 100,
      paymentType: 'PIX',
      paidAt: new Date().toISOString(),
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: null,
    });
    api.billing.subscriptions.set('sub_horizonte', {
      subscriptionId: 'sub_horizonte',
      status: 'ACTIVE',
      interval: 'MONTHLY',
      paymentType: 'PIX',
      nextCycleChargeDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      currentCycleNumber: 1,
      currentCycleAmount: priceCents / 100,
      cancelAtPeriodEnd: false,
    });

    const job = await runJob();
    expect(job.status).toBe(200);

    charges = await loadChargeRows(api, account.tenantId);
    expect(charges[0]?.status).toBe('paid');
    expect(charges[0]?.paidAt).not.toBeNull();
    expect(charges[0]?.lastSyncedAt).not.toBeNull();

    const after = await loadSubscriptionRow(api, account.tenantId);
    expect(after.status).toBe('active');
    expect(after.publicationState).toBe('allowed');
  });
});

describe('divergencia de estado', () => {
  it('corrige o estado local a partir do provedor e registra a divergencia', async () => {
    await expireTrial(api, account.tenantId);
    await startCheckout(account, planId);

    // Local diz ativa; o provedor diz cancelada.
    await api.db
      .update(schema.subscriptions)
      .set({
        externalSubscriptionId: 'sub_horizonte',
        status: 'active',
        publicationState: 'allowed',
        accessUntil: new Date(Date.now() + 10 * 24 * 3600 * 1000),
        lastSyncedAt: new Date(Date.now() - 24 * 3600 * 1000),
      })
      .where(eq(schema.subscriptions.tenantId, account.tenantId));

    api.billing.subscriptions.set('sub_horizonte', {
      subscriptionId: 'sub_horizonte',
      status: 'CANCELED',
      interval: 'MONTHLY',
      cancelAtPeriodEnd: false,
      nextCycleChargeDate: null,
      currentCycleNumber: 1,
    });

    const job = await runJob();
    const report = job.body.data as {
      subscriptionsUpdated: number;
      divergences: Array<{ detail: string }>;
    };
    expect(report.subscriptionsUpdated).toBeGreaterThan(0);
    expect(report.divergences[0]?.detail).toMatch(/active.*canceled/i);

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('canceled');
    expect(subscription.providerStatus).toBe('CANCELED');
    // Periodo pago pela frente: o site continua no ar ate o fim.
    expect(subscription.publicationState).toBe('allowed');

    const history = await api.db
      .select()
      .from(schema.billingAuditLogs)
      .where(eq(schema.billingAuditLogs.tenantId, account.tenantId));
    expect(
      history.some((entry) => entry.action === 'billing.reconciliation_divergence'),
    ).toBe(true);
  });

  it('nao desfaz uma suspensao administrativa', async () => {
    await startCheckout(account, planId);
    await api.db
      .update(schema.subscriptions)
      .set({
        externalSubscriptionId: 'sub_horizonte',
        status: 'suspended',
        adminHold: true,
        adminHoldReason: 'Suspensao manual para revisao.',
        publicationState: 'blocked_admin',
        lastSyncedAt: new Date(Date.now() - 24 * 3600 * 1000),
      })
      .where(eq(schema.subscriptions.tenantId, account.tenantId));

    api.billing.subscriptions.set('sub_horizonte', {
      subscriptionId: 'sub_horizonte',
      status: 'ACTIVE',
      interval: 'MONTHLY',
      cancelAtPeriodEnd: false,
      nextCycleChargeDate: new Date(Date.now() + 2.6e9).toISOString(),
      currentCycleNumber: 2,
    });

    await runJob();

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('suspended');
    expect(subscription.adminHold).toBe(true);
    expect(subscription.publicationState).toBe('blocked_admin');
    // O status do provedor e registrado, sem mudar a decisao administrativa.
    expect(subscription.providerStatus).toBe('ACTIVE');
  });
});

describe('passagem do tempo', () => {
  it('suspende quem teve a tolerancia vencida, sem depender de evento novo', async () => {
    await api.db
      .update(schema.subscriptions)
      .set({
        status: 'past_due',
        accessUntil: new Date(Date.now() - 30 * 24 * 3600 * 1000),
        publicationState: 'allowed',
      })
      .where(eq(schema.subscriptions.tenantId, account.tenantId));

    const job = await runJob();
    const report = job.body.data as { publicationsChanged: number };
    expect(report.publicationsChanged).toBeGreaterThan(0);

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.publicationState).toBe('blocked_overdue');
  });

  it('suspende a avaliacao vencida', async () => {
    await api.db
      .update(schema.subscriptions)
      .set({
        status: 'trialing',
        trialEndsAt: new Date(Date.now() - 20 * 24 * 3600 * 1000),
        accessUntil: new Date(Date.now() - 20 * 24 * 3600 * 1000),
        publicationState: 'allowed',
      })
      .where(eq(schema.subscriptions.tenantId, account.tenantId));

    await runJob();

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.publicationState).toBe('blocked_overdue');
  });

  it('o recalculo do tempo funciona sem credenciais do provedor', async () => {
    const isolated = await createTestApi();
    try {
      const other = await registerAccount(isolated, {
        email: 'tempo@construtora.com.br',
        companyName: 'Construtora Tempo',
      });
      await isolated.db
        .update(schema.subscriptions)
        .set({
          status: 'past_due',
          accessUntil: new Date(Date.now() - 30 * 24 * 3600 * 1000),
          publicationState: 'allowed',
        })
        .where(eq(schema.subscriptions.tenantId, other.tenantId));

      const response = await isolated.app.request(
        'http://app.localhost:5173/api/billing/reconcile',
        { method: 'POST', headers: { authorization: `Bearer ${TEST_JOB_SECRET}` } },
      );
      expect(response.status).toBe(200);

      const [subscription] = await isolated.db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.tenantId, other.tenantId));
      expect(subscription?.publicationState).toBe('blocked_overdue');
    } finally {
      await isolated.close();
    }
  });
});

describe('eventos pendentes', () => {
  it('o job reprocessa eventos que ficaram com falha', async () => {
    await expireTrial(api, account.tenantId);
    await startCheckout(account, planId);
    const subscription = await loadSubscriptionRow(api, account.tenantId);

    // Cobranca de outra empresa com o mesmo id: o evento falha ao ser aplicado.
    const other = await registerAccount(api, {
      email: 'outra@construtora.com.br',
      companyName: 'Outra Construtora',
    });
    await api.db.insert(schema.charges).values({
      tenantId: other.tenantId,
      externalChargeId: 'cha_conflito',
      status: 'pending',
      amountCents: 1000,
    });

    await sendWebhook(api, 'subscription.created', subscriptionPayload({
      subscriptionId: 'sub_horizonte',
      status: 'PENDING',
      amountCents: priceCents,
      paidAt: null,
      cycleStatus: 'PENDING',
      timestamp: new Date(Date.now() - 180_000),
      metadata: { tenantId: account.tenantId, intentToken: subscription.intentToken },
    }));

    const failing = await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_horizonte',
        status: 'ACTIVE',
        amountCents: priceCents,
        chargeId: 'cha_conflito',
        nextChargeDate: new Date(Date.now() + 2.6e9),
      }),
      { eventId: 'evt_falho' },
    );
    expect(failing.body.data?.status).toBe('failed');

    // Corrigido o conflito, o job retoma o evento.
    await api.db.delete(schema.charges).where(eq(schema.charges.externalChargeId, 'cha_conflito'));

    const job = await runJob();
    const report = job.body.data as { pendingEventsReplayed: number };
    expect(report.pendingEventsReplayed).toBeGreaterThan(0);

    const events = await loadEventRows(api);
    expect(events.find((event) => event.externalEventId === 'evt_falho')?.status).toBe('processed');

    const after = await loadSubscriptionRow(api, account.tenantId);
    expect(after.status).toBe('active');
    expect(after.publicationState).toBe('allowed');
  });

  it('aceita GET, como a Vercel Cron dispara', async () => {
    const job = await runJob('GET');
    expect(job.status).toBe(200);
    expect(job.body.data).toHaveProperty('subscriptionsChecked');
  });
});

describe('reconciliacao pelo painel mestre', () => {
  it('o administrador reconcilia uma empresa e ve o relatorio', async () => {
    const admin = await registerAccount(api, {
      email: 'admin@codecabuild.test',
      companyName: 'Plataforma',
    });
    await api.db
      .update(schema.users)
      .set({ platformRole: 'platform_admin' })
      .where(eq(schema.users.id, admin.userId));

    await expireTrial(api, account.tenantId);
    const checkout = await startCheckout(account, planId);
    api.billing.simulatePaidSession(checkout.checkoutSessionId);

    const response = await admin.client.post('/api/platform/billing/reconcile', {
      tenantId: account.tenantId,
      force: true,
      limit: 10,
    });
    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.subscriptionsChecked).toBeGreaterThan(0);

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('active');
  });
});
