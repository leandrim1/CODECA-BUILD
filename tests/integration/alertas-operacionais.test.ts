import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@codeca/database';
import type { Mailer } from '@codeca/api';
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
 * Uma falha de verdade, dentro da API, vira alerta para quem opera.
 *
 * Os testes de `tests/unit/monitor.test.ts` provam o monitor isolado. Estes
 * provam a ligação: que as falhas reais -- evento de cobrança que não aplica,
 * e-mail recusado, erro inesperado, conciliação que não roda -- passam por
 * ele. Sem a ligação, o monitor seria um módulo bem testado que ninguém chama.
 *
 * O receptor de alertas é em memória (`api.alerts`): nada vai para a rede.
 */

let clock = new Date('2026-11-14T12:00:00Z');
let api: TestApi;
let conta: RegisteredAccount;

const ALERTAS = 'https://alertas.exemplo.test/entrada';

beforeAll(async () => {
  api = await createTestApi({
    now: () => clock,
    env: { OPS_ALERT_WEBHOOK_URL: ALERTAS, SESSION_TTL_HOURS: '2160' },
  });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  clock = new Date('2026-11-14T12:00:00Z');
  await api.reset();
  conta = await registerAccount(api, { email: 'dona@padaria.com.br', companyName: 'Padaria Central' });
  await verifyEmail(api, conta);
});

const avancarHoras = (horas: number) => {
  clock = new Date(clock.getTime() + horas * 3600_000);
};

const rodar = (caminho: string) =>
  api.app.request(`http://app.localhost:5173${caminho}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TEST_JOB_SECRET}` },
  });

describe('cobrança', () => {
  it('evento que não pôde ser aplicado dispara alerta', async () => {
    const plano = await syncPlanCode(api, 'profissional');
    await startCheckout(conta, plano.id);
    const intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';

    // A aplicação do evento falha: a tabela de cobranças não responde.
    await api.db.execute(sql`alter table charges rename to charges_fora`);
    let resposta;
    try {
      resposta = await sendWebhook(
        api,
        'payment.success',
        subscriptionPayload({
          subscriptionId: 'sub_alerta_1',
          status: 'ACTIVE',
          amountCents: plano.priceCents,
          priceId: plano.priceId,
          chargeId: 'cha_alerta_1',
          metadata: { tenantId: conta.tenantId, intentToken },
        }),
        { signedAtMs: clock.getTime() },
      );
    } finally {
      await api.db.execute(sql`alter table charges_fora rename to charges`);
    }

    // A ValidaPay recebe 2xx: o evento está salvo.
    expect(resposta.status).toBe(200);
    expect(resposta.body.data?.status).toBe('failed');

    // E quem opera recebe o alerta.
    expect(api.alerts).toHaveLength(1);
    expect(api.alerts[0]!.url).toBe(ALERTAS);
    expect(api.alerts[0]!.body.event.kind).toBe('webhook_failed');
    expect(api.alerts[0]!.body.text).toContain('payment.success');
    // Sem o token que liga o evento à empresa, nem dado do pagador.
    const enviado = JSON.stringify(api.alerts);
    expect(enviado).not.toContain(intentToken);
    expect(enviado).not.toContain('contato@construtorahorizonte.com.br');
  });

  it('webhook com assinatura inválida dispara alerta', async () => {
    await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({ subscriptionId: 'sub_x', status: 'ACTIVE', amountCents: 1000 }),
      { corruptSignature: true, signedAtMs: clock.getTime() },
    );

    expect(api.alerts).toHaveLength(1);
    expect(api.alerts[0]!.body.event.kind).toBe('webhook_rejected');
  });

  it('a mesma falha em série gera um alerta só, dentro da janela', async () => {
    for (let i = 0; i < 5; i += 1) {
      await sendWebhook(
        api,
        'payment.success',
        subscriptionPayload({ subscriptionId: 'sub_x', status: 'ACTIVE', amountCents: 1000 }),
        { corruptSignature: true, signedAtMs: clock.getTime() },
      );
    }
    expect(api.alerts).toHaveLength(1);

    // O limite vale no banco, e por isso entre instâncias: passada a janela
    // (30 min por padrão), o alerta volta.
    avancarHoras(1);
    await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({ subscriptionId: 'sub_x', status: 'ACTIVE', amountCents: 1000 }),
      { corruptSignature: true, signedAtMs: clock.getTime() },
    );
    expect(api.alerts).toHaveLength(2);
  });
});

describe('erro inesperado', () => {
  it('erro que ninguém previu dispara alerta, com rota e código da requisição', async () => {
    await api.db.execute(sql`alter table plans rename to plans_fora`);
    let resposta;
    try {
      resposta = await api.client().get('/api/public/plans');
    } finally {
      await api.db.execute(sql`alter table plans_fora rename to plans`);
    }

    expect(resposta.status).toBe(500);
    const alerta = api.alerts.find((item) => item.body.event.kind === 'api_error');
    expect(alerta).toBeDefined();
    expect(alerta!.body.event.context.route).toContain('/public/plans');
    // O código devolvido ao usuário é o mesmo que chega no alerta: é por ele
    // que se liga a reclamação ao registro.
    expect(typeof alerta!.body.event.context.requestId).toBe('string');
    // A mensagem do banco não vai para o usuário...
    expect(JSON.stringify(resposta.body)).not.toContain('plans_fora');
  });
});

describe('conciliação que não roda', () => {
  it('na primeira conferência só começa a vigiar', async () => {
    const primeira = await rodar('/api/sync/run');
    expect(primeira.status).toBe(200);
    expect(api.alerts.filter((item) => item.body.event.kind === 'job_missed')).toHaveLength(0);
  });

  it('mais de 26 horas sem conciliar dispara alerta; conciliar resolve', async () => {
    await rodar('/api/sync/run'); // começa a vigiar
    avancarHoras(20);
    await rodar('/api/sync/run');
    expect(api.alerts.filter((item) => item.body.event.kind === 'job_missed')).toHaveLength(0);

    // A conciliação não rodou, e já passou o prazo.
    avancarHoras(7);
    await rodar('/api/sync/run');
    const faltou = api.alerts.filter((item) => item.body.event.kind === 'job_missed');
    expect(faltou).toHaveLength(1);
    expect(faltou[0]!.body.text).toContain('26 horas');

    // O monitor externo enxerga a mesma coisa.
    const saude = await api.client().get('/api/health?ops=1');
    expect(saude.status).toBe(503);
    expect(saude.body.ops.reconcileOverdue).toBe(true);

    // A conciliação volta a rodar: tudo em dia.
    expect((await rodar('/api/billing/reconcile')).status).toBe(200);
    const depois = await api.client().get('/api/health?ops=1');
    expect(depois.status).toBe(200);
    expect(depois.body.ops.reconcileOverdue).toBe(false);
    expect(depois.body.ops.lastReconcileAt).toBe(clock.toISOString());

    api.alerts.length = 0;
    avancarHoras(20);
    await rodar('/api/sync/run');
    expect(api.alerts).toHaveLength(0);
  });

  it('conciliação que cai inteira dispara alerta', async () => {
    await api.db.execute(sql`alter table subscriptions rename to subscriptions_fora`);
    let resposta;
    try {
      resposta = await rodar('/api/billing/reconcile');
    } finally {
      await api.db.execute(sql`alter table subscriptions_fora rename to subscriptions`);
    }

    expect(resposta.status).toBeGreaterThanOrEqual(500);
    expect(api.alerts.some((item) => item.body.event.kind === 'reconcile_failed')).toBe(true);
  });

  it('sem pedir, o health não consulta nada nem expõe a operação', async () => {
    const saude = await api.client().get('/api/health');
    expect(saude.status).toBe(200);
    expect(saude.body.ops).toBeNull();
  });
});

describe('e-mail', () => {
  it('mensagem recusada pelo provedor dispara alerta, sem destinatário nem conteúdo', async () => {
    const recusando: Mailer = {
      configured: true,
      send: async () => ({ delivered: false, reason: 'Provedor de e-mail respondeu 403.' }),
    };
    const comFalha = await createTestApi({
      mailer: recusando,
      env: { OPS_ALERT_WEBHOOK_URL: ALERTAS },
    });
    try {
      await comFalha.client().post('/api/auth/forgot-password', { email: 'alguem@empresa.com.br' });
      const criada = await registerAccount(comFalha, {
        email: 'nova@empresa.com.br',
        companyName: 'Empresa Nova',
      });
      await comFalha.client().post('/api/auth/forgot-password', { email: criada.email });

      const alerta = comFalha.alerts.find((item) => item.body.event.kind === 'email_failed');
      expect(alerta).toBeDefined();
      expect(alerta!.body.event.context.reason).toContain('403');
      const enviado = JSON.stringify(comFalha.alerts) + JSON.stringify(comFalha.opsEvents);
      expect(enviado).not.toContain('nova@empresa.com.br');
      expect(enviado).not.toContain('redefinir');
    } finally {
      await comFalha.close();
    }
  });
});
