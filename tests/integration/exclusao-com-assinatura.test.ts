import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeBillingBeforeDeletion } from '@codeca/api';
import { AppError } from '@codeca/shared';
import { eq, isNull, schema } from '@codeca/database';
import {
  createTestApi,
  registerAccount,
  TEST_JOB_SECRET,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';
import { loadSubscriptionRow, startCheckout, syncPlanCode } from '../helpers/billing.js';

/**
 * Excluir a empresa encerra a cobrança -- e só exclui se encerrar.
 *
 * ## O defeito
 *
 * A exclusão da empresa apagava tudo do nosso lado e não avisava a ValidaPay.
 * A assinatura seguia viva lá: o cartão continuava sendo cobrado, os eventos
 * chegavam sem empresa para receber e o cliente não tinha mais painel por onde
 * cancelar. Entrou junto com a exclusão por LGPD, cujos testes cobriam dados e
 * arquivos e não cobriam uma empresa com assinatura ativa.
 *
 * ## O que estes testes garantem
 *
 * 1. Com assinatura viva, o provedor recebe o cancelamento **antes** de
 *    qualquer coisa ser apagada.
 * 2. Se não der para confirmar o cancelamento, **nada é apagado**. O erro
 *    oposto -- apagar e seguir cobrando -- não tem conserto depois.
 * 3. Sobra prova: o registro de auditoria que sobrevive à exclusão diz qual
 *    assinatura foi encerrada e como.
 * 4. Quem não tem assinatura exclui como antes, sem depender do provedor.
 */

let api: TestApi;
let dona: RegisteredAccount;
let planId: string;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  dona = await registerAccount(api, { email: 'marina@agencia.com.br', companyName: 'Agência Norte' });
  await verifyEmail(api, dona);
  // Documento da empresa: é por ele que a assinatura é localizada no provedor.
  await api.db
    .update(schema.tenants)
    .set({ taxId: '12345678000199' })
    .where(eq(schema.tenants.id, dona.tenantId));
  planId = (await syncPlanCode(api, 'profissional')).id;
});

const apagar = () =>
  dona.client.delete(`/api/tenants/${dona.tenantId}`, {
    confirmacao: 'Agência Norte',
    password: dona.password,
  });

const empresaExiste = async () =>
  (await api.db.select().from(schema.tenants).where(eq(schema.tenants.id, dona.tenantId))).length === 1;

/** O registro que sobrevive à exclusão (gravado sem empresa, de propósito). */
async function auditoriaDaExclusao() {
  const linhas = await api.db
    .select()
    .from(schema.auditLogs)
    .where(isNull(schema.auditLogs.tenantId));
  return linhas.find((linha) => linha.action === 'tenant.deleted') ?? null;
}

/** Contrata, paga e deixa a reconciliação vincular -- uma assinatura ativa de verdade. */
async function assinar(opcoes: { nextChargeDate?: Date; conta?: RegisteredAccount } = {}) {
  const conta = opcoes.conta ?? dona;
  const checkout = await startCheckout(conta, planId);
  const { subscription } = api.billing.simulatePaidSession(checkout.checkoutSessionId, {
    ...(opcoes.nextChargeDate ? { nextChargeDate: opcoes.nextChargeDate } : {}),
  });
  const job = await api.app.request('http://app.localhost:5173/api/billing/reconcile', {
    method: 'POST',
    headers: { authorization: `Bearer ${TEST_JOB_SECRET}` },
  });
  expect(job.status).toBe(200);
  const linha = await loadSubscriptionRow(api, conta.tenantId);
  expect(linha.externalSubscriptionId).toBe(subscription.subscriptionId);
  expect(linha.status).toBe('active');
  return subscription.subscriptionId;
}

describe('empresa com assinatura ativa', () => {
  it('cancela no provedor antes de apagar, e registra o que fez', async () => {
    const subId = await assinar();
    api.billing.calls.length = 0;

    const resposta = await apagar();
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);

    // O provedor foi avisado...
    expect(api.billing.calls).toContain('cancelSubscription');
    // ...e do lado dele não há mais cobrança por vir: com período já pago, o
    // cancelamento fica agendado para o fim dele (é o que a ValidaPay faz).
    const remota = api.billing.subscriptions.get(subId)!;
    expect(remota.status === 'CANCELED' || remota.cancelAtPeriodEnd === true).toBe(true);

    // Só então a empresa foi apagada.
    expect(await empresaExiste()).toBe(false);

    // E sobra a prova, no registro que sobrevive à exclusão.
    const auditoria = await auditoriaDaExclusao();
    const cobranca = (auditoria?.metadata as { cobranca?: Array<Record<string, unknown>> }).cobranca;
    expect(cobranca).toHaveLength(1);
    expect(cobranca![0]).toMatchObject({ externalSubscriptionId: subId, outcome: 'scheduled' });
    expect(resposta.body.cobranca).toHaveLength(1);
  });

  it('sem período pago pela frente, cancela na hora', async () => {
    // A próxima cobrança já passou: não há período pago a respeitar.
    const subId = await assinar({ nextChargeDate: new Date(Date.now() - 86_400_000) });

    const resposta = await apagar();
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);

    expect(api.billing.subscriptions.get(subId)!.status).toBe('CANCELED');
    expect(resposta.body.cobranca[0]).toMatchObject({ outcome: 'canceled' });
    expect(await empresaExiste()).toBe(false);
  });

  it('provedor fora do ar: nada é apagado', async () => {
    const subId = await assinar();
    const antes = await dona.client.get(`/api/tenants/${dona.tenantId}/exclusao/resumo`);

    api.billing.failNext('cancelSubscription', new AppError('upstream_error', 'ValidaPay indisponível.'));

    const resposta = await apagar();
    expect(resposta.status).toBe(502);
    // A mensagem diz o que NÃO aconteceu: é o que a pessoa precisa saber.
    expect(resposta.errorMessage).toMatch(/não foi excluída/i);
    expect(resposta.errorMessage).toMatch(/nada foi apagado/i);

    // Tudo no lugar: empresa, assinatura local e assinatura do provedor.
    expect(await empresaExiste()).toBe(true);
    const linha = await loadSubscriptionRow(api, dona.tenantId);
    expect(linha.status).toBe('active');
    expect(api.billing.subscriptions.get(subId)!.status).toBe('ACTIVE');
    expect(api.billing.subscriptions.get(subId)!.cancelAtPeriodEnd ?? false).toBe(false);
    // Nenhum registro de exclusão para uma exclusão que não houve...
    expect(await auditoriaDaExclusao()).toBeNull();
    // ...mas a tentativa fica rastreável, na própria empresa.
    const tentativas = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.tenantId, dona.tenantId));
    const bloqueada = tentativas.find((linha) => linha.action === 'tenant.deletion_blocked');
    expect(bloqueada).toBeDefined();
    expect(bloqueada!.actorUserId).toBe(dona.userId);
    // O registro diz o motivo e nada além: nem resposta do provedor, nem documento.
    expect(bloqueada!.metadata).toEqual({ motivo: 'cobranca_nao_encerrada' });
    // E a sessão continua valendo: a pessoa segue no painel.
    const depois = await dona.client.get(`/api/tenants/${dona.tenantId}/exclusao/resumo`);
    expect(depois.status).toBe(200);
    expect(depois.body.removidos).toEqual(antes.body.removidos);
  });

  it('provedor que não responde à consulta também interrompe', async () => {
    await assinar();
    api.billing.failNext('getSubscription', new Error('timeout'));

    const resposta = await apagar();
    expect(resposta.status).toBe(502);
    expect(await empresaExiste()).toBe(true);
    // Sem a consulta, nem se tenta cancelar às cegas.
    expect(api.billing.calls.filter((chamada) => chamada === 'cancelSubscription')).toHaveLength(0);
  });

  it('depois que o provedor volta, a mesma exclusão funciona', async () => {
    const subId = await assinar();
    api.billing.failNext('cancelSubscription', new AppError('upstream_error', 'ValidaPay indisponível.'));
    expect((await apagar()).status).toBe(502);

    const resposta = await apagar();
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
    expect(await empresaExiste()).toBe(false);
    const remota = api.billing.subscriptions.get(subId)!;
    expect(remota.status === 'CANCELED' || remota.cancelAtPeriodEnd === true).toBe(true);
  });

  it('cancelamento já agendado não é pedido de novo', async () => {
    const subId = await assinar();
    const cancelar = await dona.client.post(`/api/tenants/${dona.tenantId}/billing/cancel`, {
      reason: 'Não vou mais usar.',
      mode: 'period_end',
    });
    expect(cancelar.status, cancelar.errorMessage ?? '').toBe(200);
    api.billing.calls.length = 0;

    const resposta = await apagar();
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);

    // Conferiu no provedor que já não há cobrança por vir, e não cancelou de novo.
    expect(api.billing.calls).toContain('getSubscription');
    expect(api.billing.calls).not.toContain('cancelSubscription');
    expect(resposta.body.cobranca[0]).toMatchObject({
      externalSubscriptionId: subId,
      outcome: 'already_closed',
    });
    expect(await empresaExiste()).toBe(false);
  });

  it('a tela é avisada antes de perguntar', async () => {
    const antes = await dona.client.get(`/api/tenants/${dona.tenantId}/exclusao/resumo`);
    expect(antes.body.cobranca).toMatchObject({ assinaturaAtiva: false, acessoPagoAte: null });

    await assinar();

    const depois = await dona.client.get(`/api/tenants/${dona.tenantId}/exclusao/resumo`);
    expect(depois.body.cobranca.assinaturaAtiva).toBe(true);
    expect(new Date(depois.body.cobranca.acessoPagoAte).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('contratação aberta, ainda sem vínculo', () => {
  it('paga e ainda não vinculada: localiza pela nossa sessão e cancela', async () => {
    const checkout = await startCheckout(dona, planId);
    // Pagou, e o evento que vincularia a assinatura não chegou.
    const { subscription } = api.billing.simulatePaidSession(checkout.checkoutSessionId);
    expect((await loadSubscriptionRow(api, dona.tenantId)).externalSubscriptionId).toBeNull();

    const resposta = await apagar();
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);

    const remota = api.billing.subscriptions.get(subscription.subscriptionId)!;
    expect(remota.status === 'CANCELED' || remota.cancelAtPeriodEnd === true).toBe(true);
    expect(resposta.body.cobranca[0]).toMatchObject({
      externalSubscriptionId: subscription.subscriptionId,
    });
    expect(await empresaExiste()).toBe(false);
  });

  it('não cancela a assinatura de outra origem com o mesmo documento', async () => {
    const checkout = await startCheckout(dona, planId);
    const { subscription } = api.billing.simulatePaidSession(checkout.checkoutSessionId);
    // Mesmo documento, outra sessão: o documento sozinho não prova de quem é.
    subscription.checkoutId = 'cs_de_outra_origem';

    const resposta = await apagar();

    // A sessão consta como paga e não achamos a assinatura dela: existe
    // dinheiro do cliente que não sabemos onde está. Não se apaga a pista.
    expect(resposta.status).toBe(502);
    expect(await empresaExiste()).toBe(true);
    expect(api.billing.calls).not.toContain('cancelSubscription');
    expect(api.billing.subscriptions.get(subscription.subscriptionId)!.status).toBe('ACTIVE');
  });

  it('aberta e não paga: não há o que cancelar, e a exclusão segue', async () => {
    await startCheckout(dona, planId);

    const resposta = await apagar();
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
    expect(resposta.body.cobranca).toEqual([]);
    expect(api.billing.calls).not.toContain('cancelSubscription');
    expect(await empresaExiste()).toBe(false);
  });
});

describe('empresa sem assinatura', () => {
  it('na avaliação, exclui como antes e não consulta o provedor', async () => {
    api.billing.calls.length = 0;

    const resposta = await apagar();
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
    expect(resposta.body.cobranca).toEqual([]);
    // Quem nunca contratou não depende de a ValidaPay estar no ar para sair.
    expect(api.billing.calls).toEqual([]);
    expect(await empresaExiste()).toBe(false);
  });

  it('assinatura já encerrada não segura a exclusão', async () => {
    const subId = await assinar({ nextChargeDate: new Date(Date.now() - 86_400_000) });
    const cancelar = await dona.client.post(`/api/tenants/${dona.tenantId}/billing/cancel`, {
      reason: 'Encerrando.',
      mode: 'immediate',
    });
    expect(cancelar.status, cancelar.errorMessage ?? '').toBe(200);
    expect(api.billing.subscriptions.get(subId)!.status).toBe('CANCELED');
    api.billing.calls.length = 0;

    const resposta = await apagar();
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
    // Encerrada por resposta do próprio provedor: nada a conferir de novo.
    expect(api.billing.calls).toEqual([]);
    expect(await empresaExiste()).toBe(false);
  });
});

describe('pedidos repetidos', () => {
  it('encerrar duas vezes pede o cancelamento uma vez só', async () => {
    const subId = await assinar();
    api.billing.calls.length = 0;
    const contexto = {
      db: api.db,
      provider: api.billing,
      now: () => new Date(),
      actorUserId: dona.userId,
    };

    // Duplo clique, nova tentativa depois de um erro de rede, duas abas: a
    // segunda passada lê no provedor que já não há cobrança por vir.
    const primeira = await closeBillingBeforeDeletion(contexto, dona.tenantId);
    const segunda = await closeBillingBeforeDeletion(contexto, dona.tenantId);

    expect(primeira).toEqual([expect.objectContaining({ externalSubscriptionId: subId, outcome: 'scheduled' })]);
    expect(segunda).toEqual([
      expect.objectContaining({ externalSubscriptionId: subId, outcome: 'already_closed' }),
    ]);
    expect(api.billing.calls.filter((chamada) => chamada === 'cancelSubscription')).toHaveLength(1);
  });

  it('repetir a exclusão já concluída não alcança mais nada', async () => {
    await assinar();
    expect((await apagar()).status).toBe(200);
    api.billing.calls.length = 0;

    const denovo = await apagar();

    // A empresa não existe mais (e a sessão de quem a tinha, tampouco).
    expect([401, 404]).toContain(denovo.status);
    expect(api.billing.calls).toEqual([]);
  });
});

describe('isolamento: cada empresa só encerra a própria assinatura', () => {
  let vizinha: RegisteredAccount;
  let subDaDona: string;
  let subDaVizinha: string;

  beforeEach(async () => {
    vizinha = await registerAccount(api, {
      email: 'contato@vizinha.com.br',
      companyName: 'Empresa Vizinha',
    });
    await verifyEmail(api, vizinha);
    // Mesmo documento, de propósito: é o pior caso para a busca por documento.
    await api.db
      .update(schema.tenants)
      .set({ taxId: '12345678000199' })
      .where(eq(schema.tenants.id, vizinha.tenantId));

    subDaDona = await assinar();
    subDaVizinha = await assinar({ conta: vizinha });
    api.billing.calls.length = 0;
  });

  it('excluir uma empresa não toca na assinatura da outra', async () => {
    const resposta = await apagar();
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);

    // Só a assinatura de quem pediu foi encerrada.
    expect(resposta.body.cobranca).toEqual([
      expect.objectContaining({ externalSubscriptionId: subDaDona }),
    ]);
    expect(api.billing.calls.filter((chamada) => chamada === 'cancelSubscription')).toHaveLength(1);

    // A da vizinha segue como estava, lá e cá.
    const remota = api.billing.subscriptions.get(subDaVizinha)!;
    expect(remota.status).toBe('ACTIVE');
    expect(remota.cancelAtPeriodEnd ?? false).toBe(false);
    const local = await loadSubscriptionRow(api, vizinha.tenantId);
    expect(local.status).toBe('active');
    expect(local.externalSubscriptionId).toBe(subDaVizinha);
    expect((await vizinha.client.get(`/api/tenants/${vizinha.tenantId}/billing`)).status).toBe(200);
  });

  it('uma empresa não consegue excluir a outra, nem cancelar por ela', async () => {
    const invasao = await vizinha.client.delete(`/api/tenants/${dona.tenantId}`, {
      confirmacao: 'Agência Norte',
      password: vizinha.password,
    });

    expect(invasao.status).toBe(404);
    expect(api.billing.calls).toEqual([]);
    expect(await empresaExiste()).toBe(true);
    expect(api.billing.subscriptions.get(subDaDona)!.status).toBe('ACTIVE');
    expect(api.billing.subscriptions.get(subDaDona)!.cancelAtPeriodEnd ?? false).toBe(false);

    // Nem pela rota de cancelamento da cobrança.
    const cancelar = await vizinha.client.post(`/api/tenants/${dona.tenantId}/billing/cancel`, {
      reason: 'tentativa',
      mode: 'immediate',
    });
    expect(cancelar.status).toBe(404);
    expect(api.billing.calls).toEqual([]);
  });
});
