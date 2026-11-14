import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { TRIAL_PERIOD_DAYS } from '@codeca/shared';
import {
  createTestApi,
  registerAccount,
  TEST_JOB_SECRET,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';
import {
  loadSubscriptionRow,
  sendWebhook,
  startCheckout,
  subscriptionPayload,
  syncPlanCode,
} from '../helpers/billing.js';

/**
 * Abrir o pagamento não pode custar a avaliação.
 *
 * ## O defeito
 *
 * Quem abria a tela de pagamento no meio dos 14 dias perdia o acesso na hora:
 * o painel ia para somente leitura e a API pública respondia 402, com dias de
 * avaliação ainda sobrando. Três caminhos gravavam `pending` por cima de
 * `trialing`:
 *
 * 1. a própria contratação, ao criar a sessão de checkout;
 * 2. o webhook `subscription.created`, que a ValidaPay envia com `PENDING`;
 * 3. a reconciliação diária, lendo o mesmo `PENDING` no provedor.
 *
 * Com cartão aprovado na hora, o bloqueio durava segundos e ninguém via. Com
 * Pix, boleto, cartão recusado ou desistência, durava até alguém intervir.
 *
 * ## O que estes testes garantem -- nas duas direções
 *
 * - Enquanto a avaliação vale, nenhum dos três caminhos tira o acesso.
 * - **Nada foi afrouxado:** pagamento pendente não vira pagamento aprovado, o
 *   plano novo só vale depois de pago, e a avaliação continua acabando no dia
 *   14, com ou sem pagamento aberto.
 */

let clock = new Date('2026-03-01T12:00:00Z');
let api: TestApi;
let conta: RegisteredAccount;
let planId: string;
let priceId: string;
let priceCents: number;
let planoDeAvaliacao: string;
/**
 * Boleto só é oferecido no plano Empresas (regra comercial dos planos: nos
 * demais a tarifa come a mensalidade). Os cenários de boleto contratam ele.
 */
let comBoleto: { id: string; priceId: string; priceCents: number };

beforeAll(async () => {
  // Sessão longa pelo mesmo motivo de `acesso-por-pagamento.test.ts`: o relógio
  // avança semanas, e o que está sob teste não é a expiração de sessão.
  api = await createTestApi({ now: () => clock, env: { SESSION_TTL_HOURS: '2160' } });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  clock = new Date('2026-03-01T12:00:00Z');
  await api.reset();
  conta = await registerAccount(api, { email: 'dona@padaria.com.br', companyName: 'Padaria Central' });
  await verifyEmail(api, conta);
  // Documento da empresa: é por ele que a reconciliação localiza a assinatura.
  await api.db
    .update(schema.tenants)
    .set({ taxId: '12345678000199' })
    .where(eq(schema.tenants.id, conta.tenantId));

  const plano = await syncPlanCode(api, 'profissional');
  planId = plano.id;
  priceId = plano.priceId;
  priceCents = plano.priceCents;
  comBoleto = await syncPlanCode(api, 'empresas');
  planoDeAvaliacao = (await loadSubscriptionRow(api, conta.tenantId)).planId;
});

const avancarDias = (dias: number) => {
  clock = new Date(clock.getTime() + dias * 86_400_000);
};

/** Webhook assinado com o relógio simulado (ver `acesso-por-pagamento.test.ts`). */
const enviar = (evento: string, payload: Record<string, unknown>) =>
  sendWebhook(api, evento, payload, { signedAtMs: clock.getTime() });

/** O que a pessoa vê na tela de plano. */
async function tela() {
  const resposta = await conta.client.get(`/api/tenants/${conta.tenantId}/billing`);
  expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
  return resposta.body.subscription as {
    state: string;
    publicationState: string;
    checkoutUrl: string | null;
  };
}

/** Uma escrita qualquer do painel: é o que o bloqueio recusava com 403. */
const escrever = () =>
  conta.client.patch(`/api/tenants/${conta.tenantId}/contact`, {
    contactEmail: 'contato@padaria.com.br',
  });

/** Confere, de uma vez, tudo o que "a avaliação segue valendo" quer dizer. */
async function esperarAvaliacaoIntacta() {
  const linha = await loadSubscriptionRow(api, conta.tenantId);
  expect(linha.status).toBe('trialing');
  expect(linha.publicationState).toBe('allowed');
  // O plano em vigor continua sendo o da avaliação: nada foi concedido.
  expect(linha.planId).toBe(planoDeAvaliacao);
  expect((await tela()).publicationState).toBe('allowed');
  expect((await escrever()).status).toBe(200);
}

/** Os eventos que a ValidaPay envia quando a cobrança nasce e ninguém pagou. */
async function cobrancaNasceSemPagamento(paymentType: 'PIX' | 'BOLETO', sufixo: string) {
  const intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';
  const plano = paymentType === 'BOLETO' ? comBoleto : { priceId, priceCents };
  const base = {
    subscriptionId: `sub_${sufixo}`,
    status: 'PENDING',
    amountCents: plano.priceCents,
    priceId: plano.priceId,
    paymentType,
    paidAt: null,
    cycleStatus: 'PENDING',
    metadata: { intentToken },
  };
  const criada = await enviar('subscription.created', subscriptionPayload(base));
  expect(criada.status).toBe(200);
  const cobranca = await enviar(
    'charge.created',
    subscriptionPayload({ ...base, chargeId: `cha_${sufixo}` }),
  );
  expect(cobranca.status).toBe(200);
}

describe('avaliação em curso: abrir o pagamento não tira o acesso', () => {
  it('no terceiro dia, abre o checkout e continua usando', async () => {
    avancarDias(3);
    await esperarAvaliacaoIntacta();

    await startCheckout(conta, planId);

    await esperarAvaliacaoIntacta();
    // A escolha ficou registrada -- como intenção, não como plano em vigor.
    const linha = await loadSubscriptionRow(api, conta.tenantId);
    expect(linha.pendingPlanId).toBe(planId);
    // E o fim da avaliação não se moveu.
    expect(linha.accessUntil?.getTime()).toBe(linha.trialEndsAt?.getTime());
  });

  it('mostra o caminho de volta ao pagamento que ficou aberto', async () => {
    avancarDias(3);
    expect((await tela()).checkoutUrl).toBeNull();

    const checkout = await startCheckout(conta, planId);

    // Sem isto a pessoa continuaria com acesso, mas sem como retomar o
    // pagamento que começou: o link só aparecia em `pending`.
    const depois = await tela();
    expect(depois.state).toBe('trialing');
    expect(depois.checkoutUrl).toBe(checkout.checkoutUrl);
  });

  it('abre o checkout, desiste e segue na avaliação nos dias seguintes', async () => {
    avancarDias(3);
    await startCheckout(conta, planId);

    // Não paga, não volta. Dois dias depois, tudo como estava.
    avancarDias(2);
    await esperarAvaliacaoIntacta();

    // No último dia também.
    avancarDias(8);
    await esperarAvaliacaoIntacta();
  });

  it('gera um Pix e deixa a cobrança pendente', async () => {
    avancarDias(3);
    await startCheckout(conta, planId, 'pix');
    await cobrancaNasceSemPagamento('PIX', 'pix_aberto');

    await esperarAvaliacaoIntacta();

    // Pagamento pendente não é pagamento: o vínculo com a assinatura do
    // provedor foi feito, e mais nada.
    const linha = await loadSubscriptionRow(api, conta.tenantId);
    expect(linha.externalSubscriptionId).toBe('sub_pix_aberto');
    expect(linha.providerStatus).toBe('PENDING');
    expect(linha.accessUntil?.getTime()).toBe(linha.trialEndsAt?.getTime());
  });

  it('gera um boleto e deixa a cobrança pendente', async () => {
    avancarDias(3);
    await startCheckout(conta, comBoleto.id, 'boleto');
    await cobrancaNasceSemPagamento('BOLETO', 'boleto_aberto');

    await esperarAvaliacaoIntacta();

    // Boleto leva dias para compensar: a pessoa segue trabalhando enquanto isso.
    avancarDias(4);
    await esperarAvaliacaoIntacta();
  });

  it('a reconciliação diária também não rebaixa quem está na avaliação', async () => {
    avancarDias(3);
    await startCheckout(conta, comBoleto.id, 'boleto');
    await cobrancaNasceSemPagamento('BOLETO', 'reconc');

    // O provedor conhece a assinatura, ainda sem pagamento.
    api.billing.subscriptions.set('sub_reconc', {
      subscriptionId: 'sub_reconc',
      status: 'PENDING',
      cancelAtPeriodEnd: false,
    } as never);

    const job = await api.app.request('http://app.localhost:5173/api/billing/reconcile', {
      method: 'POST',
      headers: { authorization: `Bearer ${TEST_JOB_SECRET}` },
    });
    expect(job.status).toBe(200);
    // O teste só vale se a reconciliação de fato consultou esta assinatura.
    expect(api.billing.calls).toContain('getSubscription');

    await esperarAvaliacaoIntacta();
  });

  it('cartão recusado na contratação não derruba a avaliação', async () => {
    avancarDias(3);
    await startCheckout(conta, planId);
    const intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';

    const recusado = await enviar(
      'payment.failed',
      subscriptionPayload({
        subscriptionId: 'sub_recusado',
        status: 'PENDING',
        amountCents: priceCents,
        priceId,
        paidAt: null,
        cycleStatus: 'FAILED',
        chargeId: 'cha_recusado',
        metadata: { intentToken },
        retry: { attempt: 1, status: 'FAILED', failureReason: 'Saldo insuficiente' },
      }),
    );
    expect(recusado.status).toBe(200);

    await esperarAvaliacaoIntacta();
  });
});

describe('nada foi afrouxado', () => {
  it('pagamento confirmado ativa o plano contratado', async () => {
    avancarDias(3);
    await startCheckout(conta, planId, 'pix');
    await cobrancaNasceSemPagamento('PIX', 'vai_pagar');
    const intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';

    const proximaCobranca = new Date(clock.getTime() + 30 * 86_400_000);
    const pago = await enviar(
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_vai_pagar',
        status: 'ACTIVE',
        amountCents: priceCents,
        priceId,
        chargeId: 'cha_vai_pagar',
        paymentType: 'PIX',
        nextChargeDate: proximaCobranca,
        metadata: { intentToken },
      }),
    );
    expect(pago.status).toBe(200);

    const linha = await loadSubscriptionRow(api, conta.tenantId);
    expect(linha.status).toBe('active');
    expect(linha.publicationState).toBe('allowed');
    // Agora sim o plano contratado passa a valer...
    expect(linha.planId).toBe(planId);
    expect(linha.pendingPlanId).toBeNull();
    // ...e o acesso vai até a próxima cobrança, não até o fim da avaliação.
    expect(linha.accessUntil?.getTime()).toBe(proximaCobranca.getTime());
    // O link de retomar some: não há mais nada a pagar.
    expect((await tela()).checkoutUrl).toBeNull();
  });

  it('pagamento pendente não concede o plano nem estende a avaliação', async () => {
    avancarDias(3);
    const antes = await loadSubscriptionRow(api, conta.tenantId);

    await startCheckout(conta, comBoleto.id, 'boleto');
    await cobrancaNasceSemPagamento('BOLETO', 'nao_pago');

    const depois = await loadSubscriptionRow(api, conta.tenantId);
    expect(depois.planId).toBe(antes.planId);
    expect(depois.accessUntil?.getTime()).toBe(antes.accessUntil?.getTime());
    expect(depois.trialEndsAt?.getTime()).toBe(antes.trialEndsAt?.getTime());

    const empresa = (
      await api.db.select().from(schema.tenants).where(eq(schema.tenants.id, conta.tenantId))
    )[0]!;
    expect(empresa.planId).toBe(antes.planId);
  });

  it('pagamento aberto não segura a avaliação depois do dia 14', async () => {
    avancarDias(3);
    await startCheckout(conta, comBoleto.id, 'boleto');
    await cobrancaNasceSemPagamento('BOLETO', 'esquecido');
    await esperarAvaliacaoIntacta();

    // Um boleto esquecido não é passe livre: no 15º dia acaba, como sempre.
    avancarDias(TRIAL_PERIOD_DAYS - 3 + 1);

    expect((await tela()).publicationState).not.toBe('allowed');
    expect((await escrever()).status).toBe(403);
    // A tela de plano continua aberta: é por onde se paga.
    expect((await conta.client.get(`/api/tenants/${conta.tenantId}/billing`)).status).toBe(200);
  });

  it('avaliação vencida: abrir o pagamento continua deixando a conta pendente', async () => {
    avancarDias(TRIAL_PERIOD_DAYS + 1);
    expect((await tela()).publicationState).toBe('blocked_overdue');

    await startCheckout(conta, planId);

    // Comportamento de antes, preservado: sem acesso vigente, `pending` vale.
    const linha = await loadSubscriptionRow(api, conta.tenantId);
    expect(linha.status).toBe('pending');
    expect(linha.publicationState).toBe('blocked_pending');
    expect((await escrever()).status).toBe(403);
  });

  it('depois de vencida, o pagamento confirmado libera normalmente', async () => {
    avancarDias(3);
    await startCheckout(conta, comBoleto.id, 'boleto');
    await cobrancaNasceSemPagamento('BOLETO', 'tardio');

    // O boleto só é pago depois que a avaliação acabou.
    avancarDias(TRIAL_PERIOD_DAYS);
    expect((await tela()).publicationState).not.toBe('allowed');

    const pago = await enviar(
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_tardio',
        status: 'ACTIVE',
        amountCents: comBoleto.priceCents,
        priceId: comBoleto.priceId,
        chargeId: 'cha_tardio',
        paymentType: 'BOLETO',
        nextChargeDate: new Date(clock.getTime() + 30 * 86_400_000),
      }),
    );
    expect(pago.status).toBe(200);

    const linha = await loadSubscriptionRow(api, conta.tenantId);
    expect(linha.status).toBe('active');
    expect(linha.planId).toBe(comBoleto.id);
    expect((await tela()).publicationState).toBe('allowed');
    expect((await escrever()).status).toBe(200);
  });
});
