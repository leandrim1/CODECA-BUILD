import { and, eq, inArray, schema, type Database } from '@codeca/database';
import { AppError } from '@codeca/shared';

/**
 * Vinculo entre conteudos e a biblioteca de midia.
 *
 * Toda imagem referenciada e conferida contra `media_assets` da propria
 * empresa. Se um identificador apontar para o arquivo de outra construtora, a
 * operacao falha com 404 -- sem revelar que o arquivo existe em outro lugar.
 */

export async function assertMediaBelongsToTenant(
  db: Database,
  tenantId: string,
  mediaIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = [...new Set(mediaIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return;

  const rows = await db
    .select({ id: schema.mediaAssets.id })
    .from(schema.mediaAssets)
    .where(and(eq(schema.mediaAssets.tenantId, tenantId), inArray(schema.mediaAssets.id, ids)));

  if (rows.length !== ids.length) {
    throw AppError.notFound('Uma ou mais imagens informadas nao estao na biblioteca desta empresa.');
  }
}

type GalleryTarget = 'property' | 'project' | 'projectUpdate';

/** Substitui a galeria de um conteudo mantendo a ordem informada. */
export async function syncGallery(
  db: Database,
  target: GalleryTarget,
  input: { tenantId: string; entityId: string; mediaIds: string[] },
): Promise<void> {
  await assertMediaBelongsToTenant(db, input.tenantId, input.mediaIds);

  if (target === 'property') {
    await db
      .delete(schema.propertyImages)
      .where(
        and(
          eq(schema.propertyImages.propertyId, input.entityId),
          eq(schema.propertyImages.tenantId, input.tenantId),
        ),
      );
    if (input.mediaIds.length > 0) {
      await db.insert(schema.propertyImages).values(
        input.mediaIds.map((mediaAssetId, index) => ({
          tenantId: input.tenantId,
          propertyId: input.entityId,
          mediaAssetId,
          sortOrder: index,
        })),
      );
    }
    return;
  }

  if (target === 'project') {
    await db
      .delete(schema.projectImages)
      .where(
        and(
          eq(schema.projectImages.projectId, input.entityId),
          eq(schema.projectImages.tenantId, input.tenantId),
        ),
      );
    if (input.mediaIds.length > 0) {
      await db.insert(schema.projectImages).values(
        input.mediaIds.map((mediaAssetId, index) => ({
          tenantId: input.tenantId,
          projectId: input.entityId,
          mediaAssetId,
          sortOrder: index,
        })),
      );
    }
    return;
  }

  await db
    .delete(schema.projectUpdateImages)
    .where(
      and(
        eq(schema.projectUpdateImages.projectUpdateId, input.entityId),
        eq(schema.projectUpdateImages.tenantId, input.tenantId),
      ),
    );
  if (input.mediaIds.length > 0) {
    await db.insert(schema.projectUpdateImages).values(
      input.mediaIds.map((mediaAssetId, index) => ({
        tenantId: input.tenantId,
        projectUpdateId: input.entityId,
        mediaAssetId,
        sortOrder: index,
      })),
    );
  }
}

export interface MediaRef {
  id: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/** Carrega as imagens de uma galeria na ordem definida pelo usuario. */
export async function loadGallery(
  db: Database,
  target: GalleryTarget,
  input: { tenantId: string; entityIds: string[] },
): Promise<Map<string, MediaRef[]>> {
  const result = new Map<string, MediaRef[]>();
  if (input.entityIds.length === 0) return result;

  const selectFields = {
    id: schema.mediaAssets.id,
    url: schema.mediaAssets.blobUrl,
    alt: schema.mediaAssets.alt,
    width: schema.mediaAssets.width,
    height: schema.mediaAssets.height,
  };

  if (target === 'property') {
    const rows = await db
      .select({ ...selectFields, entityId: schema.propertyImages.propertyId, sortOrder: schema.propertyImages.sortOrder })
      .from(schema.propertyImages)
      .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.propertyImages.mediaAssetId))
      .where(
        and(
          eq(schema.propertyImages.tenantId, input.tenantId),
          inArray(schema.propertyImages.propertyId, input.entityIds),
        ),
      )
      .orderBy(schema.propertyImages.sortOrder);
    group(rows, result);
    return result;
  }

  if (target === 'project') {
    const rows = await db
      .select({ ...selectFields, entityId: schema.projectImages.projectId, sortOrder: schema.projectImages.sortOrder })
      .from(schema.projectImages)
      .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.projectImages.mediaAssetId))
      .where(
        and(
          eq(schema.projectImages.tenantId, input.tenantId),
          inArray(schema.projectImages.projectId, input.entityIds),
        ),
      )
      .orderBy(schema.projectImages.sortOrder);
    group(rows, result);
    return result;
  }

  const rows = await db
    .select({
      ...selectFields,
      entityId: schema.projectUpdateImages.projectUpdateId,
      sortOrder: schema.projectUpdateImages.sortOrder,
    })
    .from(schema.projectUpdateImages)
    .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.projectUpdateImages.mediaAssetId))
    .where(
      and(
        eq(schema.projectUpdateImages.tenantId, input.tenantId),
        inArray(schema.projectUpdateImages.projectUpdateId, input.entityIds),
      ),
    )
    .orderBy(schema.projectUpdateImages.sortOrder);
  group(rows, result);
  return result;
}

function group(
  rows: Array<MediaRef & { entityId: string; sortOrder: number }>,
  target: Map<string, MediaRef[]>,
): void {
  for (const row of rows) {
    const list = target.get(row.entityId) ?? [];
    list.push({ id: row.id, url: row.url, alt: row.alt, width: row.width, height: row.height });
    target.set(row.entityId, list);
  }
}

/** Carrega a imagem de capa de varios conteudos de uma vez. */
export async function loadMediaByIds(
  db: Database,
  tenantId: string,
  ids: Array<string | null>,
): Promise<Map<string, MediaRef>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const map = new Map<string, MediaRef>();
  if (unique.length === 0) return map;

  const rows = await db
    .select({
      id: schema.mediaAssets.id,
      url: schema.mediaAssets.blobUrl,
      alt: schema.mediaAssets.alt,
      width: schema.mediaAssets.width,
      height: schema.mediaAssets.height,
    })
    .from(schema.mediaAssets)
    .where(and(eq(schema.mediaAssets.tenantId, tenantId), inArray(schema.mediaAssets.id, unique)));

  for (const row of rows) map.set(row.id, row);
  return map;
}
