import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { emailHash, enqueueEmail, processOutbox, signSvix } from '@codeca/api';
import { createTestApi, registerAccount, verifyEmail, type RegisteredAccount, type TestApi } from '../helpers/api.js';
import {
  expireTrial,
  loadSubscriptionRow,
  sendWebhook,
  startCheckout,
  subscriptionPayload,
  syncPlanCode,
} from '../helpers/billing.js';
import { createScriptedMailer, notices, outboxRows, PERMANENT, runJob, TRANSIENT } from '../helpers/mail.js';

/**
 * Avisos por e-mail sobre a conta (Fase 4).
 *
 * Todos os cenarios rodam com **relogio simulado**: o teste decide que horas
 * sao, avanca os dias e dispara as tarefas agendadas como o agendador faria.
 * Nenhum e-mail sai de verdade -- o provedor e um roteiro em memoria.
 *
 * Horarios usados (Brasilia = UTC-3):
 *   17:47 UTC = 14:47, a tarefa da tarde (dentro da janela dos avisos de avaliacao)
 *   05:23 UTC = 02:23, a conciliacao da madrugada (fora da janela)
 */

const DAY = 24 * 3600 * 1000;
const RESEND_SECRET = `whsec_${Buffer.from('segredo-do-webhook-do-resend-de-teste').toString('base64')}`;

/** Cadastro as 12:00 de Brasilia de 02/03/2027; a avaliacao vai ate 16/03, 12:00. */
const INICIO = new Date('2027-03-02T15:00:00.000Z');
const tarde = (dia: string) => new Date(`2027-03-${dia}T17:47:00.000Z`);
const madrugada = (dia: string) => new Date(`2027-03-${dia}T05:23:00.000Z`);

let clock = new Date(INICIO);
let api: TestApi;
let mailer: ReturnType<typeof createScriptedMailer>;
let conta: RegisteredAccount;
let plano: { id: string; priceId: string; priceCents: number };
let intentToken: string;

const SUB = 'sub_avisos_1';

const ASSUNTO = {
  welcome: 'Sua conta na CODECA Build está pronta',
  tresDias: 'Sua avaliação termina em 3 dias',
  amanha: 'Sua avaliação termina amanhã',
  encerrada: 'Sua avaliação gratuita terminou',
  pago: 'Pagamento confirmado',
  recusado: 'Não conseguimos confirmar seu pagamento',
  atraso: 'Há um pagamento em atraso na sua assinatura',
  suspenso: 'O acesso da sua conta foi suspenso',
  cancelado: 'Cancelamento da assinatura confirmado',
};

beforeAll(async () => {
  mailer = createScriptedMailer();
  api = await createTestApi({
    now: () => new Date(clock),
    mailer,
    env: { BILLING_EMAILS_ENABLED: 'true', RESEND_WEBHOOK_SECRET: RESEND_SECRET },
  });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  clock = new Date(INICIO);
  await api.reset();
  mailer.calls.length = 0;
  conta = await registerAccount(api, {
    email: 'dona@padariaaurora.com.br',
    companyName: 'Padaria Aurora',
    name: 'Marina Souza',
  });
  await verifyEmail(api, conta);
  await api.settle();
  plano = await syncPlanCode(api, 'profissional');
  intentToken = '';
});

/** Evento de assinatura com todas as datas no relogio simulado. */
const evento = (overrides: Partial<Parameters<typeof subscriptionPayload>[0]> = {}, sub = SUB, c = conta, token = intentToken) =>
  subscriptionPayload({
    subscriptionId: sub,
    status: 'ACTIVE',
    amountCents: plano.priceCents,
    priceId: plano.priceId,
    metadata: { tenantId: c.tenantId, planId: plano.id, intentToken: token },
    timestamp: new Date(clock),
    chargeDate: new Date(clock),
    paidAt: new Date(clock),
    ...overrides,
  });

const webhook = async (nome: string, payload: Record<string, unknown>, eventId?: string) => {
  const resposta = await sendWebhook(api, nome, payload, { signedAtMs: clock.getTime(), ...(eventId ? { eventId } : {}) });
  expect(resposta.status).toBe(200);
  await api.settle();
  return resposta;
};

/** Abre o pagamento (precisa da sessao: faca antes de avancar o relogio). */
async function abrirPagamento() {
  await startCheckout(conta, plano.id);
  intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';
}

/** Contrata e paga o primeiro ciclo: assinatura ativa. */
async function contratarEPagar(chargeId = 'cha_1', proxima = new Date(clock.getTime() + 30 * DAY)) {
  if (!intentToken) await abrirPagamento();
  await webhook('payment.success', evento({ nextChargeDate: proxima, chargeId }));
}

describe('boas-vindas', () => {
  it('sai uma vez, quando o e-mail e confirmado, com os dados reais da conta', async () => {
    const [aviso] = notices(api, ASSUNTO.welcome);
    expect(notices(api, ASSUNTO.welcome)).toHaveLength(1);
    expect(aviso?.to).toBe(conta.email);
    expect(aviso?.text).toContain('Olá, Marina.');
    expect(aviso?.text).toContain('A conta de Padaria Aurora na CODECA Build está pronta.');
    expect(aviso?.text).toContain('Você tem 14 dias de avaliação gratuita, até 16/03/2027');
    expect(aviso?.html).toContain('Padaria Aurora');
    // A demonstracao esta desligada neste ambiente: o paragrafo dela nao aparece.
    expect(aviso?.text).not.toContain('site de demonstração');

    const [registro] = await outboxRows(api);
    expect(registro).toMatchObject({ kind: 'welcome', status: 'sent', attempts: 1, provider: 'resend' });
    expect(registro?.providerMessageId).toMatch(/^msg_/);
    expect(registro?.dedupeKey.startsWith(`welcome:${conta.tenantId}:${conta.userId}:`)).toBe(true);
    // A chave de idempotencia no provedor e o id do registro.
    expect(mailer.calls[0]?.idempotencyKey).toBe(registro?.id);
  });

  it('nao sai antes de o e-mail ser confirmado', async () => {
    const outra = await registerAccount(api, { email: 'novo@oficinasol.com.br', companyName: 'Oficina Sol' });
    await api.settle();
    expect(notices(api).filter((m) => m.to === outra.email)).toHaveLength(0);
  });
});

describe('avaliacao', () => {
  it('avisa 3 dias antes, na vespera e no encerramento -- um de cada, nos dias certos', async () => {
    // Dia 12: faltam 4 dias. Nada.
    clock = tarde('12');
    await runJob(api, 'sync');
    expect(notices(api, /avaliação/)).toHaveLength(0);

    clock = tarde('13');
    await runJob(api, 'sync');
    expect(notices(api, ASSUNTO.tresDias)).toHaveLength(1);
    expect(notices(api, ASSUNTO.tresDias)[0]?.text).toContain('termina em 3 dias, em 16/03/2027.');

    // Dia 14: faltam 2 dias. Nada novo.
    clock = tarde('14');
    await runJob(api, 'sync');
    expect(notices(api, /avaliação/)).toHaveLength(1);

    clock = tarde('15');
    await runJob(api, 'sync');
    expect(notices(api, ASSUNTO.amanha)).toHaveLength(1);
    expect(notices(api, ASSUNTO.amanha)[0]?.text).toContain('termina amanhã, 16/03/2027.');
    expect(notices(api, ASSUNTO.tresDias)).toHaveLength(1);

    clock = tarde('16');
    await runJob(api, 'sync');
    const [encerrada] = notices(api, ASSUNTO.encerrada);
    expect(notices(api, ASSUNTO.encerrada)).toHaveLength(1);
    expect(encerrada?.text).toContain('terminou em 16/03/2027.');
    expect(encerrada?.text).toContain('Nenhuma cobrança foi feita.');

    // Dias seguintes: nada se repete.
    clock = tarde('17');
    await runJob(api, 'sync');
    await runJob(api, 'reconcile');
    expect(notices(api, /avaliação/)).toHaveLength(3);
  });

  it('a tarefa rodando duas vezes (e a outra tarefa tambem) nao duplica nada', async () => {
    clock = tarde('13');
    await runJob(api, 'sync');
    await runJob(api, 'sync');
    await runJob(api, 'reconcile');
    expect(notices(api, ASSUNTO.tresDias)).toHaveLength(1);
    expect((await outboxRows(api)).filter((r) => r.kind === 'trial_ending_3d')).toHaveLength(1);
  });

  it('a conciliacao da madrugada nao manda aviso de avaliacao', async () => {
    clock = madrugada('13');
    const { body } = await runJob(api, 'reconcile');
    expect(body.data?.notices?.enabled).toBe(true);
    expect(notices(api, /avaliação/)).toHaveLength(0);
    // A tarefa da tarde do mesmo dia manda.
    clock = tarde('13');
    await runJob(api, 'sync');
    expect(notices(api, ASSUNTO.tresDias)).toHaveLength(1);
  });

  it('quem contratou e pagou antes nao recebe aviso de avaliacao nenhum', async () => {
    await abrirPagamento();
    clock = new Date('2027-03-07T15:00:00.000Z');
    await contratarEPagar();
    expect((await loadSubscriptionRow(api, conta.tenantId)).status).toBe('active');

    for (const dia of ['13', '15', '16', '17']) {
      clock = tarde(dia);
      await runJob(api, 'sync');
    }
    expect(notices(api, /avaliação/)).toHaveLength(0);
  });

  it('"amanha" e "3 dias" valem no horario de Brasilia, nao em UTC', async () => {
    // Fim as 22:30 de 16/03 em Brasilia -- que em UTC ja e dia 17.
    await api.db
      .update(schema.subscriptions)
      .set({ trialEndsAt: new Date('2027-03-17T01:30:00.000Z'), accessUntil: new Date('2027-03-17T01:30:00.000Z') })
      .where(eq(schema.subscriptions.tenantId, conta.tenantId));

    clock = tarde('13');
    await runJob(api, 'sync');
    expect(notices(api, ASSUNTO.tresDias)).toHaveLength(1);
    expect(notices(api, ASSUNTO.tresDias)[0]?.text).toContain('em 16/03/2027.');

    clock = tarde('15');
    await runJob(api, 'sync');
    expect(notices(api, ASSUNTO.amanha)[0]?.text).toContain('termina amanhã, 16/03/2027.');

    // Dia 16 a tarde: ainda nao terminou (termina as 22:30).
    clock = tarde('16');
    await runJob(api, 'sync');
    expect(notices(api, ASSUNTO.encerrada)).toHaveLength(0);
    clock = tarde('17');
    await runJob(api, 'sync');
    expect(notices(api, ASSUNTO.encerrada)).toHaveLength(1);
  });
});

describe('pagamento', () => {
  it('pagamento confirmado: um aviso por cobranca, com plano, valor e proxima cobranca', async () => {
    await abrirPagamento();
    clock = new Date('2027-03-07T15:00:00.000Z');
    await contratarEPagar('cha_pago', new Date('2027-04-07T15:00:00.000Z'));

    const [aviso] = notices(api, ASSUNTO.pago);
    expect(notices(api, ASSUNTO.pago)).toHaveLength(1);
    expect(aviso?.text).toContain('Confirmamos o pagamento da assinatura de Padaria Aurora.');
    expect(aviso?.text).toContain('Plano: Profissional');
    expect(aviso?.text).toContain('Valor pago: R$ 59,90');
    expect(aviso?.text).toContain('Confirmado em: 07/03/2027');
    expect(aviso?.text).toContain('Próxima cobrança: 07/04/2027');

    const registro = (await outboxRows(api)).find((r) => r.kind === 'payment_confirmed');
    expect(registro?.dedupeKey.startsWith('payment_confirmed:cha_pago:')).toBe(true);
  });

  it('abrir o pagamento, sem confirmacao da ValidaPay, nao gera aviso de pagamento', async () => {
    await startCheckout(conta, plano.id);
    intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';
    await webhook('subscription.created', evento({ status: 'PENDING', cycleStatus: 'PENDING', paidAt: null }));
    await runJob(api, 'reconcile');
    expect(notices(api, ASSUNTO.pago)).toHaveLength(0);
  });

  it('webhook repetido (mesmo evento e o mesmo pagamento com outro id) nao duplica o aviso', async () => {
    await startCheckout(conta, plano.id);
    intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';
    const corpo = evento({ nextChargeDate: new Date(clock.getTime() + 30 * DAY), chargeId: 'cha_dup' });
    await webhook('payment.success', corpo, 'evt_fixo');
    await webhook('payment.success', corpo, 'evt_fixo');
    await webhook('payment.success', corpo, 'evt_outro');
    await runJob(api, 'reconcile');
    expect(notices(api, ASSUNTO.pago)).toHaveLength(1);
  });

  it('pagamento recusado: um aviso por cobranca, sem motivo nem dado de cartao', async () => {
    await contratarEPagar();
    const recusa = evento({
      cycleStatus: 'FAILED',
      paidAt: null,
      chargeId: 'cha_recusada',
      cycleNumber: 2,
      retry: { attempt: 1, status: 'FAILED', failureReason: 'card_declined' },
    });
    await webhook('payment.failed', recusa);
    // Nova tentativa da MESMA cobranca.
    clock = new Date(clock.getTime() + 3600_000);
    await webhook('payment.failed', { ...recusa, timestamp: clock.toISOString() });

    const [aviso] = notices(api, ASSUNTO.recusado);
    expect(notices(api, ASSUNTO.recusado)).toHaveLength(1);
    expect(aviso?.text).toContain('não foi aprovado');
    expect(`${aviso?.text}${aviso?.html}`).not.toContain('card_declined');
    expect(`${aviso?.text}${aviso?.html}`).not.toMatch(/\d{4}[ -]?\d{4}/);
  });

  it('webhook fora de ordem: uma recusa antiga que chega depois do pagamento nao vira aviso', async () => {
    await startCheckout(conta, plano.id);
    intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';
    const antes = new Date(clock.getTime() - 3600_000);
    await webhook('payment.success', evento({ nextChargeDate: new Date(clock.getTime() + 30 * DAY), chargeId: 'cha_ordem' }));
    await webhook(
      'payment.failed',
      evento({ cycleStatus: 'FAILED', paidAt: null, chargeId: 'cha_ordem', timestamp: antes }),
    );
    await runJob(api, 'reconcile');

    expect(notices(api, ASSUNTO.pago)).toHaveLength(1);
    expect(notices(api, ASSUNTO.recusado)).toHaveLength(0);
  });
});

describe('atraso, suspensao e cancelamento', () => {
  it('assinatura em atraso: avisa com a data ate quando o acesso continua', async () => {
    // Com a avaliacao ainda valendo, o acesso seria o dela.
    await expireTrial(api, conta.siteId);
    await contratarEPagar('cha_1', new Date(clock.getTime() - DAY));
    await webhook(
      'payment.overdue',
      evento({ status: 'DEFAULT', cycleStatus: 'FAILED', paidAt: null, chargeId: 'cha_2', cycleNumber: 2 }),
    );
    const assinatura = await loadSubscriptionRow(api, conta.tenantId);
    expect(assinatura.status).toBe('past_due');
    expect(assinatura.publicationState).toBe('allowed');

    const [aviso] = notices(api, ASSUNTO.atraso);
    expect(notices(api, ASSUNTO.atraso)).toHaveLength(1);
    expect(aviso?.text).toContain('(plano Profissional)');
    // Venceu em 01/03; tolerancia de 5 dias configurada na assinatura.
    expect(aviso?.text).toContain('Seu acesso continua liberado até 06/03/2027.');
    expect(notices(api, ASSUNTO.suspenso)).toHaveLength(0);

    await runJob(api, 'reconcile');
    expect(notices(api, ASSUNTO.atraso)).toHaveLength(1);
  });

  it('acesso suspenso por atraso: um aviso, com o motivo certo, e nao o de avaliacao', async () => {
    await expireTrial(api, conta.siteId);
    await contratarEPagar('cha_1', new Date(clock.getTime() - 10 * DAY));
    await webhook('payment.overdue', evento({ status: 'DEFAULT', cycleStatus: 'FAILED', paidAt: null, cycleNumber: 2 }));
    expect((await loadSubscriptionRow(api, conta.tenantId)).publicationState).toBe('blocked_overdue');

    clock = tarde('02');
    await runJob(api, 'sync');
    await runJob(api, 'reconcile');
    const [aviso] = notices(api, ASSUNTO.suspenso);
    expect(notices(api, ASSUNTO.suspenso)).toHaveLength(1);
    expect(aviso?.text).toContain('Motivo: há um pagamento em atraso e o prazo de regularização terminou.');
    expect(aviso?.text).toContain('Seu conteúdo não foi apagado.');
    expect(notices(api, ASSUNTO.encerrada)).toHaveLength(0);
    expect(notices(api, ASSUNTO.atraso)).toHaveLength(0);
  });

  it('cancelamento confirmado: agendado diz ate quando vai o acesso, e efetivar depois nao repete', async () => {
    const fim = new Date('2027-03-20T15:00:00.000Z');
    await contratarEPagar('cha_1', fim);
    await webhook('subscription.cancel_scheduled', evento({ nextChargeDate: fim }));

    const [aviso] = notices(api, ASSUNTO.cancelado);
    expect(notices(api, ASSUNTO.cancelado)).toHaveLength(1);
    expect(aviso?.text).toContain('Seu acesso continua liberado até 20/03/2027, fim do período já pago.');

    clock = new Date('2027-03-20T16:00:00.000Z');
    await webhook('subscription.canceled', evento({ status: 'CANCELED', canceledAt: new Date(clock), nextChargeDate: null }));
    await runJob(api, 'reconcile');
    expect(notices(api, ASSUNTO.cancelado)).toHaveLength(1);
  });
});

describe('exclusao de conta', () => {
  it('avisa quem pediu, e o registro sobrevive a exclusao da empresa', async () => {
    const resposta = await conta.client.delete(`/api/tenants/${conta.tenantId}`, {
      confirmacao: 'Padaria Aurora',
      password: conta.password,
    });
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
    await api.settle();

    const [aviso] = notices(api, 'A exclusão de Padaria Aurora foi concluída');
    expect(aviso?.to).toBe(conta.email);
    expect(aviso?.text).toContain('foi concluída em 02/03/2027, a seu pedido.');
    // Nao havia assinatura paga: a frase sobre cobranca nao aparece.
    expect(aviso?.text).not.toContain('A assinatura foi cancelada');

    const registro = (await outboxRows(api)).find((r) => r.kind === 'account_deleted');
    expect(registro).toMatchObject({ status: 'sent', tenantId: null });
    expect(registro?.dedupeKey.startsWith(`account_deleted:${conta.tenantId}:`)).toBe(true);
  });
});

describe('duas empresas', () => {
  it('cada uma recebe so o que e seu, com o proprio nome', async () => {
    const outra = await registerAccount(api, {
      email: 'dono@oficinasol.com.br',
      companyName: 'Oficina Sol',
      name: 'Paulo Lima',
    });
    await verifyEmail(api, outra);
    await api.settle();

    await contratarEPagar('cha_aurora');
    clock = tarde('13');
    await runJob(api, 'sync');

    // O pagamento foi da Aurora; so ela recebe a confirmacao.
    expect(notices(api, ASSUNTO.pago).map((m) => m.to)).toEqual([conta.email]);
    // A Oficina Sol segue em avaliacao; so ela recebe o aviso de 3 dias.
    const tres = notices(api, ASSUNTO.tresDias);
    expect(tres.map((m) => m.to)).toEqual([outra.email]);
    expect(tres[0]?.text).toContain('Olá, Paulo.');
    expect(tres[0]?.text).toContain('Oficina Sol');
    expect(tres[0]?.text).not.toContain('Padaria Aurora');

    for (const registro of await outboxRows(api)) {
      const dona = registro.recipient === conta.email ? conta.tenantId : outra.tenantId;
      expect(registro.tenantId).toBe(dona);
    }
  });

  it('so proprietarios ativos recebem: editor e e-mail de contato da empresa ficam de fora', async () => {
    const [editor] = await api.db
      .insert(schema.users)
      .values({ email: 'editor@padariaaurora.com.br', name: 'Edu Editor', emailVerifiedAt: clock })
      .returning({ id: schema.users.id });
    await api.db
      .insert(schema.memberships)
      .values({ tenantId: conta.tenantId, userId: editor!.id, role: 'editor', status: 'active' });

    clock = tarde('13');
    await runJob(api, 'sync');
    expect(notices(api, ASSUNTO.tresDias).map((m) => m.to)).toEqual([conta.email]);
  });
});

describe('fila: falhas, novas tentativas e recuperacao', () => {
  const ctx = () => ({ db: api.db, env: api.env, mailer, now: () => new Date(clock) });
  const enfileirar = (n: number, to = conta.email) =>
    enqueueEmail(ctx(), {
      tenantId: conta.tenantId,
      kind: 'trial_ending_3d',
      eventKey: `teste:${n}`,
      to,
      vars: { firstName: 'Marina', companyName: 'Padaria Aurora', trialEndDate: '16/03/2027' },
    });
  const registroDe = async (n: number) => (await outboxRows(api)).find((r) => r.dedupeKey.startsWith(`teste:${n}:`))!;

  it('falha passageira do provedor: tenta de novo depois, com a mesma chave, e envia uma vez so', async () => {
    mailer.calls.length = 0;
    mailer.failNext(TRANSIENT);
    await enfileirar(1);
    expect((await processOutbox(ctx())).retried).toBe(1);

    let registro = await registroDe(1);
    expect(registro).toMatchObject({ status: 'pending', attempts: 1 });
    expect(registro.lastError).toContain('503');
    expect(registro.nextAttemptAt.getTime()).toBe(clock.getTime() + 60_000);

    // Antes da hora, nao e tentado.
    expect((await processOutbox(ctx())).claimed).toBe(0);

    clock = new Date(clock.getTime() + 2 * 60_000);
    expect((await processOutbox(ctx())).sent).toBe(1);
    registro = await registroDe(1);
    expect(registro).toMatchObject({ status: 'sent', attempts: 2, lastError: '' });
    expect(mailer.calls.map((m) => m.idempotencyKey)).toEqual([registro.id, registro.id]);
    expect(notices(api, ASSUNTO.tresDias)).toHaveLength(1);
  });

  it('falha passageira que nao passa: 5 tentativas com espera crescente, e entao desiste', async () => {
    mailer.calls.length = 0;
    mailer.failNext(TRANSIENT, TRANSIENT, TRANSIENT, TRANSIENT, TRANSIENT);
    await enfileirar(2);
    const esperas: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await processOutbox(ctx());
      const registro = await registroDe(2);
      if (registro.status !== 'pending') break;
      esperas.push((registro.nextAttemptAt.getTime() - clock.getTime()) / 60_000);
      clock = new Date(registro.nextAttemptAt.getTime() + 1000);
    }
    expect(esperas).toEqual([1, 5, 30, 120]);
    expect(await registroDe(2)).toMatchObject({ status: 'failed', attempts: 5 });
    expect(mailer.calls).toHaveLength(5);
    expect(notices(api, ASSUNTO.tresDias)).toHaveLength(0);
  });

  it('recusa definitiva (endereco invalido): falha na hora, sem nova tentativa', async () => {
    mailer.calls.length = 0;
    mailer.failNext(PERMANENT);
    await enfileirar(3, 'endereco-errado@dominio-que-nao-existe.invalid');
    expect((await processOutbox(ctx())).failed).toBe(1);

    const registro = await registroDe(3);
    expect(registro).toMatchObject({ status: 'failed', attempts: 1 });
    // O motivo guardado nao carrega endereco de ninguem.
    expect(registro.lastError).not.toContain('@');

    clock = new Date(clock.getTime() + DAY);
    await processOutbox(ctx());
    expect(mailer.calls).toHaveLength(1);
  });

  it('recuperacao: registro preso em "enviando" por um processo que morreu volta para a fila', async () => {
    await enfileirar(4);
    const preso = await registroDe(4);
    await api.db
      .update(schema.emailOutbox)
      .set({ status: 'sending', lockedAt: new Date(clock.getTime() - 11 * 60_000) })
      .where(eq(schema.emailOutbox.id, preso.id));

    const relatorio = await processOutbox(ctx());
    expect(relatorio).toMatchObject({ recovered: 1, sent: 1 });
    expect((await registroDe(4)).status).toBe('sent');
  });

  it('um registro "enviando" recente NAO e roubado de quem o esta enviando', async () => {
    await enfileirar(5);
    const emUso = await registroDe(5);
    await api.db
      .update(schema.emailOutbox)
      .set({ status: 'sending', lockedAt: new Date(clock.getTime() - 60_000) })
      .where(eq(schema.emailOutbox.id, emUso.id));
    expect(await processOutbox(ctx())).toMatchObject({ recovered: 0, claimed: 0 });
  });

  it('dois processadores ao mesmo tempo: cada e-mail sai uma vez', async () => {
    mailer.calls.length = 0;
    for (let n = 10; n < 18; n += 1) await enfileirar(n);
    const [a, b] = await Promise.all([processOutbox(ctx()), processOutbox(ctx())]);
    expect(a.sent + b.sent).toBe(8);
    expect(mailer.calls).toHaveLength(8);
    expect(new Set(mailer.calls.map((m) => m.idempotencyKey)).size).toBe(8);
  });

  it('aviso parado alem do prazo nao e mais enviado', async () => {
    mailer.calls.length = 0;
    await enfileirar(20);
    clock = new Date(clock.getTime() + 3 * DAY);
    expect(await processOutbox(ctx())).toMatchObject({ expired: 1, sent: 0 });
    expect(mailer.calls).toHaveLength(0);
    expect((await registroDe(20)).status).toBe('failed');
  });

  it('o mesmo evento para a mesma pessoa so entra na fila uma vez; para outra pessoa, entra', async () => {
    expect(await enfileirar(30)).toBe(true);
    expect(await enfileirar(30)).toBe(false);
    expect(await enfileirar(30, 'socia@padariaaurora.com.br')).toBe(true);
  });
});

describe('eventos de entrega do Resend', () => {
  const entrega = async (
    type: string,
    emailId: string,
    extra: Record<string, unknown> = {},
    opcoes: { assinatura?: string; idade?: number } = {},
  ) => {
    const rawBody = JSON.stringify({ type, created_at: clock.toISOString(), data: { email_id: emailId, ...extra } });
    const id = `msg_evt_${Math.random().toString(36).slice(2)}`;
    const ts = Math.floor(clock.getTime() / 1000) - (opcoes.idade ?? 0);
    const response = await api.app.request('http://app.localhost:5173/api/webhooks/resend', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': id,
        'svix-timestamp': String(ts),
        'svix-signature': opcoes.assinatura ?? `v1,${signSvix(RESEND_SECRET, id, ts, rawBody)}`,
      },
      body: rawBody,
    });
    return { status: response.status, body: (await response.json()) as { data?: Record<string, unknown> } };
  };
  const boasVindas = async () => (await outboxRows(api)).find((r) => r.kind === 'welcome')!;

  it('"entregue" e registrado -- e so entao se pode dizer que chegou', async () => {
    const antes = await boasVindas();
    expect(antes).toMatchObject({ status: 'sent', deliveryStatus: '' });
    const resposta = await entrega('email.delivered', antes.providerMessageId!);
    expect(resposta.status).toBe(200);
    expect(resposta.body.data?.handled).toBe(true);
    expect((await boasVindas()).deliveryStatus).toBe('delivered');
  });

  it('assinatura invalida, vencida ou ausente: recusado, e nada muda', async () => {
    const registro = await boasVindas();
    expect((await entrega('email.bounced', registro.providerMessageId!, {}, { assinatura: 'v1,AAAA' })).status).toBe(401);
    expect((await entrega('email.bounced', registro.providerMessageId!, {}, { idade: 3600 })).status).toBe(401);
    expect((await boasVindas()).deliveryStatus).toBe('');
    expect(await api.db.select().from(schema.emailSuppressions)).toHaveLength(0);
  });

  it('devolucao definitiva: o endereco sai dos avisos, e o proximo aviso nao e enviado', async () => {
    const registro = await boasVindas();
    const resposta = await entrega('email.bounced', registro.providerMessageId!, {
      bounce: { type: 'Permanent', subType: 'General', message: 'mailbox does not exist' },
    });
    expect(resposta.body.data).toMatchObject({ handled: true, suppressed: true });
    expect((await boasVindas()).deliveryStatus).toBe('bounced');

    const [bloqueio] = await api.db.select().from(schema.emailSuppressions);
    expect(bloqueio?.emailHash).toBe(emailHash(api.env, conta.email));
    // Guarda so o resumo, nunca o endereco.
    expect(JSON.stringify(bloqueio)).not.toContain(conta.email);

    mailer.calls.length = 0;
    clock = tarde('13');
    await runJob(api, 'sync');
    expect(mailer.calls).toHaveLength(0);
    const tres = (await outboxRows(api)).find((r) => r.kind === 'trial_ending_3d');
    expect(tres?.status).toBe('suppressed');
  });

  it('devolucao passageira (caixa cheia) nao tira o endereco dos avisos', async () => {
    const registro = await boasVindas();
    const resposta = await entrega('email.bounced', registro.providerMessageId!, {
      bounce: { type: 'Transient', subType: 'MailboxFull' },
    });
    expect(resposta.body.data).toMatchObject({ handled: true, suppressed: false });
    expect(await api.db.select().from(schema.emailSuppressions)).toHaveLength(0);
  });

  it('marcado como spam: o endereco sai dos avisos', async () => {
    const registro = await boasVindas();
    await entrega('email.complained', registro.providerMessageId!);
    expect((await boasVindas()).deliveryStatus).toBe('complained');
    expect(await api.db.select().from(schema.emailSuppressions)).toHaveLength(1);

    clock = tarde('13');
    await runJob(api, 'sync');
    expect(notices(api, ASSUNTO.tresDias)).toHaveLength(0);
  });

  it('fora de ordem e repetido: um "entregue" atrasado nao apaga a devolucao', async () => {
    const registro = await boasVindas();
    const devolucao = { bounce: { type: 'Permanent' } };
    await entrega('email.bounced', registro.providerMessageId!, devolucao);
    await entrega('email.bounced', registro.providerMessageId!, devolucao);
    await entrega('email.delivered', registro.providerMessageId!);
    expect((await boasVindas()).deliveryStatus).toBe('bounced');
    expect(await api.db.select().from(schema.emailSuppressions)).toHaveLength(1);
  });

  it('evento de e-mail que nao e da fila e confirmado e ignorado', async () => {
    const resposta = await entrega('email.bounced', 'id-de-outro-email', { bounce: { type: 'Permanent' } });
    expect(resposta.status).toBe(200);
    expect(resposta.body.data?.handled).toBe(false);
    expect(await api.db.select().from(schema.emailSuppressions)).toHaveLength(0);
  });
});

describe('avisos desligados (o padrao)', () => {
  it('nada entra na fila e nada e enviado, em nenhum gatilho', async () => {
    const desligado = createScriptedMailer();
    let relogio = new Date(INICIO);
    const outra = await createTestApi({ now: () => new Date(relogio), mailer: desligado });
    try {
      const c = await registerAccount(outra, { email: 'a@empresa-desligada.com.br', companyName: 'Empresa Desligada' });
      await verifyEmail(outra, c);
      await outra.settle();
      relogio = tarde('13');
      const { body } = await runJob(outra, 'sync').then(() => runJob(outra, 'reconcile'));
      expect(body.data?.notices).toMatchObject({ enabled: false, enqueued: 0, outbox: null });
      expect(await outboxRows(outra)).toHaveLength(0);
      expect(desligado.calls).toHaveLength(0);
    } finally {
      await outra.close();
    }
  });
});
