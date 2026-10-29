import { and, asc, desc, eq, inArray, isNotNull, schema, type Database } from '@codeca/database';
import {
  coercePageLayout,
  formatPublicAddress,
  isPlatformHost,
  normalizeDomain,
  parseTheme,
  updateSeoSchema,
  updateSiteSectionsSchema,
  type PublicFaq,
  type PublicGalleryImage,
  type PublicImage,
  type PublicNavigationMenu,
  type PublicPage,
  type PublicProject,
  type PublicProperty,
  type PublicRouteKind,
  type PublicService,
  type PublicSiteData,
  type PublicTeamMember,
  type PublicTenant,
  type PublicTestimonial,
} from '@codeca/shared';
import type { Env } from '../env.js';
import { loadGallery, loadMediaByIds, type MediaRef } from './media-refs.js';

/**
 * Montagem dos dados do site publico.
 *
 * Pontos centrais:
 * - A empresa e identificada pelo dominio verificado e ativo da requisicao,
 *   nunca por um identificador vindo do navegador.
 * - Apenas conteudo publicado entra no resultado. Em modo de previa, a pagina
 *   usa o rascunho, mas as listas continuam mostrando so o que esta publicado.
 * - Nenhum dado de usuario, interessado, observacao interna, auditoria ou
 *   configuracao administrativa e incluido.
 */

const LIST_LIMITS = {
  properties: 60,
  projects: 40,
  services: 30,
  testimonials: 30,
  team: 30,
  faqs: 40,
  gallery: 60,
} as const;

export interface ResolvedHost {
  tenantId: string;
  hostname: string;
  /** `true` quando o host foi resolvido pelo slug em ambiente de desenvolvimento. */
  viaDevSlug: boolean;
}

/**
 * Resolve a empresa a partir do host.
 * Retorna null para hosts da plataforma ou dominios nao verificados.
 */
export async function resolveTenantByHost(
  db: Database,
  rawHost: string,
  options: { platformHosts: readonly string[]; allowDevSlug: boolean },
): Promise<ResolvedHost | null> {
  const host = rawHost.trim().toLowerCase().split(':')[0] ?? '';
  if (!host) return null;
  if (isPlatformHost(host, options.platformHosts)) return null;

  const normalized = normalizeDomain(host);
  if (normalized) {
    const [row] = await db
      .select({ tenantId: schema.domains.tenantId, hostname: schema.domains.hostname })
      .from(schema.domains)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.domains.tenantId))
      .where(
        and(
          eq(schema.domains.hostname, normalized),
          // Somente dominio verificado e ativo serve o site.
          eq(schema.domains.status, 'active'),
          // Empresa suspensa ou cancelada nao serve conteudo.
          inArray(schema.tenants.status, ['trialing', 'active']),
        ),
      );
    if (row) return { tenantId: row.tenantId, hostname: row.hostname, viaDevSlug: false };
  }

  // Em desenvolvimento, `<slug>.localhost` abre o site da empresa sem DNS.
  if (options.allowDevSlug && host.endsWith('.localhost')) {
    const slug = host.slice(0, -'.localhost'.length);
    const [row] = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug));
    if (row) return { tenantId: row.id, hostname: host, viaDevSlug: true };
  }

  return null;
}

export interface SiteRoute {
  kind: PublicRouteKind;
  slug: string;
}

/** Interpreta o caminho solicitado. */
export function parseSiteRoute(pathname: string): SiteRoute {
  const clean = pathname.split('?')[0]?.split('#')[0] ?? '/';
  const segments = clean.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) return { kind: 'page', slug: 'home' };

  const [first, second] = segments;
  if ((first === 'imoveis' || first === 'imovel') && second) {
    return { kind: 'property', slug: second };
  }
  if ((first === 'obras' || first === 'obra' || first === 'projetos') && second) {
    return { kind: 'project', slug: second };
  }
  if (segments.length === 1 && first) return { kind: 'page', slug: first };
  return { kind: 'not_found', slug: clean };
}

export interface RedirectMatch {
  toPath: string;
  statusCode: number;
}

export async function findRedirect(
  db: Database,
  tenantId: string,
  pathname: string,
): Promise<RedirectMatch | null> {
  const [row] = await db
    .select({ toPath: schema.redirects.toPath, statusCode: schema.redirects.statusCode })
    .from(schema.redirects)
    .where(
      and(
        eq(schema.redirects.tenantId, tenantId),
        eq(schema.redirects.fromPath, pathname),
        eq(schema.redirects.enabled, true),
      ),
    );
  return row ? { toPath: row.toPath, statusCode: row.statusCode } : null;
}

function toPublicImage(ref: MediaRef | null | undefined, fallbackAlt: string): PublicImage | null {
  if (!ref) return null;
  return { url: ref.url, alt: ref.alt || fallbackAlt, width: ref.width, height: ref.height };
}

export interface BuildSiteDataOptions {
  tenantId: string;
  origin: string;
  path: string;
  /** Usa o rascunho da pagina em vez da versao publicada. */
  preview?: boolean;
}

export async function buildPublicSiteData(
  db: Database,
  env: Env,
  options: BuildSiteDataOptions,
): Promise<PublicSiteData | null> {
  const { tenantId } = options;

  const [tenantRow] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  if (!tenantRow) return null;

  const [settingsRow] = await db
    .select()
    .from(schema.siteSettings)
    .where(eq(schema.siteSettings.tenantId, tenantId));

  const theme = parseTheme(settingsRow?.theme);
  const sections = updateSiteSectionsSchema.parse(settingsRow?.sections ?? {});
  const seo = updateSeoSchema.parse(settingsRow?.seo ?? {});
  const siteVersion = String(settingsRow?.publishedVersion ?? 0);

  const tenant: PublicTenant = {
    id: tenantRow.id,
    slug: tenantRow.slug,
    displayName: tenantRow.displayName,
    legalName: tenantRow.legalName,
    description: tenantRow.description,
    taxId: tenantRow.taxId,
    foundedYear: tenantRow.foundedYear,
    creaNumber: tenantRow.creaNumber,
    email: tenantRow.contactEmail,
    phone: tenantRow.contactPhone,
    whatsapp: tenantRow.whatsapp,
    whatsappDefaultMessage: tenantRow.whatsappDefaultMessage,
    businessHours: tenantRow.businessHours,
    serviceArea: tenantRow.serviceArea,
    address: {
      street: tenantRow.address.showFullAddress ? tenantRow.address.street : '',
      number: tenantRow.address.showFullAddress ? tenantRow.address.number : '',
      complement: tenantRow.address.showFullAddress ? tenantRow.address.complement : '',
      neighborhood: tenantRow.address.neighborhood,
      city: tenantRow.address.city,
      state: tenantRow.address.state,
      postalCode: tenantRow.address.showFullAddress ? tenantRow.address.postalCode : '',
      showFullAddress: tenantRow.address.showFullAddress,
    },
    social: tenantRow.social,
  };

  const route = parseSiteRoute(options.path);

  // --------------------------------------------------------------- paginas
  const pageRows = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      title: schema.pages.title,
      isHome: schema.pages.isHome,
      status: schema.pages.status,
      seoTitle: schema.pages.seoTitle,
      seoDescription: schema.pages.seoDescription,
      seoImageUrl: schema.pages.seoImageUrl,
      canonicalUrl: schema.pages.canonicalUrl,
      robots: schema.pages.robots,
      showInNavigation: schema.pages.showInNavigation,
      sortOrder: schema.pages.sortOrder,
      publishedAt: schema.pages.publishedAt,
      publishedVersionId: schema.pages.publishedVersionId,
      draftLayout: schema.pages.draftLayout,
    })
    .from(schema.pages)
    .where(
      options.preview
        ? eq(schema.pages.tenantId, tenantId)
        : and(eq(schema.pages.tenantId, tenantId), isNotNull(schema.pages.publishedVersionId)),
    )
    .orderBy(asc(schema.pages.sortOrder), asc(schema.pages.title));

  let page: PublicPage | null = null;
  if (route.kind === 'page') {
    const match =
      route.slug === 'home'
        ? pageRows.find((row) => row.isHome) ?? pageRows.find((row) => row.slug === 'home')
        : pageRows.find((row) => row.slug === route.slug);

    if (match) {
      let layout = coercePageLayout({ schemaVersion: 1, sections: [] });
      if (options.preview) {
        layout = coercePageLayout(match.draftLayout);
      } else if (match.publishedVersionId) {
        const [version] = await db
          .select({ layout: schema.pageVersions.layout })
          .from(schema.pageVersions)
          .where(
            and(
              eq(schema.pageVersions.id, match.publishedVersionId),
              eq(schema.pageVersions.tenantId, tenantId),
            ),
          );
        layout = coercePageLayout(version?.layout);
      }
      page = {
        id: match.id,
        slug: match.slug,
        title: match.title,
        isHome: match.isHome,
        seoTitle: match.seoTitle,
        seoDescription: match.seoDescription,
        seoImageUrl: match.seoImageUrl,
        canonicalUrl: match.canonicalUrl,
        robots: match.robots as 'index' | 'noindex',
        layout,
        publishedAt: match.publishedAt ? match.publishedAt.toISOString() : null,
      };
    }
  }

  // ------------------------------------------------------------- navegacao
  const menuRows = await db
    .select()
    .from(schema.navigationMenus)
    .where(eq(schema.navigationMenus.tenantId, tenantId));

  const menus: PublicNavigationMenu[] = menuRows.map((row) => ({
    key: row.key,
    label: row.label,
    items: (row.items ?? []).map((item) => ({
      label: item.label,
      href: item.href,
      newTab: item.newTab,
      children: (item.children ?? []).map((child) => ({
        label: child.label,
        href: child.href,
        newTab: child.newTab,
      })),
    })),
  }));

  // --------------------------------------------------------------- imoveis
  const properties = sections.showProperties ? await loadProperties(db, tenantId) : [];
  const projects = sections.showProjects ? await loadProjects(db, tenantId) : [];
  const services = sections.showServices ? await loadServices(db, tenantId) : [];
  const testimonials = sections.showTestimonials ? await loadTestimonials(db, tenantId) : [];
  const team = sections.showTeam ? await loadTeam(db, tenantId) : [];
  const faqs = sections.showFaq ? await loadFaqs(db, tenantId) : [];
  const gallery = sections.showGallery ? await loadGalleryAssets(db, tenantId) : [];

  // ---------------------------------------------------- detalhe solicitado
  let property: PublicProperty | null = null;
  let project: PublicProject | null = null;
  let routeKind: PublicRouteKind = route.kind;

  if (route.kind === 'property') {
    property = properties.find((item) => item.slug === route.slug) ?? null;
    if (!property) {
      property = await loadSingleProperty(db, tenantId, route.slug);
    }
    if (!property) routeKind = 'not_found';
  }

  if (route.kind === 'project') {
    project = await loadSingleProject(db, tenantId, route.slug);
    if (!project) routeKind = 'not_found';
  }

  if (route.kind === 'page' && !page) routeKind = 'not_found';

  return {
    context: {
      origin: options.origin,
      path: options.path,
      routeKind,
      preview: options.preview ?? false,
      siteVersion,
    },
    tenant,
    theme,
    sections,
    seo,
    menus,
    pages: pageRows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      isHome: row.isHome,
    })),
    page,
    property,
    project,
    properties,
    projects,
    services,
    testimonials,
    team,
    faqs,
    gallery,
    showPlatformBadge: await shouldShowPlatformBadge(db, tenantId),
    platformName: env.PLATFORM_NAME,
    platformUrl: env.PLATFORM_URL,
  };
}

async function shouldShowPlatformBadge(db: Database, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ limits: schema.plans.limits, overrides: schema.tenants.limitOverrides })
    .from(schema.tenants)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
    .where(eq(schema.tenants.id, tenantId));
  if (!row) return true;
  const features = [...(row.limits.features ?? []), ...(row.overrides?.features ?? [])];
  return !features.includes('remove_platform_badge');
}

async function loadProperties(db: Database, tenantId: string): Promise<PublicProperty[]> {
  const rows = await db
    .select()
    .from(schema.properties)
    .where(
      and(eq(schema.properties.tenantId, tenantId), eq(schema.properties.publicationStatus, 'published')),
    )
    .orderBy(desc(schema.properties.featured), asc(schema.properties.sortOrder), desc(schema.properties.createdAt))
    .limit(LIST_LIMITS.properties);

  const covers = await loadMediaByIds(db, tenantId, rows.map((row) => row.coverImageId));
  const galleries = await loadGallery(db, 'property', { tenantId, entityIds: rows.map((row) => row.id) });

  return rows.map((row) => toPublicProperty(row, covers, galleries.get(row.id) ?? []));
}

async function loadSingleProperty(
  db: Database,
  tenantId: string,
  slug: string,
): Promise<PublicProperty | null> {
  const [row] = await db
    .select()
    .from(schema.properties)
    .where(
      and(
        eq(schema.properties.tenantId, tenantId),
        eq(schema.properties.slug, slug),
        eq(schema.properties.publicationStatus, 'published'),
      ),
    );
  if (!row) return null;
  const covers = await loadMediaByIds(db, tenantId, [row.coverImageId]);
  const galleries = await loadGallery(db, 'property', { tenantId, entityIds: [row.id] });
  return toPublicProperty(row, covers, galleries.get(row.id) ?? []);
}

function toPublicProperty(
  row: typeof schema.properties.$inferSelect,
  covers: Map<string, MediaRef>,
  gallery: MediaRef[],
): PublicProperty {
  const address = row.address;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    reference: row.reference,
    shortDescription: row.shortDescription,
    description: row.description,
    type: row.type,
    purpose: row.purpose,
    commercialStatus: row.commercialStatus,
    price: row.price,
    priceOnRequest: row.priceOnRequest,
    condoFee: row.condoFee,
    iptu: row.iptu,
    currency: row.currency,
    city: address.city,
    neighborhood: address.neighborhood,
    state: address.state,
    // Respeita a opcao da empresa de nao divulgar rua e numero.
    addressLine: formatPublicAddress(address),
    builtAreaM2: row.builtAreaM2,
    landAreaM2: row.landAreaM2,
    bedrooms: row.bedrooms,
    suites: row.suites,
    bathrooms: row.bathrooms,
    parkingSpots: row.parkingSpots,
    features: row.features,
    coverImage: toPublicImage(row.coverImageId ? covers.get(row.coverImageId) : null, row.title),
    gallery: gallery.map((item) => toPublicImage(item, row.title)).filter((i): i is PublicImage => i !== null),
    featured: row.featured,
    deliveryDate: row.deliveryDate,
    videoUrl: row.videoUrl,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadProjects(db: Database, tenantId: string): Promise<PublicProject[]> {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.tenantId, tenantId), eq(schema.projects.publicationStatus, 'published')))
    .orderBy(desc(schema.projects.featured), asc(schema.projects.sortOrder), desc(schema.projects.createdAt))
    .limit(LIST_LIMITS.projects);

  const covers = await loadMediaByIds(db, tenantId, rows.map((row) => row.coverImageId));
  const galleries = await loadGallery(db, 'project', { tenantId, entityIds: rows.map((row) => row.id) });

  return rows.map((row) => toPublicProject(row, covers, galleries.get(row.id) ?? [], []));
}

async function loadSingleProject(
  db: Database,
  tenantId: string,
  slug: string,
): Promise<PublicProject | null> {
  const [row] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.tenantId, tenantId),
        eq(schema.projects.slug, slug),
        eq(schema.projects.publicationStatus, 'published'),
      ),
    );
  if (!row) return null;

  const covers = await loadMediaByIds(db, tenantId, [row.coverImageId]);
  const galleries = await loadGallery(db, 'project', { tenantId, entityIds: [row.id] });

  const updateRows = await db
    .select()
    .from(schema.projectUpdates)
    .where(and(eq(schema.projectUpdates.projectId, row.id), eq(schema.projectUpdates.tenantId, tenantId)))
    .orderBy(desc(schema.projectUpdates.recordedAt), desc(schema.projectUpdates.createdAt))
    .limit(20);

  const updateImages = await loadGallery(db, 'projectUpdate', {
    tenantId,
    entityIds: updateRows.map((u) => u.id),
  });

  const updates = updateRows.map((update) => ({
    id: update.id,
    title: update.title,
    note: update.note,
    stage: update.stage,
    progressPercent: update.progressPercent,
    recordedAt: update.recordedAt,
    images: (updateImages.get(update.id) ?? [])
      .map((item) => toPublicImage(item, update.title))
      .filter((i): i is PublicImage => i !== null),
  }));

  return toPublicProject(row, covers, galleries.get(row.id) ?? [], updates);
}

function toPublicProject(
  row: typeof schema.projects.$inferSelect,
  covers: Map<string, MediaRef>,
  gallery: MediaRef[],
  updates: PublicProject['updates'],
): PublicProject {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    shortDescription: row.shortDescription,
    description: row.description,
    category: row.category,
    status: row.status,
    stage: row.stage,
    // Null quando a empresa nao informou: o site nao exibe barra de progresso.
    progressPercent: row.progressPercent,
    locationLabel: row.showLocation
      ? [row.neighborhood, [row.city, row.state].filter(Boolean).join(' - ')].filter(Boolean).join(', ')
      : '',
    startDate: row.startDate,
    expectedCompletionDate: row.expectedCompletionDate,
    completedDate: row.completedDate,
    coverImage: toPublicImage(row.coverImageId ? covers.get(row.coverImageId) : null, row.title),
    gallery: gallery.map((item) => toPublicImage(item, row.title)).filter((i): i is PublicImage => i !== null),
    updates,
    featured: row.featured,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadServices(db: Database, tenantId: string): Promise<PublicService[]> {
  const rows = await db
    .select()
    .from(schema.services)
    .where(and(eq(schema.services.tenantId, tenantId), eq(schema.services.publicationStatus, 'published')))
    .orderBy(asc(schema.services.sortOrder), asc(schema.services.title))
    .limit(LIST_LIMITS.services);

  const images = await loadMediaByIds(db, tenantId, rows.map((row) => row.imageId));

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    icon: row.icon,
    image: toPublicImage(row.imageId ? images.get(row.imageId) : null, row.title),
    highlights: row.highlights,
  }));
}

async function loadTestimonials(db: Database, tenantId: string): Promise<PublicTestimonial[]> {
  const rows = await db
    .select()
    .from(schema.testimonials)
    .where(
      and(
        eq(schema.testimonials.tenantId, tenantId),
        eq(schema.testimonials.publicationStatus, 'published'),
        // Sem autorizacao declarada do autor, o depoimento nao vai ao ar.
        eq(schema.testimonials.authorizationConfirmed, true),
      ),
    )
    .orderBy(asc(schema.testimonials.sortOrder), desc(schema.testimonials.createdAt))
    .limit(LIST_LIMITS.testimonials);

  const photos = await loadMediaByIds(db, tenantId, rows.map((row) => row.photoId));

  return rows.map((row) => ({
    id: row.id,
    authorName: row.authorName,
    authorRole: row.authorRole,
    content: row.content,
    rating: row.rating,
    photo: toPublicImage(row.photoId ? photos.get(row.photoId) : null, row.authorName),
  }));
}

async function loadTeam(db: Database, tenantId: string): Promise<PublicTeamMember[]> {
  const rows = await db
    .select()
    .from(schema.teamMembers)
    .where(
      and(eq(schema.teamMembers.tenantId, tenantId), eq(schema.teamMembers.publicationStatus, 'published')),
    )
    .orderBy(asc(schema.teamMembers.sortOrder), asc(schema.teamMembers.name))
    .limit(LIST_LIMITS.team);

  const photos = await loadMediaByIds(db, tenantId, rows.map((row) => row.photoId));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    bio: row.bio,
    photo: toPublicImage(row.photoId ? photos.get(row.photoId) : null, row.name),
    social: row.social,
  }));
}

async function loadFaqs(db: Database, tenantId: string): Promise<PublicFaq[]> {
  const rows = await db
    .select()
    .from(schema.faqs)
    .where(and(eq(schema.faqs.tenantId, tenantId), eq(schema.faqs.publicationStatus, 'published')))
    .orderBy(asc(schema.faqs.sortOrder), asc(schema.faqs.createdAt))
    .limit(LIST_LIMITS.faqs);

  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    category: row.category,
  }));
}

async function loadGalleryAssets(db: Database, tenantId: string): Promise<PublicGalleryImage[]> {
  const rows = await db
    .select({
      id: schema.mediaAssets.id,
      url: schema.mediaAssets.blobUrl,
      alt: schema.mediaAssets.alt,
      title: schema.mediaAssets.title,
      tag: schema.mediaAssets.tag,
      width: schema.mediaAssets.width,
      height: schema.mediaAssets.height,
    })
    .from(schema.mediaAssets)
    .where(and(eq(schema.mediaAssets.tenantId, tenantId), eq(schema.mediaAssets.kind, 'image')))
    .orderBy(desc(schema.mediaAssets.createdAt))
    .limit(LIST_LIMITS.gallery);

  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    alt: row.alt || row.title,
    title: row.title,
    tag: row.tag,
    width: row.width,
    height: row.height,
  }));
}

/** Lista de URLs publicadas, usada para montar o sitemap. */
export async function buildSitemapEntries(
  db: Database,
  tenantId: string,
  origin: string,
): Promise<Array<{ loc: string; lastmod: string }>> {
  const entries: Array<{ loc: string; lastmod: string }> = [];

  const pageRows = await db
    .select({
      slug: schema.pages.slug,
      isHome: schema.pages.isHome,
      publishedAt: schema.pages.publishedAt,
      updatedAt: schema.pages.updatedAt,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.tenantId, tenantId), isNotNull(schema.pages.publishedVersionId)));

  for (const row of pageRows) {
    entries.push({
      loc: row.isHome ? `${origin}/` : `${origin}/${row.slug}`,
      lastmod: (row.publishedAt ?? row.updatedAt).toISOString(),
    });
  }

  const propertyRows = await db
    .select({ slug: schema.properties.slug, updatedAt: schema.properties.updatedAt })
    .from(schema.properties)
    .where(
      and(eq(schema.properties.tenantId, tenantId), eq(schema.properties.publicationStatus, 'published')),
    );
  for (const row of propertyRows) {
    entries.push({ loc: `${origin}/imoveis/${row.slug}`, lastmod: row.updatedAt.toISOString() });
  }

  const projectRows = await db
    .select({ slug: schema.projects.slug, updatedAt: schema.projects.updatedAt })
    .from(schema.projects)
    .where(and(eq(schema.projects.tenantId, tenantId), eq(schema.projects.publicationStatus, 'published')));
  for (const row of projectRows) {
    entries.push({ loc: `${origin}/obras/${row.slug}`, lastmod: row.updatedAt.toISOString() });
  }

  return entries;
}
