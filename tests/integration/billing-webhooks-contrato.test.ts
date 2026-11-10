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
  loadEventRows,
  loadSubscriptionRow,
  reais,
  sendWebhook,
  startCheckout,
  subscriptionPayload,
  syncPlanCode,
} from '../helpers/billing.js';

/**
 * Conformidade com o CONTRATO PUBLICADO dos webhooks da ValidaPay.
 *
 * ## Em que este arquivo difere de `billing-webhooks.test.ts`
 *
 * La os payloads sao nossos: montados pelo helper, no formato que a nossa
 * implementacao espera. Isso prova que o nosso codigo e coerente consigo
 * mesmo -- e nao prova nada sobre o que a ValidaPay realmente envia.
 *
 * Aqui os corpos sao copiados da documentacao da ValidaPay, com as armadilhas
 * que ela mesma aponta:
 *
 * - a chave da conta **muda conforme o evento**: `accountNumber` em uns,
 *   `accountId` em outros;
 * - cobranca avulsa **nunca** traz `subscriptionId`, mesmo paga com cartao;
 * - em `charge.created` e `charge.expired`, o `status` da raiz e o da
 *   **COBRANCA**, nao o da assinatura;
 * - em `payment.retry`, `retry.status` e o desfecho DAQUELA tentativa,
 *   enquanto o `status` da raiz continua sendo o da assinatura;
 * - `payment.failed` na criacao da assinatura tem schema proprio: nao carrega
 *   a base da assinatura e usa `accountId`.
 *
 * Confundir qualquer uma dessas gravaria o estado errado na assinatura de um
 * cliente pagante. Nenhuma delas aparece se o teste usa so o nosso formato.
 */

let api: TestApi;
let account: RegisteredAccount;
let planId: string;
let priceId: string;
let priceCents: number;
let intentToken: string;

const SUB_ID = 'sub_1786746719522_contrato';
const CHARGE_ID = 'cha_1791047440770_nzonv0adh';

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
  const plan = await syncPlanCode(api, 'profissional');
  planId = plan.id;
  priceId = plan.priceId;
  priceCents = plan.priceCents;
  await startCheckout(account, planId);
  intentToken = (await loadSubscriptionRow(api, account.tenantId)).intentToken ?? '';
});

const base = (overrides: Record<string, unknown> = {}) =>
  subscriptionPayload({
    subscriptionId: SUB_ID,
    status: 'ACTIVE',
    amountCents: priceCents,
    priceId,
    metadata: { tenantId: account.tenantId, planId, intentToken },
    ...overrides,
  });

/** Vincula a assinatura e deixa a empresa ativa, como em producao. */
async function ativar(): Promise<void> {
  const ok = await sendWebhook(api, 'payment.success', base());
  expect(ok.status).toBe(200);
}

describe('cobranca avulsa: o payload da documentacao, sem subscriptionId', () => {
  /** Copiado do guia de webhooks, secao "charge.created de cobranca avulsa". */
  const avulsa = {
    timestamp: '2026-10-03T17:10:40.990Z',
    accountNumber: '4231833',
    accountId: '4231833',
    chargeId: CHARGE_ID,
    invoiceId: 'inv_1791047440760_060bt2rwm',
    type: 'ONE_TIME_ITEM',
    status: 'PENDING',
    amount: 12.34,
    currency: 'BRL',
    paymentType: 'PIX',
    dueDate: '2026-10-04T00:00:00Z',
    transactionId: '4000782515',
    paidAt: null,
    customerId: 'cus_1790435193764_3dixre16i',
    email: 'joao@example.com',
    taxId: '12345678901',
    metadata: null,
    customer: {
      customerId: 'cus_1790435193764_3dixre16i',
      name: 'João da Silva',
      email: 'joao@example.com',
      taxId: '12345678901',
      phone: '11999990000',
    },
    items: [{ name: 'Consultoria', description: 'Sessão avulsa', quantity: 1, amount: 12.34, discount: 0 }],
    pix: { emv: '00020101021226980014br.gov.bcb.pix…', dueDate: '2026-10-04T00:00:00Z' },
  };

  it('charge.created avulsa e aceito e guardado, sem inventar empresa', async () => {
    const resposta = await sendWebhook(api, 'charge.created', avulsa);

    expect(resposta.status).toBe(200);
    const [evento] = await loadEventRows(api);
    expect(evento).toBeDefined();
    /*
     * `ignored`, e nao `unresolved` -- a diferenca importa na operacao:
     *
     * - `unresolved` e o evento que NOMEIA uma assinatura que ainda nao
     *   conseguimos localizar. Vale reprocessar depois, quando o vinculo
     *   existir (ha teste disso em `billing-webhooks.test.ts`).
     * - `ignored` e a cobranca avulsa: ela simplesmente nao pertence a
     *   nenhuma assinatura da plataforma, e reprocessar nunca mudaria isso.
     *
     * Tratar as duas igual encheria a fila de reprocesso com eventos que
     * nunca resolvem.
     */
    expect(evento!.status).toBe('ignored');
    expect(String(resposta.body.data?.detail ?? '')).toContain('avulsa');

    // Nenhuma cobranca foi atribuida a empresa.
    const cobrancas = await api.db
      .select()
      .from(schema.charges)
      .where(eq(schema.charges.tenantId, account.tenantId));
    expect(cobrancas).toHaveLength(0);
  });

  it('payment.success avulsa, com currentCycle e sem subscriptionId, nao corrompe a assinatura', async () => {
    await ativar();
    const antes = await loadSubscriptionRow(api, account.tenantId);

    const resposta = await sendWebhook(api, 'payment.success', {
      ...avulsa,
      status: 'PAID',
      paidAt: '2026-10-04T13:21:07.000Z',
      currentCycle: {
        cycleNumber: 1,
        amount: 12.34,
        status: 'PAID',
        chargeDate: '2026-10-04T00:00:00Z',
        paymentMethod: 'pix',
        paidAt: '2026-10-04T13:21:07.000Z',
      },
    });
    expect(resposta.status).toBe(200);

    const depois = await loadSubscriptionRow(api, account.tenantId);
    // A assinatura da empresa nao foi tocada por uma cobranca que nao e dela.
    expect(depois.accessUntil?.toISOString()).toBe(antes.accessUntil?.toISOString());
    expect(depois.status).toBe(antes.status);
  });

  it('payment.failed na criacao, com accountId e sem a base da assinatura, nao derruba a rota', async () => {
    // Schema proprio, segundo a documentacao: sem subscriptionId, sem items.
    const resposta = await sendWebhook(api, 'payment.failed', {
      timestamp: new Date().toISOString(),
      accountId: '4231833',
      chargeId: CHARGE_ID,
      status: 'FAILED',
      amount: 12.34,
      failureReason: 'Cartão recusado pelo emissor',
      customerId: 'cus_1790435193764_3dixre16i',
    });

    expect(resposta.status).toBe(200);
    const [evento] = await loadEventRows(api);
    expect(evento!.event).toBe('payment.failed');
  });
});

describe('o `status` da raiz nem sempre e o da assinatura', () => {
  it('charge.expired traz o status da COBRANCA, e nao muda o estado da assinatura', async () => {
    await ativar();
    const antes = await loadSubscriptionRow(api, account.tenantId);
    expect(antes.providerStatus).toBe('ACTIVE');

    // `status: EXPIRED` aqui e da cobranca. Aplicar isso na assinatura
    // deixaria uma empresa pagante marcada como expirada.
    const resposta = await sendWebhook(api, 'charge.expired', {
      timestamp: new Date().toISOString(),
      accountNumber: '4231833',
      subscriptionId: SUB_ID,
      chargeId: 'cha_outra_cobranca',
      status: 'EXPIRED',
      amount: reais(priceCents),
    });
    expect(resposta.status).toBe(200);

    const depois = await loadSubscriptionRow(api, account.tenantId);
    expect(depois.providerStatus).toBe('ACTIVE');
    expect(depois.status).toBe(antes.status);
  });

  it('payment.retry: `retry.status` e o da tentativa, `status` e o da assinatura', async () => {
    await ativar();

    const resposta = await sendWebhook(
      api,
      'payment.retry',
      base({
        // A assinatura continua ativa; o que falhou foi a tentativa.
        status: 'ACTIVE',
        retry: {
          attempt: 2,
          status: 'FAILED',
          failureReason: 'Saldo insuficiente',
          nextRetryAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      }),
    );
    expect(resposta.status).toBe(200);

    const depois = await loadSubscriptionRow(api, account.tenantId);
    // O desfecho da tentativa nao vira o estado comercial da assinatura.
    expect(depois.providerStatus).toBe('ACTIVE');
    expect(depois.status).not.toBe('expired');
    expect(depois.status).not.toBe('canceled');
    // Mas o motivo fica registrado para quem for atender o cliente.
    expect(depois.lastErrorMessage).toContain('Saldo insuficiente');
  });
});

describe('idempotencia, como a documentacao exige', () => {
  it('a retentativa da ValidaPay traz o MESMO X-Webhook-Id e nao aplica duas vezes', async () => {
    const eventId = 'evt_retentativa_1';
    const payload = base();

    const primeira = await sendWebhook(api, 'payment.success', payload, { eventId, attempt: 1 });
    expect(primeira.status).toBe(200);
    expect(primeira.body.data?.duplicate).toBe(false);
    const depoisDaPrimeira = await loadSubscriptionRow(api, account.tenantId);

    // Tentativa 4, horas depois: corpo igual, assinatura nova (o `t` muda),
    // mesmo id de evento. E o cenario do reenvio manual descrito no guia.
    const segunda = await sendWebhook(api, 'payment.success', payload, {
      eventId,
      attempt: 4,
      signedAtMs: Date.now() + 1_000,
    });
    expect(segunda.status).toBe(200);
    expect(segunda.body.data?.duplicate).toBe(true);

    const depoisDaQuarta = await loadSubscriptionRow(api, account.tenantId);
    // O periodo nao foi creditado de novo.
    expect(depoisDaQuarta.accessUntil?.toISOString()).toBe(depoisDaPrimeira.accessUntil?.toISOString());
    expect(await loadEventRows(api)).toHaveLength(1);
  });

  it('sem o cabecalho de id, a deduplicacao cai no corpo -- e ainda funciona', async () => {
    const payload = base();
    const primeira = await sendWebhook(api, 'payment.success', payload, { eventId: '' });
    const segunda = await sendWebhook(api, 'payment.success', payload, { eventId: '' });

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(segunda.body.data?.duplicate).toBe(true);
    expect(await loadEventRows(api)).toHaveLength(1);
  });
});

describe('a chave da conta muda conforme o evento', () => {
  it('le `accountNumber` quando ele vem, e `accountId` quando so ele vem', async () => {
    await ativar();

    const comAccountId = await sendWebhook(api, 'subscription.renewed', {
      ...base({ status: 'ACTIVE' }),
      accountNumber: undefined,
      accountId: '4231833',
    });
    expect(comAccountId.status).toBe(200);

    const eventos = await loadEventRows(api);
    // Nenhum evento ficou sem interpretacao por causa da chave da conta.
    expect(eventos.every((e) => e.status !== 'failed')).toBe(true);
  });
});

describe('o orcamento de 5 segundos do provedor', () => {
  it('a rota responde muito antes do tempo limite de entrega', async () => {
    /*
     * A ValidaPay aborta a entrega em 5 s e a conta como falha; depois de 5
     * falhas seguidas ela PAUSA o endpoint. Como o processamento acontece
     * dentro da requisicao, vale medir -- e deixar o numero registrado para
     * quem mexer nisso depois.
     */
    const inicio = Date.now();
    const resposta = await sendWebhook(api, 'payment.success', base());
    const decorrido = Date.now() - inicio;

    expect(resposta.status).toBe(200);
    // Folga grande de proposito: o que importa e nao chegar perto do limite.
    expect(decorrido).toBeLessThan(2_000);
  });
});
