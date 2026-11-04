import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  extractToken,
  registerAccount,
  verifyEmail,
  TEST_JOB_SECRET,
  type RegisteredAccount,
  type TestApi,
  type TestClient,
} from '../helpers/api.js';
import { expireTrial, loadSubscriptionRow, startCheckout, syncPlanCode } from '../helpers/billing.js';

/**
 * Troca da forma de pagamento (sem cartao) e do dia de vencimento.
 *
 * O que se quer garantir: nada que mexe em dinheiro acontece sem a empresa ver
 * antes; a simulacao nao altera nada; so quem administra a cobranca troca; e
 * cartao nunca entra por esta porta.
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
  api.billing.calls.length = 0;
  account = await registerAccount(api, {
    email: 'contato@construtorahorizonte.com.br',
    companyName: 'Construtora Horizonte',
  });
  await verifyEmail(api, account);
  await api.db
    .update(schema.tenants)
    .set({ taxId: '12345678000199' })
    .where(eq(schema.tenants.id, account.tenantId));
});

const base = () => `/api/tenants/${account.tenantId}/billing`;

/** Assinatura ativa, paga no cartao, como o job de reconciliacao a encontraria. */
async function contratarNoCartao() {
  const plan = await syncPlanCode(api, 'essencial');
  await expireTrial(api, account.siteId);
  const checkout = await startCheckout(account, plan.id);
  const { subscription } = api.billing.simulatePaidSession(checkout.checkoutSessionId);
  const job = await api.app.request('http://app.localhost:5173/api/billing/reconcile', {
    method: 'POST',
    headers: { authorization: `Bearer ${TEST_JOB_SECRET}` },
  });
  expect(job.status).toBe(200);
  const row = await loadSubscriptionRow(api, account.tenantId);
  expect(row.status).toBe('active');
  expect(row.paymentMethod).toBe('creditcard');
  api.billing.calls.length = 0;
  return { remote: subscription, row };
}

async function addAdmin(email: string): Promise<TestClient> {
  const invite = await account.client.post(`/api/tenants/${account.tenantId}/members/invite`, {
    email,
    role: 'admin',
    name: 'Administrador',
  });
  expect(invite.status, invite.errorMessage ?? '').toBe(201);
  const message = [...api.outbox].reverse().find((m) => m.kind === 'invitation' && m.to === email);
  const client = api.client();
  const accepted = await client.post('/api/auth/accept-invite', {
    token: extractToken(message!.text),
    name: 'Administrador',
    password: 'senhaSegura123',
  });
  expect(accepted.status, accepted.errorMessage ?? '').toBe(200);
  return client;
}

describe('forma de pagamento', () => {
  it('troca do cartao para o boleto e avisa que a renovacao passa a ser manual', async () => {
    const { remote } = await contratarNoCartao();

    const response = await account.client.post(`${base()}/payment-method`, { paymentMethod: 'boleto' });

    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.changed).toBe(true);
    expect(response.body.automaticRenewal).toBe(false);
    expect(response.body.message).toMatch(/renovação é manual/);
    expect(remote.paymentType).toBe('BOLETO');
    // O banco local ja reflete a troca, sem esperar a reconciliacao do dia seguinte.
    expect((await loadSubscriptionRow(api, account.tenantId)).paymentMethod).toBe('boleto');
  });

  it('nunca reemite a cobranca em aberto: a troca vale a partir da proxima', async () => {
    const { remote } = await contratarNoCartao();
    await account.client.post(`${base()}/payment-method`, { paymentMethod: 'pix' });

    const [alterada] = [...api.billing.subscriptions.values()].filter((s) => s.subscriptionId === remote.subscriptionId);
    expect(alterada?.paymentType).toBe('PIX');
    expect(api.billing.calls).toContain('changePaymentMethod');
  });

  it('recusa trocar para a forma que ja e a atual, sem chamar a ValidaPay', async () => {
    await contratarNoCartao();
    await account.client.post(`${base()}/payment-method`, { paymentMethod: 'pix' });
    api.billing.calls.length = 0;

    const response = await account.client.post(`${base()}/payment-method`, { paymentMethod: 'pix' });

    expect(response.status).toBe(409);
    expect(response.errorMessage).toMatch(/já está em Pix/);
    expect(api.billing.calls).not.toContain('changePaymentMethod');
  });

  it('cartao e Pix Automatico nao entram por esta rota', async () => {
    await contratarNoCartao();
    for (const paymentMethod of ['creditcard', 'pix_automatico']) {
      const response = await account.client.post(`${base()}/payment-method`, { paymentMethod });
      expect(response.status, paymentMethod).toBe(422);
    }
    expect(api.billing.calls).not.toContain('changePaymentMethod');
  });

  it('registra a troca no historico de cobranca e na auditoria, sem dado de pagamento', async () => {
    await contratarNoCartao();
    await account.client.post(`${base()}/payment-method`, { paymentMethod: 'boleto' });

    const historico = await api.db
      .select()
      .from(schema.billingAuditLogs)
      .where(eq(schema.billingAuditLogs.action, 'billing.payment_method_changed'));
    expect(historico).toHaveLength(1);
    expect(historico[0]?.metadata).toMatchObject({ from: 'creditcard', to: 'boleto' });

    const auditoria = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'billing.payment_method_changed'));
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]?.actorUserId).toBe(account.userId);
  });
});

describe('dia de vencimento', () => {
  it('a simulacao mostra datas e valor e nao altera nada', async () => {
    const { remote, row } = await contratarNoCartao();
    const antes = remote.nextCycleChargeDate;

    const response = await account.client.post(`${base()}/due-day`, { billingDay: 20, preview: true });

    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.preview).toBe(true);
    expect(response.body.newBillingDay).toBe(20);
    expect(response.body.newNextDueDate).toMatch(/^\d{4}-\d{2}-20$/);
    expect(typeof response.body.prorataAmountCents).toBe('number');
    // Nada mudou: nem no provedor, nem no banco, nem na trilha.
    expect(remote.nextCycleChargeDate).toBe(antes);
    expect(api.billing.calls).toContain('previewDueDay');
    expect(api.billing.calls).not.toContain('changeDueDay');
    const depois = await loadSubscriptionRow(api, account.tenantId);
    expect(depois.nextChargeAt?.getTime()).toBe(row.nextChargeAt?.getTime());
    const historico = await api.db
      .select()
      .from(schema.billingAuditLogs)
      .where(eq(schema.billingAuditLogs.action, 'billing.due_day_changed'));
    expect(historico).toHaveLength(0);
  });

  it('aplica o dia novo, traz a proxima cobranca de volta ao banco e registra', async () => {
    const { remote, row } = await contratarNoCartao();

    const response = await account.client.post(`${base()}/due-day`, { billingDay: 20, prorata: false });

    expect(response.status, response.errorMessage ?? '').toBe(200);
    expect(response.body.preview).toBe(false);
    expect(response.body.changed).toBe(true);
    expect(response.body.message).toMatch(/dia 20/);
    expect(remote.billingDay).toBe(20);
    const depois = await loadSubscriptionRow(api, account.tenantId);
    expect(depois.nextChargeAt?.getUTCDate()).toBe(20);
    expect(depois.nextChargeAt?.getTime()).not.toBe(row.nextChargeAt?.getTime());

    const historico = await api.db
      .select()
      .from(schema.billingAuditLogs)
      .where(eq(schema.billingAuditLogs.action, 'billing.due_day_changed'));
    expect(historico).toHaveLength(1);
    expect(historico[0]?.metadata).toMatchObject({ to: 20, prorata: false });
  });

  it('o valor da diferenca de dias volta em centavos, como o resto da API', async () => {
    await contratarNoCartao();
    const response = await account.client.post(`${base()}/due-day`, { billingDay: 28, preview: true });
    expect(Number.isInteger(response.body.prorataAmountCents)).toBe(true);
    expect(Number.isInteger(response.body.recurringAmountCents)).toBe(true);
    expect(response.body.recurringAmountCents).toBeGreaterThan(0);
  });

  it('so oferece os dias 1 a 28', async () => {
    await contratarNoCartao();
    for (const billingDay of [0, 29, 31, -1, 10.5]) {
      const response = await account.client.post(`${base()}/due-day`, { billingDay, preview: true });
      expect(response.status, String(billingDay)).toBe(422);
    }
    expect(api.billing.calls).not.toContain('previewDueDay');
  });
});

describe('quem pode e quando', () => {
  it('um administrador sem a cobranca nao troca nada', async () => {
    await contratarNoCartao();
    const admin = await addAdmin('admin@construtorahorizonte.com.br');

    const pagamento = await admin.post(`${base()}/payment-method`, { paymentMethod: 'boleto' });
    const vencimento = await admin.post(`${base()}/due-day`, { billingDay: 20 });

    expect(pagamento.status).toBe(403);
    expect(vencimento.status).toBe(403);
    expect(api.billing.calls).not.toContain('changePaymentMethod');
    expect(api.billing.calls).not.toContain('changeDueDay');
  });

  it('sem assinatura contratada, recusa com a explicacao', async () => {
    const pagamento = await account.client.post(`${base()}/payment-method`, { paymentMethod: 'boleto' });
    const vencimento = await account.client.post(`${base()}/due-day`, { billingDay: 20 });
    expect(pagamento.status).toBe(409);
    expect(vencimento.status).toBe(409);
    expect(pagamento.errorMessage).toMatch(/Contrate um plano/);
  });

  it('assinatura com cancelamento agendado nao pode mudar vencimento', async () => {
    await contratarNoCartao();
    const cancelamento = await account.client.post(`${base()}/cancel`, { reason: 'teste', mode: 'period_end' });
    expect(cancelamento.status, cancelamento.errorMessage ?? '').toBe(200);
    api.billing.calls.length = 0;

    const response = await account.client.post(`${base()}/due-day`, { billingDay: 20 });

    expect(response.status).toBe(409);
    expect(response.errorMessage).toMatch(/ativa ou em atraso/);
    expect(api.billing.calls).not.toContain('changeDueDay');
  });

  it('exige e-mail verificado', async () => {
    await contratarNoCartao();
    await api.db
      .update(schema.users)
      .set({ emailVerifiedAt: null })
      .where(eq(schema.users.id, account.userId));
    const response = await account.client.post(`${base()}/due-day`, { billingDay: 20 });
    expect(response.status).toBe(403);
  });

  it('empresa nenhuma mexe na assinatura de outra', async () => {
    await contratarNoCartao();
    const outra = await registerAccount(api, { email: 'outra@empresa.com.br', companyName: 'Outra Empresa' });
    await verifyEmail(api, outra);

    const response = await outra.client.post(`/api/tenants/${account.tenantId}/billing/due-day`, { billingDay: 20 });

    expect([403, 404]).toContain(response.status);
    expect(api.billing.calls).not.toContain('changeDueDay');
  });
});

describe('falha do provedor', () => {
  it('uma falha na troca nao deixa o banco dizendo que trocou', async () => {
    await contratarNoCartao();
    api.billing.failNext('changePaymentMethod', new Error('indisponivel'));

    const response = await account.client.post(`${base()}/payment-method`, { paymentMethod: 'boleto' });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await loadSubscriptionRow(api, account.tenantId)).paymentMethod).toBe('creditcard');
    const historico = await api.db
      .select()
      .from(schema.billingAuditLogs)
      .where(eq(schema.billingAuditLogs.action, 'billing.payment_method_changed'));
    expect(historico).toHaveLength(0);
  });
});
