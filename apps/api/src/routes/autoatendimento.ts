import { and, eq, schema } from '@codeca/database';
import {
  AppError,
  MODULE_KEYS,
  MODULE_REGISTRY,
  planHasFeature,
  type ModuleKey,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import {
  listApiKeys,
  moduleToggleImpact,
  requireKeyOfSite,
  MODULE_DEPENDENCIES,
} from '../lib/autoatendimento.js';
import { rotateApiKey, revokeApiKeyById } from '../lib/integration/keys.js';
import { ok, parseJsonBody, parseParams } from '../lib/http.js';
import { enabledModuleKeys, loadSiteModules } from '../lib/modules.js';
import { loadEffectivePlan } from '../lib/plan-limits.js';
import { requireCapability } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Autoatendimento: o cliente cuida das proprias chaves e modulos.
 *
 * Antes desta fase, as duas coisas so existiam no painel mestre: para revogar
 * uma chave vazada ou desligar um modulo que nao usa, o cliente tinha de
 * abrir chamado. Agora ele resolve sozinho -- com tres limites deliberados:
 *
 * 1. **Emitir a PRIMEIRA chave continua com a CODECA IA.** Emitir chave e
 *    parte de conectar o site, que e um ato de quem desenvolve. O que o
 *    cliente ganha aqui e o que e dele: ver, revogar e trocar.
 * 2. **Modulo pago nao existe.** Ligar/desligar vale para o que o plano ja
 *    inclui. Cobrar por modulo seria produto novo, nao autoatendimento.
 * 3. **Toda regra vale no servidor.** A tela e conveniencia; quem recusa e
 *    esta rota.
 */

const keyParamSchema = z.object({ keyId: z.string().uuid('Chave inválida.') });

const clientParamSchema = z.object({ clientId: z.string().uuid('Cliente inválido.') });
const siteParamSchema = z.object({ siteId: z.string().uuid('Projeto inválido.') });

const clientSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do cliente.').max(120),
  contactName: z.string().trim().max(120).default(''),
  contactEmail: z.union([z.string().trim().email('E-mail inválido.'), z.literal('')]).default(''),
  contactPhone: z.string().trim().max(40).default(''),
  notes: z.string().trim().max(2000).default(''),
});

const updateClientSchema = clientSchema.partial().extend({
  /** Arquivar some das listas; nada e apagado e os projetos continuam ligados. */
  archivedAt: z.coerce.date().nullable().optional(),
});

const assignClientSchema = z.object({
  /** `null` desfaz o vinculo: o projeto volta a ser "sem cliente". */
  clientId: z.string().uuid('Cliente inválido.').nullable(),
});

const rotateSchema = z.object({
  /**
   * Minutos em que a chave antiga continua valendo.
   *
   * Existe porque o site do cliente nao troca a credencial no mesmo instante:
   * sem a sobreposicao, rotacionar derrubaria o site ate alguem publicar o
   * valor novo. O teto de 24 h evita uma chave antiga viva por semanas.
   */
  graceMinutes: z.number().int().min(0).max(1440).default(60),
});

const moduleParamSchema = z.object({
  moduleKey: z.enum(MODULE_KEYS as unknown as [ModuleKey, ...ModuleKey[]]),
});

const toggleSchema = z.object({
  enabled: z.boolean(),
  /**
   * `true` apenas calcula o impacto e nao altera nada.
   *
   * A tela pede a previa, mostra o que muda e so entao confirma -- e o
   * servidor refaz o mesmo calculo na confirmacao, para a decisao nunca
   * depender do que o navegador respondeu.
   */
  preview: z.boolean().default(false),
});

export function selfServiceRoutes() {
  const app = new Hono<AppBindings>();

  // ------------------------------------------------------------- chaves

  /**
   * As chaves do site. Nunca devolve segredo: ver `listApiKeys`.
   */
  app.get('/:tenantId/integration/keys', requireCapability('integration:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const keys = await listApiKeys(ctx.db, tenant.siteId, ctx.now());

    c.header('cache-control', 'no-store');
    return ok(c, {
      siteId: tenant.siteId,
      keys,
      /**
       * Emitir a primeira chave e ato de quem conecta o site. Dito aqui para a
       * tela explicar, em vez de mostrar um botao que o servidor recusaria.
       */
      canIssue: false,
      issueNotice:
        'A emissão de chaves novas é feita pela CODECA IA, junto com a conexão do site. '
        + 'Aqui você acompanha, revoga e troca as chaves já emitidas.',
    });
  });

  /**
   * Revoga uma chave AGORA.
   *
   * Acao de emergencia (chave vazada), e por isso nao tem carencia: o efeito e
   * imediato e o site que usa essa chave para de receber conteudo ate
   * publicarem outra. A tela avisa; aqui so se executa.
   */
  app.delete('/:tenantId/integration/keys/:keyId', requireCapability('integration:manage'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { keyId } = parseParams(c, keyParamSchema);

    // Confere o dono ANTES de qualquer coisa: a chave tem de ser deste site.
    const chave = await requireKeyOfSite(ctx.db, tenant.siteId, keyId);
    if (chave.revokedAt) throw AppError.conflict('Esta chave já está revogada.');

    const revogada = await revokeApiKeyById(ctx.db, tenant.siteId, keyId, ctx.now());
    if (!revogada) throw AppError.conflict('Esta chave já está revogada.');

    ctx.caches.invalidateAll();
    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteKeyRevoked,
      entityType: 'apikey',
      entityId: keyId,
      metadata: { kind: chave.kind, via: 'autoatendimento' },
    });

    return ok(c, { revoked: true });
  });

  /**
   * Troca a chave por uma nova, mantendo a antiga por um tempo.
   *
   * O segredo novo volta UMA vez nesta resposta. Depois disto, so o hash fica.
   */
  app.post('/:tenantId/integration/keys/:keyId/rotate', requireCapability('integration:manage'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { keyId } = parseParams(c, keyParamSchema);
    const input = await parseJsonBody(c, rotateSchema);

    const chave = await requireKeyOfSite(ctx.db, tenant.siteId, keyId);
    if (chave.revokedAt) {
      throw AppError.conflict('Esta chave está revogada. Peça uma nova à CODECA IA.');
    }

    const nova = await rotateApiKey(ctx.db, keyId, input.graceMinutes, ctx.now());
    ctx.caches.invalidateAll();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteKeyRotated,
      entityType: 'apikey',
      entityId: nova.id,
      metadata: { rotatedFrom: keyId, graceMinutes: input.graceMinutes, via: 'autoatendimento' },
    });

    c.header('cache-control', 'no-store');
    return ok(c, {
      id: nova.id,
      kind: nova.kind,
      // Unica vez que este valor existe fora do banco.
      token: nova.token,
      graceMinutes: input.graceMinutes,
      notice:
        input.graceMinutes > 0
          ? `A chave anterior continua funcionando por ${input.graceMinutes} minuto(s). `
            + 'Publique a chave nova no site antes desse prazo.'
          : 'A chave anterior deixou de funcionar agora.',
    });
  });

  // ------------------------------------------------------------ modulos

  /**
   * O catalogo de modulos como esta conta o ve: o que esta ligado, o que o
   * plano permite, e o que depende de que.
   */
  app.get('/:tenantId/integration/modules', requireCapability('integration:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const plano = await loadEffectivePlan(ctx.db, tenant.tenantId);
    const temPainel = planHasFeature(plano.limits, 'cms_panel');
    const estado = await loadSiteModules(ctx.db, tenant.siteId);
    const ligados = new Set(enabledModuleKeys(estado));

    const modules = estado.modules.map((modulo) => ({
      key: modulo.key,
      name: MODULE_REGISTRY[modulo.key as ModuleKey]?.name ?? modulo.key,
      description: MODULE_REGISTRY[modulo.key as ModuleKey]?.description ?? '',
      enabled: modulo.enabled,
      /** Modulos que este usa. Vem de chave estrangeira real, nao de catalogo. */
      dependsOn: (MODULE_DEPENDENCIES[modulo.key as ModuleKey] ?? []).map((dep) => ({
        key: dep,
        name: MODULE_REGISTRY[dep].name,
        enabled: ligados.has(dep),
      })),
      /**
       * Sem painel no plano, nada se liga aqui -- e o motivo aparece na tela,
       * em vez de um botao que o servidor recusaria.
       */
      manageable: temPainel,
    }));

    return ok(c, {
      siteId: tenant.siteId,
      modules,
      plan: { code: plano.planCode, name: plano.planName, panelIncluded: temPainel },
      notice: temPainel
        ? null
        : `O plano ${plano.planName} não inclui o painel de conteúdo. Os módulos são configurados pela CODECA IA.`,
    });
  });

  /**
   * Liga ou desliga um modulo deste site.
   *
   * **Desligar nunca apaga nada.** O conteudo continua no banco e volta a
   * aparecer assim que o modulo for ligado de novo. O que muda e o que o site
   * publica e o que o painel mostra.
   */
  app.patch('/:tenantId/integration/modules/:moduleKey', requireCapability('integration:manage'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { moduleKey } = parseParams(c, moduleParamSchema);
    const input = await parseJsonBody(c, toggleSchema);

    const plano = await loadEffectivePlan(ctx.db, tenant.tenantId);
    if (!planHasFeature(plano.limits, 'cms_panel')) {
      throw AppError.forbidden(
        `O plano ${plano.planName} não inclui o painel de conteúdo. Fale com a CODECA IA para ajustar os módulos.`,
      );
    }

    const estado = await loadSiteModules(ctx.db, tenant.siteId);
    const atual = estado.modules.find((m) => m.key === moduleKey);
    if (!atual) {
      throw AppError.notFound('Este módulo não faz parte do segmento deste site.');
    }

    const impacto = await moduleToggleImpact(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      moduleKey,
      enable: input.enabled,
      enabledKeys: enabledModuleKeys(estado),
    });

    // Previa: o mesmo calculo, sem alterar nada.
    if (input.preview) return ok(c, { preview: true, impacto, current: atual.enabled });

    if (atual.enabled === input.enabled) {
      return ok(c, { preview: false, impacto, changed: false, enabled: atual.enabled });
    }

    const agora = ctx.now();
    await ctx.db
      .update(schema.siteModules)
      .set({ enabled: input.enabled, updatedAt: agora })
      .where(
        and(
          eq(schema.siteModules.siteId, tenant.siteId),
          eq(schema.siteModules.moduleKey, moduleKey),
        ),
      );
    ctx.caches.invalidateAll();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteModulesConfigured,
      entityType: 'site',
      entityId: tenant.siteId,
      metadata: {
        moduleKey,
        enabled: input.enabled,
        records: impacto.records,
        via: 'autoatendimento',
      },
    });

    return ok(c, { preview: false, impacto, changed: true, enabled: input.enabled });
  });

  // ------------------------------------------- clientes da agencia

  /*
   * Base do modelo de agencia: a empresa organiza seus projetos por cliente.
   *
   * O que isto E: um cadastro da agencia, para separar "de quem e cada
   * projeto". O que isto NAO e: conta, login, assinatura ou cobranca. Quem
   * paga continua sendo a empresa, e nenhum preco ou plano mudou.
   *
   * Existe agora porque custa pouco e nao fecha porta nenhuma: quando o modelo
   * comercial de agencia for decidido, esta e a estrutura em que ele se apoia.
   */

  app.get('/:tenantId/clients', requireCapability('clients:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const clientes = await ctx.db
      .select()
      .from(schema.tenantClients)
      .where(eq(schema.tenantClients.tenantId, tenant.tenantId));

    // Quantos projetos cada cliente tem. Uma consulta so, em memoria: sao
    // dezenas de linhas, nao milhares.
    const sites = await ctx.db
      .select({ id: schema.sites.id, name: schema.sites.name, clientId: schema.sites.clientId })
      .from(schema.sites)
      .where(eq(schema.sites.tenantId, tenant.tenantId));

    return ok(c, {
      clients: clientes
        .map((cliente) => ({
          id: cliente.id,
          name: cliente.name,
          contactName: cliente.contactName,
          contactEmail: cliente.contactEmail,
          contactPhone: cliente.contactPhone,
          notes: cliente.notes,
          archivedAt: cliente.archivedAt,
          projects: sites
            .filter((s) => s.clientId === cliente.id)
            .map((s) => ({ id: s.id, name: s.name })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      /** Projetos ainda sem cliente: o caso normal de quem nao e agencia. */
      unassigned: sites.filter((s) => !s.clientId).map((s) => ({ id: s.id, name: s.name })),
    });
  });

  app.post('/:tenantId/clients', requireCapability('clients:manage'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, clientSchema);
    const agora = ctx.now();

    const [criado] = await ctx.db
      .insert(schema.tenantClients)
      .values({ ...input, tenantId: tenant.tenantId, createdAt: agora, updatedAt: agora })
      .returning({ id: schema.tenantClients.id, name: schema.tenantClients.name });
    if (!criado) throw AppError.internal('Não foi possível cadastrar o cliente.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.tenantClientCreated,
      entityType: 'tenant_client',
      entityId: criado.id,
      metadata: { name: criado.name },
    });
    return ok(c, { client: criado });
  });

  app.patch('/:tenantId/clients/:clientId', requireCapability('clients:manage'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { clientId } = parseParams(c, clientParamSchema);
    const input = await parseJsonBody(c, updateClientSchema);

    // O filtro por empresa e o que impede alcançar o cliente de outra agencia.
    const [alterado] = await ctx.db
      .update(schema.tenantClients)
      .set({ ...input, updatedAt: ctx.now() })
      .where(
        and(
          eq(schema.tenantClients.id, clientId),
          eq(schema.tenantClients.tenantId, tenant.tenantId),
        ),
      )
      .returning({ id: schema.tenantClients.id, name: schema.tenantClients.name });
    if (!alterado) throw AppError.notFound('Cliente não encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.tenantClientUpdated,
      entityType: 'tenant_client',
      entityId: alterado.id,
      metadata: { name: alterado.name },
    });
    return ok(c, { client: alterado });
  });

  /**
   * Liga um projeto a um cliente -- ou o desliga, com `clientId: null`.
   *
   * O par (cliente, empresa) e conferido pelo BANCO, por chave estrangeira
   * composta: um identificador de cliente de outra agencia e recusado mesmo
   * que passasse por esta rota. Ver `sites_client_tenant_fk`.
   */
  app.patch('/:tenantId/sites/:siteId/client', requireCapability('clients:manage'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { siteId } = parseParams(c, siteParamSchema);
    const input = await parseJsonBody(c, assignClientSchema);

    const [atualizado] = await ctx.db
      .update(schema.sites)
      .set({ clientId: input.clientId, updatedAt: ctx.now() })
      .where(and(eq(schema.sites.id, siteId), eq(schema.sites.tenantId, tenant.tenantId)))
      .returning({ id: schema.sites.id, clientId: schema.sites.clientId });
    if (!atualizado) throw AppError.notFound('Projeto não encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.tenantClientAssigned,
      entityType: 'site',
      entityId: siteId,
      metadata: { clientId: input.clientId },
    });
    return ok(c, { site: atualizado });
  });

  return app;
}
