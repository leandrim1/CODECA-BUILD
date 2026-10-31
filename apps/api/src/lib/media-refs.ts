import { and, asc, eq, inArray, schema, type Database } from '@codeca/database';
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

/**
 * Onde cada tipo de conteudo guarda a lista ordenada de imagens.
 *
 * Tabela em vez de uma cadeia de `if`: eram tres alvos com o mesmo corpo
 * repetido, e produtos e galerias levariam a cinco. Acrescentar um alvo passa
 * a ser uma entrada aqui.
 */
const GALLERY_TARGETS = {
  property: { table: schema.propertyImages, owner: schema.propertyImages.propertyId },
  project: { table: schema.projectImages, owner: schema.projectImages.projectId },
  projectUpdate: {
    table: schema.projectUpdateImages,
    owner: schema.projectUpdateImages.projectUpdateId,
  },
  product: { table: schema.productImages, owner: schema.productImages.productId },
  gallery: { table: schema.galleryImages, owner: schema.galleryImages.galleryId },
} as const;

export type GalleryTarget = keyof typeof GALLERY_TARGETS;

/** Nome da coluna que aponta para o dono, para montar o `INSERT`. */
const OWNER_COLUMN: Record<GalleryTarget, string> = {
  property: 'propertyId',
  project: 'projectId',
  projectUpdate: 'projectUpdateId',
  product: 'productId',
  gallery: 'galleryId',
};

/**
 * Substitui a galeria de um conteudo mantendo a ordem informada.
 *
 * Apaga e reinsere em vez de aplicar diferencas: a ordem e o proprio dado, e
 * calcular movimentacoes daria o mesmo resultado por um caminho mais longo.
 */
export async function syncGallery(
  db: Database,
  target: GalleryTarget,
  input: { tenantId: string; entityId: string; mediaIds: string[] },
): Promise<void> {
  await assertMediaBelongsToTenant(db, input.tenantId, input.mediaIds);

  const alvo = GALLERY_TARGETS[target];
  const coluna = OWNER_COLUMN[target];

  await db
    .delete(alvo.table)
    .where(and(eq(alvo.owner, input.entityId), eq(alvo.table.tenantId, input.tenantId)));

  if (input.mediaIds.length === 0) return;

  await db.insert(alvo.table).values(
    input.mediaIds.map((mediaAssetId, index) => ({
      tenantId: input.tenantId,
      [coluna]: input.entityId,
      mediaAssetId,
      sortOrder: index,
    })),
  );
}

/** Ids das imagens de um conteudo, na ordem definida pelo cliente. */
export async function loadGalleryIds(
  db: Database,
  target: GalleryTarget,
  tenantId: string,
  entityId: string,
): Promise<string[]> {
  const alvo = GALLERY_TARGETS[target];
  const rows = await db
    .select({ mediaAssetId: alvo.table.mediaAssetId })
    .from(alvo.table)
    .where(and(eq(alvo.table.tenantId, tenantId), eq(alvo.owner, entityId)))
    .orderBy(asc(alvo.table.sortOrder));
  return rows.map((row) => row.mediaAssetId);
}

export interface MediaRef {
  id: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

/**
 * Carrega as imagens de varias galerias de uma vez, na ordem do cliente.
 *
 * Uma consulta para todos os donos, nao uma por registro: a listagem do painel
 * mostra dezenas de itens, e uma consulta por item e o caminho mais curto para
 * uma tela lenta.
 */
export async function loadGallery(
  db: Database,
  target: GalleryTarget,
  input: { tenantId: string; entityIds: string[] },
): Promise<Map<string, MediaRef[]>> {
  const result = new Map<string, MediaRef[]>();
  if (input.entityIds.length === 0) return result;

  const alvo = GALLERY_TARGETS[target];
  const rows = await db
    .select({
      id: schema.mediaAssets.id,
      url: schema.mediaAssets.blobUrl,
      alt: schema.mediaAssets.alt,
      width: schema.mediaAssets.width,
      height: schema.mediaAssets.height,
      entityId: alvo.owner,
      sortOrder: alvo.table.sortOrder,
    })
    .from(alvo.table)
    .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, alvo.table.mediaAssetId))
    .where(and(eq(alvo.table.tenantId, input.tenantId), inArray(alvo.owner, input.entityIds)))
    .orderBy(asc(alvo.table.sortOrder));

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
