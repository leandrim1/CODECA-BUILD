import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  TEST_WEBHOOK_SECRET,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';
import {
  expireTrial,
  loadChargeRows,
  loadEventRows,
  loadSubscriptionRow,
  reais,
  sendWebhook,
  startCheckout,
  subscriptionPayload,
  syncPlanCode,
} from '../helpers/billing.js';

/**
 * Webhooks de pagamento.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *  - um corpo nao assinado ou com assinatura invalida nunca e aplicado;
 *  - o mesmo evento, chegando varias vezes, nao credita o periodo duas vezes;
 *  - um evento atrasado nao desfaz um estado mais novo;
 *  - um evento valido que falhe ao ser aplicado fica gravado para reprocesso.
 */

let api: TestApi;
let account: RegisteredAccount;
let planId: string;
let priceId: string;
let priceCents: number;
let sessionId: string;
let intentToken: string;

const SUB_ID = 'sub_1786746719522_teste';
const CHARGE_ID = 'cha_1788634613625_teste';

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

  const plan = await syncPlanCode(api, 'essencial');
  planId = plan.id;
  priceId = plan.priceId;
  priceCents = plan.priceCents;

  const checkout = await startCheckout(account, planId);
  sessionId = checkout.checkoutSessionId;
  const subscription = await loadSubscriptionRow(api, account.tenantId);
  intentToken = subscription.intentToken ?? '';
});

/** Payload padrao de um evento de assinatura deste cenario. */
const payloadFor = (
  overrides: Partial<Parameters<typeof subscriptionPayload>[0]> = {},
): Record<string, unknown> =>
  subscriptionPayload({
    subscriptionId: SUB_ID,
    status: 'ACTIVE',
    amountCents: priceCents,
    priceId,
    metadata: { tenantId: account.tenantId, planId, intentToken },
    ...overrides,
  });

describe('verificacao da assinatura', () => {
  it('aceita um evento assinado corretamente', async () => {
    const response = await sendWebhook(
      api,
      'subscription.created',
      payloadFor({ status: 'PENDING', cycleStatus: 'PENDING', paidAt: null }),
    );

    expect(response.status).toBe(200);
    expect(response.body.data?.received).toBe(true);
    expect(response.body.data?.status).toBe('processed');

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.externalSubscriptionId).toBe(SUB_ID);
    // Assinatura criada nao e assinatura paga: o estado comercial fica
    // pendente e nenhum periodo novo e concedido.
    expect(subscription.status).toBe('pending');
    expect(subscription.publicationState).toBe('blocked_pending');
    expect(subscription.currentPeriodStart).not.toBeNull();
    // O acesso continua sendo o da avaliacao, e nao o do ciclo nao pago.
    expect(subscription.accessUntil?.toISOString()).toBe(
      subscription.trialEndsAt?.toISOString(),
    );
  });

  it('recusa assinatura invalida e nao grava o evento', async () => {
    const before = await loadSubscriptionRow(api, account.tenantId);

    const response = await sendWebhook(api, 'payment.success', payloadFor(), {
      corruptSignature: true,
    });

    expect(response.status).toBe(401);
    expect(await loadEventRows(api)).toHaveLength(0);

    // Nada mudou: nem estado, nem acesso, nem cobranca.
    const after = await loadSubscriptionRow(api, account.tenantId);
    expect(after.status).toBe(before.status);
    expect(after.accessUntil?.toISOString()).toBe(before.accessUntil?.toISOString());
    expect(await loadChargeRows(api, account.tenantId)).toHaveLength(0);
  });

  it('recusa evento sem o cabecalho de assinatura', async () => {
    const response = await sendWebhook(api, 'payment.success', payloadFor(), {
      omitSignature: true,
    });

    expect(response.status).toBe(401);
    expect(response.body.error?.message).toMatch(/X-Webhook-Signature/i);
    expect(await loadEventRows(api)).toHaveLength(0);
  });

  it('recusa assinatura feita com outro segredo', async () => {
    const response = await sendWebhook(api, 'payment.success', payloadFor(), {
      secret: 'outro-segredo-completamente-diferente-32',
    });

    expect(response.status).toBe(401);
    expect(await loadEventRows(api)).toHaveLength(0);
  });

  it('recusa timestamp fora da janela de tolerancia', async () => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const response = await sendWebhook(api, 'payment.success', payloadFor(), {
      signedAtMs: tenMinutesAgo,
    });

    expect(response.status).toBe(401);
    expect(response.body.error?.message).toMatch(/tolerancia/i);
    expect(await loadEventRows(api)).toHaveLength(0);
  });

  it('aceita timestamp dentro da janela', async () => {
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
    const response = await sendWebhook(api, 'subscription.created', payloadFor({ status: 'PENDING' }), {
      signedAtMs: twoMinutesAgo,
    });

    expect(response.status).toBe(200);
  });

  it('a assinatura cobre o corpo: alterar o valor invalida o evento', async () => {
    // Assina um corpo e envia outro, como faria um atacante de posse da
    // assinatura de um evento legitimo.
    const body = JSON.stringify({ event: 'payment.success', ...payloadFor() });
    const tampered = body.replace(`"amount":${reais(priceCents)}`, '"amount":0.01');
    expect(tampered).not.toBe(body);

    const signedAt = Date.now();
    const { signWebhookBody } = await import('@codeca/api');
    const signature = signWebhookBody(signedAt, body, TEST_WEBHOOK_SECRET);

    const response = await api.app.request('http://app.localhost:5173/api/webhooks/validapay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-event': 'payment.success',
        'x-webhook-id': 'evt_corpo_alterado',
        'x-webhook-signature': `t=${signedAt},v1=${signature}`,
      },
      body: tampered,
    });

    expect(response.status).toBe(401);
    expect(await loadEventRows(api)).toHaveLength(0);
  });
});

describe('pagamento confirmado', () => {
  it('ativa a assinatura, libera a publicacao e grava a cobranca', async () => {
    const nextCharge = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await sendWebhook(api, 'subscription.created', payloadFor({ status: 'PENDING', paidAt: null }));

    const response = await sendWebhook(
      api,
      'payment.success',
      payloadFor({
        status: 'ACTIVE',
        cycleStatus: 'PAID',
        nextChargeDate: nextCharge,
        chargeId: CHARGE_ID,
        invoiceId: 'inv_teste_1',
        paymentType: 'CREDIT_CARD',
      }),
    );
    expect(response.status).toBe(200);

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('active');
    expect(subscription.publicationState).toBe('allowed');
    expect(subscription.accessUntil?.toISOString()).toBe(nextCharge.toISOString());
    expect(subscription.paymentMethod).toBe('creditcard');
    expect(subscription.planId).toBe(planId); // plano promovido so com pagamento

    const charges = await loadChargeRows(api, account.tenantId);
    expect(charges).toHaveLength(1);
    expect(charges[0]?.status).toBe('paid');
    // Valor em reais no evento, centavos no banco.
    expect(charges[0]?.amountCents).toBe(priceCents);
    expect(charges[0]?.externalChargeId).toBe(CHARGE_ID);

    // A empresa passou a ter os limites do plano contratado.
    const [tenant] = await api.db
      .select({ planId: schema.tenants.planId })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, account.tenantId));
    expect(tenant?.planId).toBe(planId);
  });

  it('nao credita o periodo duas vezes quando o evento chega repetido', async () => {
    const nextCharge = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const payload = payloadFor({
      status: 'ACTIVE',
      nextChargeDate: nextCharge,
      chargeId: CHARGE_ID,
    });

    const first = await sendWebhook(api, 'payment.success', payload, { eventId: 'evt_unico' });
    expect(first.body.data?.duplicate).toBe(false);

    const before = await loadSubscriptionRow(api, account.tenantId);

    // Reentrega: mesmo X-Webhook-Id, tres vezes.
    for (const attempt of [2, 3, 4]) {
      const repeat = await sendWebhook(api, 'payment.success', payload, {
        eventId: 'evt_unico',
        attempt,
      });
      expect(repeat.status).toBe(200);
      expect(repeat.body.data?.duplicate).toBe(true);
    }

    const after = await loadSubscriptionRow(api, account.tenantId);
    expect(after.accessUntil?.toISOString()).toBe(before.accessUntil?.toISOString());
    expect(after.currentCycleNumber).toBe(before.currentCycleNumber);

    // Uma unica cobranca e um unico evento gravados.
    expect(await loadChargeRows(api, account.tenantId)).toHaveLength(1);
    expect(await loadEventRows(api)).toHaveLength(1);
  });

  it('nao duplica a cobranca quando o mesmo pagamento chega com outro id de evento', async () => {
    const payload = payloadFor({ chargeId: CHARGE_ID, nextChargeDate: new Date(Date.now() + 2.6e9) });

    await sendWebhook(api, 'payment.success', payload, { eventId: 'evt_a' });
    await sendWebhook(api, 'payment.success', payload, { eventId: 'evt_b' });

    // Dois eventos distintos foram registrados, mas a cobranca e unica.
    expect(await loadEventRows(api)).toHaveLength(2);
    const charges = await loadChargeRows(api, account.tenantId);
    expect(charges).toHaveLength(1);
    expect(charges[0]?.status).toBe('paid');
  });

  it('a renovacao estende o acesso sem encurtar o periodo ja pago', async () => {
    const firstEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const secondEnd = new Date(Date.now() + 60 * 24 * 3600 * 1000);

    await sendWebhook(
      api,
      'payment.success',
      payloadFor({ nextChargeDate: firstEnd, chargeId: 'cha_ciclo_1', cycleNumber: 1 }),
    );
    await sendWebhook(
      api,
      'subscription.renewed',
      payloadFor({ nextChargeDate: secondEnd, chargeId: 'cha_ciclo_2', cycleNumber: 2 }),
    );

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.accessUntil?.toISOString()).toBe(secondEnd.toISOString());
    expect(subscription.currentCycleNumber).toBe(2);
    expect(await loadChargeRows(api, account.tenantId)).toHaveLength(2);
  });
});

describe('eventos fora de ordem', () => {
  it('um evento antigo nao desfaz um estado mais novo', async () => {
    const now = Date.now();
    const periodEnd = new Date(now + 30 * 24 * 3600 * 1000);

    // O pagamento acontece "agora".
    await sendWebhook(
      api,
      'payment.success',
      payloadFor({
        nextChargeDate: periodEnd,
        chargeId: CHARGE_ID,
        timestamp: new Date(now),
      }),
    );

    // Um `subscription.created` atrasado, emitido antes, chega depois.
    const late = await sendWebhook(
      api,
      'subscription.created',
      payloadFor({
        status: 'PENDING',
        cycleStatus: 'PENDING',
        paidAt: null,
        timestamp: new Date(now - 60_000),
      }),
      { eventId: 'evt_atrasado' },
    );
    expect(late.status).toBe(200);

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    // O estado pago prevalece: o site nao volta a ficar bloqueado.
    expect(subscription.status).toBe('active');
    expect(subscription.publicationState).toBe('allowed');
    expect(subscription.accessUntil?.toISOString()).toBe(periodEnd.toISOString());
  });

  it('uma cobranca paga nao volta para pendente', async () => {
    const payload = payloadFor({ chargeId: CHARGE_ID, nextChargeDate: new Date(Date.now() + 2.6e9) });
    await sendWebhook(api, 'payment.success', payload, { eventId: 'evt_pago' });

    // `charge.created` da mesma cobranca, atrasado: aqui o status da raiz e o
    // status da COBRANCA.
    const late = await sendWebhook(
      api,
      'charge.created',
      {
        timestamp: new Date(Date.now() - 120_000).toISOString(),
        accountNumber: '4231833',
        subscriptionId: SUB_ID,
        chargeId: CHARGE_ID,
        invoiceId: 'inv_teste_1',
        type: 'RECURRING',
        status: 'PENDING',
        amount: reais(priceCents),
        currency: 'BRL',
        paymentType: 'PIX',
        dueDate: new Date().toISOString(),
        paidAt: null,
      },
      { eventId: 'evt_charge_criada' },
    );
    expect(late.status).toBe(200);

    const charges = await loadChargeRows(api, account.tenantId);
    expect(charges).toHaveLength(1);
    expect(charges[0]?.status).toBe('paid');
    expect(charges[0]?.paidAt).not.toBeNull();
  });
});

describe('falha de pagamento e inadimplencia', () => {
  it('uma recusa isolada nao cancela nem suspende o site', async () => {
    const periodEnd = new Date(Date.now() + 20 * 24 * 3600 * 1000);
    await sendWebhook(api, 'payment.success', payloadFor({ nextChargeDate: periodEnd, chargeId: 'cha_1' }));

    const response = await sendWebhook(
      api,
      'payment.failed',
      payloadFor({
        status: 'ACTIVE',
        cycleStatus: 'FAILED',
        paidAt: null,
        chargeId: 'cha_2',
        cycleNumber: 2,
        retry: { attempt: 1, status: 'FAILED', failureReason: 'card_declined' },
      }),
    );
    expect(response.status).toBe(200);

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('active');
    expect(subscription.publicationState).toBe('allowed');
    expect(subscription.lastErrorMessage).toContain('card_declined');

    const charges = await loadChargeRows(api, account.tenantId);
    const failed = charges.find((charge) => charge.externalChargeId === 'cha_2');
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toBe('card_declined');
  });

  it('vencimento marca atraso mas mantem o site no ar durante a tolerancia', async () => {
    // Pagamento cujo periodo venceu ontem; a tolerancia padrao e de 5 dias.
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    await sendWebhook(
      api,
      'payment.success',
      payloadFor({ nextChargeDate: yesterday, chargeId: 'cha_1' }),
    );

    await sendWebhook(
      api,
      'payment.overdue',
      payloadFor({
        status: 'DEFAULT',
        cycleStatus: 'FAILED',
        paidAt: null,
        chargeId: 'cha_2',
        cycleNumber: 2,
      }),
    );

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('past_due');
    expect(subscription.providerStatus).toBe('DEFAULT');
    // Dentro da tolerancia o site continua publicado.
    expect(subscription.publicationState).toBe('allowed');
  });

  it('suspende o site quando a tolerancia vence', async () => {
    await expireTrial(api, account.tenantId);
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    await sendWebhook(
      api,
      'payment.success',
      payloadFor({ nextChargeDate: tenDaysAgo, chargeId: 'cha_1' }),
    );
    await sendWebhook(
      api,
      'payment.overdue',
      payloadFor({ status: 'DEFAULT', cycleStatus: 'FAILED', paidAt: null, cycleNumber: 2 }),
    );

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('past_due');
    expect(subscription.publicationState).toBe('blocked_overdue');
  });

  it('o pagamento em atraso reativa a publicacao', async () => {
    await expireTrial(api, account.tenantId);
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    await sendWebhook(api, 'payment.success', payloadFor({ nextChargeDate: tenDaysAgo, chargeId: 'cha_1' }));
    await sendWebhook(
      api,
      'payment.overdue',
      payloadFor({ status: 'DEFAULT', cycleStatus: 'FAILED', paidAt: null, cycleNumber: 2 }),
    );
    expect((await loadSubscriptionRow(api, account.tenantId)).publicationState).toBe('blocked_overdue');

    const newPeriodEnd = new Date(Date.now() + 25 * 24 * 3600 * 1000);
    await sendWebhook(
      api,
      'payment.success',
      payloadFor({
        status: 'ACTIVE',
        nextChargeDate: newPeriodEnd,
        chargeId: 'cha_2',
        cycleNumber: 2,
      }),
    );

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('active');
    expect(subscription.publicationState).toBe('allowed');
    expect(subscription.accessUntil?.toISOString()).toBe(newPeriodEnd.toISOString());
  });

  it('encerramento por falta de pagamento bloqueia a publicacao', async () => {
    await expireTrial(api, account.tenantId);
    await sendWebhook(
      api,
      'subscription.expired',
      payloadFor({
        status: 'EXPIRED',
        cycleStatus: 'FAILED',
        paidAt: null,
        nextChargeDate: null,
      }),
    );

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('expired');
    expect(subscription.publicationState).toBe('blocked_canceled');
    expect(subscription.nextChargeAt).toBeNull();
  });
});

describe('cancelamento', () => {
  it('cancelamento agendado mantem o site no ar ate o fim do periodo', async () => {
    const periodEnd = new Date(Date.now() + 15 * 24 * 3600 * 1000);
    await sendWebhook(api, 'payment.success', payloadFor({ nextChargeDate: periodEnd, chargeId: 'cha_1' }));

    await sendWebhook(
      api,
      'subscription.cancel_scheduled',
      payloadFor({ status: 'ACTIVE', nextChargeDate: periodEnd }),
    );

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('cancel_at_period_end');
    expect(subscription.cancelAtPeriodEnd).toBe(true);
    expect(subscription.publicationState).toBe('allowed');
  });

  it('cancelamento efetivado respeita o periodo pago e nao apaga conteudo', async () => {
    const periodEnd = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    await sendWebhook(api, 'payment.success', payloadFor({ nextChargeDate: periodEnd, chargeId: 'cha_1' }));

    // Conteudo da empresa antes do cancelamento.
    const property = await account.client.post(`/api/tenants/${account.tenantId}/properties`, {
      title: 'Residencial Aurora',
      type: 'apartamento',
      purpose: 'venda',
      publicationStatus: 'published',
    });
    expect(property.status).toBe(201);

    await sendWebhook(
      api,
      'subscription.canceled',
      payloadFor({
        status: 'CANCELED',
        cycleStatus: 'PAID',
        canceledAt: new Date(),
        cancelReason: 'Cancelamento solicitado pela empresa.',
        nextChargeDate: null,
      }),
    );

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('canceled');
    expect(subscription.canceledAt).not.toBeNull();
    expect(subscription.cancelReason).toContain('Cancelamento solicitado');
    // Periodo pago pela frente: o site segue no ar.
    expect(subscription.publicationState).toBe('allowed');

    // O conteudo continua salvo e acessivel no painel.
    const properties = await account.client.get(`/api/tenants/${account.tenantId}/properties`);
    expect(properties.body.items).toHaveLength(1);
  });

  it('cancelamento sem periodo pago bloqueia a publicacao na hora', async () => {
    await expireTrial(api, account.tenantId);
    await sendWebhook(
      api,
      'subscription.canceled',
      payloadFor({
        status: 'CANCELED',
        cycleStatus: 'CANCELED',
        paidAt: null,
        canceledAt: new Date(),
        nextChargeDate: null,
      }),
    );

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('canceled');
    expect(subscription.publicationState).toBe('blocked_canceled');
  });
});

describe('estorno e contestacao', () => {
  it('estorno total suspende o site para revisao', async () => {
    const periodEnd = new Date(Date.now() + 25 * 24 * 3600 * 1000);
    await sendWebhook(
      api,
      'payment.success',
      payloadFor({ nextChargeDate: periodEnd, chargeId: CHARGE_ID }),
    );

    const response = await sendWebhook(api, 'refund.confirmed', {
      timestamp: new Date().toISOString(),
      accountId: '4231833',
      refundId: 'ref_teste_1',
      chargeId: CHARGE_ID,
      amount: reais(priceCents),
      status: 'CONFIRMED',
    });
    expect(response.status).toBe(200);

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.disputeHold).toBe(true);
    expect(subscription.publicationState).toBe('blocked_dispute');
    // O periodo pago continua registrado: o estorno nao reescreve a historia.
    expect(subscription.accessUntil?.toISOString()).toBe(periodEnd.toISOString());

    const charges = await loadChargeRows(api, account.tenantId);
    expect(charges[0]?.status).toBe('refunded');
    expect(charges[0]?.refundedAmountCents).toBe(priceCents);
  });

  it('estorno parcial registra o valor sem suspender', async () => {
    const periodEnd = new Date(Date.now() + 25 * 24 * 3600 * 1000);
    await sendWebhook(api, 'payment.success', payloadFor({ nextChargeDate: periodEnd, chargeId: CHARGE_ID }));

    await sendWebhook(api, 'refund.confirmed', {
      timestamp: new Date().toISOString(),
      accountId: '4231833',
      refundId: 'ref_parcial',
      chargeId: CHARGE_ID,
      amount: reais(Math.floor(priceCents / 2)),
      status: 'CONFIRMED',
    });

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.disputeHold).toBe(false);
    expect(subscription.publicationState).toBe('allowed');

    const charges = await loadChargeRows(api, account.tenantId);
    expect(charges[0]?.status).toBe('partially_refunded');
  });

  it('devolucao recusada mantem a cobranca paga', async () => {
    const periodEnd = new Date(Date.now() + 25 * 24 * 3600 * 1000);
    await sendWebhook(api, 'payment.success', payloadFor({ nextChargeDate: periodEnd, chargeId: CHARGE_ID }));

    await sendWebhook(api, 'refund.failed', {
      timestamp: new Date().toISOString(),
      accountId: '4231833',
      refundId: 'ref_falhou',
      chargeId: CHARGE_ID,
      amount: reais(priceCents),
      status: 'ERROR',
    });

    const charges = await loadChargeRows(api, account.tenantId);
    expect(charges[0]?.status).toBe('paid');

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.publicationState).toBe('allowed');
  });

  it('estorno de cobranca desconhecida fica como nao resolvido', async () => {
    const response = await sendWebhook(api, 'refund.confirmed', {
      timestamp: new Date().toISOString(),
      accountId: '4231833',
      refundId: 'ref_orfao',
      chargeId: 'cha_que_nao_existe',
      amount: 10,
      status: 'CONFIRMED',
    });

    expect(response.status).toBe(200);
    expect(response.body.data?.status).toBe('unresolved');

    const events = await loadEventRows(api);
    expect(events.at(-1)?.status).toBe('unresolved');
  });
});

describe('eventos sem empresa e reprocessamento', () => {
  it('evento de assinatura desconhecida fica como nao resolvido, sem adivinhar a empresa', async () => {
    const response = await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_de_outro_cliente',
        status: 'ACTIVE',
        amountCents: 9990,
        // Mesmo e-mail e documento: ainda assim nao e atribuido a ninguem.
        metadata: {},
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body.data?.status).toBe('unresolved');

    // Nenhuma empresa recebeu o pagamento de outro cliente.
    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.externalSubscriptionId).toBeNull();
    expect(subscription.status).toBe('pending');
    expect(await loadChargeRows(api, account.tenantId)).toHaveLength(0);
  });

  it('o reprocessamento resolve o evento depois que a assinatura e vinculada', async () => {
    // Ordem real: a assinatura e criada antes do pagamento. Aqui o evento de
    // pagamento chega primeiro e sem metadata -- a entrega fora de ordem que a
    // documentacao avisa ser possivel.
    const createdAt = new Date(Date.now() - 120_000);
    const paidAt = new Date(Date.now() - 60_000);

    const orphan = await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: SUB_ID,
        status: 'ACTIVE',
        amountCents: priceCents,
        priceId,
        chargeId: CHARGE_ID,
        nextChargeDate: new Date(Date.now() + 2.6e9),
        timestamp: paidAt,
        paidAt,
        metadata: {},
      }),
      { eventId: 'evt_sem_vinculo' },
    );
    expect(orphan.body.data?.status).toBe('unresolved');

    // A empresa e vinculada por um `subscription.created` com o token.
    await sendWebhook(
      api,
      'subscription.created',
      subscriptionPayload({
        subscriptionId: SUB_ID,
        status: 'PENDING',
        amountCents: priceCents,
        priceId,
        paidAt: null,
        cycleStatus: 'PENDING',
        timestamp: createdAt,
        metadata: { tenantId: account.tenantId, intentToken },
      }),
    );
    expect((await loadSubscriptionRow(api, account.tenantId)).externalSubscriptionId).toBe(SUB_ID);

    // Reprocessa o evento que havia ficado sem empresa.
    const platform = await createPlatformAdmin();
    const events = await loadEventRows(api);
    const pending = events.find((event) => event.externalEventId === 'evt_sem_vinculo');
    expect(pending).toBeDefined();

    const replay = await platform.client.post('/api/platform/billing/webhooks/replay', {
      eventId: pending!.id,
    });
    expect(replay.status, replay.errorMessage ?? '').toBe(200);
    expect(replay.body.status).toBe('processed');

    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('active');
    expect(subscription.publicationState).toBe('allowed');
    expect(await loadChargeRows(api, account.tenantId)).toHaveLength(1);
  });

  it('reprocessar um evento ja aplicado nao duplica periodo nem cobranca', async () => {
    const periodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await sendWebhook(
      api,
      'payment.success',
      payloadFor({ nextChargeDate: periodEnd, chargeId: CHARGE_ID }),
      { eventId: 'evt_para_reprocessar' },
    );

    const before = await loadSubscriptionRow(api, account.tenantId);
    const platform = await createPlatformAdmin();
    const events = await loadEventRows(api);
    const target = events.find((event) => event.externalEventId === 'evt_para_reprocessar');

    const replay = await platform.client.post('/api/platform/billing/webhooks/replay', {
      eventId: target!.id,
    });
    expect(replay.status).toBe(200);

    const after = await loadSubscriptionRow(api, account.tenantId);
    expect(after.accessUntil?.toISOString()).toBe(before.accessUntil?.toISOString());
    expect(await loadChargeRows(api, account.tenantId)).toHaveLength(1);
  });

  it('evento nao tratado e registrado como ignorado', async () => {
    const response = await sendWebhook(api, 'onboarding.proposal', {
      timestamp: new Date().toISOString(),
      accountId: '4231833',
      status: 'APPROVED',
    });

    expect(response.status).toBe(200);
    expect(response.body.data?.status).toBe('ignored');

    const events = await loadEventRows(api);
    expect(events.at(-1)?.status).toBe('ignored');
  });

  it('grava o evento antes de processar: uma falha deixa o evento para retomada', async () => {
    // Cobranca registrada em outra empresa: aplicar o evento viola a
    // consistencia e deve falhar, sem perder o evento.
    const other = await registerAccount(api, {
      email: 'outra@construtora.com.br',
      companyName: 'Outra Construtora',
    });
    await api.db.insert(schema.charges).values({
      tenantId: other.tenantId,
      siteId: other.siteId,
      externalChargeId: CHARGE_ID,
      status: 'pending',
      amountCents: 1000,
    });

    await sendWebhook(
      api,
      'subscription.created',
      payloadFor({ status: 'PENDING', paidAt: null, cycleStatus: 'PENDING' }),
    );

    const response = await sendWebhook(
      api,
      'payment.success',
      payloadFor({ chargeId: CHARGE_ID, nextChargeDate: new Date(Date.now() + 2.6e9) }),
      { eventId: 'evt_com_falha' },
    );

    // A ValidaPay recebe 2xx: o evento esta salvo e sera retomado.
    expect(response.status).toBe(200);
    expect(response.body.data?.status).toBe('failed');

    const events = await loadEventRows(api);
    const failed = events.find((event) => event.externalEventId === 'evt_com_falha');
    expect(failed?.status).toBe('failed');
    expect(failed?.errorMessage).toMatch(/outra empresa/i);

    // A transacao foi desfeita: nada aplicado pela metade.
    const subscription = await loadSubscriptionRow(api, account.tenantId);
    expect(subscription.status).toBe('pending');
    // O acesso continua sendo o da avaliacao: o pagamento nao foi creditado.
    expect(subscription.accessUntil?.toISOString()).toBe(
      subscription.trialEndsAt?.toISOString(),
    );
    const charges = await loadChargeRows(api, account.tenantId);
    expect(charges.filter((charge) => charge.tenantId === account.tenantId)).toHaveLength(0);
  });
});

/** Administrador da plataforma, para as rotas de reprocessamento. */
async function createPlatformAdmin(): Promise<RegisteredAccount> {
  const admin = await registerAccount(api, {
    email: `admin${Math.random().toString(36).slice(2, 8)}@codecabuild.test`,
    companyName: 'Plataforma Codeca',
  });
  await api.db
    .update(schema.users)
    .set({ platformRole: 'platform_admin' })
    .where(eq(schema.users.id, admin.userId));
  return admin;
}
