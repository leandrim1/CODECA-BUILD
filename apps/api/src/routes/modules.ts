import { and, eq, schema } from '@codeca/database';
import {
  AppError,
  DOCUMENT_SCHEMAS,
  MODULE_REGISTRY,
  emptyCustomFields,
  isModuleKey,
  planHasFeature,
  type DocumentModuleKey,
  type SiteModulesPayload,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { ok, parseJsonBody, parseJsonBodyWithRaw, parseParams } from '../lib/http.js';
import {
  assertEditableChanges,
  assertModuleEnabled,
  customFieldsOf,
  loadSiteModules,
} from '../lib/modules.js';
import { mergeCustomFields, parseCustomFields } from '../lib/custom-fields.js';
import { resolveSiteBilling } from '../lib/billing/suspension.js';
import { loadEffectivePlan } from '../lib/plan-limits.js';
import { queueContentPublished } from '../lib/integration/outbound.js';
import { requireCapability, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Modulos editaveis do site e o conteudo dos de instancia unica.
 *
 * O painel pergunta aqui o que desenhar: quais modulos este site tem e quais
 * campos o cliente pode mexer. Esconder um campo na tela nao basta -- a mesma
 * politica e conferida na escrita, porque a API e publica e o painel nao e a
 * unica forma de chegar nela.
 */

const moduleParamSchema = z.object({
  tenantId: z.string().uuid(),
  moduleKey: z.string().min(1),
});

/** Converte o parametro da rota em chave de modulo conhecida. */
function parseModuleKey(value: string) {
  if (!isModuleKey(value)) throw AppError.notFound('Modulo nao encontrado.');
  return value;
}

function parseDocumentModuleKey(value: string): DocumentModuleKey {
  const key = parseModuleKey(value);
  if (MODULE_REGISTRY[key].kind !== 'document') {
    throw AppError.badRequest(
      `O modulo ${MODULE_REGISTRY[key].name} guarda uma lista de registros, nao um documento.`,
    );
  }
  return key as DocumentModuleKey;
}

export function moduleRoutes() {
  const app = new Hono<AppBindings>();

  /**
   * O que o painel deve desenhar para este site.
   *
   * Esta rota fica **fora** do bloqueio de plano sem painel, de proposito: e
   * por ela que a tela descobre que nao ha painel a desenhar. Deduzir isso de
   * uma recusa faria o menu aparecer e sumir, e um cliente do plano Essencial
   * veria por um instante exatamente o que nao contratou.
   */
  app.get('/:tenantId/modules', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const plano = await loadEffectivePlan(ctx.db, tenant.tenantId);
    const incluido = planHasFeature(plano.limits, 'cms_panel');
    const situacao = await resolveSiteBilling(ctx.db, tenant.siteId, ctx.now());

    // Sem painel no plano, nao se consulta modulo: a lista vazia e a resposta
    // certa, e evita duas consultas que nao vao para a tela.
    const state = incluido
      ? await loadSiteModules(ctx.db, tenant.siteId)
      : { modules: [], overrides: {} };

    const resposta: SiteModulesPayload = {
      siteId: tenant.siteId,
      modules: state.modules,
      /**
       * Restricao em vigor agora.
       *
       * Vem junto porque o painel ja pede esta rota uma vez ao abrir: sem
       * isso a tela so descobriria a suspensao ao tentar gravar, depois de o
       * cliente preencher o formulario inteiro.
       */
      suspension: situacao.effect,
      panel: { included: incluido, planCode: plano.planCode, planName: plano.planName },
    };

    return ok(c, resposta);
  });

  app.get('/:tenantId/modules/:moduleKey/document', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { moduleKey } = parseParams(c, moduleParamSchema);
    const key = parseDocumentModuleKey(moduleKey);
    await assertModuleEnabled(ctx.db, tenant.siteId, key);

    const [row] = await ctx.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.siteId, tenant.siteId),
          eq(schema.contentDocuments.moduleKey, key),
        ),
      );

    const state = await loadSiteModules(ctx.db, tenant.siteId);
    const definicao = state.modules.find((m) => m.key === key);

    return ok(c, {
      moduleKey: key,
      // Documento ausente nao e erro: o modulo pode ter sido habilitado depois
      // do site. O schema devolve a forma vazia valida.
      data: row?.data ?? DOCUMENT_SCHEMAS[key].parse(key === 'institucional'
        ? { companyName: tenant.displayName }
        : {}),
      /**
       * Valores dos campos personalizados, separados do documento.
       *
       * Fora de `data` porque o schema tipado recusa chave desconhecida:
       * juntar os dois faria o campo personalizado depender de afrouxar a
       * validacao do campo tipado.
       *
       * A forma vazia vai **embaixo** do que esta gravado, nao no lugar: o
       * caso comum e o documento ter sido salvo antes de o campo existir, e
       * nele o valor gravado nao tem a chave. Sem isto o formulario abriria
       * sem o campo novo, que e justamente o que acabou de ser definido.
       */
      customFields: {
        ...emptyCustomFields(customFieldsOf(state, key)),
        ...(row?.customFields ?? {}),
      },
      fields: definicao?.fields ?? [],
      updatedAt: row?.updatedAt ?? null,
    });
  });

  app.put('/:tenantId/modules/:moduleKey/document', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const { moduleKey } = parseParams(c, moduleParamSchema);
    const key = parseDocumentModuleKey(moduleKey);
    await assertModuleEnabled(ctx.db, tenant.siteId, key);

    const { data: validado, raw } = await parseJsonBodyWithRaw(c, DOCUMENT_SCHEMAS[key]);
    const enviado = validado as Record<string, unknown>;

    const [atual] = await ctx.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.siteId, tenant.siteId),
          eq(schema.contentDocuments.moduleKey, key),
        ),
      );

    const estadoModulos = await loadSiteModules(ctx.db, tenant.siteId);
    const { overrides } = estadoModulos;
    const alterados = assertEditableChanges(key, atual?.data ?? {}, enviado, overrides);
    const personalizados = parseCustomFields({
      moduleKey: key,
      definicoes: customFieldsOf(estadoModulos, key),
      raw,
      overrides,
      // Documento nao tem rascunho: o formulario envia tudo o que mostra, e
      // mostra todos os campos. Vale a validacao completa.
      partial: false,
    });

    const [row] = await ctx.db
      .insert(schema.contentDocuments)
      .values({
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey: key,
        data: enviado,
        customFields: mergeCustomFields(atual?.customFields, personalizados),
        updatedByUserId: session.user.id,
      })
      .onConflictDoUpdate({
        target: [schema.contentDocuments.siteId, schema.contentDocuments.moduleKey],
        set: {
          data: enviado,
          customFields: mergeCustomFields(atual?.customFields, personalizados),
          updatedByUserId: session.user.id,
          updatedAt: ctx.now(),
        },
      })
      .returning();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentUpdated,
      entityType: 'content_document',
      entityId: row?.id ?? key,
      // Os nomes dos campos alterados bastam para a auditoria; os valores
      // ficam no proprio documento.
      metadata: { moduleKey: key, changed: alterados },
    });

    // Documento nao tem rascunho: salvar e publicar. Sempre avisa.
    await queueContentPublished(ctx, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      moduleKey: key,
      action: 'updated',
    });

    // Mesma forma da leitura: a tela que acabou de salvar nao precisa de um
    // segundo `GET` para saber o que ficou gravado.
    return ok(c, {
      moduleKey: key,
      data: row?.data ?? enviado,
      customFields: row?.customFields ?? mergeCustomFields(atual?.customFields, personalizados),
    });
  });

  return app;
}
