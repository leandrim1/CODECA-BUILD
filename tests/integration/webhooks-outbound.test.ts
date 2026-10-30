import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import {
  OUTBOUND_DELIVERY_HEADER,
  OUTBOUND_EVENT_HEADER,
  OUTBOUND_SIGNATURE_HEADER,
} from '@codeca/shared';
import { verifyWebhook } from '@codeca/sdk/server';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Aviso de publicacao ao site do cliente.
 *
 * Duas coisas sao verificadas aqui, e a segunda e a que faz o recurso valer
 * algo numa funcao serverless: que o aviso sai quando o conteudo muda, e que
 * a entrega **sobrevive** a falha do site -- fica gravada e volta na proxima
 * passagem do cron. Um aviso que as vezes nao chega e pior do que nenhum: o
 * site do cliente passaria a confiar nele.
 */

let api: TestApi;
let admin: RegisteredAccount;
let empresa: RegisteredAccount;

const ENDERECO = 'https://horizonte.com.br/api/revalidar';

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  admin = await registerAccount(api, { email: 'admin@codeca.test', companyName: 'Plataforma' });
  await api.db
    .update(schema.users)
    .set({ platformRole: 'platform_admin' })
    .where(eq(schema.users.id, admin.userId));

  empresa = await registerAccount(api, {
    email: 'contato@horizonte.com.br',
    companyName: 'Construtora Horizonte',
  });
  await verifyEmail(api, empresa);
});

/** Cadastra o endereco e devolve o segredo mostrado na criacao. */
async function cadastrarEndereco(url = ENDERECO): Promise<{ id: string; secret: string }> {
  const response = await admin.client.post(`/api/platform/sites/${empresa.siteId}/webhooks`, {
    url,
    description: 'Revalidacao do cache',
  });
  expect(response.status, response.errorMessage ?? '').toBe(201);
  expect(response.body.showOnce).toBe(true);
  return { id: response.body.webhook.id as string, secret: response.body.secret as string };
}

async function publicarImovel(titulo = 'Apartamento Jardim') {
  const response = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
    title: titulo,
    type: 'apartamento',
    purpose: 'venda',
    publicationStatus: 'published',
  });
  expect(response.status, response.errorMessage ?? '').toBe(201);
  return response.body.property as { id: string; slug: string };
}

function rodarCron(limit = 50) {
  return api
    .client()
    .post(`/api/billing/reconcile?limit=${limit}`, undefined, {
      headers: { authorization: 'Bearer segredo-do-job-de-reconciliacao-de-teste' },
    });
}

// ------------------------------------------------------------- o aviso sai

describe('o aviso sai quando o conteudo e publicado', () => {
  it('entrega assinada, e o site confere com o verificador do SDK', async () => {
    const endereco = await cadastrarEndereco();
    const imovel = await publicarImovel();

    expect(api.webhooks.calls).toHaveLength(1);
    const entrega = api.webhooks.calls[0]!;
    expect(entrega.url).toBe(ENDERECO);
    expect(entrega.headers[OUTBOUND_EVENT_HEADER]).toBe('content.published');
    expect(entrega.headers[OUTBOUND_DELIVERY_HEADER]).toBeTruthy();

    // O caminho que o site do cliente percorre, com o verificador publicado.
    const evento = await verifyWebhook({
      rawBody: entrega.body,
      signature: entrega.headers[OUTBOUND_SIGNATURE_HEADER] ?? null,
      secret: endereco.secret,
    });

    expect(evento.siteId).toBe(empresa.siteId);
    expect(evento.moduleKey).toBe('imoveis');
    expect(evento.action).toBe('created');
    expect(evento.slug).toBe(imovel.slug);
  });

  it('o corpo traz o que mudou, nao o conteudo', async () => {
    const endereco = await cadastrarEndereco();

    const imovel = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Apartamento Jardim',
      type: 'apartamento',
      purpose: 'venda',
      publicationStatus: 'published',
      description: 'Vista para a represa, com area gourmet climatizada.',
      price: 1_250_000,
      address: { street: 'Rua das Palmeiras', number: '450', city: 'Campinas' },
    });
    expect(imovel.status, imovel.errorMessage ?? '').toBe(201);

    const bruto = api.webhooks.calls[0]!.body;
    const corpo = JSON.parse(bruto) as Record<string, unknown>;

    // Identificadores, e nada mais. O aviso viaja para um endereco que a
    // plataforma nao controla, e o site busca o conteudo pela API com a
    // propria credencial, que e o que define o que ele pode ler. Mandar o
    // conteudo aqui duplicaria a regra de visibilidade em dois lugares.
    expect(Object.keys(corpo).sort()).toEqual([
      'action',
      'entityId',
      'event',
      'moduleKey',
      'publishedAt',
      'siteId',
      'slug',
    ]);

    // O `slug` vai, e precisa ir: e por ele que o site sabe qual pagina
    // invalidar. O resto do conteudo, nao.
    expect(corpo.slug).toBe('apartamento-jardim');
    expect(bruto).not.toContain('represa');
    expect(bruto).not.toContain('1250000');
    expect(bruto).not.toContain('Palmeiras');
    expect(bruto).not.toContain(endereco.secret);
  });

  it('salvar um documento avisa: documento nao tem rascunho', async () => {
    await cadastrarEndereco();

    const response = await empresa.client.put(
      `/api/tenants/${empresa.tenantId}/modules/contato/document`,
      { email: 'novo@horizonte.com.br', phone: '(19) 3333-0000' },
    );
    expect(response.status, response.errorMessage ?? '').toBe(200);

    expect(api.webhooks.calls).toHaveLength(1);
    const corpo = JSON.parse(api.webhooks.calls[0]!.body);
    expect(corpo.moduleKey).toBe('contato');
    expect(corpo.action).toBe('updated');
    expect(corpo.entityId).toBeNull();
  });

  it('remover um imovel publicado tambem avisa', async () => {
    await cadastrarEndereco();
    const imovel = await publicarImovel();
    api.webhooks.reset();

    const response = await empresa.client.delete(
      `/api/tenants/${empresa.tenantId}/properties/${imovel.id}`,
    );
    expect(response.status).toBe(204);

    // Uma pagina que deixou de existir precisa sair do cache tanto quanto uma
    // que mudou.
    expect(api.webhooks.calls).toHaveLength(1);
    const corpo = JSON.parse(api.webhooks.calls[0]!.body);
    expect(corpo.action).toBe('removed');
    expect(corpo.slug).toBe(imovel.slug);
  });

  it('rascunho que continua rascunho nao avisa', async () => {
    await cadastrarEndereco();

    const rascunho = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Ainda em rascunho',
      type: 'casa',
      purpose: 'venda',
      publicationStatus: 'draft',
    });
    expect(rascunho.status, rascunho.errorMessage ?? '').toBe(201);

    const alteracao = await empresa.client.patch(
      `/api/tenants/${empresa.tenantId}/properties/${rascunho.body.property.id}`,
      { title: 'Rascunho com outro titulo' },
    );
    expect(alteracao.status, alteracao.errorMessage ?? '').toBe(200);

    // Avisar a cada tecla digitada num rascunho gastaria entrega e
    // invalidaria cache sem motivo: o visitante nao ve rascunho.
    expect(api.webhooks.calls).toHaveLength(0);
  });

  it('publicar um rascunho avisa', async () => {
    await cadastrarEndereco();

    const rascunho = await empresa.client.post(`/api/tenants/${empresa.tenantId}/properties`, {
      title: 'Vai ser publicado',
      type: 'casa',
      purpose: 'venda',
      publicationStatus: 'draft',
    });
    expect(api.webhooks.calls).toHaveLength(0);

    const publicacao = await empresa.client.patch(
      `/api/tenants/${empresa.tenantId}/properties/${rascunho.body.property.id}`,
      { publicationStatus: 'published' },
    );
    expect(publicacao.status, publicacao.errorMessage ?? '').toBe(200);

    expect(api.webhooks.calls).toHaveLength(1);
    expect(JSON.parse(api.webhooks.calls[0]!.body).action).toBe('updated');
  });

  it('site sem endereco cadastrado nao gera entrega nenhuma', async () => {
    await publicarImovel();

    expect(api.webhooks.calls).toHaveLength(0);
    const entregas = await api.db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.siteId, empresa.siteId));
    expect(entregas).toHaveLength(0);
  });

  it('endereco desativado nao recebe', async () => {
    const endereco = await cadastrarEndereco();
    const desativacao = await admin.client.patch(
      `/api/platform/sites/${empresa.siteId}/webhooks/${endereco.id}`,
      { isActive: false },
    );
    expect(desativacao.status, desativacao.errorMessage ?? '').toBe(200);

    await publicarImovel();
    expect(api.webhooks.calls).toHaveLength(0);
  });
});

// ------------------------------------------------------ a entrega sobrevive

describe('a entrega sobrevive a falha do site', () => {
  it('a publicacao do cliente nao falha quando o site dele esta fora', async () => {
    await cadastrarEndereco();
    api.webhooks.respondWith(500);

    // O cliente pediu para gravar um imovel. Avisar o site e consequencia: se
    // o aviso derrubasse a gravacao, uma indisponibilidade no site do cliente
    // impediria o cliente de trabalhar.
    const imovel = await publicarImovel();
    expect(imovel.id).toBeTruthy();

    const [linha] = await api.db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.siteId, empresa.siteId));
    expect(linha?.status).toBe('failed');
    expect(linha?.attempts).toBe(1);
    expect(linha?.lastStatus).toBe(500);
  });

  it('o cron reenvia o que falhou, e para quando entrega', async () => {
    await cadastrarEndereco();
    api.webhooks.respondWith(503);
    await publicarImovel();

    // A proxima tentativa esta agendada para o futuro: o cron precisa que ela
    // esteja vencida.
    await api.db
      .update(schema.webhookDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.webhookDeliveries.siteId, empresa.siteId));

    api.webhooks.reset();
    api.webhooks.respondWith(200);

    const cron = await rodarCron();
    expect(cron.status, cron.errorMessage ?? '').toBe(200);
    expect(cron.body.deliveries.attempted).toBe(1);
    expect(cron.body.deliveries.delivered).toBe(1);

    const [linha] = await api.db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.siteId, empresa.siteId));
    expect(linha?.status).toBe('delivered');
    expect(linha?.attempts).toBe(2);
    expect(linha?.deliveredAt).not.toBeNull();
  });

  it('nao insiste num 404: endereco errado nao melhora com repeticao', async () => {
    await cadastrarEndereco();
    api.webhooks.respondWith(404);
    await publicarImovel();

    const [linha] = await api.db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.siteId, empresa.siteId));
    expect(linha?.status).toBe('exhausted');
    expect(linha?.attempts).toBe(1);
  });

  it('desiste depois de esgotar as tentativas', async () => {
    await cadastrarEndereco();
    api.webhooks.respondWith(500);
    await publicarImovel();

    // Quatro passagens do cron, sempre com o site fora.
    for (let i = 0; i < 4; i += 1) {
      await api.db
        .update(schema.webhookDeliveries)
        .set({ nextAttemptAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.webhookDeliveries.siteId, empresa.siteId));
      await rodarCron();
    }

    const [linha] = await api.db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.siteId, empresa.siteId));
    expect(linha?.status).toBe('exhausted');
    expect(linha?.attempts).toBe(5);

    // Esgotada, nao volta mais: insistir para sempre encheria a tabela de
    // entregas que ninguem vai receber.
    api.webhooks.reset();
    await rodarCron();
    expect(api.webhooks.calls).toHaveLength(0);
  });

  it('o erro registrado nao guarda o corpo da resposta alheia', async () => {
    await cadastrarEndereco();
    api.webhooks.respondWith(500);
    await publicarImovel();

    const [linha] = await api.db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.siteId, empresa.siteId));

    // A coluna e exibida no painel mestre, e o corpo de erro de um servidor
    // alheio pode trazer qualquer coisa, inclusive segredo de quem respondeu.
    expect(linha?.lastError).toBe('O site respondeu 500.');
  });
});

// -------------------------------------------------------- painel mestre

describe('cadastro dos enderecos', () => {
  it('o segredo aparece uma vez e nao volta na leitura', async () => {
    const endereco = await cadastrarEndereco();

    const lista = await admin.client.get(`/api/platform/sites/${empresa.siteId}/webhooks`);
    expect(lista.status, lista.errorMessage ?? '').toBe(200);
    expect(lista.body.items).toHaveLength(1);

    const item = lista.body.items[0];
    expect(item.url).toBe(ENDERECO);
    // Assinar exige o segredo em claro no banco, mas ele nunca e lido de
    // volta: quem perdeu o valor rotaciona.
    expect(JSON.stringify(item)).not.toContain(endereco.secret);
    expect(item.secret).toBeUndefined();
  });

  it('a rotacao troca o segredo e invalida o anterior', async () => {
    const endereco = await cadastrarEndereco();

    const rotacao = await admin.client.post(
      `/api/platform/sites/${empresa.siteId}/webhooks/${endereco.id}/rotate`,
    );
    expect(rotacao.status, rotacao.errorMessage ?? '').toBe(200);
    const novo = rotacao.body.secret as string;
    expect(novo).not.toBe(endereco.secret);

    api.webhooks.reset();
    await publicarImovel();
    const entrega = api.webhooks.calls[0]!;

    // A entrega nova confere com o segredo novo e nao com o antigo.
    await expect(
      verifyWebhook({
        rawBody: entrega.body,
        signature: entrega.headers[OUTBOUND_SIGNATURE_HEADER] ?? null,
        secret: novo,
      }),
    ).resolves.toMatchObject({ event: 'content.published' });

    await expect(
      verifyWebhook({
        rawBody: entrega.body,
        signature: entrega.headers[OUTBOUND_SIGNATURE_HEADER] ?? null,
        secret: endereco.secret,
      }),
    ).rejects.toMatchObject({ code: 'assinatura_invalida' });
  });

  it('exige https, menos em localhost', async () => {
    const insegura = await admin.client.post(`/api/platform/sites/${empresa.siteId}/webhooks`, {
      url: 'http://horizonte.com.br/api/revalidar',
    });
    expect(insegura.status).toBe(422);

    const local = await admin.client.post(`/api/platform/sites/${empresa.siteId}/webhooks`, {
      url: 'http://localhost:3000/api/revalidar',
    });
    expect(local.status, local.errorMessage ?? '').toBe(201);
  });

  it('nao cadastra o mesmo endereco duas vezes', async () => {
    await cadastrarEndereco();
    const repetido = await admin.client.post(`/api/platform/sites/${empresa.siteId}/webhooks`, {
      url: ENDERECO,
    });

    // Cadastrar duas vezes dobraria as entregas.
    expect(repetido.status).toBe(409);
  });

  it('a empresa nao cadastra endereco no proprio site', async () => {
    const response = await empresa.client.post(`/api/platform/sites/${empresa.siteId}/webhooks`, {
      url: ENDERECO,
    });

    expect(response.status).toBe(403);
  });

  it('a auditoria registra o endereco e nunca o segredo', async () => {
    const endereco = await cadastrarEndereco();

    const logs = await api.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityType, 'site_webhook'));

    expect(logs.length).toBeGreaterThan(0);
    const texto = JSON.stringify(logs);
    expect(texto).toContain(ENDERECO);
    expect(texto).not.toContain(endereco.secret);
  });
});
