import { and, desc, eq, ilike, schema, sql } from '@codeca/database';
import {
  AppError,
  MAX_UPLOAD_BYTES,
  formatBytes,
  isAllowedMimeType,
  mediaKindFor,
  mediaQuerySchema,
  paginate,
  safeFileName,
  updateMediaSchema,
  uuidSchema,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { buildBlobPathname, blobPathBelongsToTenant } from '../lib/blob.js';
import { clientIp, created, noContent, ok, parseJsonBody, parseParams, parseQuery } from '../lib/http.js';
import { countMediaReferences, describeUsage, findReferencedMediaIds } from '../lib/media-usage.js';
import { assertStorageAvailable, loadEffectivePlan, loadUsage } from '../lib/plan-limits.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { requireCapability, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Biblioteca de midia sobre o Vercel Blob.
 *
 * O arquivo e enviado para esta API, que valida sessao, empresa, tipo, tamanho
 * e limite de armazenamento antes de gravar. O token de escrita do Blob nunca
 * sai do servidor, e o caminho e sempre `tenants/<tenantId>/...`, de modo que
 * uma empresa nao consegue escrever nem apagar arquivos de outra.
 */

const mediaParams = z.object({ tenantId: uuidSchema, mediaId: uuidSchema });

export function mediaRoutes() {
  const app = new Hono<AppBindings>();

  // --------------------------------------------------------------- uso
  app.get('/:tenantId/media/usage', requireCapability('media:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const [plan, usage] = await Promise.all([
      loadEffectivePlan(ctx.db, tenant.tenantId),
      loadUsage(ctx.db, tenant.tenantId),
    ]);

    return ok(c, {
      storageBytes: usage.storageBytes,
      storageLimitBytes: plan.limits.storageBytes,
      storageLabel: `${formatBytes(usage.storageBytes)} de ${formatBytes(plan.limits.storageBytes)}`,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      blobConfigured: ctx.blob.configured,
    });
  });

  // ---------------------------------------------------------- listagem
  app.get('/:tenantId/media', requireCapability('media:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const query = parseQuery(c, mediaQuerySchema);

    const conditions = [eq(schema.mediaAssets.tenantId, tenant.tenantId)];
    if (query.search) {
      conditions.push(ilike(schema.mediaAssets.fileName, `%${query.search}%`));
    }
    if (query.kind) conditions.push(eq(schema.mediaAssets.kind, query.kind));
    if (query.tag) conditions.push(eq(schema.mediaAssets.tag, query.tag));
    const where = and(...conditions);

    const rows = await ctx.db
      .select()
      .from(schema.mediaAssets)
      .where(where)
      .orderBy(desc(schema.mediaAssets.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totals] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.mediaAssets)
      .where(where);

    let items = rows;
    if (query.unusedOnly) {
      const referenced = await findReferencedMediaIds(ctx.db, tenant.tenantId, rows.map((r) => r.id));
      items = rows.filter((row) => !referenced.has(row.id));
    }

    const tags = await ctx.db
      .selectDistinct({ tag: schema.mediaAssets.tag })
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.tenantId, tenant.tenantId));

    return ok(c, {
      ...paginate(items, totals?.total ?? 0, query),
      tags: tags.map((t) => t.tag).filter((t) => t.length > 0).sort(),
    });
  });

  // ------------------------------------------------------------ upload
  app.post('/:tenantId/media', requireCapability('media:upload'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);

    if (!ctx.blob.configured) {
      throw AppError.notConfigured(
        'O envio de arquivos depende da configuracao do Vercel Blob. Defina BLOB_READ_WRITE_TOKEN '
          + 'no ambiente para habilitar a biblioteca de midia.',
      );
    }

    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.upload,
      rateLimitSubjectFromIp(clientIp(c), ctx.env.AUTH_SECRET),
      ctx.now(),
    );

    const form = await c.req.formData().catch(() => {
      throw AppError.badRequest('Envie o arquivo como multipart/form-data no campo "file".');
    });

    const file = form.get('file');
    if (!(file instanceof File)) {
      throw AppError.badRequest('Nenhum arquivo recebido no campo "file".');
    }

    const mimeType = file.type;
    if (!isAllowedMimeType(mimeType)) {
      throw new AppError(
        'unsupported_media_type',
        'Tipo de arquivo nao permitido. Aceitamos JPG, PNG, WEBP, AVIF, SVG, GIF e PDF.',
        { received: mimeType },
      );
    }
    if (file.size <= 0) throw AppError.badRequest('O arquivo esta vazio.');
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError(
        'payload_too_large',
        `O arquivo tem ${formatBytes(file.size)}. O limite por arquivo e ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      );
    }

    const plan = await loadEffectivePlan(ctx.db, tenant.tenantId);
    await assertStorageAvailable(ctx.db, tenant.tenantId, file.size, plan);

    const alt = String(form.get('alt') ?? '').slice(0, 240);
    const title = String(form.get('title') ?? '').slice(0, 160);
    const tag = String(form.get('tag') ?? '').slice(0, 60);
    const width = toPositiveInt(form.get('width'));
    const height = toPositiveInt(form.get('height'));

    const fileName = safeFileName(file.name || 'arquivo', mimeType);
    const buffer = new Uint8Array(await file.arrayBuffer());

    const stored = await ctx.blob.put({
      pathname: buildBlobPathname(tenant.tenantId, fileName),
      body: buffer,
      contentType: mimeType,
    });

    const [row] = await ctx.db
      .insert(schema.mediaAssets)
      .values({
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        blobUrl: stored.url,
        blobPathname: stored.pathname,
        downloadUrl: stored.downloadUrl,
        fileName,
        mimeType,
        kind: mediaKindFor(mimeType),
        sizeBytes: file.size,
        width,
        height,
        alt,
        title,
        tag,
        uploadedByUserId: session.user.id,
      })
      .returning();

    if (!row) {
      // Evita arquivo orfao no Blob quando o registro no banco falha.
      await ctx.blob.remove(stored.url).catch(() => undefined);
      throw AppError.internal('Nao foi possivel registrar o arquivo enviado.');
    }

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.mediaUploaded,
      entityType: 'media_asset',
      entityId: row.id,
      metadata: { fileName, mimeType, sizeBytes: file.size },
    });

    return created(c, { asset: row });
  });

  // ------------------------------------------------------- texto alternativo
  app.patch('/:tenantId/media/:mediaId', requireCapability('media:upload'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { mediaId } = parseParams(c, mediaParams);
    const input = await parseJsonBody(c, updateMediaSchema);

    const [row] = await ctx.db
      .update(schema.mediaAssets)
      .set({ ...input, updatedAt: ctx.now() })
      .where(and(eq(schema.mediaAssets.id, mediaId), eq(schema.mediaAssets.tenantId, tenant.tenantId)))
      .returning();
    if (!row) throw AppError.notFound('Arquivo nao encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.mediaUpdated,
      entityType: 'media_asset',
      entityId: mediaId,
      metadata: {},
    });

    return ok(c, { asset: row });
  });

  // ----------------------------------------------- referencias do arquivo
  app.get('/:tenantId/media/:mediaId/usage', requireCapability('media:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { mediaId } = parseParams(c, mediaParams);

    const [row] = await ctx.db
      .select({ id: schema.mediaAssets.id })
      .from(schema.mediaAssets)
      .where(and(eq(schema.mediaAssets.id, mediaId), eq(schema.mediaAssets.tenantId, tenant.tenantId)));
    if (!row) throw AppError.notFound('Arquivo nao encontrado.');

    const usage = await countMediaReferences(ctx.db, tenant.tenantId, mediaId);
    return ok(c, { usage, description: describeUsage(usage) });
  });

  // ---------------------------------------------------------- exclusao
  app.delete('/:tenantId/media/:mediaId', requireCapability('media:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { mediaId } = parseParams(c, mediaParams);

    const [row] = await ctx.db
      .select()
      .from(schema.mediaAssets)
      .where(and(eq(schema.mediaAssets.id, mediaId), eq(schema.mediaAssets.tenantId, tenant.tenantId)));
    if (!row) throw AppError.notFound('Arquivo nao encontrado.');

    // Segunda barreira: o caminho no Blob precisa pertencer a esta empresa.
    if (!blobPathBelongsToTenant(row.blobPathname, tenant.tenantId)) {
      throw AppError.forbidden('Este arquivo nao pertence ao espaco de armazenamento desta empresa.');
    }

    const usage = await countMediaReferences(ctx.db, tenant.tenantId, mediaId);
    if (usage.total > 0) {
      throw AppError.conflict(
        `Este arquivo esta em uso em ${describeUsage(usage).join(', ')}. `
          + 'Remova as referencias antes de excluir o arquivo.',
        { usage },
      );
    }

    // Remove primeiro do banco: se a remocao no Blob falhar, o arquivo fica
    // inacessivel pela aplicacao e pode ser recolhido depois.
    await ctx.db
      .delete(schema.mediaAssets)
      .where(and(eq(schema.mediaAssets.id, mediaId), eq(schema.mediaAssets.tenantId, tenant.tenantId)));

    try {
      await ctx.blob.remove(row.blobUrl);
    } catch (error) {
      console.error(
        '[media] falha ao remover do Blob',
        row.blobPathname,
        error instanceof Error ? error.message : error,
      );
    }

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.mediaDeleted,
      entityType: 'media_asset',
      entityId: mediaId,
      metadata: { fileName: row.fileName, sizeBytes: row.sizeBytes },
    });

    return noContent(c);
  });

  return app;
}

function toPositiveInt(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 100_000 ? parsed : null;
}
