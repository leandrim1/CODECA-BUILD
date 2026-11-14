import { and, desc, eq, gte, isNull, schema, sql, type Database } from '@codeca/database';
import {
  AppError,
  deleteTenantSchema,
  updateTenantContactSchema,
  updateTenantSchema,
  type ContentUsageView,
  type TenantOverview,
  syncNoticeMessage,
  type SyncNotice,
} from '@codeca/shared';
import { verifyPassword } from '@codeca/shared/server';
import { Hono } from 'hono';
import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { billingClosurePreview, closeBillingBeforeDeletion } from '../lib/billing/encerramento.js';
import { clearSessionCookies } from '../lib/cookies.js';
import { clientIp, ok, parseJsonBody, userAgent } from '../lib/http.js';
import {
  confirmacaoConfere,
  deleteTenant,
  deletionPreview,
  exportTenantData,
} from '../lib/privacidade.js';
import { loadContentUsage } from '../lib/content-usage.js';
import { countPending, loadSource } from '../lib/sync/store.js';
import { loadEffectivePlan, loadPlanStatus } from '../lib/plan-limits.js';
import { requireCapability, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/** Dados da empresa, identidade visual, SEO e visao geral do painel. */
export function tenantRoutes() {
  const app = new Hono<AppBindings>();

  // ------------------------------------------------------------- resumo
  app.get('/:tenantId', requireCapability('tenant:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const [row] = await ctx.db
      .select({
        id: schema.tenants.id,
        slug: schema.tenants.slug,
        legalName: schema.tenants.legalName,
        displayName: schema.tenants.displayName,
        taxId: schema.tenants.taxId,
        description: schema.tenants.description,
        foundedYear: schema.tenants.foundedYear,
        creaNumber: schema.tenants.creaNumber,
        status: schema.tenants.status,
        contactEmail: schema.tenants.contactEmail,
        contactPhone: schema.tenants.contactPhone,
        whatsapp: schema.tenants.whatsapp,
        whatsappDefaultMessage: schema.tenants.whatsappDefaultMessage,
        address: schema.tenants.address,
        serviceArea: schema.tenants.serviceArea,
        businessHours: schema.tenants.businessHours,
        social: schema.tenants.social,
        createdAt: schema.tenants.createdAt,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenant.tenantId));

    if (!row) throw AppError.notFound('Empresa não encontrada.');

    const planStatus = await loadPlanStatus(ctx.db, tenant.tenantId);

    return ok(c, {
      tenant: row,
      access: {
        role: tenant.role,
        capabilities: [...tenant.capabilities],
        readOnly: tenant.readOnly,
        viaSupportGrant: tenant.viaSupportGrant,
      },
      plan: planStatus.plan,
      usage: planStatus.usage,
    });
  });

  // -------------------------------------------- conteudos cadastrados
  app.get('/:tenantId/content-usage', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const [plan, usage] = await Promise.all([
      loadEffectivePlan(ctx.db, tenant.tenantId),
      loadContentUsage(ctx.db, tenant.tenantId),
    ]);
    const resposta: ContentUsageView = {
      used: usage.total,
      max: plan.limits.maxContentRecords,
      byModule: usage.byModule,
      planName: plan.planName,
      overridden: plan.overridden,
    };
    return ok(c, resposta);
  });

  // ------------------------------------------------------- visao geral
  app.get('/:tenantId/overview', requireCapability('tenant:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const tenantId = tenant.tenantId;
    const countOf = sql<number>`cast(count(*) as int)`;
    const since30d = new Date(ctx.now().getTime() - 30 * 24 * 3600 * 1000);

    // As consultas sao independentes: em serie, o painel pagava a soma das
    // idas ao banco; em paralelo paga so a mais lenta. O pool limita o total.
    const [
      [propertyStats],
      [projectStats],
      [serviceStats],
      [bannerStats],
      [leadStats],
      [leads30d],
      [mediaStats],
      recentLeads,
      domains,
      [site],
      [acesso],
      planStatus,
    ] = await Promise.all([
      ctx.db
        .select({
          total: countOf,
          published: sql<number>`cast(count(*) filter (where ${schema.properties.publicationStatus} = 'published') as int)`,
          drafts: sql<number>`cast(count(*) filter (where ${schema.properties.publicationStatus} = 'draft') as int)`,
          available: sql<number>`cast(count(*) filter (where ${schema.properties.publicationStatus} = 'published' and ${schema.properties.commercialStatus} = 'disponivel') as int)`,
          sold: sql<number>`cast(count(*) filter (where ${schema.properties.commercialStatus} = 'vendido') as int)`,
        })
        .from(schema.properties)
        .where(eq(schema.properties.tenantId, tenantId)),
      ctx.db
        .select({
          total: countOf,
          published: sql<number>`cast(count(*) filter (where ${schema.projects.publicationStatus} = 'published') as int)`,
          inProgress: sql<number>`cast(count(*) filter (where ${schema.projects.status} = 'em_andamento') as int)`,
          completed: sql<number>`cast(count(*) filter (where ${schema.projects.status} = 'concluida') as int)`,
        })
        .from(schema.projects)
        .where(eq(schema.projects.tenantId, tenantId)),
      ctx.db
        .select({
          total: countOf,
          published: sql<number>`cast(count(*) filter (where ${schema.services.publicationStatus} = 'published') as int)`,
        })
        .from(schema.services)
        .where(eq(schema.services.tenantId, tenantId)),
      ctx.db
        .select({
          total: countOf,
          active: sql<number>`cast(count(*) filter (where ${schema.banners.isActive}) as int)`,
        })
        .from(schema.banners)
        .where(eq(schema.banners.siteId, tenant.siteId)),
      ctx.db
        .select({
          total: countOf,
          novos: sql<number>`cast(count(*) filter (where ${schema.leads.status} = 'novo') as int)`,
          emAtendimento: sql<number>`cast(count(*) filter (where ${schema.leads.status} = 'em_atendimento') as int)`,
          convertidos: sql<number>`cast(count(*) filter (where ${schema.leads.status} = 'convertido') as int)`,
        })
        .from(schema.leads)
        .where(eq(schema.leads.tenantId, tenantId)),
      ctx.db
        .select({ total: countOf })
        .from(schema.leads)
        .where(and(eq(schema.leads.tenantId, tenantId), gte(schema.leads.createdAt, since30d))),
      ctx.db
        .select({
          total: countOf,
          bytes: sql<number>`cast(coalesce(sum(${schema.mediaAssets.sizeBytes}), 0) as bigint)`,
        })
        .from(schema.mediaAssets)
        .where(eq(schema.mediaAssets.tenantId, tenantId)),
      ctx.db
        .select({
          id: schema.leads.id,
          name: schema.leads.name,
          interestType: schema.leads.interestType,
          status: schema.leads.status,
          createdAt: schema.leads.createdAt,
        })
        .from(schema.leads)
        .where(eq(schema.leads.tenantId, tenantId))
        .orderBy(desc(schema.leads.createdAt))
        .limit(5),
      ctx.db
        .select({
          id: schema.domains.id,
          hostname: schema.domains.hostname,
          status: schema.domains.status,
          isPrimary: schema.domains.isPrimary,
          sslStatus: schema.domains.sslStatus,
        })
        .from(schema.domains)
        .where(eq(schema.domains.tenantId, tenantId))
        .orderBy(desc(schema.domains.isPrimary)),
      ctx.db
        .select({
          id: schema.sites.id,
          name: schema.sites.name,
          status: schema.sites.status,
        })
        .from(schema.sites)
        .where(eq(schema.sites.id, tenant.siteId)),
      // Ultimo acesso do site a API: a unica evidencia honesta de que a
      // integracao esta de pe (a plataforma nao publica o site). Nulo
      // significa cadastrado e nunca integrado -- o que o cliente precisa ver
      // no primeiro dia, com o aviso de que a CODECA IA ainda vai conectar.
      ctx.db
        .select({ lastUsedAt: sql<Date | null>`max(${schema.siteApiKeys.lastUsedAt})` })
        .from(schema.siteApiKeys)
        .where(
          and(eq(schema.siteApiKeys.siteId, tenant.siteId), isNull(schema.siteApiKeys.revokedAt)),
        ),
      loadPlanStatus(ctx.db, tenantId),
    ]);

    if (!site) throw AppError.notFound('Site não encontrado.');

    // Tipado pelo contrato compartilhado: deixar de enviar um campo que o
    // painel le passa a ser erro de compilacao, nao surpresa em producao.
    const resposta: TenantOverview = {
      site: {
        id: site.id,
        name: site.name,
        status: site.status,
        lastApiAccessAt: acesso?.lastUsedAt ? new Date(acesso.lastUsedAt).toISOString() : null,
      },
      properties: propertyStats ?? { total: 0, published: 0, drafts: 0, available: 0, sold: 0 },
      projects: projectStats ?? { total: 0, published: 0, inProgress: 0, completed: 0 },
      services: serviceStats ?? { total: 0, published: 0 },
      banners: bannerStats ?? { total: 0, active: 0 },
      leads: {
        ...(leadStats ?? { total: 0, novos: 0, emAtendimento: 0, convertidos: 0 }),
        last30Days: leads30d?.total ?? 0,
      },
      media: { total: mediaStats?.total ?? 0, bytes: Number(mediaStats?.bytes ?? 0) },
      recentLeads: recentLeads.map((lead) => ({
        ...lead,
        createdAt: lead.createdAt.toISOString(),
      })),
      domains,
      plan: planStatus.plan,
      usage: planStatus.usage,
      /**
       * Aviso da sincronizacao.
       *
       * Uma consulta a mais na visao geral, contra um indice -- e o preco de
       * o cliente descobrir que ha conteudo esperando por ele sem precisar
       * abrir outra tela. `null` quando nao ha nada pendente: um aviso com
       * zero nao e informacao.
       */
      syncNotice: await buildSyncNotice(ctx.db, {
        tenantId,
        siteId: tenant.siteId,
      }),
    };

    return ok(c, resposta);
  });

  // ------------------------------------------------- dados da empresa
  // ------------------------------------------- direitos do titular (LGPD)
  /**
   * Levar os dados embora (LGPD, art. 18, V).
   *
   * Um JSON com o conteudo, as imagens, os interessados, os dominios e as
   * pessoas da equipe. Sem segredo: a chave de integracao aparece pelo nome e
   * pelo tipo, nunca pelo valor, e nao ha hash de senha nem token.
   */
  app.get('/:tenantId/dados', requireCapability('tenant:export'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const dados = await exportTenantData(ctx.db, tenant.tenantId);

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.tenantExported,
      entityType: 'tenant',
      entityId: tenant.tenantId,
      metadata: { interessados: dados.interessados.length, imagens: dados.imagens.length },
    });

    // Baixa como arquivo: e um pedido de portabilidade, nao uma tela.
    const nome = `codeca-build-${tenant.tenantId}-${new Date().toISOString().slice(0, 10)}.json`;
    c.header('content-disposition', `attachment; filename="${nome}"`);
    c.header('cache-control', 'no-store');
    return ok(c, dados);
  });

  /** O que a exclusao vai levar, para a tela dizer antes de perguntar. */
  app.get('/:tenantId/exclusao/resumo', requireCapability('tenant:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const [row] = await ctx.db
      .select({ displayName: schema.tenants.displayName })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenant.tenantId));
    return ok(c, {
      displayName: row?.displayName ?? '',
      removidos: await deletionPreview(ctx.db, tenant.tenantId),
      // A tela avisa, antes de perguntar, que a assinatura sera cancelada.
      cobranca: await billingClosurePreview(ctx.db, tenant.tenantId),
    });
  });

  /**
   * Apagar a empresa e tudo o que pertence a ela (LGPD, art. 18, VI).
   *
   * Nao ha desfazer. Por isso sao tres barreiras: so o proprietario chega
   * aqui, o nome da empresa tem que ser digitado inteiro, e quem tem senha
   * precisa informa-la.
   *
   * O registro da exclusao e gravado ANTES, e com `tenantId: null` -- se fosse
   * gravado com a empresa, a propria cascata o levaria junto, e nao restaria
   * prova de quem pediu o que.
   */
  app.delete('/:tenantId', requireCapability('tenant:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, deleteTenantSchema);

    const [empresa] = await ctx.db
      .select({ displayName: schema.tenants.displayName, slug: schema.tenants.slug })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenant.tenantId));
    if (!empresa) throw AppError.notFound('Empresa não encontrada.');

    if (!confirmacaoConfere(input.confirmacao, empresa.displayName)) {
      throw AppError.badRequest(
        `Para confirmar, digite exatamente o nome da empresa: ${empresa.displayName}.`,
      );
    }

    const [usuario] = await ctx.db
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id));
    if (usuario?.passwordHash) {
      const senhaConfere = await verifyPassword(input.password ?? '', usuario.passwordHash);
      if (!senhaConfere) throw AppError.unauthenticated('Senha incorreta.');
    }

    /*
     * A cobranca e encerrada ANTES de qualquer coisa ser apagada, e se nao der
     * para encerrar a exclusao para aqui, com tudo no lugar. Excluir e seguir
     * cobrando era o defeito: depois da exclusao nao sobra painel para o
     * cliente cancelar nem registro nosso de que assinatura era de quem.
     */
    let cobranca: Awaited<ReturnType<typeof closeBillingBeforeDeletion>>;
    try {
      cobranca = await closeBillingBeforeDeletion(
        { db: ctx.db, provider: ctx.billing, now: ctx.now, actorUserId: session.user.id },
        tenant.tenantId,
      );
    } catch (error) {
      // A tentativa fica rastreavel: quem pediu, quando, e que parou na
      // cobranca. Nada foi apagado, entao o registro mora na propria empresa
      // -- e o pedido pode ser repetido quando o provedor responder.
      await auditFromContext(c, {
        action: AUDIT_ACTIONS.tenantDeletionBlocked,
        entityType: 'tenant',
        entityId: tenant.tenantId,
        metadata: { motivo: 'cobranca_nao_encerrada' },
      });
      throw error;
    }

    const resumo = await deletionPreview(ctx.db, tenant.tenantId);
    await recordAudit(ctx.db, ctx.env, {
      // Sem `tenantId`: este registro precisa sobreviver a exclusao.
      tenantId: null,
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      action: AUDIT_ACTIONS.tenantDeleted,
      entityType: 'tenant',
      entityId: tenant.tenantId,
      // `cobranca` e a unica prova que sobra de que a assinatura foi encerrada
      // (e de qual era): o espelho local some junto com a empresa.
      metadata: { slug: empresa.slug, displayName: empresa.displayName, removidos: resumo, cobranca },
      ip: clientIp(c),
      userAgent: userAgent(c),
    });

    const resultado = await deleteTenant(ctx.db, ctx.blob, {
      tenantId: tenant.tenantId,
      requesterUserId: session.user.id,
    });

    ctx.caches.invalidateAll();
    if (resultado.contaRemovida) clearSessionCookies(c, ctx.env);

    return ok(c, { ...resultado, cobranca });
  });

  app.patch('/:tenantId', requireCapability('tenant:update'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, updateTenantSchema);

    const [row] = await ctx.db
      .update(schema.tenants)
      .set({ ...input, updatedAt: ctx.now() })
      .where(eq(schema.tenants.id, tenant.tenantId))
      .returning({ id: schema.tenants.id, displayName: schema.tenants.displayName });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.tenantUpdated,
      entityType: 'tenant',
      entityId: tenant.tenantId,
      metadata: { displayName: input.displayName },
    });
    return ok(c, { tenant: row ?? null });
  });

  app.patch('/:tenantId/contact', requireCapability('tenant:update'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, updateTenantContactSchema);

    await ctx.db
      .update(schema.tenants)
      .set({
        contactEmail: input.email,
        contactPhone: input.phone,
        whatsapp: input.whatsapp,
        whatsappDefaultMessage: input.whatsappDefaultMessage,
        address: input.address,
        serviceArea: input.serviceArea,
        businessHours: input.businessHours,
        social: input.social,
        updatedAt: ctx.now(),
      })
      .where(eq(schema.tenants.id, tenant.tenantId));

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.tenantUpdated,
      entityType: 'tenant',
      entityId: tenant.tenantId,
      metadata: { section: 'contato' },
    });
    return ok(c, { updated: true });
  });

  // ---------------------------------------------------- plano e limites
  app.get('/:tenantId/plan', requireCapability('billing:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const status = await loadPlanStatus(ctx.db, tenant.tenantId);

    const [subscription] = await ctx.db
      .select({
        status: schema.subscriptions.status,
        currentPeriodStart: schema.subscriptions.currentPeriodStart,
        currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
        trialEndsAt: schema.subscriptions.trialEndsAt,
      })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, tenant.tenantId));

    const availablePlans = await ctx.db
      .select({
        code: schema.plans.code,
        name: schema.plans.name,
        description: schema.plans.description,
        priceCents: schema.plans.priceCents,
        limits: schema.plans.limits,
      })
      .from(schema.plans)
      .where(and(eq(schema.plans.isActive, true), eq(schema.plans.isPublic, true)));

    return ok(c, {
      plan: status.plan,
      usage: status.usage,
      subscription: subscription ?? null,
      availablePlans,
      // A cobranca automatizada ainda nao esta implementada: a troca de plano e
      // feita pelo painel mestre da plataforma.
      selfServiceUpgrade: false,
    });
  });

  return app;
}

/**
 * Aviso da sincronizacao para a visao geral.
 *
 * Devolve `null` quando nao ha fonte conectada ou nao ha pendencia -- e o que
 * mantem o painel limpo para quem nao usa a funcionalidade.
 */
async function buildSyncNotice(
  db: Database,
  input: { tenantId: string; siteId: string },
): Promise<SyncNotice | null> {
  const source = await loadSource(db, input);
  if (source === null) return null;

  const counts = await countPending(db, input);
  const message = syncNoticeMessage(counts);
  if (message === null) return null;

  return { ...counts, state: source.state, message };
}
