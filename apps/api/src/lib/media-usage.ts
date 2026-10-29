import { and, eq, schema, sql, type Database } from '@codeca/database';

/**
 * Referencias ativas de um arquivo de midia.
 *
 * Usado para impedir a exclusao de arquivos em uso e para listar os arquivos
 * que podem ser removidos com seguranca. As paginas guardam o layout como JSON,
 * por isso a busca por `mediaId` nelas e textual.
 */

export interface MediaUsage {
  propertyCovers: number;
  propertyGalleries: number;
  projectCovers: number;
  projectGalleries: number;
  projectUpdates: number;
  services: number;
  testimonials: number;
  teamMembers: number;
  pages: number;
  total: number;
}

export async function countMediaReferences(
  db: Database,
  tenantId: string,
  mediaId: string,
): Promise<MediaUsage> {
  const countOf = sql<number>`cast(count(*) as int)`;
  const needle = `%"mediaId":"${mediaId}"%`;

  const [propertyCovers] = await db
    .select({ value: countOf })
    .from(schema.properties)
    .where(and(eq(schema.properties.tenantId, tenantId), eq(schema.properties.coverImageId, mediaId)));

  const [propertyGalleries] = await db
    .select({ value: countOf })
    .from(schema.propertyImages)
    .where(
      and(eq(schema.propertyImages.tenantId, tenantId), eq(schema.propertyImages.mediaAssetId, mediaId)),
    );

  const [projectCovers] = await db
    .select({ value: countOf })
    .from(schema.projects)
    .where(and(eq(schema.projects.tenantId, tenantId), eq(schema.projects.coverImageId, mediaId)));

  const [projectGalleries] = await db
    .select({ value: countOf })
    .from(schema.projectImages)
    .where(
      and(eq(schema.projectImages.tenantId, tenantId), eq(schema.projectImages.mediaAssetId, mediaId)),
    );

  const [projectUpdates] = await db
    .select({ value: countOf })
    .from(schema.projectUpdateImages)
    .where(
      and(
        eq(schema.projectUpdateImages.tenantId, tenantId),
        eq(schema.projectUpdateImages.mediaAssetId, mediaId),
      ),
    );

  const [services] = await db
    .select({ value: countOf })
    .from(schema.services)
    .where(and(eq(schema.services.tenantId, tenantId), eq(schema.services.imageId, mediaId)));

  const [testimonials] = await db
    .select({ value: countOf })
    .from(schema.testimonials)
    .where(and(eq(schema.testimonials.tenantId, tenantId), eq(schema.testimonials.photoId, mediaId)));

  const [teamMembers] = await db
    .select({ value: countOf })
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.tenantId, tenantId), eq(schema.teamMembers.photoId, mediaId)));

  const [draftPages] = await db
    .select({ value: countOf })
    .from(schema.pages)
    .where(
      and(eq(schema.pages.tenantId, tenantId), sql`${schema.pages.draftLayout}::text like ${needle}`),
    );

  const [publishedPages] = await db
    .select({ value: countOf })
    .from(schema.pageVersions)
    .where(
      and(
        eq(schema.pageVersions.tenantId, tenantId),
        sql`${schema.pageVersions.layout}::text like ${needle}`,
      ),
    );

  const usage: MediaUsage = {
    propertyCovers: propertyCovers?.value ?? 0,
    propertyGalleries: propertyGalleries?.value ?? 0,
    projectCovers: projectCovers?.value ?? 0,
    projectGalleries: projectGalleries?.value ?? 0,
    projectUpdates: projectUpdates?.value ?? 0,
    services: services?.value ?? 0,
    testimonials: testimonials?.value ?? 0,
    teamMembers: teamMembers?.value ?? 0,
    pages: (draftPages?.value ?? 0) + (publishedPages?.value ?? 0),
    total: 0,
  };
  usage.total =
    usage.propertyCovers
    + usage.propertyGalleries
    + usage.projectCovers
    + usage.projectGalleries
    + usage.projectUpdates
    + usage.services
    + usage.testimonials
    + usage.teamMembers
    + usage.pages;
  return usage;
}

/** Ids de midia com ao menos uma referencia ativa, entre os informados. */
export async function findReferencedMediaIds(
  db: Database,
  tenantId: string,
  mediaIds: string[],
): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const id of mediaIds) {
    const usage = await countMediaReferences(db, tenantId, id);
    if (usage.total > 0) referenced.add(id);
  }
  return referenced;
}

export function describeUsage(usage: MediaUsage): string[] {
  const parts: string[] = [];
  if (usage.propertyCovers > 0) parts.push(`capa de ${usage.propertyCovers} imovel(is)`);
  if (usage.propertyGalleries > 0) parts.push(`galeria de ${usage.propertyGalleries} imovel(is)`);
  if (usage.projectCovers > 0) parts.push(`capa de ${usage.projectCovers} obra(s)`);
  if (usage.projectGalleries > 0) parts.push(`galeria de ${usage.projectGalleries} obra(s)`);
  if (usage.projectUpdates > 0) parts.push(`${usage.projectUpdates} registro(s) de evolucao`);
  if (usage.services > 0) parts.push(`${usage.services} servico(s)`);
  if (usage.testimonials > 0) parts.push(`${usage.testimonials} depoimento(s)`);
  if (usage.teamMembers > 0) parts.push(`${usage.teamMembers} integrante(s) da equipe`);
  if (usage.pages > 0) parts.push(`${usage.pages} pagina(s)`);
  return parts;
}
