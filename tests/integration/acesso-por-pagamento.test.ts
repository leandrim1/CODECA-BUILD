import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { TRIAL_PERIOD_DAYS } from '@codeca/shared';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';
import {
  loadSubscriptionRow,
  reais,
  sendWebhook,
  startCheckout,
  subscriptionPayload,
  syncPlanCode,
} from '../helpers/billing.js';

/**
 * Acesso vinculado ao pagamento.
 *
 * A regra comercial em uma frase: **a avaliação de 14 dias é a única forma de
 * usar a plataforma sem pagar.** Tudo o mais depende de confirmação financeira
 * autêntica.
 *
 * ## O que estes testes protegem
 *
 * 1. A avaliação dura 14 dias -- não 19. A tolerância existe para quem PAGA e
 *    atrasou; aplicada a quem nunca pagou, eram cinco dias de graça.
 * 2. Vencida a avaliação, a API pública para de servir. Antes o painel ficava
 *    em leitura e o site do visitante seguia alimentado para sempre.
 * 3. Criar conta, criar cobrança ou cadastrar assinatura não liberam nada.
 * 4. Reativação depois de expirar funciona.
 * 5. Pagamento com valor fora do plano é registrado -- e não bloqueia.
 */

let clock = new Date('2026-03-01T12:00:00Z');
let api: TestApi;

beforeAll(async () => {
  /*
   * Sessão longa: estes testes avançam o relógio em semanas para alcançar o
   * fim da avaliação, e a sessão padrão (12 h) morreria no caminho. O que está
   * sob teste é o acesso por pagamento, não a expiração de sessão -- essa tem
   * os testes dela em `auth.test.ts`.
   */
  api = await createTestApi({ now: () => clock, env: { SESSION_TTL_HOURS: '2160' } });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  clock = new Date('2026-03-01T12:00:00Z');
  await api.reset();
});

const avancarDias = (dias: number) => {
  clock = new Date(clock.getTime() + dias * 86_400_000);
};

/**
 * Webhook assinado com o relógio SIMULADO.
 *
 * `sendWebhook` assina com `Date.now()`, e estes testes avançam o relógio da
 * API em semanas: a assinatura real cairia fora da janela de tolerância de 5
 * minutos e o evento seria recusado com 401 -- o que é o comportamento certo,
 * e justamente por isso precisa ser contornado aqui.
 */
const enviar = (evento: string, payload: Record<string, unknown>) =>
  sendWebhook(api, evento, payload, { signedAtMs: clock.getTime() });

/** Situação de publicação como a plataforma a calcula agora. */
async function publicacao(conta: RegisteredAccount): Promise<string> {
  const row = await loadSubscriptionRow(api, conta.tenantId);
  const resposta = await conta.client.get(`/api/tenants/${conta.tenantId}/billing`);
  expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
  void row;
  return resposta.body.subscription.publicationState as string;
}

describe('plano gratuito: 14 dias, e nem um a mais', () => {
  it('libera no cadastro e bloqueia no 15º dia', async () => {
    const conta = await registerAccount(api, {
      email: 'marina@agencia.com.br',
      companyName: 'Agência Norte',
    });

    const assinatura = await loadSubscriptionRow(api, conta.tenantId);
    expect(assinatura.status).toBe('trialing');
    expect(assinatura.trialEndsAt).not.toBeNull();
    // O fim do período é registrado, e é o que vence sozinho.
    const dias = Math.round((assinatura.trialEndsAt!.getTime() - clock.getTime()) / 86_400_000);
    expect(dias).toBe(TRIAL_PERIOD_DAYS);

    expect(await publicacao(conta)).toBe('allowed');

    avancarDias(13);
    expect(await publicacao(conta)).toBe('allowed');

    // No 15º dia acabou. Sem tolerância: ela é para quem paga e atrasou.
    avancarDias(2);
    expect(await publicacao(conta)).toBe('blocked_overdue');
  });

  it('a tolerância não vale na avaliação, mas continua valendo para quem paga', async () => {
    /*
     * A regra mora na decisão, não na linha: a MESMA assinatura que nasce em
     * avaliação vira a do cliente pagante. Zerar a coluna no cadastro tirava a
     * tolerância de quem depois passava a pagar -- foi o que a suíte pegou.
     */
    const conta = await registerAccount(api, { email: 'a@b.com.br', companyName: 'Teste' });
    const assinatura = await loadSubscriptionRow(api, conta.tenantId);
    expect(assinatura.gracePeriodDays).toBeGreaterThan(0);

    // Em avaliação, a tolerância é ignorada.
    avancarDias(TRIAL_PERIOD_DAYS + 1);
    expect(await publicacao(conta)).toBe('blocked_overdue');
  });

  it('vencida a avaliação, a API pública para de servir o site', async () => {
    /*
     * É a mudança comercial desta etapa. Antes, a política padrão (`serve`)
     * valia também para a avaliação: o painel ficava em leitura e o site do
     * visitante seguia alimentado **para sempre**. Quem nunca pagou tinha o
     * produto funcionando por tempo ilimitado.
     *
     * O padrão continua certo para quem PAGA e atrasou -- e é por isso que a
     * mudança é no plano de avaliação, não na regra geral.
     */
    const plataforma = await registerAccount(api, {
      email: 'operacao@codeca.test',
      companyName: 'Plataforma',
    });
    await api.db
      .update(schema.users)
      .set({ platformRole: 'platform_admin' })
      .where(eq(schema.users.id, plataforma.userId));

    const conta = await registerAccount(api, { email: 'site@empresa.com.br', companyName: 'Empresa Site' });
    const chave = (
      await plataforma.client.post(`/api/platform/sites/${conta.siteId}/keys`, { kind: 'secret' })
    ).body.key.token as string;

    const ler = () =>
      api.client().get('/api/v1/site', { origin: null, headers: { authorization: `Bearer ${chave}` } });

    // Durante a avaliação, o site é servido normalmente.
    expect((await ler()).status).toBe(200);

    avancarDias(TRIAL_PERIOD_DAYS + 1);

    // Vencida, para de responder -- com 402, e não 403: a diferença importa
    // para quem integra. 403 é credencial sem permissão, algo a corrigir no
    // código do site; 402 é pendência de assinatura, que ninguém resolve
    // mexendo no site.
    const depois = await ler();
    expect(depois.status).toBe(402);
  });

  it('vencida a avaliação, o painel fica em leitura e a contratação continua aberta', async () => {
    const conta = await registerAccount(api, { email: 'c@d.com.br', companyName: 'Empresa' });
    await verifyEmail(api, conta);
    avancarDias(TRIAL_PERIOD_DAYS + 1);

    // Leitura do painel continua: a pessoa precisa ver o que cadastrou.
    expect((await conta.client.get(`/api/tenants/${conta.tenantId}`)).status).toBe(200);

    // Escrita de conteúdo, não.
    const escrita = await conta.client.patch(`/api/tenants/${conta.tenantId}/contact`, {
      contactEmail: 'novo@empresa.com.br',
    });
    expect(escrita.status).toBe(403);

    // E a tela de cobrança nunca é bloqueada: é por onde se regulariza.
    expect((await conta.client.get(`/api/tenants/${conta.tenantId}/billing`)).status).toBe(200);
  });
});

describe('planos pagos: nada libera sem confirmação', () => {
  let conta: RegisteredAccount;
  let planId: string;
  let priceId: string;
  let priceCents: number;

  beforeEach(async () => {
    conta = await registerAccount(api, { email: 'pago@empresa.com.br', companyName: 'Empresa Paga' });
    await verifyEmail(api, conta);
    const plano = await syncPlanCode(api, 'profissional');
    planId = plano.id;
    priceId = plano.priceId;
    priceCents = plano.priceCents;
  });

  it('abrir o checkout não libera: a assinatura fica pendente', async () => {
    avancarDias(TRIAL_PERIOD_DAYS + 1);
    expect(await publicacao(conta)).toBe('blocked_overdue');

    await startCheckout(conta, planId);

    const assinatura = await loadSubscriptionRow(api, conta.tenantId);
    expect(assinatura.status).toBe('pending');
    expect(await publicacao(conta)).toBe('blocked_pending');
  });

  it('cobrança criada não libera; só o pagamento confirmado libera', async () => {
    avancarDias(TRIAL_PERIOD_DAYS + 1);
    await startCheckout(conta, planId);
    const assinatura = await loadSubscriptionRow(api, conta.tenantId);
    const intentToken = assinatura.intentToken ?? '';

    // A cobrança nasce: ainda não há pagamento.
    const criada = await enviar(
      'charge.created',
      subscriptionPayload({
        subscriptionId: 'sub_pago_1',
        status: 'PENDING',
        amountCents: priceCents,
        priceId,
        chargeId: 'cha_pago_1',
        metadata: { intentToken },
      }),
    );
    expect(criada.status).toBe(200);
    expect(await publicacao(conta)).toBe('blocked_pending');

    // Agora sim.
    const pago = await enviar(
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_pago_1',
        status: 'ACTIVE',
        amountCents: priceCents,
        priceId,
        chargeId: 'cha_pago_1',
        metadata: { intentToken },
      }),
    );
    expect(pago.status).toBe(200);

    const depois = await loadSubscriptionRow(api, conta.tenantId);
    expect(depois.status).toBe('active');
    expect(await publicacao(conta)).toBe('allowed');
  });

  it('reativação: quem expirou e paga de novo volta a ter acesso', async () => {
    // Expira a avaliação e contrata.
    avancarDias(TRIAL_PERIOD_DAYS + 1);
    await startCheckout(conta, planId);
    const intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';

    await enviar(
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_react_1',
        status: 'ACTIVE',
        amountCents: priceCents,
        priceId,
        metadata: { intentToken },
        nextChargeDate: new Date(clock.getTime() + 30 * 86_400_000),
      }),
    );
    expect(await publicacao(conta)).toBe('allowed');

    // O período acaba e ninguém paga: expira.
    avancarDias(40);
    await enviar(
      'subscription.expired',
      subscriptionPayload({ subscriptionId: 'sub_react_1', status: 'EXPIRED', amountCents: priceCents, priceId }),
    );
    expect(await publicacao(conta)).not.toBe('allowed');

    // Paga de novo: o acesso volta, sem intervenção manual.
    await enviar(
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_react_1',
        status: 'ACTIVE',
        amountCents: priceCents,
        priceId,
        nextChargeDate: new Date(clock.getTime() + 30 * 86_400_000),
      }),
    );
    expect(await publicacao(conta)).toBe('allowed');
  });

  it('valor fora do plano é registrado, e não bloqueia quem pagou', async () => {
    avancarDias(TRIAL_PERIOD_DAYS + 1);
    await startCheckout(conta, planId);
    const intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';

    // Um real, num plano de centenas.
    await enviar(
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_valor_1',
        status: 'ACTIVE',
        amountCents: 100,
        priceId,
        metadata: { intentToken },
      }),
    );

    const registros = await api.db
      .select()
      .from(schema.billingAuditLogs)
      .where(eq(schema.billingAuditLogs.action, 'billing.payment_divergence'));
    expect(registros).toHaveLength(1);
    expect(registros[0]!.reason).toContain('difere do plano');

    // De propósito: quem pagou não é bloqueado por uma divergência de valor.
    // Pró-rata e desconto divergem por desenho; a decisão é comercial.
    expect(await publicacao(conta)).toBe('allowed');
  });

  it('valor dentro do plano não gera divergência', async () => {
    avancarDias(TRIAL_PERIOD_DAYS + 1);
    await startCheckout(conta, planId);
    const intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';

    await enviar(
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_valor_2',
        status: 'ACTIVE',
        amountCents: priceCents,
        priceId,
        metadata: { intentToken },
      }),
    );

    const registros = await api.db
      .select()
      .from(schema.billingAuditLogs)
      .where(eq(schema.billingAuditLogs.action, 'billing.payment_divergence'));
    expect(registros).toHaveLength(0);
    void reais;
  });
});
