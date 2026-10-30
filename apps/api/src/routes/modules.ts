import { and, eq, schema } from '@codeca/database';
import {
  AppError,
  DOCUMENT_SCHEMAS,
  MODULE_REGISTRY,
  isModuleKey,
  type DocumentModuleKey,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { ok, parseJsonBody, parseParams } from '../lib/http.js';
import { assertEditableChanges, assertModuleEnabled, loadSiteModules } from '../lib/modules.js';
import { requireCapability, sessionOf, tenantMiddleware } from '../middleware/auth.js';
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
  app.use('/:tenantId/*', tenantMiddleware());

  /** O que o painel deve desenhar para este site. */
  app.get('/:tenantId/modules', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const state = await loadSiteModules(ctx.db, tenant.siteId);
    return ok(c, { siteId: tenant.siteId, modules: state.modules });
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

    const enviado = (await parseJsonBody(c, DOCUMENT_SCHEMAS[key])) as Record<string, unknown>;

    const [atual] = await ctx.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.siteId, tenant.siteId),
          eq(schema.contentDocuments.moduleKey, key),
        ),
      );

    const { overrides } = await loadSiteModules(ctx.db, tenant.siteId);
    const alterados = assertEditableChanges(key, atual?.data ?? {}, enviado, overrides);

    const [row] = await ctx.db
      .insert(schema.contentDocuments)
      .values({
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey: key,
        data: enviado,
        updatedByUserId: session.user.id,
      })
      .onConflictDoUpdate({
        target: [schema.contentDocuments.siteId, schema.contentDocuments.moduleKey],
        set: { data: enviado, updatedByUserId: session.user.id, updatedAt: ctx.now() },
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

    return ok(c, { moduleKey: key, data: row?.data ?? enviado });
  });

  return app;
}
