import { and, asc, count, desc, eq, inArray, schema } from '@codeca/database';
import {
  AppError,
  TICKET_STATUSES_ABERTOS,
  abrirTicketSchema,
  paginate,
  responderTicketSchema,
  ticketEstaAberto,
  ticketQuerySchema,
  uuidSchema,
  type TicketStatus,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { created, noContent, ok, parseJsonBody, parseParams, parseQuery } from '../lib/http.js';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit.js';
import { acharChamado, montarContexto, proximoNumero } from '../lib/suporte/contexto.js';
import { requireCapability, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Chamados de suporte, do lado do cliente.
 *
 * Tres garantias que valem para toda rota deste arquivo:
 *
 * 1. **A empresa vem da sessao, nunca do corpo.** Nenhum campo do pedido
 *    escolhe de quem e o chamado. `:tenantId` passa pelo middleware que
 *    confere a participacao de quem esta logado.
 * 2. **O contexto e montado aqui**, a partir do banco. O navegador nao diz
 *    qual e o plano nem quanto do limite foi usado -- se dissesse, um chamado
 *    poderia descrever a empresa de outra pessoa e o atendimento acreditaria.
 * 3. **Nada depende do assistente de IA.** Abrir e acompanhar chamado
 *    funciona com a IA desligada, sem chave ou fora do ar.
 */

const chamadoParams = z.object({ tenantId: uuidSchema, ticketId: uuidSchema });

export function suporteRoutes() {
  const app = new Hono<AppBindings>();

  /** A lista da empresa. Por padrao, so o que ainda espera alguma coisa. */
  app.get('/:tenantId/suporte/chamados', requireCapability('support:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const consulta = parseQuery(c, ticketQuerySchema);

    const porSituacao =
      consulta.situacao === 'todos'
        ? undefined
        : consulta.situacao === 'abertos'
          ? inArray(schema.tickets.status, [...TICKET_STATUSES_ABERTOS])
          : eq(schema.tickets.status, consulta.situacao);

    const filtro = porSituacao
      ? and(eq(schema.tickets.tenantId, tenant.tenantId), porSituacao)
      : eq(schema.tickets.tenantId, tenant.tenantId);

    const [linhas, [total]] = await Promise.all([
      ctx.db
        .select({
          id: schema.tickets.id,
          numero: schema.tickets.numero,
          assunto: schema.tickets.assunto,
          categoria: schema.tickets.categoria,
          status: schema.tickets.status,
          prioridade: schema.tickets.prioridade,
          createdAt: schema.tickets.createdAt,
          updatedAt: schema.tickets.updatedAt,
        })
        .from(schema.tickets)
        .where(filtro)
        .orderBy(desc(schema.tickets.createdAt))
        .limit(consulta.pageSize)
        .offset((consulta.page - 1) * consulta.pageSize),
      ctx.db.select({ value: count() }).from(schema.tickets).where(filtro),
    ]);

    return ok(c, paginate(linhas, total?.value ?? 0, { page: consulta.page, pageSize: consulta.pageSize }));
  });

  /** Abre um chamado. O corpo traz assunto, categoria, texto e a tela de origem. */
  app.post('/:tenantId/suporte/chamados', requireCapability('support:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const sessao = sessionOf(c);
    const entrada = await parseJsonBody(c, abrirTicketSchema);

    /*
      Cota por EMPRESA, e nao por IP ou por pessoa.

      Quem abre chamado em excesso nao e um invasor: e um cliente aflito, e
      quase sempre a mesma empresa. Uma cota por IP puniria o escritorio
      inteiro atras de uma saida so; por pessoa, nao seguraria nada.
    */
    await enforceRateLimit(ctx.db, RATE_LIMITS.suporteAbertura, tenant.tenantId, ctx.now());

    const { contexto, siteId } = await montarContexto(ctx.db, {
      tenantId: tenant.tenantId,
      usuario: {
        id: sessao.user.id,
        nome: sessao.user.name,
        email: sessao.user.email,
        papel: tenant.role,
      },
      origemUrl: entrada.origemUrl,
      agora: ctx.now(),
    });

    /*
      Duas aberturas ao mesmo tempo disputam o mesmo numero. O indice unico
      recusa a segunda, e aqui ela tenta de novo com o numero seguinte. Tres
      tentativas cobrem muito mais do que a concorrencia real de uma empresa.
    */
    let criado: { id: string; numero: number } | null = null;
    let ultimoErro: unknown = null;
    for (let tentativa = 0; tentativa < 3 && !criado; tentativa += 1) {
      const numero = await proximoNumero(ctx.db, tenant.tenantId);
      try {
        const [linha] = await ctx.db
          .insert(schema.tickets)
          .values({
            tenantId: tenant.tenantId,
            siteId,
            openedBy: sessao.user.id,
            numero,
            assunto: entrada.assunto,
            categoria: entrada.categoria,
            status: 'aberto',
            contexto,
            origemUrl: entrada.origemUrl,
            createdAt: ctx.now(),
            updatedAt: ctx.now(),
          })
          .returning({ id: schema.tickets.id, numero: schema.tickets.numero });
        criado = linha ?? null;
      } catch (erro) {
        ultimoErro = erro;
      }
    }
    if (!criado) {
      // O erro original vai para o log do servidor; a pessoa recebe uma
      // frase, nao o conflito de indice.
      console.error('[suporte] não foi possível numerar o chamado:', ultimoErro);
      throw AppError.internal('Não foi possível abrir o chamado. Tente novamente.');
    }

    await ctx.db.insert(schema.ticketMessages).values({
      ticketId: criado.id,
      tenantId: tenant.tenantId,
      author: 'cliente',
      authorUserId: sessao.user.id,
      body: entrada.corpo,
      createdAt: ctx.now(),
    });

    return created(c, { id: criado.id, numero: criado.numero });
  });

  /** Um chamado com a conversa. O contexto NAO volta: e para o atendimento. */
  app.get('/:tenantId/suporte/chamados/:ticketId', requireCapability('support:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { ticketId } = parseParams(c, chamadoParams);

    const chamado = await acharChamado(ctx.db, tenant.tenantId, ticketId);
    if (!chamado) throw AppError.notFound('Chamado não encontrado.');

    const mensagens = await ctx.db
      .select({
        id: schema.ticketMessages.id,
        author: schema.ticketMessages.author,
        body: schema.ticketMessages.body,
        createdAt: schema.ticketMessages.createdAt,
      })
      .from(schema.ticketMessages)
      /*
        O filtro por empresa esta aqui mesmo com o chamado ja conferido acima.

        Nao e redundancia defensiva: e a razao de `ticket_messages` carregar
        `tenant_id`. Uma consulta de empresa sem filtro de empresa depende de
        quem escreve lembrar da conferencia anterior -- e a varredura de
        `tests/unit/isolamento-das-consultas.test.ts` recusa exatamente isso,
        de proposito.
      */
      .where(and(eq(schema.ticketMessages.ticketId, ticketId), eq(schema.ticketMessages.tenantId, tenant.tenantId)))
      .orderBy(asc(schema.ticketMessages.createdAt));

    return ok(c, {
      id: chamado.id,
      numero: chamado.numero,
      assunto: chamado.assunto,
      categoria: chamado.categoria,
      status: chamado.status,
      prioridade: chamado.prioridade,
      origemUrl: chamado.origemUrl,
      createdAt: chamado.createdAt,
      updatedAt: chamado.updatedAt,
      resolvidoEm: chamado.resolvidoEm,
      mensagens,
    });
  });

  /** Responde um chamado aberto. */
  app.post('/:tenantId/suporte/chamados/:ticketId/mensagens', requireCapability('support:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const sessao = sessionOf(c);
    const { ticketId } = parseParams(c, chamadoParams);
    const entrada = await parseJsonBody(c, responderTicketSchema);

    const chamado = await acharChamado(ctx.db, tenant.tenantId, ticketId);
    if (!chamado) throw AppError.notFound('Chamado não encontrado.');
    if (!ticketEstaAberto(chamado.status)) {
      throw AppError.validation('Este chamado já foi encerrado. Abra um novo para continuar.');
    }

    await enforceRateLimit(ctx.db, RATE_LIMITS.suporteMensagem, tenant.tenantId, ctx.now());

    await ctx.db.insert(schema.ticketMessages).values({
      ticketId,
      tenantId: tenant.tenantId,
      author: 'cliente',
      authorUserId: sessao.user.id,
      body: entrada.corpo,
      createdAt: ctx.now(),
    });

    /*
      Responder devolve a vez ao suporte.

      Sem isto o chamado ficaria "aguardando voce" depois de a pessoa ter
      respondido -- e ela veria, na propria tela, que a bola continua com ela.
    */
    const proximo: TicketStatus = chamado.status === 'aguardando_cliente' ? 'em_atendimento' : chamado.status;
    await ctx.db
      .update(schema.tickets)
      .set({ status: proximo, updatedAt: ctx.now() })
      .where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.tenantId, tenant.tenantId)));

    return noContent(c);
  });

  /**
   * O cliente encerra o proprio chamado.
   *
   * Encerrar e dele, nao do suporte: quem resolveu sozinho nao deve ficar
   * esperando alguem do outro lado marcar como resolvido.
   */
  app.post('/:tenantId/suporte/chamados/:ticketId/encerrar', requireCapability('support:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const sessao = sessionOf(c);
    const { ticketId } = parseParams(c, chamadoParams);

    const chamado = await acharChamado(ctx.db, tenant.tenantId, ticketId);
    if (!chamado) throw AppError.notFound('Chamado não encontrado.');
    if (!ticketEstaAberto(chamado.status)) return noContent(c);

    await ctx.db
      .update(schema.tickets)
      .set({ status: 'fechado', resolvidoEm: ctx.now(), updatedAt: ctx.now() })
      .where(and(eq(schema.tickets.id, ticketId), eq(schema.tickets.tenantId, tenant.tenantId)));

    await ctx.db.insert(schema.ticketMessages).values({
      ticketId,
      tenantId: tenant.tenantId,
      author: 'sistema',
      authorUserId: sessao.user.id,
      body: 'Chamado encerrado pelo cliente.',
      createdAt: ctx.now(),
    });

    return noContent(c);
  });

  return app;
}
