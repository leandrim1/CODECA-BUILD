import { and, asc, eq, inArray, schema, type Database } from '@codeca/database';
import {
  publicAddress,
  type AddressInput,
  type PublicBanner,
  type PublicImage,
  type PublicProject,
  type PublicProperty,
  type PublicService,
} from '@codeca/shared';

/**
 * Conversao do registro interno para o formato publico.
 *
 * Nenhum destes mapeadores copia o objeto inteiro: cada campo entregue e
 * escrito a mao. E mais verboso que espalhar `...row`, e de proposito -- uma
 * coluna acrescentada ao banco amanha nao vaza sozinha para o site do cliente.
 */

type MediaRef = { id: string; url: string; alt: string; width: number | null; height: number | null };

function toImage(ref: MediaRef | undefined | null): PublicImage | null {
  if (!ref) return null;
  return { id: ref.id, url: ref.url, alt: ref.alt, width: ref.width, height: ref.height };
}

function toIsoDate(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function toPublicProperty(
  row: typeof schema.properties.$inferSelect,
  media: Map<string, MediaRef>,
  galleryIds: string[] = [],
): PublicProperty {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    reference: row.reference,
    description: row.description,
    shortDescription: row.shortDescription,
    type: row.type,
    purpose: row.purpose,
    price: row.price,
    priceOnRequest: row.priceOnRequest,
    condoFee: row.condoFee,
    iptu: row.iptu,
    currency: row.currency,
    // Respeita a escolha do cliente sobre divulgar o endereco completo.
    address: publicAddress(row.address as AddressInput),
    builtAreaM2: row.builtAreaM2,
    landAreaM2: row.landAreaM2,
    bedrooms: row.bedrooms,
    suites: row.suites,
    bathrooms: row.bathrooms,
    parkingSpots: row.parkingSpots,
    floor: row.floor,
    features: row.features ?? [],
    cover: toImage(row.coverImageId ? media.get(row.coverImageId) : null),
    gallery: galleryIds.map((id) => toImage(media.get(id))).filter((i): i is PublicImage => i !== null),
    commercialStatus: row.commercialStatus,
    featured: row.featured,
    deliveryDate: toIsoDate(row.deliveryDate),
    videoUrl: row.videoUrl,
    seo: { title: row.seoTitle, description: row.seoDescription },
    publishedAt: toIsoDate(row.publishedAt),
  };
}

export function toPublicProject(
  row: typeof schema.projects.$inferSelect,
  media: Map<string, MediaRef>,
  galleryIds: string[] = [],
): PublicProject {
  // `showLocation` desligado esconde a localizacao da obra, como no imovel.
  const mostrarLocal = row.showLocation;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    shortDescription: row.shortDescription,
    category: row.category,
    status: row.status,
    stage: row.stage,
    progressPercent: row.progressPercent,
    city: mostrarLocal ? row.city : '',
    state: mostrarLocal ? row.state : '',
    neighborhood: mostrarLocal ? row.neighborhood : '',
    startDate: toIsoDate(row.startDate),
    expectedCompletionDate: toIsoDate(row.expectedCompletionDate),
    completedDate: toIsoDate(row.completedDate),
    cover: toImage(row.coverImageId ? media.get(row.coverImageId) : null),
    gallery: galleryIds.map((id) => toImage(media.get(id))).filter((i): i is PublicImage => i !== null),
    featured: row.featured,
    seo: { title: row.seoTitle, description: row.seoDescription },
    publishedAt: toIsoDate(row.publishedAt),
  };
}

export function toPublicService(
  row: typeof schema.services.$inferSelect,
  media: Map<string, MediaRef>,
): PublicService {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    icon: row.icon,
    image: toImage(row.imageId ? media.get(row.imageId) : null),
    highlights: row.highlights ?? [],
    sortOrder: row.sortOrder,
    seo: { title: row.seoTitle, description: row.seoDescription },
  };
}

export function toPublicBanner(
  row: typeof schema.banners.$inferSelect,
  media: Map<string, MediaRef>,
): PublicBanner {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    image: toImage(row.imageId ? media.get(row.imageId) : null),
    buttonLabel: row.buttonLabel,
    buttonUrl: row.buttonUrl,
    sortOrder: row.sortOrder,
  };
}

/** Ids das imagens de galeria, na ordem definida pelo cliente. */
export async function loadGallery(
  db: Database,
  table: 'property' | 'project',
  tenantId: string,
  ownerId: string,
): Promise<string[]> {
  if (table === 'property') {
    const rows = await db
      .select({ mediaAssetId: schema.propertyImages.mediaAssetId })
      .from(schema.propertyImages)
      .where(
        and(
          eq(schema.propertyImages.tenantId, tenantId),
          eq(schema.propertyImages.propertyId, ownerId),
        ),
      )
      .orderBy(asc(schema.propertyImages.sortOrder));
    return rows.map((r) => r.mediaAssetId);
  }

  const rows = await db
    .select({ mediaAssetId: schema.projectImages.mediaAssetId })
    .from(schema.projectImages)
    .where(
      and(eq(schema.projectImages.tenantId, tenantId), eq(schema.projectImages.projectId, ownerId)),
    )
    .orderBy(asc(schema.projectImages.sortOrder));
  return rows.map((r) => r.mediaAssetId);
}

/** Carrega as imagens citadas, de uma vez, para evitar consulta por registro. */
export async function loadMedia(
  db: Database,
  tenantId: string,
  ids: Array<string | null>,
): Promise<Map<string, MediaRef>> {
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const mapa = new Map<string, MediaRef>();
  if (unicos.length === 0) return mapa;

  const rows = await db
    .select({
      id: schema.mediaAssets.id,
      url: schema.mediaAssets.blobUrl,
      alt: schema.mediaAssets.alt,
      width: schema.mediaAssets.width,
      height: schema.mediaAssets.height,
    })
    .from(schema.mediaAssets)
    .where(and(eq(schema.mediaAssets.tenantId, tenantId), inArray(schema.mediaAssets.id, unicos)));

  for (const row of rows) mapa.set(row.id, row);
  return mapa;
}
