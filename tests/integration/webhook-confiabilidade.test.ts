import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_AUTOMATIC_ATTEMPTS, pendingWebhookEvents, processWebhookEvent } from '@codeca/api';
import { eq, schema, sql } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
  TEST_JOB_SECRET,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';
import {
  loadEventRows,
  loadSubscriptionRow,
  sendWebhook,
  startCheckout,
  subscriptionPayload,
  syncPlanCode,
} from '../helpers/billing.js';

/**
 * O webhook de cobrança não perde evento, não aplica duas vezes e responde no prazo.
 *
 * ## O que havia
 *
 * A rota já conferia a assinatura sobre o corpo bruto, a janela de tempo e
 * gravava o evento antes de processar. Faltavam três coisas:
 *
 * 1. a resposta só saía depois de processar tudo, sem prazo -- e a ValidaPay
 *    corta a entrega em 5 s;
 * 2. nada impedia o mesmo evento de ser processado duas vezes ao mesmo tempo
 *    (segundo plano, retomada, reconciliação, reprocesso manual);
 * 3. evento com falha era retentado para sempre, na frente da fila.
 *
 * ## O que estes testes garantem
 *
 * - Nunca se responde 2xx por um evento que não foi gravado.
 * - Passado o prazo, a resposta sai e o processamento termina em segundo plano.
 * - Evento que ficou parado é retomado na entrega seguinte.
 * - O mesmo evento, alcançado duas vezes ao mesmo tempo, é aplicado uma vez.
 * - Depois de dez falhas, o evento sai da fila automática e vira alerta.
 */

let api: TestApi;
let conta: RegisteredAccount;
let planId: string;
let priceId: string;
let priceCents: number;
let intentToken: string;

const SUB_ID = 'sub_confiabilidade_1';

async function preparar(alvo: TestApi) {
  await alvo.reset();
  conta = await registerAccount(alvo, { email: 'dona@padaria.com.br', companyName: 'Padaria Central' });
  await verifyEmail(alvo, conta);
  const plano = await syncPlanCode(alvo, 'profissional');
  planId = plano.id;
  priceId = plano.priceId;
  priceCents = plano.priceCents;
  await startCheckout(conta, planId);
  intentToken = (await loadSubscriptionRow(alvo, conta.tenantId)).intentToken ?? '';
}

/** Evento de pagamento confirmado desta empresa. */
const pagamento = (extra: Partial<Parameters<typeof subscriptionPayload>[0]> = {}) =>
  subscriptionPayload({
    subscriptionId: SUB_ID,
    status: 'ACTIVE',
    amountCents: priceCents,
    priceId,
    chargeId: 'cha_confiabilidade_1',
    nextChargeDate: new Date(Date.now() + 30 * 86_400_000),
    metadata: { tenantId: conta.tenantId, planId, intentToken },
    ...extra,
  });

/** Registros de "pagamento confirmado" na auditoria de cobrança desta empresa. */
async function confirmacoes(alvo: TestApi) {
  const linhas = await alvo.db
    .select()
    .from(schema.billingAuditLogs)
    .where(eq(schema.billingAuditLogs.tenantId, conta.tenantId));
  return linhas.filter((linha) => linha.action === 'billing.payment_confirmed');
}

describe('gravar antes de confirmar', () => {
  beforeAll(async () => {
    api = await createTestApi();
  });
  afterAll(async () => {
    await api.close();
  });
  beforeEach(async () => preparar(api));

  it('se o evento não pôde ser gravado, a resposta é erro -- e a reentrega funciona', async () => {
    // Banco sem a tabela de eventos: a gravação falha.
    await api.db.execute(sql`alter table webhook_events rename to webhook_events_fora`);
    let resposta;
    try {
      resposta = await sendWebhook(api, 'payment.success', pagamento(), { eventId: 'evt_sem_gravar' });
    } finally {
      await api.db.execute(sql`alter table webhook_events_fora rename to webhook_events`);
    }

    // Nunca 2xx: a ValidaPay precisa saber que deve reenviar.
    expect(resposta.status).toBeGreaterThanOrEqual(500);
    expect(resposta.body.data?.received).toBeUndefined();
    // E nada foi aplicado sem registro.
    expect((await loadSubscriptionRow(api, conta.tenantId)).status).not.toBe('active');
    expect(await loadEventRows(api)).toHaveLength(0);

    // A reentrega (mesmo id) é gravada e aplicada normalmente.
    const reentrega = await sendWebhook(api, 'payment.success', pagamento(), {
      eventId: 'evt_sem_gravar',
      attempt: 2,
    });
    expect(reentrega.status).toBe(200);
    expect(reentrega.body.data?.status).toBe('processed');
    expect((await loadSubscriptionRow(api, conta.tenantId)).status).toBe('active');
  });

  it('assinatura inválida: nada é gravado, e quem opera é avisado', async () => {
    const resposta = await sendWebhook(api, 'payment.success', pagamento(), { corruptSignature: true });

    expect(resposta.status).toBe(401);
    expect(await loadEventRows(api)).toHaveLength(0);

    const recusa = api.opsEvents.find((evento) => evento.kind === 'webhook_rejected');
    expect(recusa).toBeDefined();
    expect(recusa!.severity).toBe('critical');
    // O registro diz o motivo, e nunca a assinatura recebida nem o corpo.
    expect(JSON.stringify(recusa)).not.toContain('v1=');
    expect(JSON.stringify(recusa)).not.toContain(intentToken);
  });

  it('entrega repetida não reaplica, e fica registrada', async () => {
    const primeira = await sendWebhook(api, 'payment.success', pagamento(), { eventId: 'evt_repetido' });
    expect(primeira.body.data?.status).toBe('processed');

    const segunda = await sendWebhook(api, 'payment.success', pagamento(), {
      eventId: 'evt_repetido',
      attempt: 2,
    });

    expect(segunda.status).toBe(200);
    expect(segunda.body.data?.duplicate).toBe(true);
    expect(await confirmacoes(api)).toHaveLength(1);
    expect(await loadEventRows(api)).toHaveLength(1);
    expect(api.opsEvents.some((evento) => evento.kind === 'webhook_duplicate')).toBe(true);
  });
});

describe('prazo de resposta', () => {
  let semEspera: TestApi;

  beforeAll(async () => {
    // Prazo zero: a resposta nunca espera o processamento. É o caso do banco
    // lento, levado ao extremo para o teste ser determinístico.
    semEspera = await createTestApi({ env: { VALIDAPAY_WEBHOOK_RESPONSE_BUDGET_MS: '0' } });
  });
  afterAll(async () => {
    await semEspera.close();
  });
  beforeEach(async () => preparar(semEspera));

  it('responde com o evento gravado e conclui em segundo plano', async () => {
    const resposta = await sendWebhook(semEspera, 'payment.success', pagamento(), { eventId: 'evt_adiado' });

    // A resposta sai no prazo, dizendo a verdade: gravado, ainda processando.
    expect(resposta.status).toBe(200);
    expect(resposta.body.data).toMatchObject({ received: true, duplicate: false, status: 'pending' });
    // O evento já está no banco quando a resposta sai.
    const [gravado] = await loadEventRows(semEspera);
    expect(gravado?.externalEventId).toBe('evt_adiado');

    // O trabalho em segundo plano (em produção, sob `waitUntil`) conclui.
    await semEspera.settle();

    const [processado] = await loadEventRows(semEspera);
    expect(processado?.status).toBe('processed');
    const assinatura = await loadSubscriptionRow(semEspera, conta.tenantId);
    expect(assinatura.status).toBe('active');
    expect(assinatura.planId).toBe(planId);
    expect(await confirmacoes(semEspera)).toHaveLength(1);
    expect(semEspera.opsEvents.some((evento) => evento.kind === 'webhook_deferred')).toBe(true);
  });

  it('a reentrega durante o processamento não aplica de novo', async () => {
    await sendWebhook(semEspera, 'payment.success', pagamento(), { eventId: 'evt_adiado_2' });
    // A ValidaPay reenvia antes de o primeiro processamento terminar.
    const reentrega = await sendWebhook(semEspera, 'payment.success', pagamento(), {
      eventId: 'evt_adiado_2',
      attempt: 2,
    });
    expect(reentrega.body.data?.duplicate).toBe(true);

    await semEspera.settle();

    expect(await confirmacoes(semEspera)).toHaveLength(1);
    expect((await loadEventRows(semEspera))[0]?.processingAttempts).toBe(1);
  });
});

describe('recuperação', () => {
  beforeAll(async () => {
    api = await createTestApi();
  });
  afterAll(async () => {
    await api.close();
  });
  beforeEach(async () => preparar(api));

  /** Um evento gravado e nunca processado -- a função morreu depois da resposta. */
  async function eventoParado(haMinutos: number) {
    const corpo = { event: 'payment.success', ...pagamento() };
    const [linha] = await api.db
      .insert(schema.webhookEvents)
      .values({
        externalEventId: `evt_parado_${haMinutos}`,
        event: 'payment.success',
        status: 'pending',
        receivedAt: new Date(Date.now() - haMinutos * 60_000),
        externalSubscriptionId: SUB_ID,
        externalChargeId: 'cha_confiabilidade_1',
        payload: corpo,
      })
      .returning();
    return linha!;
  }

  it('evento que ficou parado é retomado na entrega seguinte', async () => {
    const parado = await eventoParado(5);
    expect((await loadSubscriptionRow(api, conta.tenantId)).status).not.toBe('active');

    // Chega qualquer outro evento; depois da resposta, os parados são retomados.
    await sendWebhook(
      api,
      'charge.created',
      subscriptionPayload({
        subscriptionId: 'sub_de_outra_empresa',
        status: 'PENDING',
        amountCents: 1000,
        chargeId: 'cha_outra',
        cycleStatus: 'PENDING',
        paidAt: null,
      }),
    );
    await api.settle();

    const [depois] = await api.db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, parado.id));
    expect(depois?.status).toBe('processed');
    // O pagamento que estava esquecido foi creditado, sem esperar o dia seguinte.
    expect((await loadSubscriptionRow(api, conta.tenantId)).status).toBe('active');
  });

  it('evento recém-gravado não é disputado pela retomada', async () => {
    // Parado há segundos: ainda pode estar sendo processado por quem o recebeu.
    const recente = await eventoParado(0);

    await sendWebhook(
      api,
      'charge.created',
      subscriptionPayload({
        subscriptionId: 'sub_de_outra_empresa',
        status: 'PENDING',
        amountCents: 1000,
        chargeId: 'cha_outra_2',
        cycleStatus: 'PENDING',
        paidAt: null,
      }),
    );
    await api.settle();

    const [depois] = await api.db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, recente.id));
    expect(depois?.status).toBe('pending');
    expect(depois?.processingAttempts).toBe(0);
  });

  it('o mesmo evento alcançado duas vezes ao mesmo tempo é aplicado uma vez', async () => {
    const parado = await eventoParado(5);
    const contexto = { db: api.db, now: () => new Date(), source: 'reconciliation' as const };

    // Dois caminhos pegam a mesma linha, ainda `pending`, ao mesmo tempo:
    // a retomada e a reconciliação, por exemplo.
    const [a, b] = await Promise.all([
      processWebhookEvent(contexto, parado),
      processWebhookEvent(contexto, parado),
    ]);

    // Um aplicou; o outro esperou a trava, leu `processed` e saiu.
    expect([a.outcome, b.outcome].sort()).toEqual(['ignored', 'processed']);
    expect(await confirmacoes(api)).toHaveLength(1);
    const [depois] = await api.db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, parado.id));
    expect(depois?.processingAttempts).toBe(1);
  });

  it('evento que falha dez vezes sai da fila automática, sem ser descartado', async () => {
    const [esgotado] = await api.db
      .insert(schema.webhookEvents)
      .values({
        externalEventId: 'evt_esgotado',
        event: 'payment.success',
        status: 'failed',
        receivedAt: new Date(Date.now() - 86_400_000),
        processingAttempts: MAX_AUTOMATIC_ATTEMPTS,
        errorMessage: 'falha repetida',
        payload: { event: 'payment.success', ...pagamento() },
      })
      .returning();
    const novo = await eventoParado(5);

    // A fila automática não o traz mais -- e o novo não fica atrás dele.
    const fila = await pendingWebhookEvents(api.db, 20);
    expect(fila.map((evento) => evento.id)).toEqual([novo.id]);

    // Continua guardado, com o erro, para reprocesso manual.
    const [guardado] = await api.db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, esgotado!.id));
    expect(guardado?.status).toBe('failed');
    expect(guardado?.errorMessage).toBe('falha repetida');

    // E a reconciliação avisa que há evento esperando uma pessoa.
    const job = await api.app.request('http://app.localhost:5173/api/billing/reconcile', {
      method: 'POST',
      headers: { authorization: `Bearer ${TEST_JOB_SECRET}` },
    });
    expect(job.status).toBe(200);
    const aviso = api.opsEvents.find((evento) => evento.kind === 'webhook_stuck');
    expect(aviso?.severity).toBe('critical');
    expect(aviso?.context.eventos).toBe(1);
  });

  it('na fila, quem tentou menos vem antes de quem já falhou várias vezes', async () => {
    await api.db.insert(schema.webhookEvents).values({
      externalEventId: 'evt_velho_que_falha',
      event: 'payment.success',
      status: 'failed',
      receivedAt: new Date(Date.now() - 5 * 86_400_000),
      processingAttempts: 6,
      payload: { event: 'payment.success', ...pagamento({ subscriptionId: 'sub_inexistente', metadata: {} }) },
    });
    const novo = await eventoParado(5);

    const fila = await pendingWebhookEvents(api.db, 20);
    expect(fila[0]?.id).toBe(novo.id);
    expect(fila).toHaveLength(2);
  });
});
