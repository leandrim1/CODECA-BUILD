import { and, asc, desc, eq, gte, ilike, lte, or, schema, sql } from '@codeca/database';
import {
  AppError,
  LEAD_INTEREST_LABELS,
  LEAD_STATUSES,
  leadNoteSchema,
  leadQuerySchema,
  paginate,
  updateLeadSchema,
  uuidSchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { created, noContent, ok, parseJsonBody, parseParams, parseQuery } from '../lib/http.js';
import { assertFeature, loadEffectivePlan } from '../lib/plan-limits.js';
import { requireCapability, sessionOf, tenantMiddleware } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Interessados recebidos pelos formularios publicos.
 *
 * As observacoes internas ficam em `lead_notes` e so aparecem no painel; o site
 * publico nunca recebe nem o conteudo das observacoes nem os dados pessoais de
 * outros interessados.
 */

const leadParams = z.object({ tenantId: uuidSchema, leadId: uuidSchema });

export function leadRoutes() {
  const app = new Hono<AppBindings>();
  app.use('/:tenantId/*', tenantMiddleware());

  app.get('/:tenantId/leads/export', requireCapability('leads:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const plan = await loadEffectivePlan(ctx.db, tenant.tenantId);
    assertFeature(plan, 'lead_export');

    const rows = await ctx.db
      .select({
        createdAt: schema.leads.createdAt,
        name: schema.leads.name,
        phone: schema.leads.phone,
        email: schema.leads.email,
        interestType: schema.leads.interestType,
        status: schema.leads.status,
        message: schema.leads.message,
        sourcePath: schema.leads.sourcePath,
      })
      .from(schema.leads)
      .where(eq(schema.leads.tenantId, tenant.tenantId))
      .orderBy(desc(schema.leads.createdAt))
      .limit(5000);

    const header = ['Recebido em', 'Nome', 'Telefone', 'E-mail', 'Interesse', 'Status', 'Mensagem', 'Origem'];
    const lines = [header.join(';')];
    for (const row of rows) {
      lines.push(
        [
          row.createdAt.toISOString(),
          row.name,
          row.phone,
          row.email,
          LEAD_INTEREST_LABELS[row.interestType as keyof typeof LEAD_INTEREST_LABELS] ?? row.interestType,
          row.status,
          row.message.replace(/[\r\n;]+/g, ' '),
          row.sourcePath,
        ]
          .map(csvCell)
          .join(';'),
      );
    }

    await auditFromContext(c, {
      action: 'lead.exported',
      entityType: 'lead',
      entityId: '',
      metadata: { rows: rows.length },
    });

    return c.body(`﻿${lines.join('\n')}`, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="interessados-${tenant.slug}.csv"`,
      'cache-control': 'no-store',
    });
  });

  app.get('/:tenantId/leads', requireCapability('leads:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const query = parseQuery(c, leadQuerySchema);

    const conditions = [eq(schema.leads.tenantId, tenant.tenantId)];
    if (query.search) {
      const term = `%${query.search}%`;
      const clause = or(
        ilike(schema.leads.name, term),
        ilike(schema.leads.phone, term),
        ilike(schema.leads.email, term),
      );
      if (clause) conditions.push(clause);
    }
    if (query.status) conditions.push(eq(schema.leads.status, query.status));
    if (query.interestType) conditions.push(eq(schema.leads.interestType, query.interestType));
    if (query.from) {
      const from = new Date(`${query.from}T00:00:00.000Z`);
      if (!Number.isNaN(from.getTime())) conditions.push(gte(schema.leads.createdAt, from));
    }
    if (query.to) {
      const to = new Date(`${query.to}T23:59:59.999Z`);
      if (!Number.isNaN(to.getTime())) conditions.push(lte(schema.leads.createdAt, to));
    }
    const where = and(...conditions);

    const rows = await ctx.db
      .select({
        id: schema.leads.id,
        name: schema.leads.name,
        phone: schema.leads.phone,
        email: schema.leads.email,
        interestType: schema.leads.interestType,
        message: schema.leads.message,
        status: schema.leads.status,
        sourcePath: schema.leads.sourcePath,
        assignedToUserId: schema.leads.assignedToUserId,
        propertyId: schema.leads.propertyId,
        projectId: schema.leads.projectId,
        serviceId: schema.leads.serviceId,
        createdAt: schema.leads.createdAt,
        propertyTitle: schema.properties.title,
        projectTitle: schema.projects.title,
      })
      .from(schema.leads)
      .leftJoin(schema.properties, eq(schema.properties.id, schema.leads.propertyId))
      .leftJoin(schema.projects, eq(schema.projects.id, schema.leads.projectId))
      .where(where)
      .orderBy(desc(schema.leads.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.leads)
      .where(where);

    const plan = await loadEffectivePlan(ctx.db, tenant.tenantId);

    return ok(c, {
      ...paginate(rows, totals?.total ?? 0, query),
      statuses: LEAD_STATUSES,
      exportEnabled: plan.limits.features.includes('lead_export'),
    });
  });

  app.get('/:tenantId/leads/:leadId', requireCapability('leads:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { leadId } = parseParams(c, leadParams);

    const [lead] = await ctx.db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.id, leadId), eq(schema.leads.tenantId, tenant.tenantId)));
    if (!lead) throw AppError.notFound('Interessado nao encontrado.');

    const notes = await ctx.db
      .select({
        id: schema.leadNotes.id,
        note: schema.leadNotes.note,
        createdAt: schema.leadNotes.createdAt,
        authorName: schema.users.name,
      })
      .from(schema.leadNotes)
      .leftJoin(schema.users, eq(schema.users.id, schema.leadNotes.authorUserId))
      .where(and(eq(schema.leadNotes.leadId, leadId), eq(schema.leadNotes.tenantId, tenant.tenantId)))
      .orderBy(asc(schema.leadNotes.createdAt));

    // `ipHash` e `userAgent` ficam fora da resposta: servem apenas a auditoria.
    const { ipHash: _ipHash, userAgent: _userAgent, ...safeLead } = lead;
    return ok(c, { lead: safeLead, notes });
  });

  app.patch('/:tenantId/leads/:leadId', requireCapability('leads:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { leadId } = parseParams(c, leadParams);
    const input = await parseJsonBody(c, updateLeadSchema);

    if (input.assignedToUserId) {
      const [membership] = await ctx.db
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.tenantId, tenant.tenantId),
            eq(schema.memberships.userId, input.assignedToUserId),
            eq(schema.memberships.status, 'active'),
          ),
        );
      if (!membership) {
        throw AppError.badRequest('O responsavel informado nao faz parte da equipe desta empresa.');
      }
    }

    const updates: Record<string, unknown> = { updatedAt: ctx.now() };
    if (input.status !== undefined) updates.status = input.status;
    if (input.assignedToUserId !== undefined) updates.assignedToUserId = input.assignedToUserId;

    const [row] = await ctx.db
      .update(schema.leads)
      .set(updates)
      .where(and(eq(schema.leads.id, leadId), eq(schema.leads.tenantId, tenant.tenantId)))
      .returning({ id: schema.leads.id, status: schema.leads.status });
    if (!row) throw AppError.notFound('Interessado nao encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.leadUpdated,
      entityType: 'lead',
      entityId: leadId,
      metadata: { status: row.status },
    });

    return ok(c, { lead: row });
  });

  app.post('/:tenantId/leads/:leadId/notes', requireCapability('leads:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const { leadId } = parseParams(c, leadParams);
    const input = await parseJsonBody(c, leadNoteSchema);

    const [lead] = await ctx.db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(and(eq(schema.leads.id, leadId), eq(schema.leads.tenantId, tenant.tenantId)));
    if (!lead) throw AppError.notFound('Interessado nao encontrado.');

    const [note] = await ctx.db
      .insert(schema.leadNotes)
      .values({
        tenantId: tenant.tenantId,
        leadId,
        authorUserId: session.user.id,
        note: input.note,
      })
      .returning();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.leadNoteAdded,
      entityType: 'lead',
      entityId: leadId,
      // O texto da observacao nao vai para a auditoria.
      metadata: { noteLength: input.note.length },
    });

    return created(c, { note: note ?? null });
  });

  app.delete('/:tenantId/leads/:leadId', requireCapability('leads:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { leadId } = parseParams(c, leadParams);

    const removed = await ctx.db
      .delete(schema.leads)
      .where(and(eq(schema.leads.id, leadId), eq(schema.leads.tenantId, tenant.tenantId)))
      .returning({ id: schema.leads.id });
    if (removed.length === 0) throw AppError.notFound('Interessado nao encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.leadDeleted,
      entityType: 'lead',
      entityId: leadId,
      metadata: {},
    });

    return noContent(c);
  });

  return app;
}

function csvCell(value: string): string {
  const text = value ?? '';
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
