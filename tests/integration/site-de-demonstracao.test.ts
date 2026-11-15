import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema, sql } from '@codeca/database';
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
  sendWebhook,
  startCheckout,
  subscriptionPayload,
  syncPlanCode,
} from '../helpers/billing.js';

/**
 * Site de demonstração da avaliação.
 *
 * ## O que havia
 *
 * Quem se cadastrava sozinho recebia um painel sem site nenhum ligado: o
 * conteúdo cadastrado não aparecia em lugar algum, e os 14 dias corriam sem
 * resultado visível.
 *
 * ## O que estes testes garantem
 *
 * 1. O cadastro entrega um site de demonstração pronto, com exemplos, dentro
 *    do limite do plano.
 * 2. O que se edita no painel aparece no site -- pelo caminho real (banco e API
 *    pública), não por simulação.
 * 3. Cada empresa tem a sua demonstração, a sua chave e os seus registros.
 * 4. A demonstração não é acesso a mais: vence com a avaliação.
 * 5. Ligar o site real nunca apaga o que é do cliente, e uma falha no meio não
 *    deixa nada pela metade.
 */

let clock = new Date('2026-03-01T12:00:00Z');
let api: TestApi;
let conta: RegisteredAccount;

beforeAll(async () => {
  // A demonstracao vem ligada em producao; o ambiente de teste padrao a
  // desliga (ver `tests/helpers/api.ts`), e aqui ela e o assunto.
  api = await createTestApi({
    now: () => clock,
    env: { SESSION_TTL_HOURS: '2160', DEMO_SITE_ON_SIGNUP: 'true' },
  });
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  clock = new Date('2026-03-01T12:00:00Z');
  await api.reset();
  conta = await registerAccount(api, { email: 'dona@padaria.com.br', companyName: 'Padaria Central' });
  await verifyEmail(api, conta);
});

const avancarDias = (dias: number) => {
  clock = new Date(clock.getTime() + dias * 86_400_000);
};

const base = (alvo: RegisteredAccount) => `/api/tenants/${alvo.tenantId}`;

/** O visitante: sem sessão, sem cookie, sem chave. */
const visitar = (siteId: string, recurso: string) => api.client().get(`/api/demo/${siteId}/${recurso}`);

async function site(alvo: RegisteredAccount) {
  const [linha] = await api.db.select().from(schema.sites).where(eq(schema.sites.id, alvo.siteId));
  return linha!;
}

/** Um administrador da plataforma, para os passos que só a CODECA IA faz. */
async function plataforma() {
  const admin = await registerAccount(api, { email: 'operacao@codeca.test', companyName: 'Plataforma' });
  await api.db.update(schema.users).set({ platformRole: 'platform_admin' }).where(eq(schema.users.id, admin.userId));
  return admin;
}

describe('cadastro: a demonstração nasce pronta', () => {
  it('marca o site, cria os exemplos e uma chave própria', async () => {
    const linha = await site(conta);

    expect(linha.tenantId).toBe(conta.tenantId);
    expect(linha.isDemo).toBe(true);
    expect(linha.demoSeed?.records.banners).toHaveLength(1);
    expect(linha.demoSeed?.records.services).toHaveLength(2);

    // Uma chave, publicável (só leitura), deste site e desta empresa.
    const chaves = await api.db.select().from(schema.siteApiKeys).where(eq(schema.siteApiKeys.siteId, conta.siteId));
    expect(chaves).toHaveLength(1);
    expect(chaves[0]).toMatchObject({ kind: 'publishable', tenantId: conta.tenantId, id: linha.demoSeed?.apiKeyId });

    // Autorizada só para o endereço da plataforma.
    const origens = await api.db.select().from(schema.siteOrigins).where(eq(schema.siteOrigins.siteId, conta.siteId));
    expect(origens.map((origem) => origem.origin)).toEqual(['http://app.localhost:5173']);
  });

  it('os exemplos cabem no limite do plano e deixam vagas para o cliente', async () => {
    const uso = await conta.client.get(`${base(conta)}/plan`);
    expect(uso.status, uso.errorMessage ?? '').toBe(200);

    // Limite de 5 na avaliação: 3 exemplos, 2 vagas.
    const novo = await conta.client.post(`${base(conta)}/services`, { title: 'Pão na chapa' });
    expect(novo.status, novo.errorMessage ?? '').toBe(201);
    const outro = await conta.client.post(`${base(conta)}/services`, { title: 'Café coado' });
    expect(outro.status, outro.errorMessage ?? '').toBe(201);
    // O limite continua valendo: a demonstração não o afrouxa.
    const alem = await conta.client.post(`${base(conta)}/services`, { title: 'Bolo de fubá' });
    expect(alem.status).not.toBe(201);
  });

  it('o painel sabe que há uma demonstração e onde vê-la', async () => {
    const resposta = await conta.client.get(`${base(conta)}/demo`);

    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
    expect(resposta.body.demo).toEqual({
      active: true,
      // O prazo e o da avaliacao que ja existia: 14 dias a partir do cadastro.
      trialEndsAt: new Date(clock.getTime() + TRIAL_PERIOD_DAYS * 86_400_000).toISOString(),
      path: `/demonstracao/${conta.siteId}`,
      examples: 3,
      ended: false,
    });
  });

  it('o painel abre com conteúdo, não vazio', async () => {
    const servicos = await conta.client.get(`${base(conta)}/services`);
    const banners = await conta.client.get(`${base(conta)}/banners`);

    expect(servicos.status).toBe(200);
    expect(JSON.stringify(servicos.body)).toContain('Serviço de exemplo');
    expect(JSON.stringify(banners.body)).toContain('site de demonstração');
  });

  it('não cria avaliação a mais nem mexe no prazo', async () => {
    const assinaturas = await api.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, conta.tenantId));

    expect(assinaturas).toHaveLength(1);
    expect(assinaturas[0]!.status).toBe('trialing');
    const dias = Math.round((assinaturas[0]!.trialEndsAt!.getTime() - clock.getTime()) / 86_400_000);
    expect(dias).toBe(TRIAL_PERIOD_DAYS);

    // Ver o site dez vezes não renova nada.
    for (let i = 0; i < 10; i += 1) await visitar(conta.siteId, 'site');
    const depois = await loadSubscriptionRow(api, conta.tenantId);
    expect(depois.trialEndsAt?.getTime()).toBe(assinaturas[0]!.trialEndsAt!.getTime());
    expect(depois.accessUntil?.getTime()).toBe(assinaturas[0]!.accessUntil!.getTime());
  });

  it('empresa criada pela CODECA IA no painel mestre não é demonstração', async () => {
    const admin = await plataforma();
    const criada = await admin.client.post('/api/platform/tenants', {
      companyName: 'Cliente de Projeto Real',
      ownerEmail: 'dono@clientereal.com.br',
      ownerName: 'Dono do Projeto',
    });
    // Seja qual for o contrato dessa rota, nenhum site que não veio do
    // cadastro do próprio cliente pode nascer como demonstração.
    void criada;
    const sites = await api.db.select().from(schema.sites);
    const demonstracoes = sites.filter((linha) => linha.isDemo).map((linha) => linha.id).sort();
    expect(demonstracoes).toEqual([conta.siteId, admin.siteId].sort());
  });
});

describe('ver o site: o caminho real, do painel ao visitante', () => {
  it('o visitante vê o conteúdo de exemplo', async () => {
    const identidade = await visitar(conta.siteId, 'site');
    expect(identidade.status, identidade.errorMessage ?? '').toBe(200);
    expect(identidade.body.site.name).toBe('Padaria Central');

    const servicos = await visitar(conta.siteId, 'services');
    expect(servicos.status).toBe(200);
    expect(JSON.stringify(servicos.body)).toContain('Serviço de exemplo');

    const banners = await visitar(conta.siteId, 'banners');
    expect(JSON.stringify(banners.body)).toContain('Bem-vindo ao seu site de demonstração');

    const institucional = await visitar(conta.siteId, 'content/institucional');
    expect(JSON.stringify(institucional.body)).toContain('Padaria Central');
  });

  it('editar no painel muda o site', async () => {
    const lista = await conta.client.get(`${base(conta)}/services`);
    const exemplo = (lista.body.items ?? lista.body.services ?? lista.body.data) as Array<{ id: string; title: string }>;
    const alvo = exemplo.find((item) => item.title === 'Serviço de exemplo')!;

    const edicao = await conta.client.patch(`${base(conta)}/services/${alvo.id}`, {
      title: 'Pão francês quentinho',
      summary: 'Fornadas às 6h, 11h e 17h.',
    });
    expect(edicao.status, edicao.errorMessage ?? '').toBe(200);

    // Persistiu...
    const [gravado] = await api.db.select().from(schema.services).where(eq(schema.services.id, alvo.id));
    expect(gravado?.title).toBe('Pão francês quentinho');

    // ...e o visitante vê, pelo site.
    const noSite = await visitar(conta.siteId, 'services');
    expect(JSON.stringify(noSite.body)).toContain('Pão francês quentinho');
    expect(JSON.stringify(noSite.body)).toContain('Fornadas às 6h');
    expect(JSON.stringify(noSite.body)).not.toContain('"Serviço de exemplo"');
  });

  it('cadastrar e excluir no painel também aparecem no site', async () => {
    const criado = await conta.client.post(`${base(conta)}/services`, { title: 'Encomenda de bolos' });
    expect(criado.status, criado.errorMessage ?? '').toBe(201);
    expect(JSON.stringify((await visitar(conta.siteId, 'services')).body)).toContain('Encomenda de bolos');

    const id = (criado.body.service ?? criado.body.item ?? criado.body).id as string;
    const excluido = await conta.client.delete(`${base(conta)}/services/${id}`);
    expect([200, 204]).toContain(excluido.status);
    expect(JSON.stringify((await visitar(conta.siteId, 'services')).body)).not.toContain('Encomenda de bolos');
  });

  it('rascunho não aparece: vale a regra de publicação de qualquer site', async () => {
    const rascunho = await conta.client.post(`${base(conta)}/services`, {
      title: 'Ainda em preparação',
      publicationStatus: 'draft',
    });
    expect(rascunho.status, rascunho.errorMessage ?? '').toBe(201);

    expect(JSON.stringify((await visitar(conta.siteId, 'services')).body)).not.toContain('Ainda em preparação');
  });

  it('a chave nunca chega ao navegador', async () => {
    const [chave] = await api.db.select().from(schema.siteApiKeys).where(eq(schema.siteApiKeys.siteId, conta.siteId));

    for (const recurso of ['site', 'services', 'banners', 'content/contato']) {
      const resposta = await visitar(conta.siteId, recurso);
      expect(JSON.stringify(resposta.body)).not.toContain(chave!.token!);
      expect(JSON.stringify([...resposta.headers.entries()])).not.toContain(chave!.token!);
    }
    const painel = await conta.client.get(`${base(conta)}/demo`);
    expect(JSON.stringify(painel.body)).not.toContain(chave!.token!);
  });
});

describe('o que a demonstração não permite', () => {
  it('só leitura, e só do que a página mostra', async () => {
    // Nada de escrita pelo endereço público.
    const escrita = await api.client().post(`/api/demo/${conta.siteId}/services`, { title: 'invasor' });
    expect([404, 405]).toContain(escrita.status);
    const interessado = await api.client().post(`/api/demo/${conta.siteId}/leads`, { name: 'x' });
    expect([404, 405]).toContain(interessado.status);

    // Nem leitura fora da lista (interessados, por exemplo, nunca).
    for (const recurso of ['leads', 'openapi.json', '../tenants', 'properties/qualquer', 'custom/x']) {
      const resposta = await visitar(conta.siteId, recurso);
      expect(resposta.status, recurso).toBe(404);
    }
  });

  it('não dá acesso administrativo', async () => {
    const semSessao = api.client();
    expect((await semSessao.get(`${base(conta)}/demo`)).status).toBe(401);
    expect((await semSessao.get(`${base(conta)}/services`)).status).toBe(401);
    expect((await semSessao.patch(`${base(conta)}/contact`, { email: 'x@y.com' })).status).toBe(401);
  });

  it('identificador inválido ou inexistente: a mesma resposta', async () => {
    const inexistente = await visitar('00000000-0000-4000-8000-000000000000', 'site');
    const invalido = await visitar('nao-e-um-id', 'site');

    expect(inexistente.status).toBe(404);
    expect(invalido.status).toBe(404);
    expect(inexistente.errorMessage).toBe(invalido.errorMessage);
  });
});

describe('isolamento entre empresas', () => {
  let vizinha: RegisteredAccount;

  beforeEach(async () => {
    vizinha = await registerAccount(api, { email: 'contato@oficina.com.br', companyName: 'Oficina do Bairro' });
    await verifyEmail(api, vizinha);
  });

  it('cada empresa tem site, chave e exemplos próprios', async () => {
    const [a, b] = [await site(conta), await site(vizinha)];

    expect(a.id).not.toBe(b.id);
    expect(a.demoSeed?.apiKeyId).not.toBe(b.demoSeed?.apiKeyId);
    expect(a.demoSeed?.records.services).not.toEqual(b.demoSeed?.records.services);

    const chaves = await api.db.select().from(schema.siteApiKeys);
    expect(new Set(chaves.map((chave) => chave.token)).size).toBe(2);
    expect(new Set(chaves.map((chave) => chave.tenantId))).toEqual(new Set([conta.tenantId, vizinha.tenantId]));
  });

  it('o site de uma nunca mostra o conteúdo da outra', async () => {
    await conta.client.post(`${base(conta)}/services`, { title: 'Sonho de padaria' });
    await vizinha.client.post(`${base(vizinha)}/services`, { title: 'Troca de óleo' });

    const daPadaria = JSON.stringify((await visitar(conta.siteId, 'services')).body);
    const daOficina = JSON.stringify((await visitar(vizinha.siteId, 'services')).body);

    expect(daPadaria).toContain('Sonho de padaria');
    expect(daPadaria).not.toContain('Troca de óleo');
    expect(daOficina).toContain('Troca de óleo');
    expect(daOficina).not.toContain('Sonho de padaria');
    expect((await visitar(vizinha.siteId, 'site')).body.site.name).toBe('Oficina do Bairro');
  });

  it('uma empresa não lê nem altera a demonstração da outra pelo painel', async () => {
    expect((await vizinha.client.get(`${base(conta)}/demo`)).status).toBe(404);
    expect((await vizinha.client.get(`${base(conta)}/services`)).status).toBe(404);

    const [exemplo] = (await site(conta)).demoSeed!.records.services;
    const invasao = await vizinha.client.patch(`${base(conta)}/services/${exemplo}`, { title: 'alterado por outro' });
    expect(invasao.status).toBe(404);
    // Nem trocando só o id do registro, dentro da própria empresa.
    const cruzado = await vizinha.client.patch(`${base(vizinha)}/services/${exemplo}`, { title: 'alterado por outro' });
    expect(cruzado.status).toBe(404);

    const [intacto] = await api.db.select().from(schema.services).where(eq(schema.services.id, exemplo!));
    expect(intacto?.title).toBe('Serviço de exemplo');
  });

  it('a chave de uma não lê o site da outra', async () => {
    const [chaveDaPadaria] = await api.db
      .select()
      .from(schema.siteApiKeys)
      .where(eq(schema.siteApiKeys.siteId, conta.siteId));
    await vizinha.client.post(`${base(vizinha)}/services`, { title: 'Alinhamento' });

    // A chave decide o que é devolvido: com a da padaria, só a padaria.
    const resposta = await api.client().get('/api/v1/services', {
      origin: 'http://app.localhost:5173',
      headers: { authorization: `Bearer ${chaveDaPadaria!.token}` },
    });
    expect(resposta.status).toBe(200);
    expect(JSON.stringify(resposta.body)).not.toContain('Alinhamento');

    // E de outro endereço ela não funciona: não serve para o site de um terceiro.
    const deFora = await api.client().get('/api/v1/services', {
      origin: 'https://site-de-um-terceiro.example',
      headers: { authorization: `Bearer ${chaveDaPadaria!.token}` },
    });
    expect(deFora.status).toBe(403);
  });
});

describe('avaliação: a demonstração não é acesso a mais', () => {
  it('no 14º dia ainda funciona; no 15º, para', async () => {
    avancarDias(13);
    expect((await visitar(conta.siteId, 'services')).status).toBe(200);

    avancarDias(2);
    const vencida = await visitar(conta.siteId, 'services');
    expect(vencida.status).toBe(402);

    // O painel fica em leitura, e a contratação continua aberta.
    expect((await conta.client.get(`${base(conta)}/services`)).status).toBe(200);
    expect((await conta.client.post(`${base(conta)}/services`, { title: 'Depois do prazo' })).status).toBe(403);
    expect((await conta.client.get(`${base(conta)}/billing`)).status).toBe(200);
  });

  it('quem contrata e paga continua vendo o site', async () => {
    const plano = await syncPlanCode(api, 'profissional');
    await startCheckout(conta, plano.id);
    const intentToken = (await loadSubscriptionRow(api, conta.tenantId)).intentToken ?? '';

    avancarDias(TRIAL_PERIOD_DAYS + 1);
    expect((await visitar(conta.siteId, 'services')).status).toBe(402);

    const pago = await sendWebhook(
      api,
      'payment.success',
      subscriptionPayload({
        subscriptionId: 'sub_demo_1',
        status: 'ACTIVE',
        amountCents: plano.priceCents,
        priceId: plano.priceId,
        chargeId: 'cha_demo_1',
        nextChargeDate: new Date(clock.getTime() + 30 * 86_400_000),
        metadata: { intentToken },
      }),
      { signedAtMs: clock.getTime() },
    );
    expect(pago.status).toBe(200);

    expect((await loadSubscriptionRow(api, conta.tenantId)).status).toBe('active');
    expect((await visitar(conta.siteId, 'services')).status).toBe(200);
    // Pagar não transforma a demonstração em site real: isso é a transição.
    expect((await site(conta)).isDemo).toBe(true);
  });
});

describe('transição para o site real', () => {
  let admin: RegisteredAccount;
  const transicao = () => admin.client.get(`/api/platform/sites/${conta.siteId}/demo`);
  const encerrar = (removeUntouchedExamples: boolean, confirm: unknown = true) =>
    admin.client.post(`/api/platform/sites/${conta.siteId}/demo/end`, { confirm, removeUntouchedExamples });
  const emitirChaveReal = () => admin.client.post(`/api/platform/sites/${conta.siteId}/keys`, { kind: 'secret' });

  beforeEach(async () => {
    admin = await plataforma();
  });

  it('só a CODECA IA encerra: o cliente não', async () => {
    // Um cliente comum (a primeira conta de uma instalação nova assume o
    // painel mestre, então `conta` não serve para este caso).
    const cliente = await registerAccount(api, { email: 'dono@oficina.com.br', companyName: 'Oficina do Bairro' });
    await admin.client.post(`/api/platform/sites/${cliente.siteId}/keys`, { kind: 'secret' });

    const proprio = await cliente.client.post(`/api/platform/sites/${cliente.siteId}/demo/end`, {
      confirm: true,
      removeUntouchedExamples: true,
    });
    const alheio = await cliente.client.post(`/api/platform/sites/${conta.siteId}/demo/end`, {
      confirm: true,
      removeUntouchedExamples: true,
    });
    const previa = await cliente.client.get(`/api/platform/sites/${cliente.siteId}/demo`);

    expect(proprio.status).toBe(403);
    expect(alheio.status).toBe(403);
    expect(previa.status).toBe(403);
    expect((await site(cliente)).isDemo).toBe(true);
    expect((await site(conta)).isDemo).toBe(true);
  });

  it('recusa enquanto o site real não tem como se conectar', async () => {
    const previa = await transicao();
    expect(previa.body.transition).toMatchObject({ isDemo: true, realKeyIssued: false });

    const resposta = await encerrar(true);

    expect(resposta.status).toBe(409);
    expect(resposta.errorMessage).toMatch(/chave de integração do site real/i);
    // Nada mudou: a demonstração segue no ar.
    expect((await site(conta)).isDemo).toBe(true);
    expect((await visitar(conta.siteId, 'services')).status).toBe(200);
  });

  it('exige confirmação explícita', async () => {
    await emitirChaveReal();
    expect((await encerrar(true, false)).status).toBeGreaterThanOrEqual(400);
    expect((await admin.client.post(`/api/platform/sites/${conta.siteId}/demo/end`, {})).status).toBeGreaterThanOrEqual(400);
    expect((await site(conta)).isDemo).toBe(true);
  });

  it('remove só o exemplo intocado; o que o cliente editou ou criou fica', async () => {
    const seed = (await site(conta)).demoSeed!;
    const [editado, intocado] = seed.records.services;
    // O cliente assume um exemplo como seu, e cria um conteúdo próprio.
    await conta.client.patch(`${base(conta)}/services/${editado}`, { title: 'Pão francês quentinho' });
    const proprio = await conta.client.post(`${base(conta)}/services`, { title: 'Encomenda de bolos' });
    expect(proprio.status).toBe(201);
    await emitirChaveReal();

    const previa = (await transicao()).body.transition;
    expect(previa).toMatchObject({
      realKeyIssued: true,
      untouchedExamples: { banners: 1, services: 1 },
      editedExamples: { banners: 0, services: 1 },
      exampleDescriptionInPlace: true,
    });

    const resposta = await encerrar(true);
    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
    expect(resposta.body.result).toMatchObject({
      removed: { banners: 1, services: 1 },
      kept: { banners: 0, services: 1 },
      descriptionCleared: true,
    });

    const restantes = await api.db.select().from(schema.services).where(eq(schema.services.siteId, conta.siteId));
    expect(restantes.map((servico) => servico.title).sort()).toEqual(['Encomenda de bolos', 'Pão francês quentinho']);
    expect(restantes.some((servico) => servico.id === intocado)).toBe(false);
    expect(await api.db.select().from(schema.banners).where(eq(schema.banners.siteId, conta.siteId))).toHaveLength(0);

    // O site deixou de ser demonstração, e o endereço de demonstração parou.
    const depois = await site(conta);
    expect(depois.isDemo).toBe(false);
    expect(depois.demoSeed?.endedAt).toBe(clock.toISOString());
    expect((await visitar(conta.siteId, 'services')).status).toBe(404);
    expect((await conta.client.get(`${base(conta)}/demo`)).body.demo).toMatchObject({ active: false, ended: true });

    // O painel do cliente segue funcionando, com o conteúdo dele.
    const painel = await conta.client.get(`${base(conta)}/services`);
    expect(JSON.stringify(painel.body)).toContain('Encomenda de bolos');
  });

  it('sem pedir a remoção, nada é apagado', async () => {
    await emitirChaveReal();

    const resposta = await encerrar(false);

    expect(resposta.status, resposta.errorMessage ?? '').toBe(200);
    expect(resposta.body.result.removed).toEqual({ banners: 0, services: 0 });
    expect(await api.db.select().from(schema.services).where(eq(schema.services.siteId, conta.siteId))).toHaveLength(2);
    expect(await api.db.select().from(schema.banners).where(eq(schema.banners.siteId, conta.siteId))).toHaveLength(1);
    expect((await site(conta)).isDemo).toBe(false);
  });

  it('texto de apresentação que o cliente reescreveu não é apagado', async () => {
    const salvo = await conta.client.put(`${base(conta)}/modules/institucional/document`, {
      companyName: 'Padaria Central',
      shortDescription: 'Pão fresco desde 1987, no coração do bairro.',
    });
    expect([200, 201], salvo.errorMessage ?? '').toContain(salvo.status);
    await emitirChaveReal();

    const resposta = await encerrar(true);

    expect(resposta.body.result.descriptionCleared).toBe(false);
    const [documento] = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(eq(schema.contentDocuments.siteId, conta.siteId));
    expect(JSON.stringify(documento?.data)).toContain('Pão fresco desde 1987');
  });

  it('falha no meio: nada fica pela metade, e dá para tentar de novo', async () => {
    await emitirChaveReal();
    const antes = {
      servicos: (await api.db.select().from(schema.services).where(eq(schema.services.siteId, conta.siteId))).length,
      banners: (await api.db.select().from(schema.banners).where(eq(schema.banners.siteId, conta.siteId))).length,
    };

    // A remoção dos exemplos acontece; a revogação da chave falha logo depois.
    await api.db.execute(sql`alter table site_origins rename to site_origins_fora`);
    let resposta;
    try {
      resposta = await encerrar(true);
    } finally {
      await api.db.execute(sql`alter table site_origins_fora rename to site_origins`);
    }

    expect(resposta.status).toBeGreaterThanOrEqual(500);
    // Tudo como estava: exemplos, marca, chave e site no ar.
    expect((await api.db.select().from(schema.services).where(eq(schema.services.siteId, conta.siteId))).length).toBe(antes.servicos);
    expect((await api.db.select().from(schema.banners).where(eq(schema.banners.siteId, conta.siteId))).length).toBe(antes.banners);
    const linha = await site(conta);
    expect(linha.isDemo).toBe(true);
    expect(linha.demoSeed?.endedAt).toBeUndefined();
    expect((await visitar(conta.siteId, 'services')).status).toBe(200);

    // Resolvido o problema, a mesma transição conclui.
    const denovo = await encerrar(true);
    expect(denovo.status, denovo.errorMessage ?? '').toBe(200);
    expect((await site(conta)).isDemo).toBe(false);
  });

  it('encerrar duas vezes não apaga nada na segunda', async () => {
    await emitirChaveReal();
    expect((await encerrar(false)).status).toBe(200);

    const segunda = await encerrar(true);

    expect(segunda.status).toBe(409);
    // Os exemplos que ficaram na primeira não são apagados pela segunda.
    expect(await api.db.select().from(schema.services).where(eq(schema.services.siteId, conta.siteId))).toHaveLength(2);
  });

  it('a chave real continua valendo depois da transição', async () => {
    const emitida = await emitirChaveReal();
    const token = emitida.body.key.token as string;
    await encerrar(true);

    const leitura = await api.client().get('/api/v1/site', { origin: null, headers: { authorization: `Bearer ${token}` } });
    expect(leitura.status).toBe(200);
  });
});

describe('exclusão da empresa', () => {
  it('leva junto o site, a chave, a origem e os exemplos', async () => {
    const apagar = await conta.client.delete(`${base(conta)}`, {
      confirmacao: 'Padaria Central',
      password: conta.password,
    });
    expect(apagar.status, apagar.errorMessage ?? '').toBe(200);

    expect(await api.db.select().from(schema.sites).where(eq(schema.sites.id, conta.siteId))).toHaveLength(0);
    expect(await api.db.select().from(schema.siteApiKeys).where(eq(schema.siteApiKeys.siteId, conta.siteId))).toHaveLength(0);
    expect(await api.db.select().from(schema.siteOrigins).where(eq(schema.siteOrigins.siteId, conta.siteId))).toHaveLength(0);
    expect(await api.db.select().from(schema.services).where(eq(schema.services.siteId, conta.siteId))).toHaveLength(0);
    expect(await api.db.select().from(schema.banners).where(eq(schema.banners.siteId, conta.siteId))).toHaveLength(0);
    // E o endereço de demonstração para de responder.
    expect((await visitar(conta.siteId, 'site')).status).toBe(404);
  });
});

describe('interruptor do recurso', () => {
  it('desligado, o cadastro cria só o painel, como antes', async () => {
    const semDemo = await createTestApi({ env: { DEMO_SITE_ON_SIGNUP: 'false' } });
    try {
      const outra = await registerAccount(semDemo, { email: 'a@b.com.br', companyName: 'Sem Demonstração' });
      const [linha] = await semDemo.db.select().from(schema.sites).where(eq(schema.sites.id, outra.siteId));

      expect(linha?.isDemo).toBe(false);
      expect(linha?.demoSeed).toBeNull();
      expect(await semDemo.db.select().from(schema.siteApiKeys)).toHaveLength(0);
      expect(await semDemo.db.select().from(schema.services)).toHaveLength(0);
      expect((await outra.client.get(`/api/tenants/${outra.tenantId}/demo`)).body.demo.active).toBe(false);
      expect((await semDemo.client().get(`/api/demo/${outra.siteId}/site`)).status).toBe(404);
    } finally {
      await semDemo.close();
    }
  });
});
