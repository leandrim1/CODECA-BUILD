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
import { EXTERNAL_HOSTING_MESSAGE, loadHosting, type HostingMode } from '../lib/hosting.js';
import { mapProviderStatus, verificationPatch } from '../lib/domain-status.js';
import type { DomainProviderStatus } from '../lib/vercel-domains.js';
import { requireCapability, requireVerifiedEmail } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Dominios proprios.
 *
 * Um dominio nunca e considerado ativo apenas por estar cadastrado: o estado
 * vem da resposta do provedor (propriedade comprovada + DNS apontado). A
 * unicidade global de `domains.hostname` impede que duas empresas usem o
 * mesmo dominio, e os hosts da plataforma sao recusados.
 *
 * ## Dois modos, decididos por `loadHosting`
 *
 * **Gerenciado**: o plano inclui hospedagem e o site tem projeto configurado.
 * A Vercel e chamada contra o projeto **do site** e o estado vem dela.
 *
 * **Registro**: qualquer outro caso. A plataforma guarda que o endereco pertence
 * a este site e **nao afirma nada sobre DNS**, porque nao hospeda e nao tem
 * como verificar. Nenhuma chamada a Vercel acontece.
 *
 * O projeto da propria plataforma nunca entra: ele serve o painel, e anexar a
 * ele o dominio de um cliente faria o endereco abrir o login.
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
    const { mode } = await loadHosting(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      plan,
    });

    return ok(c, {
      domains: rows.map((row) => ({
        ...row,
        statusLabel: DOMAIN_STATUS_LABELS[row.status as DomainStatus],
        // Instrucao de DNS so quando a plataforma hospeda. Fora disso ela nao
        // sabe para onde o endereco deve apontar, e inventar um alvo mandaria
        // o cliente apontar o dominio para um lugar que nao serve o site dele.
        dns: mode.managed
          ? dnsInstructions(row.hostname, {
              aRecordIp: ctx.env.DOMAIN_A_RECORD_IP,
              cnameTarget: ctx.env.DOMAIN_CNAME_TARGET,
              verificationTxt: row.verificationRecordName
                ? { name: row.verificationRecordName, value: row.verificationRecordValue }
                : null,
            })
          : null,
      })),
      limits: { maxDomains: plan.limits.maxDomains, planName: plan.planName },
      customDomainAvailable: plan.limits.features.includes('custom_domain'),
      providerConfigured: ctx.domains.configured,
      hosting: hostingView(mode),
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
        throw AppError.conflict('Este endereço pertence a plataforma e não pode ser vinculado.');
      }
      const firstLabel = hostname.split('.')[0] ?? '';
      if (RESERVED_SUBDOMAIN_LABELS.has(firstLabel) && hostname.split('.').length > 2) {
        throw AppError.conflict(
          `O subdominio "${firstLabel}" e reservado para serviços administrativos. Use outro, como www.`,
        );
      }

      const [conflict] = await ctx.db
        .select({ tenantId: schema.domains.tenantId })
        .from(schema.domains)
        .where(eq(schema.domains.hostname, hostname));
      if (conflict) {
        throw AppError.conflict(
          conflict.tenantId === tenant.tenantId
            ? 'Este domínio já está cadastrado nesta empresa.'
            : 'Este domínio já está vinculado a outra empresa na plataforma.',
        );
      }

      // Gerenciado: registra no provedor antes de gravar, para ja nascer com o
      // estado real. Registro: nao ha provedor a consultar.
      const { mode } = await loadHosting(ctx.db, {
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        plan,
      });
      const providerStatus = mode.managed
        ? await ctx.domains.add(mode.projectId, hostname)
        : registeredStatus();
      const mapped: { status: DomainStatus } = mode.managed
        ? mapProviderStatus(providerStatus, ctx.domains.configured)
        : { status: 'registered' };

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
      if (!row) throw AppError.internal('Não foi possível cadastrar o domínio.');

      if (input.setAsPrimary && mapped.status === 'active') {
        await setPrimary(ctx.db, { tenantId: tenant.tenantId, domainId: row.id, now: ctx.now() });
      }

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.domainAdded,
        entityType: 'domain',
        entityId: row.id,
        metadata: { hostname, status: mapped.status, managed: mode.managed },
      });

      return created(c, {
        domain: { ...row, statusLabel: DOMAIN_STATUS_LABELS[mapped.status] },
        message: providerStatus.message,
        dns: mode.managed
          ? dnsInstructions(hostname, {
              aRecordIp: ctx.env.DOMAIN_A_RECORD_IP,
              cnameTarget: ctx.env.DOMAIN_CNAME_TARGET,
              verificationTxt: providerStatus.challenges[0]
                ? { name: providerStatus.challenges[0].domain, value: providerStatus.challenges[0].value }
                : null,
            })
          : null,
        hosting: hostingView(mode),
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
    if (!domain) throw AppError.notFound('Domínio não encontrado.');

    const { mode } = await loadHosting(ctx.db, { tenantId: tenant.tenantId, siteId: domain.siteId });
    if (!mode.managed) {
      // Recusa em vez de devolver um "tudo certo" vazio: nao ha o que verificar,
      // e dizer isso evita o cliente apertar o botao esperando uma mudanca.
      throw AppError.badRequest(EXTERNAL_HOSTING_MESSAGE);
    }

    // Dominio que ainda nao esta no projeto -- registrado antes de a hospedagem
    // existir -- precisa ser **anexado**, nao verificado: a Vercel responde 404
    // a um `verify` de dominio que o projeto nao conhece. `add` e idempotente.
    const providerStatus = domain.vercelDomainId
      ? await ctx.domains.verify(mode.projectId, domain.hostname)
      : await ctx.domains.add(mode.projectId, domain.hostname);
    const mapped = mapProviderStatus(providerStatus, ctx.domains.configured);

    const [row] = await ctx.db
      .update(schema.domains)
      .set(verificationPatch(domain, providerStatus, mapped.status, ctx.now()))
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
      hosting: hostingView(mode),
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
    if (!domain) throw AppError.notFound('Domínio não encontrado.');
    if (domain.status !== 'active') {
      throw AppError.badRequest(
        'Somente um domínio ativo pode ser definido como principal. Conclua a verificação primeiro.',
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
    if (!domain) throw AppError.notFound('Domínio não encontrado.');

    // So desfaz no provedor o que foi la colocado: `vercelDomainId` e o sinal.
    // O projeto vem do site e **nao** do plano atual -- um downgrade nao pode
    // deixar o dominio preso a um projeto que a plataforma deixou de enxergar.
    const { hostingProjectId } = await loadHosting(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: domain.siteId,
    });
    try {
      if (domain.vercelDomainId && hostingProjectId) {
        await ctx.domains.remove(hostingProjectId, domain.hostname);
      }
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

export { mapProviderStatus } from '../lib/domain-status.js';

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

/** O que o painel precisa saber sobre quem hospeda, sem expor o projeto. */
function hostingView(mode: HostingMode): { managed: boolean; reason: string | null } {
  return { managed: mode.managed, reason: mode.managed ? null : mode.reason };
}

/**
 * Estado de um dominio que a plataforma nao gerencia.
 *
 * Nenhum campo afirma o que ela nao pode saber: propriedade, DNS e certificado
 * ficam falsos, e a mensagem diz por que.
 */
function registeredStatus(): DomainProviderStatus {
  return {
    ownershipVerified: false,
    dnsConfigured: false,
    sslActive: false,
    challenges: [],
    message: EXTERNAL_HOSTING_MESSAGE,
    providerDomainId: null,
  };
}
