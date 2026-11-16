import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, schema } from '@codeca/database';
import { describePlanChange } from '@codeca/api';
import { DEFAULT_PLANS } from '@codeca/shared';
import {
  createTestApi,
  primarySiteId,
  registerAccount,
  verifyEmail,
  TEST_JOB_SECRET,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';
import {
  expireTrial,
  loadSubscriptionRow,
  sendWebhook,
  startCheckout,
  subscriptionPayload,
  syncPlanCode,
} from '../helpers/billing.js';

/**
 * Fase 6: autoatendimento de chaves e modulos, reducao de plano e clientes da
 * agencia.
 *
 * O que estes testes protegem:
 *  - reduzir plano NAO apaga nada, e e recusado quando a conta nao cabe;
 *  - chave secreta nunca volta, e a de outra empresa nunca e alcancada;
 *  - desligar modulo esconde, nao apaga;
 *  - cliente de uma agencia nunca se liga ao projeto de outra.
 */

let api: TestApi;
let conta: RegisteredAccount;
let vizinha: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});
afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  conta = await registerAccount(api, { email: 'dona@padariaaurora.com.br', companyName: 'Padaria Aurora' });
  await verifyEmail(api, conta);
  vizinha = await registerAccount(api, { email: 'dono@oficinasol.com.br', companyName: 'Oficina Sol' });
  await verifyEmail(api, vizinha);
  // CNPJ: a contratacao no provedor exige documento da empresa.
  await api.db
    .update(schema.tenants)
    .set({ taxId: '12345678000199' })
    .where(eq(schema.tenants.id, conta.tenantId));
});

// ------------------------------------------------------------- downgrade

describe('reducao de plano: o calculo', () => {
  const plano = (code: string) => {
    const p = DEFAULT_PLANS.find((x) => x.code === code)!;
    return { code: p.code, name: p.name, priceCents: p.priceCents, limits: p.limits };
  };
  const semUso = { users: 1, contentRecords: 0, contentByModule: {}, domains: 0, storageBytes: 0 };

  it('conta que cabe no plano menor: nada bloqueia', () => {
    const r = describePlanChange({ from: plano('empresas'), to: plano('essencial'), usage: semUso });
    expect(r.direction).toBe('downgrade');
    expect(r.limits).toHaveLength(0);
    expect(r.blocked).toBe(false);
  });

  it('conta que NAO cabe: diz o que estoura, quanto, e o que fazer', () => {
    const r = describePlanChange({
      from: plano('empresas'),
      to: plano('essencial'),
      usage: { ...semUso, contentRecords: 40, users: 9 },
    });
    expect(r.blocked).toBe(true);
    const conteudos = r.limits.find((l) => l.key === 'contentRecords')!;
    expect(conteudos.current).toBe(40);
    expect(conteudos.excess).toBe(40 - plano('essencial').limits.maxContentRecords);
    // A mensagem promete o que o sistema cumpre: nada e apagado.
    expect(conteudos.message).toContain('Nada será apagado');
    expect(r.instructions.join(' ')).toContain('antes de reduzir o plano');
  });

  it('recursos perdidos sao AVISO, nao bloqueio: a escolha e do cliente', () => {
    const r = describePlanChange({ from: plano('profissional'), to: plano('essencial'), usage: semUso });
    expect(r.features.length).toBeGreaterThan(0);
    expect(r.features.some((f) => f.feature === 'cms_panel')).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.fits).toBe(false);
  });

  it('subir de plano nunca bloqueia', () => {
    const r = describePlanChange({
      from: plano('essencial'),
      to: plano('empresas'),
      usage: { ...semUso, contentRecords: 5 },
    });
    expect(r.direction).toBe('upgrade');
    expect(r.blocked).toBe(false);
  });
});

describe('reducao de plano: a rota', () => {
  /**
   * Assinatura ativa de verdade, como a reconciliacao a encontraria.
   *
   * Passa pelo provedor em memoria (`simulatePaidSession`), e nao por um
   * webhook montado a mao: a troca de plano fala com o provedor, e ele precisa
   * conhecer a assinatura. Um webhook sozinho cria o espelho local e deixa o
   * provedor sem saber de nada -- que foi exatamente o que esta funcao
   * fazia errado na primeira versao.
   */
  async function assinarProfissional() {
    const plano = await syncPlanCode(api, 'profissional');
    await expireTrial(api, conta.siteId);
    const checkout = await startCheckout(conta, plano.id);

    // 1. O PROVEDOR passa a conhecer a assinatura. Sem isto, a troca de plano
    //    falha no provedor, nao na regra que este teste quer medir.
    const { subscription: remota } = api.billing.simulatePaidSession(checkout.checkoutSessionId);
    const pendente = await loadSubscriptionRow(api, conta.tenantId);

    // 2. O webhook de pagamento promove o plano local. A reconciliacao sozinha
    //    NAO promove: quem concede os limites do plano e o pagamento
    //    confirmado, e e so o evento que carrega o preco pago.
    await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: remota.subscriptionId,
        status: 'ACTIVE',
        amountCents: plano.priceCents,
        priceId: plano.priceId,
        chargeId: 'cha_f6',
        nextChargeDate: new Date(Date.now() + 30 * 864e5),
        // `intentToken` e o que liga o evento a ESTA empresa sem confiar em
        // e-mail ou documento. Sem ele o evento fica sem dono.
        metadata: { tenantId: conta.tenantId, planId: plano.id, intentToken: pendente.intentToken },
      }),
    );
    await api.settle();

    const row = await loadSubscriptionRow(api, conta.tenantId);
    expect(row.status).toBe('active');
    expect(row.planId).toBe(plano.id);
    api.billing.calls.length = 0;
    return plano;
  }

  it('a previa diz o impacto SEM mexer em nada', async () => {
    await assinarProfissional();
    const [essencial] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'essencial'));
    await syncPlanCode(api, 'essencial');

    const antes = await loadSubscriptionRow(api, conta.tenantId);
    const previa = await conta.client.post(`/api/tenants/${conta.tenantId}/billing/change-plan`, {
      planId: essencial!.id,
      preview: true,
    });
    expect(previa.status, previa.errorMessage ?? '').toBe(200);
    expect(previa.body.preview).toBe(true);
    expect(previa.body.impacto).toBeTruthy();
    expect(previa.body.impacto.direction).toBe('downgrade');

    const depois = await loadSubscriptionRow(api, conta.tenantId);
    expect(depois.planId).toBe(antes.planId);
    expect(depois.pendingPlanId).toBe(antes.pendingPlanId);
    expect(api.billing.calls.filter((c) => c === 'changePlan')).toHaveLength(0);
  });

  it('reducao que nao cabe e RECUSADA, e o provedor nem e chamado', async () => {
    const plano = await assinarProfissional();
    await syncPlanCode(api, 'essencial');
    const [essencial] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'essencial'));

    // Enche a conta acima do limite do Essencial.
    const siteId = await primarySiteId(api, conta.tenantId);
    const limite = (essencial!.limits as { maxContentRecords: number }).maxContentRecords;
    await api.db.insert(schema.services).values(
      Array.from({ length: limite + 3 }, (_, i) => ({
        tenantId: conta.tenantId,
        siteId,
        title: `Serviço ${i}`,
        slug: `servico-${i}`,
      })),
    );

    const chamadasAntes = api.billing.calls.length;
    const resposta = await conta.client.post(`/api/tenants/${conta.tenantId}/billing/change-plan`, {
      planId: essencial!.id,
    });
    expect(resposta.status).toBe(409);
    expect(resposta.errorMessage).toContain('não cabe no plano');
    expect(api.billing.calls.length).toBe(chamadasAntes);

    // E nada foi apagado nem alterado.
    const servicos = await api.db.select().from(schema.services).where(eq(schema.services.tenantId, conta.tenantId));
    expect(servicos).toHaveLength(limite + 3);
    const sub = await loadSubscriptionRow(api, conta.tenantId);
    expect(sub.planId).toBe(plano.id);
    expect(sub.pendingPlanId).toBeNull();
  });

  it('reducao que cabe e aceita, e a tela passa a mostrar quando ela vale', async () => {
    await assinarProfissional();
    await syncPlanCode(api, 'essencial');
    const [essencial] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'essencial'));

    const resposta = await conta.client.post(`/api/tenants/${conta.tenantId}/billing/change-plan`, {
      planId: essencial!.id,
    });
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);

    const sub = await loadSubscriptionRow(api, conta.tenantId);
    expect(sub.pendingPlanId).toBe(essencial!.id);
    expect(sub.pendingPlanRequestedAt).not.toBeNull();
    // O plano em vigor NAO muda: quem promove e o webhook do provedor.
    expect(sub.planId).not.toBe(essencial!.id);

    const painel = await conta.client.get(`/api/tenants/${conta.tenantId}/billing`);
    expect(painel.body.subscription.pendingPlanChange).toMatchObject({ planId: essencial!.id });
  });
});

// ---------------------------------------------------------------- chaves

describe('chaves de integracao', () => {
  /** Emite uma chave pelo caminho interno, como a CODECA IA faria. */
  async function emitir(account: RegisteredAccount, kind: 'publishable' | 'secret' = 'secret') {
    const siteId = await primarySiteId(api, account.tenantId);
    const [linha] = await api.db
      .insert(schema.siteApiKeys)
      .values({
        tenantId: account.tenantId,
        siteId,
        kind,
        name: 'Chave do site',
        lookup: `lk_${Math.random().toString(36).slice(2, 14)}`,
        secretHash: 'a'.repeat(64),
        token: kind === 'publishable' ? 'pk_abc_def' : null,
        scopes: ['content:read'],
      })
      .returning({ id: schema.siteApiKeys.id });
    return linha!.id;
  }

  it('lista a situacao sem NUNCA devolver o segredo', async () => {
    await emitir(conta, 'secret');
    await emitir(conta, 'publishable');

    const r = await conta.client.get(`/api/tenants/${conta.tenantId}/integration/keys`);
    expect(r.status, r.errorMessage ?? '').toBe(200);
    expect(r.body.keys).toHaveLength(2);

    const secreta = r.body.keys.find((k: { kind: string }) => k.kind === 'secret');
    expect(secreta.token).toBeNull();
    expect(secreta.hint).toMatch(/…$/);
    expect(secreta.status).toBe('ativa');
    // Nem o hash do segredo aparece.
    expect(JSON.stringify(r.body)).not.toContain('a'.repeat(64));

    // A publicavel volta inteira: ela precisa ser copiada para o site.
    const publica = r.body.keys.find((k: { kind: string }) => k.kind === 'publishable');
    expect(publica.token).toBe('pk_abc_def');

    // Emitir continua sendo da CODECA IA, e a tela sabe disso.
    expect(r.body.canIssue).toBe(false);
  });

  it('revoga uma chave, e revogar de novo e recusado', async () => {
    const keyId = await emitir(conta);
    const r = await conta.client.delete(`/api/tenants/${conta.tenantId}/integration/keys/${keyId}`);
    expect(r.status, r.errorMessage ?? '').toBe(200);

    const [linha] = await api.db.select().from(schema.siteApiKeys).where(eq(schema.siteApiKeys.id, keyId));
    expect(linha!.revokedAt).not.toBeNull();

    const denovo = await conta.client.delete(`/api/tenants/${conta.tenantId}/integration/keys/${keyId}`);
    expect(denovo.status).toBe(409);
  });

  it('rotaciona devolvendo o segredo novo UMA vez, com carencia para a antiga', async () => {
    const keyId = await emitir(conta);
    const r = await conta.client.post(
      `/api/tenants/${conta.tenantId}/integration/keys/${keyId}/rotate`,
      { graceMinutes: 30 },
    );
    expect(r.status, r.errorMessage ?? '').toBe(200);
    expect(r.body.token).toMatch(/^cb_sec_/);
    expect(r.body.notice).toContain('30 minuto');

    // A antiga ganhou prazo; a nova nasce sem prazo.
    const [antiga] = await api.db.select().from(schema.siteApiKeys).where(eq(schema.siteApiKeys.id, keyId));
    expect(antiga!.expiresAt).not.toBeNull();

    // O segredo nao volta na listagem depois disso.
    const lista = await conta.client.get(`/api/tenants/${conta.tenantId}/integration/keys`);
    expect(JSON.stringify(lista.body)).not.toContain(r.body.token);
  });

  it('a chave de outra empresa nunca e alcancada, nem para ler nem para revogar', async () => {
    const daVizinha = await emitir(vizinha);

    const revogar = await conta.client.delete(`/api/tenants/${conta.tenantId}/integration/keys/${daVizinha}`);
    expect(revogar.status).toBe(404);

    const rotacionar = await conta.client.post(
      `/api/tenants/${conta.tenantId}/integration/keys/${daVizinha}/rotate`,
      {},
    );
    expect(rotacionar.status).toBe(404);

    // E continua intacta.
    const [linha] = await api.db.select().from(schema.siteApiKeys).where(eq(schema.siteApiKeys.id, daVizinha));
    expect(linha!.revokedAt).toBeNull();

    // Trocar o identificador da empresa no endereco tambem nao passa.
    const cruzado = await conta.client.get(`/api/tenants/${vizinha.tenantId}/integration/keys`);
    expect([403, 404]).toContain(cruzado.status);
  });
});

// --------------------------------------------------------------- modulos

describe('modulos', () => {
  it('lista o que esta ligado, e as dependencias reais', async () => {
    const r = await conta.client.get(`/api/tenants/${conta.tenantId}/integration/modules`);
    expect(r.status, r.errorMessage ?? '').toBe(200);
    expect(r.body.modules.length).toBeGreaterThan(0);
    expect(r.body.plan.panelIncluded).toBe(true);

    const produtos = r.body.modules.find((m: { key: string }) => m.key === 'produtos');
    if (produtos) {
      expect(produtos.dependsOn.map((d: { key: string }) => d.key)).toContain('categorias');
    }
  });

  it('desligar ESCONDE, nao apaga: a previa diz quantos conteudos somem do site', async () => {
    const siteId = await primarySiteId(api, conta.tenantId);
    await api.db.insert(schema.services).values([
      { tenantId: conta.tenantId, siteId, title: 'Entrega', slug: 'entrega' },
      { tenantId: conta.tenantId, siteId, title: 'Encomenda', slug: 'encomenda' },
    ]);

    const previa = await conta.client.patch(
      `/api/tenants/${conta.tenantId}/integration/modules/servicos`,
      { enabled: false, preview: true },
    );
    expect(previa.status, previa.errorMessage ?? '').toBe(200);
    expect(previa.body.impacto.records).toBe(2);
    expect(previa.body.impacto.warnings.join(' ')).toContain('não serão apagados');

    // A previa nao alterou nada.
    const [antes] = await api.db
      .select()
      .from(schema.siteModules)
      .where(and(eq(schema.siteModules.siteId, siteId), eq(schema.siteModules.moduleKey, 'servicos')));
    expect(antes!.enabled).toBe(true);

    const acao = await conta.client.patch(
      `/api/tenants/${conta.tenantId}/integration/modules/servicos`,
      { enabled: false },
    );
    expect(acao.status).toBe(200);
    expect(acao.body.changed).toBe(true);

    const [depois] = await api.db
      .select()
      .from(schema.siteModules)
      .where(and(eq(schema.siteModules.siteId, siteId), eq(schema.siteModules.moduleKey, 'servicos')));
    expect(depois!.enabled).toBe(false);

    // O conteudo continua inteiro no banco.
    const servicos = await api.db.select().from(schema.services).where(eq(schema.services.tenantId, conta.tenantId));
    expect(servicos).toHaveLength(2);

    // E ligar de novo traz tudo de volta.
    const religa = await conta.client.patch(
      `/api/tenants/${conta.tenantId}/integration/modules/servicos`,
      { enabled: true },
    );
    expect(religa.status).toBe(200);
    expect((await api.db.select().from(schema.services)).length).toBe(2);
  });

  it('ligar um modulo avisa o que ele usa e esta desligado', async () => {
    const siteId = await primarySiteId(api, conta.tenantId);
    const existe = await api.db
      .select()
      .from(schema.siteModules)
      .where(and(eq(schema.siteModules.siteId, siteId), eq(schema.siteModules.moduleKey, 'produtos')));
    if (existe.length === 0) return; // segmento sem produtos: nada a medir

    await conta.client.patch(`/api/tenants/${conta.tenantId}/integration/modules/categorias`, { enabled: false });
    const previa = await conta.client.patch(
      `/api/tenants/${conta.tenantId}/integration/modules/produtos`,
      { enabled: true, preview: true },
    );
    expect(previa.body.impacto.missingDependencies.map((d: { key: string }) => d.key)).toContain('categorias');
  });

  it('modulo de outra empresa nao e alcancado', async () => {
    const r = await conta.client.patch(
      `/api/tenants/${vizinha.tenantId}/integration/modules/servicos`,
      { enabled: false },
    );
    expect([403, 404]).toContain(r.status);
  });
});

// --------------------------------------------------- clientes da agencia

describe('clientes da agencia', () => {
  it('cadastra, lista com os projetos, e liga um projeto a um cliente', async () => {
    const criado = await conta.client.post(`/api/tenants/${conta.tenantId}/clients`, {
      name: 'Construtora Horizonte',
      contactEmail: 'contato@horizonte.com.br',
    });
    expect(criado.status, criado.errorMessage ?? '').toBe(200);
    const clientId = criado.body.client.id as string;

    const siteId = await primarySiteId(api, conta.tenantId);
    const liga = await conta.client.patch(
      `/api/tenants/${conta.tenantId}/sites/${siteId}/client`,
      { clientId },
    );
    expect(liga.status, liga.errorMessage ?? '').toBe(200);

    const lista = await conta.client.get(`/api/tenants/${conta.tenantId}/clients`);
    expect(lista.body.clients).toHaveLength(1);
    expect(lista.body.clients[0].projects).toHaveLength(1);
    expect(lista.body.unassigned).toHaveLength(0);

    // Desfazer o vinculo devolve o projeto para "sem cliente".
    const desliga = await conta.client.patch(
      `/api/tenants/${conta.tenantId}/sites/${siteId}/client`,
      { clientId: null },
    );
    expect(desliga.status).toBe(200);
    const depois = await conta.client.get(`/api/tenants/${conta.tenantId}/clients`);
    expect(depois.body.unassigned).toHaveLength(1);
  });

  it('o cliente de uma agencia nao se liga ao projeto de outra', async () => {
    const daVizinha = await vizinha.client.post(`/api/tenants/${vizinha.tenantId}/clients`, {
      name: 'Cliente da Oficina',
    });
    expect(daVizinha.status).toBe(200);

    const siteId = await primarySiteId(api, conta.tenantId);
    const tentativa = await conta.client.patch(
      `/api/tenants/${conta.tenantId}/sites/${siteId}/client`,
      { clientId: daVizinha.body.client.id },
    );
    // O banco recusa pela chave estrangeira composta (id, empresa).
    expect(tentativa.status).toBeGreaterThanOrEqual(400);

    const [site] = await api.db.select().from(schema.sites).where(eq(schema.sites.id, siteId));
    expect(site!.clientId).toBeNull();
  });

  it('nao lista os clientes de outra empresa', async () => {
    await vizinha.client.post(`/api/tenants/${vizinha.tenantId}/clients`, { name: 'Cliente da Oficina' });
    const lista = await conta.client.get(`/api/tenants/${conta.tenantId}/clients`);
    expect(lista.body.clients).toHaveLength(0);
  });
});

