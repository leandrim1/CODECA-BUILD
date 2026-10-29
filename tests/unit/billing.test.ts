import { describe, expect, it } from 'vitest';
import {
  BILLING_STATES,
  CHARGE_STATES,
  DEFAULT_GRACE_PERIOD_DAYS,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_METHOD_CODES,
  VALIDAPAY_CHARGE_STATUSES,
  VALIDAPAY_SUBSCRIPTION_STATUSES,
  billingStateFromProvider,
  centsToReais,
  centsToReaisString,
  chargeStateAdvances,
  chargeStateFromProvider,
  decidePublication,
  formatCents,
  paymentMethodFromType,
  reaisToCents,
  startSubscriptionSchema,
  type BillingState,
  type ChargeState,
} from '@codeca/shared';
import {
  parseSignatureHeader,
  signWebhookBody,
  verifyWebhookSignature,
} from '@codeca/api';

/**
 * Regras de cobranca que nao dependem de banco nem de rede.
 *
 * Sao as mais importantes para a seguranca financeira: conversao de valores,
 * avanco de estados e verificacao de assinatura. Um erro aqui vira dinheiro
 * errado ou acesso indevido.
 */

const SECRET = 'segredo-de-teste-para-hmac-com-32-caracteres';

describe('conversao de valores', () => {
  it('converte centavos para reais sem erro de ponto flutuante', () => {
    expect(centsToReais(19900)).toBe(199);
    expect(centsToReais(8990)).toBe(89.9);
    expect(centsToReais(1)).toBe(0.01);
    expect(centsToReais(0)).toBe(0);
  });

  it('formata reais com duas casas para enviar na API', () => {
    expect(centsToReaisString(19900)).toBe('199.00');
    expect(centsToReaisString(8990)).toBe('89.90');
    expect(centsToReaisString(5)).toBe('0.05');
    expect(centsToReaisString(100)).toBe('1.00');
  });

  it('recusa valor em centavos nao inteiro', () => {
    expect(() => centsToReais(10.5)).toThrow(RangeError);
  });

  it('converte reais para centavos sem perder um centavo', () => {
    // 89.9 * 100 em ponto flutuante daria 8989.999...
    expect(reaisToCents(89.9)).toBe(8990);
    expect(reaisToCents(199)).toBe(19900);
    expect(reaisToCents(0.01)).toBe(1);
    expect(reaisToCents(12.34)).toBe(1234);
    expect(reaisToCents(10.5)).toBe(1050);
    expect(reaisToCents(1.005)).toBe(101);
  });

  it('aceita o valor como texto, com ponto ou virgula', () => {
    expect(reaisToCents('199.00')).toBe(19900);
    expect(reaisToCents('89.90')).toBe(8990);
    expect(reaisToCents('89,90')).toBe(8990);
    expect(reaisToCents('0.05')).toBe(5);
  });

  it('a conversao e reversivel para qualquer valor monetario', () => {
    for (const cents of [1, 5, 99, 100, 499, 8990, 19900, 39900, 123456789]) {
      expect(reaisToCents(centsToReais(cents))).toBe(cents);
      expect(reaisToCents(centsToReaisString(cents))).toBe(cents);
    }
  });

  it('recusa valor invalido em vez de devolver zero', () => {
    expect(() => reaisToCents('abc')).toThrow(TypeError);
    expect(() => reaisToCents('')).toThrow(TypeError);
    expect(() => reaisToCents(Number.NaN)).toThrow(TypeError);
  });

  it('formata em reais para exibicao', () => {
    expect(formatCents(19900).replace(/ /g, ' ')).toBe('R$ 199,00');
    expect(formatCents(499).replace(/ /g, ' ')).toBe('R$ 4,99');
  });
});

describe('traducao dos estados do provedor', () => {
  it('cobre todos os estados de assinatura documentados', () => {
    for (const status of VALIDAPAY_SUBSCRIPTION_STATUSES) {
      const state = billingStateFromProvider(status);
      expect(BILLING_STATES).toContain(state);
    }
  });

  it('DEFAULT e PAST_DUE caem ambos em atraso', () => {
    expect(billingStateFromProvider('DEFAULT')).toBe('past_due');
    expect(billingStateFromProvider('PAST_DUE')).toBe('past_due');
  });

  it('cancelamento agendado nao aparece como ativa', () => {
    expect(billingStateFromProvider('ACTIVE')).toBe('active');
    expect(billingStateFromProvider('ACTIVE', { cancelAtPeriodEnd: true })).toBe(
      'cancel_at_period_end',
    );
  });

  it('cobre todos os estados de cobranca documentados', () => {
    for (const status of VALIDAPAY_CHARGE_STATUSES) {
      const state = chargeStateFromProvider(status);
      expect(CHARGE_STATES).toContain(state);
    }
  });

  it('reconhece as formas de pagamento pelo paymentType da API', () => {
    expect(paymentMethodFromType('CREDIT_CARD')).toBe('creditcard');
    expect(paymentMethodFromType('PIX_AUTOMATICO')).toBe('pix_automatico');
    expect(paymentMethodFromType('PIX')).toBe('pix');
    expect(paymentMethodFromType('BOLETO')).toBe('boleto');
    expect(paymentMethodFromType('INEXISTENTE')).toBeNull();
  });

  it('apenas cartao e Pix Automatico renovam sozinhos', () => {
    const automatic = PAYMENT_METHOD_CODES.filter((code) => PAYMENT_METHOD_OPTIONS[code].automatic);
    expect(automatic).toEqual(['creditcard', 'pix_automatico']);
    // O Pix Automatico exige conta PJ e valor minimo de R$ 4,99.
    expect(PAYMENT_METHOD_OPTIONS.pix_automatico.requiresCompanyAccount).toBe(true);
    expect(PAYMENT_METHOD_OPTIONS.pix_automatico.minimumCents).toBe(499);
  });
});

describe('avanco do estado das cobrancas', () => {
  it('nao permite que um estado antigo substitua um definitivo', () => {
    expect(chargeStateAdvances('paid', 'pending')).toBe(false);
    expect(chargeStateAdvances('paid', 'awaiting_payment')).toBe(false);
    expect(chargeStateAdvances('paid', 'failed')).toBe(false);
    expect(chargeStateAdvances('refunded', 'paid')).toBe(false);
  });

  it('permite o caminho normal e os casos legitimos', () => {
    expect(chargeStateAdvances('pending', 'awaiting_payment')).toBe(true);
    expect(chargeStateAdvances('awaiting_payment', 'paid')).toBe(true);
    // Boleto pago depois do vencimento acontece.
    expect(chargeStateAdvances('expired', 'paid')).toBe(true);
    expect(chargeStateAdvances('failed', 'paid')).toBe(true);
    // Estorno e chargeback vem depois do pagamento.
    expect(chargeStateAdvances('paid', 'refunded')).toBe(true);
    expect(chargeStateAdvances('paid', 'charged_back')).toBe(true);
    expect(chargeStateAdvances('paid', 'dispute')).toBe(true);
  });

  it('o mesmo estado e sempre aceito, para atualizar os demais campos', () => {
    for (const state of CHARGE_STATES) {
      expect(chargeStateAdvances(state as ChargeState, state as ChargeState)).toBe(true);
    }
  });
});

describe('decisao de publicacao', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');
  const future = new Date('2026-07-15T12:00:00.000Z');
  const recent = new Date('2026-06-13T12:00:00.000Z');
  const old = new Date('2026-05-15T12:00:00.000Z');

  const decide = (
    state: BillingState,
    accessUntil: Date | null,
    extra: { adminHold?: boolean; disputeHold?: boolean; gracePeriodDays?: number } = {},
  ) =>
    decidePublication({
      state,
      accessUntil,
      gracePeriodDays: extra.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS,
      adminHold: extra.adminHold ?? false,
      disputeHold: extra.disputeHold ?? false,
      now,
    });

  it('assinatura pendente nunca publica, mesmo com data futura', () => {
    expect(decide('pending', future).publication).toBe('blocked_pending');
    expect(decide('pending', null).publication).toBe('blocked_pending');
  });

  it('assinatura paga publica durante o periodo', () => {
    expect(decide('active', future).publication).toBe('allowed');
    expect(decide('trialing', future).publication).toBe('allowed');
    expect(decide('cancel_at_period_end', future).publication).toBe('allowed');
  });

  it('atraso recente continua no ar, dentro da tolerancia', () => {
    const decision = decide('past_due', recent);
    expect(decision.publication).toBe('allowed');
    expect(decision.inGracePeriod).toBe(true);
    expect(decision.graceEndsAt?.toISOString()).toBe('2026-06-18T12:00:00.000Z');
  });

  it('atraso antigo suspende a publicacao', () => {
    const decision = decide('past_due', old);
    expect(decision.publication).toBe('blocked_overdue');
    expect(decision.inGracePeriod).toBe(false);
  });

  it('tolerancia zero suspende no vencimento', () => {
    expect(decide('past_due', recent, { gracePeriodDays: 0 }).publication).toBe('blocked_overdue');
  });

  it('cancelamento respeita o periodo pago, sem tolerancia extra', () => {
    expect(decide('canceled', future).publication).toBe('allowed');
    expect(decide('canceled', recent).publication).toBe('blocked_canceled');
    expect(decide('expired', recent).publication).toBe('blocked_canceled');
  });

  it('suspensao administrativa vence qualquer outro estado', () => {
    expect(decide('active', future, { adminHold: true }).publication).toBe('blocked_admin');
    expect(decide('suspended', future).publication).toBe('blocked_admin');
  });

  it('estorno em revisao suspende mesmo com periodo pago', () => {
    expect(decide('active', future, { disputeHold: true }).publication).toBe('blocked_dispute');
  });

  it('decide igual para a mesma entrada, qualquer que seja o estado', () => {
    for (const state of BILLING_STATES) {
      const first = decide(state as BillingState, future);
      const second = decide(state as BillingState, future);
      expect(first).toEqual(second);
    }
  });
});

describe('assinatura do webhook', () => {
  const body = JSON.stringify({ event: 'payment.success', chargeId: 'cha_1', amount: 199 });
  const now = new Date();

  it('aceita a assinatura correta', () => {
    const t = now.getTime();
    const result = verifyWebhookSignature({
      rawBody: body,
      signatureHeader: `t=${t},v1=${signWebhookBody(t, body, SECRET)}`,
      secret: SECRET,
      now,
    });
    expect(result.valid).toBe(true);
  });

  it('recusa assinatura de outro corpo', () => {
    const t = now.getTime();
    const signature = signWebhookBody(t, body, SECRET);
    const result = verifyWebhookSignature({
      rawBody: body.replace('199', '1'),
      signatureHeader: `t=${t},v1=${signature}`,
      secret: SECRET,
      now,
    });
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('invalid_signature');
  });

  it('o timestamp faz parte da string assinada', () => {
    const t = now.getTime();
    const signature = signWebhookBody(t, body, SECRET);
    // Mesma assinatura, timestamp diferente: nao confere.
    const result = verifyWebhookSignature({
      rawBody: body,
      signatureHeader: `t=${t + 1},v1=${signature}`,
      secret: SECRET,
      now,
    });
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('invalid_signature');
  });

  it('recusa assinatura fora da janela de tolerancia, antiga ou futura', () => {
    const past = now.getTime() - 10 * 60 * 1000;
    const ahead = now.getTime() + 10 * 60 * 1000;

    for (const t of [past, ahead]) {
      const result = verifyWebhookSignature({
        rawBody: body,
        signatureHeader: `t=${t},v1=${signWebhookBody(t, body, SECRET)}`,
        secret: SECRET,
        now,
      });
      expect(result.valid).toBe(false);
      expect(result.failure).toBe('timestamp_out_of_tolerance');
    }
  });

  it('recusa cabecalho ausente, malformado ou com segredo errado', () => {
    const t = now.getTime();
    expect(
      verifyWebhookSignature({ rawBody: body, signatureHeader: null, secret: SECRET, now }).failure,
    ).toBe('missing_signature');
    expect(
      verifyWebhookSignature({ rawBody: body, signatureHeader: 'sem-formato', secret: SECRET, now })
        .failure,
    ).toBe('malformed_signature');
    expect(
      verifyWebhookSignature({
        rawBody: body,
        signatureHeader: `t=${t},v1=${signWebhookBody(t, body, 'outro-segredo')}`,
        secret: SECRET,
        now,
      }).failure,
    ).toBe('invalid_signature');
  });

  it('sem segredo configurado nada e aceito', () => {
    const t = now.getTime();
    const result = verifyWebhookSignature({
      rawBody: body,
      signatureHeader: `t=${t},v1=${signWebhookBody(t, body, '')}`,
      secret: '',
      now,
    });
    expect(result.valid).toBe(false);
    expect(result.failure).toBe('not_configured');
  });

  it('confere o token estatico quando configurado', () => {
    const t = now.getTime();
    const base = {
      rawBody: body,
      signatureHeader: `t=${t},v1=${signWebhookBody(t, body, SECRET)}`,
      secret: SECRET,
      now,
      expectedAccessToken: 'token-estatico',
    };
    expect(verifyWebhookSignature({ ...base, accessTokenHeader: 'token-estatico' }).valid).toBe(true);
    expect(verifyWebhookSignature({ ...base, accessTokenHeader: 'errado' }).failure).toBe(
      'invalid_access_token',
    );
    expect(verifyWebhookSignature({ ...base, accessTokenHeader: null }).failure).toBe(
      'invalid_access_token',
    );
  });

  it('le o cabecalho no formato documentado', () => {
    expect(parseSignatureHeader('t=1757083200000,v1=9f2b8c')).toEqual({
      t: '1757083200000',
      v1: '9f2b8c',
    });
    expect(parseSignatureHeader(' t=1 , v1=abc ')).toEqual({ t: '1', v1: 'abc' });
    expect(parseSignatureHeader('v1=abc')).toEqual({ v1: 'abc' });
  });
});

describe('contrato de entrada da contratacao', () => {
  it('aceita apenas plano e forma de pagamento', () => {
    const parsed = startSubscriptionSchema.parse({
      planId: '0d4f6a3e-7c1b-4f8a-9c2d-1e5b7a9c3d4f',
      paymentMethod: 'creditcard',
      // Campos extras sao descartados: o preco nunca vem do navegador.
      priceCents: 1,
      amount: 0.01,
    });
    expect(parsed).toEqual({
      planId: '0d4f6a3e-7c1b-4f8a-9c2d-1e5b7a9c3d4f',
      paymentMethod: 'creditcard',
    });
    expect(Object.keys(parsed)).toHaveLength(2);
  });

  it('recusa forma de pagamento desconhecida', () => {
    const result = startSubscriptionSchema.safeParse({
      planId: '0d4f6a3e-7c1b-4f8a-9c2d-1e5b7a9c3d4f',
      paymentMethod: 'dinheiro',
    });
    expect(result.success).toBe(false);
  });
});
