import { and, eq, ne, schema, type Database } from '@codeca/database';
import {
  AppError,
  DOMAIN_STATUS_LABELS,
  RESERVED_SUBDOMAIN_LABELS,
  addDomainSchema,
  dnsInstructions,
  domainIdParamSchema,
  isPlatformHost,
  uuidSchema,
  type DomainStatus,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { clientIp, created, noContent, ok, parseJsonBody, parseParams } from '../lib/http.js';
import { assertFeature, assertWithinLimit, loadEffectivePlan } from '../lib/plan-limits.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { platformHosts } from '../env.js';
import type { DomainProviderStatus } from '../lib/vercel-domains.js';
import { requireCapability, requireVerifiedEmail } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Dominios proprios.
 *
 * Um dominio nunca e considerado ativo apenas por estar cadastrado: o estado
 * vem da resposta do provedor (propriedade comprovada + DNS apontado). A
 * unicidade global de `domains.hostname` impede que duas construtoras usem o
 * mesmo dominio, e os hosts da plataforma sao recusados.
 */

export function domainRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/:tenantId/domains', requireCapability('domains:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const rows = await ctx.db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.tenantId, tenant.tenantId))
      .orderBy(schema.domains.createdAt);

    const plan = await loadEffectivePlan(ctx.db, tenant.tenantId);

    return ok(c, {
      domains: rows.map((row) => ({
        ...row,
        statusLabel: DOMAIN_STATUS_LABELS[row.status as DomainStatus],
        dns: dnsInstructions(row.hostname, {
          aRecordIp: ctx.env.DOMAIN_A_RECORD_IP,
          cnameTarget: ctx.env.DOMAIN_CNAME_TARGET,
          verificationTxt: row.verificationRecordName
            ? { name: row.verificationRecordName, value: row.verificationRecordValue }
            : null,
        }),
      })),
      limits: { maxDomains: plan.limits.maxDomains, planName: plan.planName },
      customDomainAvailable: plan.limits.features.includes('custom_domain'),
      providerConfigured: ctx.domains.configured,
    });
  });

  app.post(
    '/:tenantId/domains',
    requireVerifiedEmail(),
    requireCapability('domains:manage'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const input = await parseJsonBody(c, addDomainSchema);
      const hostname = input.domain;

      const plan = await loadEffectivePlan(ctx.db, tenant.tenantId);
      assertFeature(plan, 'custom_domain');
      await assertWithinLimit(ctx.db, tenant.tenantId, 'maxDomains', { plan });

      // Hosts da plataforma e subdominios reservados nao podem ser vinculados.
      if (isPlatformHost(hostname, platformHosts(ctx.env))) {
        throw AppError.conflict('Este endereco pertence a plataforma e nao pode ser vinculado.');
      }
      const firstLabel = hostname.split('.')[0] ?? '';
      if (RESERVED_SUBDOMAIN_LABELS.has(firstLabel) && hostname.split('.').length > 2) {
        throw AppError.conflict(
          `O subdominio "${firstLabel}" e reservado para servicos administrativos. Use outro, como www.`,
        );
      }

      const [conflict] = await ctx.db
        .select({ tenantId: schema.domains.tenantId })
        .from(schema.domains)
        .where(eq(schema.domains.hostname, hostname));
      if (conflict) {
        throw AppError.conflict(
          conflict.tenantId === tenant.tenantId
            ? 'Este dominio ja esta cadastrado nesta empresa.'
            : 'Este dominio ja esta vinculado a outra empresa na plataforma.',
        );
      }

      // Registra no provedor antes de gravar, para ja nascer com o estado real.
      const providerStatus = await ctx.domains.add(hostname);
      const mapped = mapProviderStatus(providerStatus, ctx.domains.configured);

      const [row] = await ctx.db
        .insert(schema.domains)
        .values({
          tenantId: tenant.tenantId,
          siteId: tenant.siteId,
          hostname,
          status: mapped.status,
          dnsConfigured: providerStatus.dnsConfigured,
          ownershipVerified: providerStatus.ownershipVerified,
          sslStatus: providerStatus.sslActive ? 'active' : 'pending',
          vercelDomainId: providerStatus.providerDomainId,
          verificationRecordName: providerStatus.challenges[0]?.domain ?? '',
          verificationRecordValue: providerStatus.challenges[0]?.value ?? '',
          lastError: mapped.status === 'misconfigured' ? providerStatus.message : '',
          lastCheckedAt: ctx.now(),
          verifiedAt: mapped.status === 'active' ? ctx.now() : null,
        })
        .returning();
      if (!row) throw AppError.internal('Nao foi possivel cadastrar o dominio.');

      if (input.setAsPrimary && mapped.status === 'active') {
        await setPrimary(ctx.db, { tenantId: tenant.tenantId, domainId: row.id, now: ctx.now() });
      }

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.domainAdded,
        entityType: 'domain',
        entityId: row.id,
        metadata: { hostname, status: mapped.status },
      });

      return created(c, {
        domain: { ...row, statusLabel: DOMAIN_STATUS_LABELS[mapped.status] },
        message: providerStatus.message,
        dns: dnsInstructions(hostname, {
          aRecordIp: ctx.env.DOMAIN_A_RECORD_IP,
          cnameTarget: ctx.env.DOMAIN_CNAME_TARGET,
          verificationTxt: providerStatus.challenges[0]
            ? { name: providerStatus.challenges[0].domain, value: providerStatus.challenges[0].value }
            : null,
        }),
      });
    },
  );

  // ------------------------------------------------------ verificar novamente
  app.post('/:tenantId/domains/:domainId/verify', requireCapability('domains:manage'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { domainId } = parseParams(c, z.object({ tenantId: uuidSchema, domainId: uuidSchema }));

    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.domainCheck,
      rateLimitSubjectFromIp(clientIp(c), ctx.env.AUTH_SECRET),
      ctx.now(),
    );

    const [domain] = await ctx.db
      .select()
      .from(schema.domains)
      .where(and(eq(schema.domains.id, domainId), eq(schema.domains.tenantId, tenant.tenantId)));
    if (!domain) throw AppError.notFound('Dominio nao encontrado.');

    const providerStatus = await ctx.domains.verify(domain.hostname);
    const mapped = mapProviderStatus(providerStatus, ctx.domains.configured);

    const [row] = await ctx.db
      .update(schema.domains)
      .set({
        status: mapped.status,
        dnsConfigured: providerStatus.dnsConfigured,
        ownershipVerified: providerStatus.ownershipVerified,
        sslStatus: providerStatus.sslActive ? 'active' : 'pending',
        vercelDomainId: providerStatus.providerDomainId ?? domain.vercelDomainId,
        verificationRecordName: providerStatus.challenges[0]?.domain ?? '',
        verificationRecordValue: providerStatus.challenges[0]?.value ?? '',
        lastError: mapped.status === 'misconfigured' ? providerStatus.message : '',
        lastCheckedAt: ctx.now(),
        verifiedAt: mapped.status === 'active' ? (domain.verifiedAt ?? ctx.now()) : null,
        updatedAt: ctx.now(),
      })
      .where(and(eq(schema.domains.id, domainId), eq(schema.domains.tenantId, tenant.tenantId)))
      .returning();

    if (mapped.status === 'active' && !domain.ownershipVerified) {
      await auditFromContext(c, {
        action: AUDIT_ACTIONS.domainVerified,
        entityType: 'domain',
        entityId: domainId,
        metadata: { hostname: domain.hostname },
      });
    }

    return ok(c, {
      domain: row ? { ...row, statusLabel: DOMAIN_STATUS_LABELS[mapped.status] } : null,
      message: providerStatus.message,
      dns: dnsInstructions(domain.hostname, {
        aRecordIp: ctx.env.DOMAIN_A_RECORD_IP,
        cnameTarget: ctx.env.DOMAIN_CNAME_TARGET,
        verificationTxt: providerStatus.challenges[0]
          ? { name: providerStatus.challenges[0].domain, value: providerStatus.challenges[0].value }
          : null,
      }),
    });
  });

  // ------------------------------------------------------- dominio principal
  app.post('/:tenantId/domains/:domainId/primary', requireCapability('domains:manage'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { domainId } = parseParams(c, z.object({ tenantId: uuidSchema, domainId: uuidSchema }));

    const [domain] = await ctx.db
      .select({ id: schema.domains.id, status: schema.domains.status, hostname: schema.domains.hostname })
      .from(schema.domains)
      .where(and(eq(schema.domains.id, domainId), eq(schema.domains.tenantId, tenant.tenantId)));
    if (!domain) throw AppError.notFound('Dominio nao encontrado.');
    if (domain.status !== 'active') {
      throw AppError.badRequest(
        'Somente um dominio ativo pode ser definido como principal. Conclua a verificacao primeiro.',
      );
    }

    await setPrimary(ctx.db, { tenantId: tenant.tenantId, domainId, now: ctx.now() });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.domainPrimaryChanged,
      entityType: 'domain',
      entityId: domainId,
      metadata: { hostname: domain.hostname },
    });

    return ok(c, { primaryDomainId: domainId });
  });

  // -------------------------------------------------------------- desvincular
  app.delete('/:tenantId/domains/:domainId', requireCapability('domains:manage'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { domainId } = parseParams(c, z.object({ tenantId: uuidSchema, domainId: uuidSchema }));

    const [domain] = await ctx.db
      .select()
      .from(schema.domains)
      .where(and(eq(schema.domains.id, domainId), eq(schema.domains.tenantId, tenant.tenantId)));
    if (!domain) throw AppError.notFound('Dominio nao encontrado.');

    try {
      await ctx.domains.remove(domain.hostname);
    } catch (error) {
      // O vinculo local e removido mesmo se o provedor falhar; o estado fica
      // registrado para nova tentativa manual.
      console.error(
        '[domains] falha ao remover no provedor',
        domain.hostname,
        error instanceof Error ? error.message : error,
      );
    }

    await ctx.db
      .delete(schema.domains)
      .where(and(eq(schema.domains.id, domainId), eq(schema.domains.tenantId, tenant.tenantId)));

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.domainRemoved,
      entityType: 'domain',
      entityId: domainId,
      metadata: { hostname: domain.hostname },
    });

    return noContent(c);
  });

  return app;
}

/**
 * Traduz o estado do provedor para o estado exibido no painel.
 * Sem provedor configurado, o dominio nunca passa de "aguardando DNS".
 */
export function mapProviderStatus(
  status: DomainProviderStatus,
  providerConfigured: boolean,
): { status: DomainStatus } {
  if (!providerConfigured) return { status: 'awaiting_dns' };
  if (status.ownershipVerified && status.dnsConfigured) return { status: 'active' };
  if (status.ownershipVerified && !status.dnsConfigured) return { status: 'misconfigured' };
  if (status.challenges.length > 0) return { status: 'verifying_ownership' };
  return { status: 'awaiting_dns' };
}

async function setPrimary(
  db: Database,
  input: { tenantId: string; domainId: string; now: Date },
): Promise<void> {
  // Limpa o anterior antes de marcar o novo: o indice unico parcial
  // `domains_primary_per_tenant_key` permite apenas um principal por empresa.
  await db.transaction(async (tx) => {
    await tx
      .update(schema.domains)
      .set({ isPrimary: false, updatedAt: input.now })
      .where(and(eq(schema.domains.tenantId, input.tenantId), ne(schema.domains.id, input.domainId)));
    await tx
      .update(schema.domains)
      .set({ isPrimary: true, updatedAt: input.now })
      .where(and(eq(schema.domains.id, input.domainId), eq(schema.domains.tenantId, input.tenantId)));
  });
}
