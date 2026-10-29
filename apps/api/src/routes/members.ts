import { and, eq, ne, schema, type Database } from '@codeca/database';
import {
  AppError,
  canAssignRole,
  inviteMemberSchema,
  TENANT_ROLES,
  uuidSchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { clientIp, created, noContent, ok, parseJsonBody, parseParams } from '../lib/http.js';
import { assertWithinLimit } from '../lib/plan-limits.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { buildActionUrl, issueUserToken } from '../lib/tokens.js';
import { requireCapability, requireVerifiedEmail, sessionOf, tenantMiddleware } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Equipe da construtora.
 *
 * Um convite cria o usuario (sem senha) e o vinculo com status `invited`.
 * O vinculo so passa a valer quando o convite e aceito, o que impede que um
 * e-mail convidado acesse dados antes da confirmacao.
 */
export function memberRoutes() {
  const app = new Hono<AppBindings>();
  app.use('/:tenantId/*', tenantMiddleware());

  app.get('/:tenantId/members', requireCapability('members:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const rows = await ctx.db
      .select({
        membershipId: schema.memberships.id,
        role: schema.memberships.role,
        status: schema.memberships.status,
        acceptedAt: schema.memberships.acceptedAt,
        createdAt: schema.memberships.createdAt,
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        emailVerifiedAt: schema.users.emailVerifiedAt,
        lastLoginAt: schema.users.lastLoginAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.tenantId, tenant.tenantId));

    return ok(c, { members: rows, roles: TENANT_ROLES });
  });

  app.post(
    '/:tenantId/members/invite',
    requireVerifiedEmail(),
    requireCapability('members:invite'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const session = sessionOf(c);
      const ip = clientIp(c);

      await enforceRateLimit(
        ctx.db,
        RATE_LIMITS.invite,
        rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET),
        ctx.now(),
      );

      const input = await parseJsonBody(c, inviteMemberSchema);
      if (!canAssignRole(tenant.role, input.role)) {
        throw AppError.forbidden(
          input.role === 'owner'
            ? 'Apenas o proprietario pode conceder o papel de proprietario.'
            : 'Seu papel nao permite conceder este nivel de acesso.',
        );
      }

      await assertWithinLimit(ctx.db, tenant.tenantId, 'maxUsers');

      const now = ctx.now();
      let [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.email, input.email));
      if (!user) {
        [user] = await ctx.db
          .insert(schema.users)
          .values({ email: input.email, name: input.name || input.email.split('@')[0] || 'Convidado' })
          .returning();
      }
      if (!user) throw AppError.internal('Nao foi possivel registrar o convite.');

      const [existing] = await ctx.db
        .select({ id: schema.memberships.id, status: schema.memberships.status })
        .from(schema.memberships)
        .where(
          and(eq(schema.memberships.tenantId, tenant.tenantId), eq(schema.memberships.userId, user.id)),
        );

      if (existing?.status === 'active') {
        throw AppError.conflict('Esta pessoa ja faz parte da equipe.');
      }

      if (existing) {
        await ctx.db
          .update(schema.memberships)
          .set({ role: input.role, status: 'invited', updatedAt: now })
          .where(eq(schema.memberships.id, existing.id));
      } else {
        await ctx.db.insert(schema.memberships).values({
          tenantId: tenant.tenantId,
          userId: user.id,
          role: input.role,
          status: 'invited',
          invitedByUserId: session.user.id,
        });
      }

      const token = await issueUserToken(ctx.db, ctx.env, {
        userId: user.id,
        type: 'invitation',
        tenantId: tenant.tenantId,
        role: input.role,
        now,
      });

      const delivery = await ctx.mailer.send({
        to: input.email,
        kind: 'invitation',
        subject: `Convite para colaborar com ${tenant.displayName}`,
        text:
          `${session.user.name} convidou voce para colaborar com o site da ${tenant.displayName} `
          + `como ${input.role}.\n\nAceite o convite:\n`
          + `${buildActionUrl(ctx.env, '/aceitar-convite', token.token)}\n\n`
          + 'O link expira em 7 dias.',
      });

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.memberInvited,
        entityType: 'membership',
        entityId: user.id,
        metadata: { email: input.email, role: input.role },
      });

      return created(c, {
        invited: true,
        emailDelivery: { delivered: delivery.delivered, reason: delivery.reason ?? null },
      });
    },
  );

  app.patch('/:tenantId/members/:membershipId', requireCapability('members:update'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const { membershipId } = parseParams(c, z.object({ tenantId: uuidSchema, membershipId: uuidSchema }));
    const input = await parseJsonBody(c, z.object({ role: z.enum(TENANT_ROLES) }));

    const [membership] = await ctx.db
      .select({
        id: schema.memberships.id,
        userId: schema.memberships.userId,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.id, membershipId), eq(schema.memberships.tenantId, tenant.tenantId)),
      );

    if (!membership) throw AppError.notFound('Membro nao encontrado.');

    if (!canAssignRole(tenant.role, input.role)) {
      throw AppError.forbidden('Seu papel nao permite conceder este nivel de acesso.');
    }
    if (membership.role === 'owner' && tenant.role !== 'owner') {
      throw AppError.forbidden('Apenas o proprietario pode alterar o papel de outro proprietario.');
    }
    if (membership.userId === session.user.id && membership.role === 'owner' && input.role !== 'owner') {
      await assertAnotherOwnerExists(ctx.db, tenant.tenantId, membership.id);
    }

    await ctx.db
      .update(schema.memberships)
      .set({ role: input.role, updatedAt: ctx.now() })
      .where(eq(schema.memberships.id, membershipId));

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.memberRoleChanged,
      entityType: 'membership',
      entityId: membershipId,
      metadata: { from: membership.role, to: input.role },
    });

    return ok(c, { updated: true });
  });

  app.delete('/:tenantId/members/:membershipId', requireCapability('members:remove'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { membershipId } = parseParams(c, z.object({ tenantId: uuidSchema, membershipId: uuidSchema }));

    const [membership] = await ctx.db
      .select({ id: schema.memberships.id, role: schema.memberships.role, userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.id, membershipId), eq(schema.memberships.tenantId, tenant.tenantId)),
      );

    if (!membership) throw AppError.notFound('Membro nao encontrado.');
    if (membership.role === 'owner') {
      await assertAnotherOwnerExists(ctx.db, tenant.tenantId, membership.id);
      if (tenant.role !== 'owner') {
        throw AppError.forbidden('Apenas o proprietario pode remover outro proprietario.');
      }
    }

    await ctx.db.delete(schema.memberships).where(eq(schema.memberships.id, membershipId));

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.memberRemoved,
      entityType: 'membership',
      entityId: membershipId,
      metadata: { role: membership.role },
    });

    return noContent(c);
  });

  return app;
}

/** Impede que a empresa fique sem nenhum proprietario ativo. */
async function assertAnotherOwnerExists(
  db: Database,
  tenantId: string,
  excludeMembershipId: string,
): Promise<void> {
  const owners = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.tenantId, tenantId),
        eq(schema.memberships.role, 'owner'),
        eq(schema.memberships.status, 'active'),
        ne(schema.memberships.id, excludeMembershipId),
      ),
    );
  if (owners.length === 0) {
    throw AppError.conflict(
      'A empresa precisa de ao menos um proprietario ativo. Promova outra pessoa antes de prosseguir.',
    );
  }
}
