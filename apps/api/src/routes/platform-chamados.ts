import { asc, count, desc, eq, inArray, schema, type Database } from '@codeca/database';
import {
  AppError,
  TICKET_STATUSES_ABERTOS,
  atualizarTicketSchema,
  paginate,
  responderTicketSchema,
  ticketQuerySchema,
  uuidSchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { noContent, ok, parseJsonBody, parseParams, parseQuery } from '../lib/http.js';
import { requirePlatform, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Atendimento dos chamados, no painel mestre.
 *
 * Aqui o filtro por empresa NAO existe -- e esse o ponto da tela: quem atende
 * precisa ver a fila inteira. O que protege e a capacidade
 * `platform:support:tickets`, exigida em toda rota, e o fato de a area
 * inteira viver atras do papel de administrador da plataforma.
 *
 * O contexto do chamado so aparece AQUI. Ele carrega plano, uso e o endereco
 * de quem abriu: util para atender, desnecessario de volta para o cliente,
 * que ja sabe quem e.
 */

const ticketParams = z.object({ ticketId: uuidSchema });

export function platformChamadosRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/chamados', requirePlatform('platform:support:tickets'), async (c) => {
    const ctx = c.get('ctx');
    const consulta = parseQuery(c, ticketQuerySchema);

    const filtro =
      consulta.situacao === 'todos'
        ? undefined
        : consulta.situacao === 'abertos'
          ? inArray(schema.tickets.status, [...TICKET_STATUSES_ABERTOS])
          : eq(schema.tickets.status, consulta.situacao);

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
          tenantId: schema.tickets.tenantId,
          empresa: schema.tenants.displayName,
        })
        .from(schema.tickets)
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tickets.tenantId))
        .where(filtro)
        // Prioridade alta primeiro, depois o mais antigo: quem espera ha mais
        // tempo nao pode ficar no fim da fila por ter chegado antes.
        .orderBy(desc(schema.tickets.prioridade), asc(schema.tickets.createdAt))
        .limit(consulta.pageSize)
        .offset((consulta.page - 1) * consulta.pageSize),
      ctx.db.select({ value: count() }).from(schema.tickets).where(filtro),
    ]);

    return ok(c, paginate(linhas, total?.value ?? 0, { page: consulta.page, pageSize: consulta.pageSize }));
  });

  app.get('/chamados/:ticketId', requirePlatform('platform:support:tickets'), async (c) => {
    const ctx = c.get('ctx');
    const { ticketId } = parseParams(c, ticketParams);

    const [chamado] = await ctx.db
      .select({
        id: schema.tickets.id,
        numero: schema.tickets.numero,
        assunto: schema.tickets.assunto,
        categoria: schema.tickets.categoria,
        status: schema.tickets.status,
        prioridade: schema.tickets.prioridade,
        resumo: schema.tickets.resumo,
        contexto: schema.tickets.contexto,
        origemUrl: schema.tickets.origemUrl,
        createdAt: schema.tickets.createdAt,
        updatedAt: schema.tickets.updatedAt,
        resolvidoEm: schema.tickets.resolvidoEm,
        tenantId: schema.tickets.tenantId,
        empresa: schema.tenants.displayName,
      })
      .from(schema.tickets)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tickets.tenantId))
      .where(eq(schema.tickets.id, ticketId))
      .limit(1);
    if (!chamado) throw AppError.notFound('Chamado não encontrado.');

    const mensagens = await ctx.db
      .select({
        id: schema.ticketMessages.id,
        author: schema.ticketMessages.author,
        body: schema.ticketMessages.body,
        createdAt: schema.ticketMessages.createdAt,
      })
      .from(schema.ticketMessages)
      .where(eq(schema.ticketMessages.ticketId, ticketId))
      .orderBy(asc(schema.ticketMessages.createdAt));

    return ok(c, { ...chamado, mensagens });
  });

  app.post('/chamados/:ticketId/mensagens', requirePlatform('platform:support:tickets'), async (c) => {
    const ctx = c.get('ctx');
    const sessao = sessionOf(c);
    const { ticketId } = parseParams(c, ticketParams);
    const entrada = await parseJsonBody(c, responderTicketSchema);

    const [chamado] = await ctx.db
      .select({ id: schema.tickets.id, tenantId: schema.tickets.tenantId, status: schema.tickets.status, primeira: schema.tickets.primeiraRespostaEm })
      .from(schema.tickets)
      .where(eq(schema.tickets.id, ticketId))
      .limit(1);
    if (!chamado) throw AppError.notFound('Chamado não encontrado.');

    await ctx.db.insert(schema.ticketMessages).values({
      ticketId,
      tenantId: chamado.tenantId,
      author: 'suporte',
      authorUserId: sessao.user.id,
      body: entrada.corpo,
      createdAt: ctx.now(),
    });

    /*
      Responder passa a vez ao cliente -- e, na primeira vez, marca quando o
      atendimento comecou. `primeiraRespostaEm` so e escrito uma vez: e a
      medida de quanto alguem esperou pela PRIMEIRA resposta, nao pela ultima.
    */
    await ctx.db
      .update(schema.tickets)
      .set({
        status: 'aguardando_cliente',
        ...(chamado.primeira ? {} : { primeiraRespostaEm: ctx.now() }),
        updatedAt: ctx.now(),
      })
      .where(eq(schema.tickets.id, ticketId));

    return noContent(c);
  });

  app.patch('/chamados/:ticketId', requirePlatform('platform:support:tickets'), async (c) => {
    const ctx = c.get('ctx');
    const { ticketId } = parseParams(c, ticketParams);
    const entrada = await parseJsonBody(c, atualizarTicketSchema);

    const [chamado] = await ctx.db
      .select({ id: schema.tickets.id, status: schema.tickets.status, tenantId: schema.tickets.tenantId })
      .from(schema.tickets)
      .where(eq(schema.tickets.id, ticketId))
      .limit(1);
    if (!chamado) throw AppError.notFound('Chamado não encontrado.');

    const encerra = entrada.status === 'resolvido' || entrada.status === 'fechado';
    await ctx.db
      .update(schema.tickets)
      .set({
        ...(entrada.status ? { status: entrada.status } : {}),
        ...(entrada.prioridade ? { prioridade: entrada.prioridade } : {}),
        ...(entrada.categoria ? { categoria: entrada.categoria } : {}),
        ...(encerra ? { resolvidoEm: ctx.now() } : {}),
        updatedAt: ctx.now(),
      })
      .where(eq(schema.tickets.id, ticketId));

    // A mudanca de situacao entra na conversa: o cliente ve o que aconteceu
    // com o chamado dele sem precisar de outra tela.
    if (entrada.status && entrada.status !== chamado.status) {
      await ctx.db.insert(schema.ticketMessages).values({
        ticketId,
        tenantId: chamado.tenantId,
        author: 'sistema',
        body: `Situação alterada para "${entrada.status}" pelo suporte.`,
        createdAt: ctx.now(),
      });
    }

    return noContent(c);
  });

  return app;
}

/** Quantos chamados esperam atendimento. Usado pelo resumo do painel mestre. */
export async function contarChamadosAbertos(db: Database): Promise<number> {
  const [linha] = await db
    .select({ value: count() })
    .from(schema.tickets)
    .where(inArray(schema.tickets.status, [...TICKET_STATUSES_ABERTOS]));
  return linha?.value ?? 0;
}
