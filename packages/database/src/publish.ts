import { AppError, coercePageLayout, collectMediaIds, parsePageLayout, type PageLayout } from '@codeca/shared';
import { and, eq, inArray, max, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { mediaAssets, pageVersions, pages, siteSettings } from './schema.js';

/**
 * Publicacao de pagina.
 *
 * Tudo acontece em uma transacao: a estrutura e revalidada, as referencias de
 * midia sao conferidas contra a biblioteca da propria empresa, a nova versao e
 * criada e o contador de versao do site e incrementado para invalidar o cache.
 */

export interface PublishPageResult {
  versionId: string;
  version: number;
  siteVersion: number;
  publishedAt: Date;
}

export async function publishPage(
  db: Database,
  input: { tenantId: string; pageId: string; userId: string | null; note?: string; layout?: PageLayout },
): Promise<PublishPageResult> {
  return db.transaction(async (tx) => {
    const [page] = await tx
      .select()
      .from(pages)
      .where(and(eq(pages.id, input.pageId), eq(pages.tenantId, input.tenantId)))
      .for('update');

    if (!page) throw AppError.notFound('Pagina nao encontrada.');

    const candidate = input.layout ?? page.draftLayout;
    const parsed = parsePageLayout(candidate);
    if (!parsed.ok) {
      throw AppError.validation('A estrutura da pagina contem secoes invalidas e nao pode ser publicada.', {
        issues: parsed.issues,
      });
    }
    const layout = parsed.layout;

    // Referencias de midia devem existir e pertencer a esta empresa.
    const mediaIds = collectMediaIds(layout);
    if (mediaIds.length > 0) {
      const found = await tx
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.tenantId, input.tenantId), inArray(mediaAssets.id, mediaIds)));
      const foundIds = new Set(found.map((row) => row.id));
      const missing = mediaIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw AppError.validation(
          'A pagina referencia imagens que nao existem mais na biblioteca de midia. Atualize as secoes antes de publicar.',
          { missingMediaIds: missing },
        );
      }
    }

    const [{ value: currentMax } = { value: null }] = await tx
      .select({ value: max(pageVersions.version) })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, input.pageId));

    const version = (currentMax ?? 0) + 1;
    const publishedAt = new Date();

    const [created] = await tx
      .insert(pageVersions)
      .values({
        tenantId: input.tenantId,
        pageId: input.pageId,
        version,
        layout,
        note: input.note ?? '',
        publishedByUserId: input.userId,
      })
      .returning({ id: pageVersions.id });

    if (!created) throw AppError.internal('Nao foi possivel registrar a versao publicada.');

    await tx
      .update(pages)
      .set({
        publishedVersionId: created.id,
        status: 'published',
        publishedAt,
        publishedByUserId: input.userId,
        draftLayout: layout,
        updatedAt: publishedAt,
      })
      .where(and(eq(pages.id, input.pageId), eq(pages.tenantId, input.tenantId)));

    const [settings] = await tx
      .update(siteSettings)
      .set({
        publishedVersion: sql`${siteSettings.publishedVersion} + 1`,
        lastPublishedAt: publishedAt,
        updatedAt: publishedAt,
      })
      .where(eq(siteSettings.tenantId, input.tenantId))
      .returning({ publishedVersion: siteSettings.publishedVersion });

    return {
      versionId: created.id,
      version,
      siteVersion: settings?.publishedVersion ?? 0,
      publishedAt,
    };
  });
}

/**
 * Restaura uma versao anterior como rascunho e, opcionalmente, publica-a.
 * A versao antiga nunca e apagada: uma nova entrada e criada no historico.
 */
export async function restorePageVersion(
  db: Database,
  input: { tenantId: string; pageId: string; versionId: string; userId: string | null; publish: boolean },
): Promise<{ layout: PageLayout; published: PublishPageResult | null }> {
  const [version] = await db
    .select()
    .from(pageVersions)
    .where(
      and(
        eq(pageVersions.id, input.versionId),
        eq(pageVersions.pageId, input.pageId),
        eq(pageVersions.tenantId, input.tenantId),
      ),
    );

  if (!version) throw AppError.notFound('Versao nao encontrada para esta pagina.');

  const layout = coercePageLayout(version.layout);

  await db
    .update(pages)
    .set({
      draftLayout: layout,
      draftRevision: sql`${pages.draftRevision} + 1`,
      draftUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(pages.id, input.pageId), eq(pages.tenantId, input.tenantId)));

  if (!input.publish) return { layout, published: null };

  const published = await publishPage(db, {
    tenantId: input.tenantId,
    pageId: input.pageId,
    userId: input.userId,
    note: `Restauracao da versao ${version.version}`,
    layout,
  });
  return { layout, published };
}

/** Marca o site como alterado para que o cache publico seja invalidado. */
export async function bumpSiteVersion(db: Database, tenantId: string): Promise<number> {
  const [row] = await db
    .update(siteSettings)
    .set({ publishedVersion: sql`${siteSettings.publishedVersion} + 1`, updatedAt: new Date() })
    .where(eq(siteSettings.tenantId, tenantId))
    .returning({ publishedVersion: siteSettings.publishedVersion });
  return row?.publishedVersion ?? 0;
}
