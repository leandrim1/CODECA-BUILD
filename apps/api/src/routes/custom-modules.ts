import { and, asc, desc, eq, ilike, schema, sql } from '@codeca/database';
import {
  AppError,
  contentQuerySchema,
  customDocumentInputSchema,
  customRecordInputSchema,
  customRecordUpdateSchema,
  paginate,
  uuidSchema,
} from '@codeca/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import {
  created,
  noContent,
  ok,
  parseJsonBodyWithRaw,
  parseParams,
  parseQuery,
} from '../lib/http.js';
import {
  assertCustomModule,
  loadCustomModules,
  mergeRecordData,
  parseRecordData,
  uniqueRecordSlug,
} from '../lib/custom-modules.js';
import { queueContentPublished, visibilityChanged } from '../lib/integration/outbound.js';
import { requireCapability } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Conteudo dos modulos criados para o site.
 *
 * Uma rota generica para todos eles, em vez de uma por modulo: a existencia do
 * modulo e dado, entao nao ha como escrever a rota antes de o modulo existir.
 * O que seria tipado em cada CRUD -- quais campos, de que tipo, obrigatorios
 * ou nao -- vem das definicoes e e conferido em tempo de execucao por
 * `parseRecordData`.
 *
 * As garantias que isso **nao** abre mao de:
 *
 * - **Isolamento**: a chave estrangeira composta `(site_id, tenant_id)` e a
 *   mesma de todo conteudo. Nao e a aplicacao que garante, e o banco.
 * - **Politica de campos**: vale igual, porque as definicoes sao as mesmas da
 *   etapa F e `policyKey` nao distingue a origem do modulo.
 * - **Plano e suspensao**: a rota entra em `tenantScoped`, entao herda
 *   `requirePanelPlan` e `enforceSuspension` sem nada a mais.
 * - **Chave desconhecida**: recusada pelo nome, nao aceita em silencio.
 */

const paramsModulo = z.object({ tenantId: uuidSchema, moduleKey: z.string().trim().min(1) });
const paramsRegistro = paramsModulo.extend({ recordId: uuidSchema });

/** O registro como o painel o recebe. Sem colunas internas. */
function paraPainel(row: typeof schema.customRecords.$inferSelect) {
  return {
    id: row.id,
    moduleKey: row.moduleKey,
    title: row.title,
    slug: row.slug,
    data: row.data,
    publicationStatus: row.publicationStatus,
    featured: row.featured,
    sortOrder: row.sortOrder,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function customModuleRoutes() {
  const app = new Hono<AppBindings>();

  /**
   * Os modulos deste site, para o painel montar o menu.
   *
   * Duplica o que `GET /modules` ja devolve, de proposito: o menu vem de la,
   * mas uma tela aberta por URL direta precisa descobrir o modulo sem carregar
   * a moldura inteira.
   */
  app.get('/:tenantId/custom-modules', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const state = await loadCustomModules(ctx.db, tenant.siteId);
    return ok(c, {
      items: state.modules
        .filter((modulo) => modulo.enabled)
        .map((modulo) => ({
          key: modulo.key,
          name: modulo.name,
          description: modulo.description,
          kind: modulo.kind,
          icon: modulo.icon,
        })),
    });
  });

  // ------------------------------------------------------------- listagem

  app.get('/:tenantId/custom/:moduleKey', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { moduleKey } = parseParams(c, paramsModulo);
    const query = parseQuery(c, contentQuerySchema);

    const modulo = await assertCustomModule(ctx.db, tenant.siteId, moduleKey);

    const filtros = [
      eq(schema.customRecords.siteId, tenant.siteId),
      eq(schema.customRecords.moduleKey, moduleKey),
    ];
    if (query.publicationStatus) {
      filtros.push(eq(schema.customRecords.publicationStatus, query.publicationStatus));
    }
    // A busca cobre o titulo, que e a coluna que a plataforma conhece. Buscar
    // dentro de `data` exigiria indice por campo que esta tabela nao tem -- e
    // prometer busca que varre JSONB seria lento no momento em que importasse.
    if (query.search) filtros.push(ilike(schema.customRecords.title, `%${query.search}%`));

    const where = and(...filtros);

    const rows = await ctx.db
      .select()
      .from(schema.customRecords)
      .where(where)
      .orderBy(
        desc(schema.customRecords.featured),
        asc(schema.customRecords.sortOrder),
        desc(schema.customRecords.createdAt),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totais] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.customRecords)
      .where(where);

    return ok(c, {
      ...paginate(rows.map(paraPainel), totais?.total ?? 0, query),
      module: { key: modulo.key, name: modulo.name, kind: modulo.kind },
    });
  });

  // ----------------------------------------------- documento de um modulo

  /**
   * O registro unico de um modulo `document`.
   *
   * Vem antes da rota de `:recordId` porque `document` seria lido como id --
   * e um id nao e UUID falharia na validacao em vez de chegar aqui.
   */
  app.get('/:tenantId/custom/:moduleKey/document', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { moduleKey } = parseParams(c, paramsModulo);
    const modulo = await assertCustomModule(ctx.db, tenant.siteId, moduleKey);
    assertDocumento(modulo.kind, modulo.name);

    const [row] = await ctx.db
      .select()
      .from(schema.customRecords)
      .where(
        and(
          eq(schema.customRecords.siteId, tenant.siteId),
          eq(schema.customRecords.moduleKey, moduleKey),
        ),
      );

    return ok(c, {
      module: { key: modulo.key, name: modulo.name, kind: modulo.kind },
      // Documento ausente nao e erro: o modulo pode ter sido criado agora. A
      // forma vazia valida e o que deixa o formulario abrir preenchivel.
      record: row ? paraPainel(row) : null,
      fields: modulo.fields,
    });
  });

  app.put('/:tenantId/custom/:moduleKey/document', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { moduleKey } = parseParams(c, paramsModulo);
    const { data: input, raw } = await parseJsonBodyWithRaw(c, customDocumentInputSchema);

    const state = await loadCustomModules(ctx.db, tenant.siteId);
    const modulo = state.modules.find((m) => m.key === moduleKey && m.enabled);
    if (!modulo) throw AppError.notFound('Modulo nao encontrado.');
    assertDocumento(modulo.kind, modulo.name);

    const [atual] = await ctx.db
      .select()
      .from(schema.customRecords)
      .where(
        and(
          eq(schema.customRecords.siteId, tenant.siteId),
          eq(schema.customRecords.moduleKey, moduleKey),
        ),
      );

    // Documento nao tem rascunho de campo: o formulario mostra todos e envia
    // todos. Vale a validacao completa.
    const valores = parseRecordData({
      modulo,
      overrides: state.overrides,
      raw,
      partial: atual !== undefined,
    });

    const publicando = input.publicationStatus === 'published';
    const [row] = await ctx.db
      .insert(schema.customRecords)
      .values({
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey,
        title: input.title,
        // Slug vazio: e o que mantem o documento unico, pelo indice de slug.
        slug: '',
        data: mergeRecordData(atual?.data, valores),
        publicationStatus: input.publicationStatus,
        publishedAt: publicando ? ctx.now() : null,
      })
      .onConflictDoUpdate({
        target: [
          schema.customRecords.siteId,
          schema.customRecords.moduleKey,
          schema.customRecords.slug,
        ],
        set: {
          title: input.title,
          data: mergeRecordData(atual?.data, valores),
          publicationStatus: input.publicationStatus,
          publishedAt: publicando ? (atual?.publishedAt ?? ctx.now()) : null,
          updatedAt: ctx.now(),
        },
      })
      .returning();
    if (!row) throw AppError.internal('Nao foi possivel gravar o documento.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentUpdated,
      entityType: 'custom_record',
      entityId: row.id,
      metadata: { moduleKey, kind: 'document', status: row.publicationStatus },
    });

    if (visibilityChanged(atual?.publicationStatus ?? null, row.publicationStatus)) {
      await queueContentPublished(ctx, {
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey,
        action: atual ? 'updated' : 'created',
        entityId: row.id,
      });
    }

    return ok(c, { record: paraPainel(row) });
  });

  // -------------------------------------------------------------- detalhe

  app.get('/:tenantId/custom/:moduleKey/:recordId', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { moduleKey, recordId } = parseParams(c, paramsRegistro);
    const modulo = await assertCustomModule(ctx.db, tenant.siteId, moduleKey);

    const row = await carregar(c, moduleKey, recordId);
    return ok(c, {
      record: paraPainel(row),
      module: { key: modulo.key, name: modulo.name, kind: modulo.kind },
      fields: modulo.fields,
    });
  });

  // --------------------------------------------------------------- escrita

  app.post('/:tenantId/custom/:moduleKey', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { moduleKey } = parseParams(c, paramsModulo);
    const { data: input, raw } = await parseJsonBodyWithRaw(c, customRecordInputSchema);

    const state = await loadCustomModules(ctx.db, tenant.siteId);
    const modulo = state.modules.find((m) => m.key === moduleKey && m.enabled);
    if (!modulo) throw AppError.notFound('Modulo nao encontrado.');
    if (modulo.kind === 'document') {
      throw AppError.badRequest(
        `O modulo ${modulo.name} guarda um documento unico. Use a rota de documento.`,
      );
    }

    const valores = parseRecordData({ modulo, overrides: state.overrides, raw, partial: false });

    const slug = await uniqueRecordSlug(ctx.db, {
      siteId: tenant.siteId,
      moduleKey,
      desired: input.slug ?? input.title,
    });

    const publicando = input.publicationStatus === 'published';
    const [row] = await ctx.db
      .insert(schema.customRecords)
      .values({
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey,
        title: input.title,
        slug,
        data: valores ?? {},
        publicationStatus: input.publicationStatus,
        featured: input.featured,
        sortOrder: input.sortOrder,
        publishedAt: publicando ? ctx.now() : null,
      })
      .returning();
    if (!row) throw AppError.internal('Nao foi possivel cadastrar o registro.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.contentCreated,
      entityType: 'custom_record',
      entityId: row.id,
      metadata: { moduleKey, title: row.title, slug: row.slug, status: row.publicationStatus },
    });

    if (visibilityChanged(null, row.publicationStatus)) {
      await queueContentPublished(ctx, {
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        moduleKey,
        action: 'created',
        entityId: row.id,
        slug: row.slug,
      });
    }

    return created(c, { record: paraPainel(row) });
  });

  app.patch(
    '/:tenantId/custom/:moduleKey/:recordId',
    requireCapability('content:write'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const { moduleKey, recordId } = parseParams(c, paramsRegistro);
      const { data: input, raw } = await parseJsonBodyWithRaw(c, customRecordUpdateSchema);

      const state = await loadCustomModules(ctx.db, tenant.siteId);
      const modulo = state.modules.find((m) => m.key === moduleKey && m.enabled);
      if (!modulo) throw AppError.notFound('Modulo nao encontrado.');

      const atual = await carregar(c, moduleKey, recordId);
      const valores = parseRecordData({
        modulo,
        overrides: state.overrides,
        raw,
        partial: true,
      });

      const updates: Record<string, unknown> = { updatedAt: ctx.now() };
      // Mescla, nao substitui: edicao que nao mostrou um campo nao o apaga.
      if (valores !== undefined) updates.data = mergeRecordData(atual.data, valores);
      if (input.title !== undefined) updates.title = input.title;
      if (input.featured !== undefined) updates.featured = input.featured;
      if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

      if (input.slug !== undefined && input.slug !== atual.slug) {
        if (modulo.kind === 'document') {
          throw AppError.badRequest('O documento de um modulo nao tem endereco proprio.');
        }
        updates.slug = await uniqueRecordSlug(ctx.db, {
          siteId: tenant.siteId,
          moduleKey,
          desired: input.slug || atual.title,
          exceptId: recordId,
        });
      }

      if (input.publicationStatus !== undefined) {
        updates.publicationStatus = input.publicationStatus;
        // A data de publicacao e do primeiro "publicado": republicar nao a
        // move, e despublicar a limpa.
        if (input.publicationStatus === 'published') {
          updates.publishedAt = atual.publishedAt ?? ctx.now();
        } else {
          updates.publishedAt = null;
        }
      }

      const [row] = await ctx.db
        .update(schema.customRecords)
        .set(updates)
        .where(
          and(
            eq(schema.customRecords.id, recordId),
            eq(schema.customRecords.siteId, tenant.siteId),
          ),
        )
        .returning();
      if (!row) throw AppError.notFound('Registro nao encontrado.');

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.contentUpdated,
        entityType: 'custom_record',
        entityId: row.id,
        metadata: { moduleKey, changed: Object.keys(updates).filter((k) => k !== 'updatedAt') },
      });

      if (visibilityChanged(atual.publicationStatus, row.publicationStatus)) {
        await queueContentPublished(ctx, {
          tenantId: tenant.tenantId,
          siteId: tenant.siteId,
          moduleKey,
          action: 'updated',
          entityId: row.id,
          slug: row.slug,
        });
      }

      return ok(c, { record: paraPainel(row) });
    },
  );

  app.delete(
    '/:tenantId/custom/:moduleKey/:recordId',
    requireCapability('content:delete'),
    async (c) => {
      const ctx = c.get('ctx');
      const tenant = c.get('tenant');
      const { moduleKey, recordId } = parseParams(c, paramsRegistro);
      await assertCustomModule(ctx.db, tenant.siteId, moduleKey);

      const atual = await carregar(c, moduleKey, recordId);

      await ctx.db
        .delete(schema.customRecords)
        .where(
          and(
            eq(schema.customRecords.id, recordId),
            eq(schema.customRecords.siteId, tenant.siteId),
          ),
        );

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.contentDeleted,
        entityType: 'custom_record',
        entityId: recordId,
        metadata: { moduleKey, title: atual.title, slug: atual.slug },
      });

      if (atual.publicationStatus === 'published') {
        await queueContentPublished(ctx, {
          tenantId: tenant.tenantId,
          siteId: tenant.siteId,
          moduleKey,
          action: 'removed',
          entityId: recordId,
          slug: atual.slug,
        });
      }

      return noContent(c);
    },
  );

  return app;
}

function assertDocumento(kind: string, nome: string) {
  if (kind !== 'document') {
    throw AppError.badRequest(`O modulo ${nome} guarda uma lista de registros, nao um documento.`);
  }
}

/**
 * Carrega o registro dentro do site **e** do modulo.
 *
 * As duas condicoes importam: sem o site, um id de outra empresa seria lido;
 * sem o modulo, um id valido de outro modulo do mesmo site seria editado pela
 * tela errada, com as definicoes erradas.
 */
async function carregar(c: Context<AppBindings>, moduleKey: string, recordId: string) {
  const ctx = c.get('ctx');
  const tenant = c.get('tenant');
  const [row] = await ctx.db
    .select()
    .from(schema.customRecords)
    .where(
      and(
        eq(schema.customRecords.id, recordId),
        eq(schema.customRecords.siteId, tenant.siteId),
        eq(schema.customRecords.moduleKey, moduleKey),
      ),
    );
  if (!row) throw AppError.notFound('Registro nao encontrado.');
  return row;
}
