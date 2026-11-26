import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { TICKET_CORPO_MAX } from '@codeca/shared';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Chamados de suporte.
 *
 * O caso que mais importa nao e a abertura: e o ISOLAMENTO. Um chamado leva
 * junto um retrato da empresa -- plano, uso, quem abriu --, e esse retrato e
 * montado no servidor. Se o navegador pudesse influenciar de quem ele e, um
 * chamado descreveria a empresa de outra pessoa e o atendimento acreditaria.
 *
 * Nada aqui envolve o assistente de IA, e isso tambem e um teste: a Etapa 1
 * funciona inteira sem chave, sem provedor e sem rede.
 */

let api: TestApi;
let alpha: RegisteredAccount;
let beta: RegisteredAccount;
let admin: RegisteredAccount;

const CHAMADO = {
  assunto: 'Não consigo publicar o site',
  categoria: 'site' as const,
  corpo: 'Cliquei em publicar e a tela não respondeu. Tentei em dois navegadores.',
  origemUrl: '/painel/institucional',
};

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

  alpha = await registerAccount(api, { email: 'alpha@construtora.com.br', companyName: 'Construtora Alpha' });
  beta = await registerAccount(api, { email: 'beta@construtora.com.br', companyName: 'Construtora Beta' });
  await verifyEmail(api, alpha);
  await verifyEmail(api, beta);
});

const abrir = (conta: RegisteredAccount, corpo: Record<string, unknown> = {}) =>
  conta.client.post(`/api/tenants/${conta.tenantId}/suporte/chamados`, { ...CHAMADO, ...corpo });

describe('abrir um chamado', () => {
  it('grava a primeira mensagem e devolve um número legível', async () => {
    const resposta = await abrir(alpha);
    expect(resposta.status).toBe(201);
    expect(resposta.body.numero).toBe(1);

    const detalhe = await alpha.client.get(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${resposta.body.id}`,
    );
    expect(detalhe.status).toBe(200);
    expect(detalhe.body.assunto).toBe(CHAMADO.assunto);
    expect(detalhe.body.status).toBe('aberto');
    expect(detalhe.body.mensagens).toHaveLength(1);
    expect(detalhe.body.mensagens[0].author).toBe('cliente');
    expect(detalhe.body.mensagens[0].body).toBe(CHAMADO.corpo);
  });

  it('numera por empresa, e não globalmente', async () => {
    await abrir(alpha);
    await abrir(alpha);
    const daBeta = await abrir(beta);
    // Se a numeração fosse global, a Beta receberia 3 -- e saberia quantos
    // chamados a plataforma inteira recebeu.
    expect(daBeta.body.numero).toBe(1);
  });

  it('recusa assunto curto e mensagem longa demais', async () => {
    expect((await abrir(alpha, { assunto: 'oi' })).status).toBe(422);
    expect((await abrir(alpha, { corpo: 'a'.repeat(TICKET_CORPO_MAX + 1) })).status).toBe(422);
  });

  it('recusa uma origem que não seja caminho do painel', async () => {
    // Um `https://` arbitrário aqui viraria link clicável no painel mestre,
    // apontando para onde o remetente quisesse.
    expect((await abrir(alpha, { origemUrl: 'https://site-de-terceiro.test/x' })).status).toBe(422);
  });
});

describe('o contexto que acompanha o chamado', () => {
  it('é montado no servidor, a partir da empresa da sessão', async () => {
    const criado = await abrir(alpha);
    const [linha] = await api.db
      .select({ contexto: schema.tickets.contexto, tenantId: schema.tickets.tenantId })
      .from(schema.tickets)
      .where(eq(schema.tickets.id, criado.body.id));

    const contexto = linha?.contexto as Record<string, any>;
    expect(linha?.tenantId).toBe(alpha.tenantId);
    expect(contexto.empresa.nome).toBe('Construtora Alpha');
    expect(contexto.usuario.email).toBe('alpha@construtora.com.br');
    expect(contexto.plano.codigo).toBeTruthy();
    expect(typeof contexto.uso.conteudos.usados).toBe('number');
    expect(typeof contexto.uso.armazenamento.limiteBytes).toBe('number');
  });

  it('ignora um contexto forjado no corpo da requisição', async () => {
    const criado = await alpha.client.post(`/api/tenants/${alpha.tenantId}/suporte/chamados`, {
      ...CHAMADO,
      // Tudo abaixo é lixo que o cliente tentou injetar.
      contexto: { empresa: { nome: 'Construtora Beta', slug: 'beta' }, plano: { codigo: 'empresas' } },
      tenantId: beta.tenantId,
      resumo: 'resumo inventado',
      status: 'resolvido',
      prioridade: 'alta',
    });
    expect(criado.status).toBe(201);

    const [linha] = await api.db
      .select({
        contexto: schema.tickets.contexto,
        tenantId: schema.tickets.tenantId,
        status: schema.tickets.status,
        prioridade: schema.tickets.prioridade,
        resumo: schema.tickets.resumo,
      })
      .from(schema.tickets)
      .where(eq(schema.tickets.id, criado.body.id));

    const contexto = linha?.contexto as Record<string, any>;
    expect(linha?.tenantId).toBe(alpha.tenantId);
    expect(contexto.empresa.nome).toBe('Construtora Alpha');
    // Situação, prioridade e resumo não são do cliente.
    expect(linha?.status).toBe('aberto');
    expect(linha?.prioridade).toBe('normal');
    expect(linha?.resumo).toBe('');
  });

  it('não volta para o cliente: é material do atendimento', async () => {
    const criado = await abrir(alpha);
    const detalhe = await alpha.client.get(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${criado.body.id}`,
    );
    expect(detalhe.body.contexto).toBeUndefined();
  });
});

describe('isolamento entre empresas', () => {
  it('uma empresa não enxerga o chamado da outra', async () => {
    const daBeta = await abrir(beta);

    // Pela URL da própria empresa, com o id da outra: 404, e não 403 -- 403
    // confirmaria que o chamado existe em algum lugar.
    const tentativa = await alpha.client.get(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${daBeta.body.id}`,
    );
    expect(tentativa.status).toBe(404);
  });

  it('uma empresa não responde no chamado da outra', async () => {
    const daBeta = await abrir(beta);
    const tentativa = await alpha.client.post(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${daBeta.body.id}/mensagens`,
      { corpo: 'mensagem que não deveria entrar neste chamado' },
    );
    expect(tentativa.status).toBe(404);

    const detalhe = await beta.client.get(
      `/api/tenants/${beta.tenantId}/suporte/chamados/${daBeta.body.id}`,
    );
    expect(detalhe.body.mensagens).toHaveLength(1);
  });

  it('a lista traz só os chamados da própria empresa', async () => {
    await abrir(alpha);
    await abrir(beta);
    await abrir(beta);

    const lista = await alpha.client.get(`/api/tenants/${alpha.tenantId}/suporte/chamados`);
    expect(lista.status).toBe(200);
    expect(lista.body.total).toBe(1);
    expect(lista.body.items).toHaveLength(1);
  });

  it('usar o id de empresa da outra na URL não abre porta', async () => {
    const tentativa = await alpha.client.post(`/api/tenants/${beta.tenantId}/suporte/chamados`, CHAMADO);
    expect([403, 404]).toContain(tentativa.status);

    const nenhum = await api.db
      .select({ id: schema.tickets.id })
      .from(schema.tickets)
      .where(eq(schema.tickets.tenantId, beta.tenantId));
    expect(nenhum).toHaveLength(0);
  });
});

describe('a conversa', () => {
  it('o cliente responde e a vez volta para o suporte', async () => {
    const criado = await abrir(alpha);
    await admin.client.post(`/api/platform/chamados/${criado.body.id}/mensagens`, {
      corpo: 'Olá! Já estamos verificando o que houve na publicação.',
    });

    const depoisDoSuporte = await alpha.client.get(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${criado.body.id}`,
    );
    expect(depoisDoSuporte.body.status).toBe('aguardando_cliente');

    await alpha.client.post(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${criado.body.id}/mensagens`,
      { corpo: 'Obrigado! Continua dando o mesmo erro aqui.' },
    );
    const depoisDoCliente = await alpha.client.get(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${criado.body.id}`,
    );
    expect(depoisDoCliente.body.status).toBe('em_atendimento');
    expect(depoisDoCliente.body.mensagens).toHaveLength(3);
  });

  it('o cliente encerra o próprio chamado, e não responde depois', async () => {
    const criado = await abrir(alpha);
    const encerrou = await alpha.client.post(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${criado.body.id}/encerrar`,
      {},
    );
    expect(encerrou.status).toBe(204);

    const depois = await alpha.client.get(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${criado.body.id}`,
    );
    expect(depois.body.status).toBe('fechado');

    const tentativa = await alpha.client.post(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${criado.body.id}/mensagens`,
      { corpo: 'mais uma mensagem depois de encerrado' },
    );
    expect(tentativa.status).toBe(422);
  });

  it('a lista mostra os abertos por padrão', async () => {
    const primeiro = await abrir(alpha);
    await abrir(alpha, { assunto: 'Outra dúvida sobre o domínio' });
    await alpha.client.post(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${primeiro.body.id}/encerrar`,
      {},
    );

    const abertos = await alpha.client.get(`/api/tenants/${alpha.tenantId}/suporte/chamados`);
    expect(abertos.body.total).toBe(1);

    const todos = await alpha.client.get(
      `/api/tenants/${alpha.tenantId}/suporte/chamados?situacao=todos`,
    );
    expect(todos.body.total).toBe(2);
  });
});

describe('o atendimento, no painel mestre', () => {
  it('vê a fila de todas as empresas, com o contexto', async () => {
    await abrir(alpha);
    await abrir(beta);

    const fila = await admin.client.get('/api/platform/chamados');
    expect(fila.status).toBe(200);
    expect(fila.body.total).toBe(2);

    const umId = fila.body.items[0].id as string;
    const detalhe = await admin.client.get(`/api/platform/chamados/${umId}`);
    expect(detalhe.status).toBe(200);
    expect(detalhe.body.contexto.empresa.nome).toBeTruthy();
    expect(detalhe.body.empresa).toBeTruthy();
  });

  it('quem não é administrador da plataforma não alcança a fila', async () => {
    await abrir(alpha);
    const tentativa = await alpha.client.get('/api/platform/chamados');
    expect([401, 403]).toContain(tentativa.status);
  });

  it('muda a situação e registra a mudança na conversa', async () => {
    const criado = await abrir(alpha);
    const mudou = await admin.client.patch(`/api/platform/chamados/${criado.body.id}`, {
      status: 'resolvido',
      prioridade: 'alta',
    });
    expect(mudou.status).toBe(204);

    const detalhe = await alpha.client.get(
      `/api/tenants/${alpha.tenantId}/suporte/chamados/${criado.body.id}`,
    );
    expect(detalhe.body.status).toBe('resolvido');
    expect(detalhe.body.mensagens.at(-1).author).toBe('sistema');
  });

  it('marca quando a primeira resposta saiu, e só a primeira', async () => {
    const criado = await abrir(alpha);
    await admin.client.post(`/api/platform/chamados/${criado.body.id}/mensagens`, { corpo: 'Primeira resposta do suporte.' });
    const [um] = await api.db
      .select({ primeira: schema.tickets.primeiraRespostaEm })
      .from(schema.tickets)
      .where(eq(schema.tickets.id, criado.body.id));

    await admin.client.post(`/api/platform/chamados/${criado.body.id}/mensagens`, { corpo: 'Segunda resposta do suporte.' });
    const [dois] = await api.db
      .select({ primeira: schema.tickets.primeiraRespostaEm })
      .from(schema.tickets)
      .where(eq(schema.tickets.id, criado.body.id));

    expect(um?.primeira).not.toBeNull();
    expect(dois?.primeira?.toISOString()).toBe(um?.primeira?.toISOString());
  });
});

describe('limite de abertura', () => {
  it('segura um botão em laço sem travar quem precisa de ajuda', async () => {
    const respostas = [];
    for (let i = 0; i < 12; i += 1) {
      respostas.push(await abrir(alpha, { assunto: `Chamado de teste número ${i + 1}` }));
    }
    const criados = respostas.filter((r) => r.status === 201).length;
    const barrados = respostas.filter((r) => r.status === 429).length;
    expect(criados).toBe(10);
    expect(barrados).toBe(2);

    // A cota é por empresa: a outra continua podendo abrir.
    expect((await abrir(beta)).status).toBe(201);
  });
});
