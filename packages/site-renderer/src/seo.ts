import { truncate, type PublicSiteData } from '@codeca/shared';

/**
 * Metadados de SEO e dados estruturados.
 *
 * Nada aqui e inventado: o titulo, a descricao e a imagem vem do que a empresa
 * cadastrou. Nao geramos avaliacoes, precos agregados nem estatisticas que a
 * construtora nao tenha informado.
 */

export interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  imageUrl: string;
  siteName: string;
  type: 'website' | 'article';
  googleSiteVerification: string;
}

function applyTemplate(template: string, value: string, fallback: string): string {
  if (!value) return fallback;
  if (!template || !template.includes('%s')) return value;
  return template.replace('%s', value);
}

export function buildSeoMeta(data: PublicSiteData): SeoMeta {
  const { seo, tenant, context } = data;
  const base = (seo.canonicalBaseUrl || context.origin).replace(/\/$/, '');
  const fallbackTitle = seo.defaultTitle || tenant.displayName;

  let title = fallbackTitle;
  let description = seo.defaultDescription || truncate(tenant.description, 160);
  let imageUrl = seo.shareImageUrl;
  let canonicalPath = context.path;
  let robots = seo.robots;
  let type: SeoMeta['type'] = 'website';

  if (context.routeKind === 'page' && data.page) {
    title = applyTemplate(seo.titleTemplate, data.page.seoTitle || data.page.title, fallbackTitle);
    if (data.page.isHome) title = seo.defaultTitle || tenant.displayName;
    description = data.page.seoDescription || description;
    imageUrl = data.page.seoImageUrl || imageUrl;
    if (data.page.canonicalUrl) canonicalPath = data.page.canonicalUrl;
    if (data.page.robots === 'noindex') robots = 'noindex';
  }

  if (context.routeKind === 'property' && data.property) {
    const property = data.property;
    title = applyTemplate(seo.titleTemplate, property.seoTitle || property.title, fallbackTitle);
    description =
      property.seoDescription
      || truncate(property.shortDescription || property.description, 160)
      || description;
    imageUrl = property.coverImage?.url || imageUrl;
    type = 'article';
  }

  if (context.routeKind === 'project' && data.project) {
    const project = data.project;
    title = applyTemplate(seo.titleTemplate, project.seoTitle || project.title, fallbackTitle);
    description =
      project.seoDescription || truncate(project.shortDescription || project.description, 160) || description;
    imageUrl = project.coverImage?.url || imageUrl;
    type = 'article';
  }

  if (context.routeKind === 'not_found' || context.preview) {
    robots = 'noindex';
  }

  const canonical = /^https?:\/\//i.test(canonicalPath)
    ? canonicalPath
    : `${base}${canonicalPath === '/' ? '/' : canonicalPath}`;

  return {
    title,
    description,
    canonical,
    robots: robots === 'noindex' ? 'noindex, nofollow' : 'index, follow',
    imageUrl,
    siteName: tenant.displayName,
    type,
    googleSiteVerification: seo.googleSiteVerification,
  };
}

/**
 * Dados estruturados (schema.org). Inclui somente campos realmente cadastrados.
 */
export function buildStructuredData(data: PublicSiteData): Array<Record<string, unknown>> {
  const { tenant, context, seo } = data;
  const base = (seo.canonicalBaseUrl || context.origin).replace(/\/$/, '');
  const graph: Array<Record<string, unknown>> = [];

  const organization: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'GeneralContractor',
    name: tenant.displayName,
    url: base,
  };
  if (tenant.legalName) organization.legalName = tenant.legalName;
  if (tenant.description) organization.description = truncate(tenant.description, 300);
  if (tenant.phone) organization.telephone = tenant.phone;
  if (tenant.email) organization.email = tenant.email;
  if (tenant.taxId) organization.taxID = tenant.taxId;
  if (tenant.foundedYear) organization.foundingDate = String(tenant.foundedYear);
  if (data.theme.logoUrl) organization.logo = data.theme.logoUrl;

  const socialLinks = Object.values(tenant.social).filter((url): url is string => Boolean(url));
  if (socialLinks.length > 0) organization.sameAs = socialLinks;

  const addressParts: Record<string, string> = {};
  if (tenant.address.showFullAddress && tenant.address.street) {
    addressParts.streetAddress = [tenant.address.street, tenant.address.number].filter(Boolean).join(', ');
  }
  if (tenant.address.city) addressParts.addressLocality = tenant.address.city;
  if (tenant.address.state) addressParts.addressRegion = tenant.address.state;
  if (tenant.address.showFullAddress && tenant.address.postalCode) {
    addressParts.postalCode = tenant.address.postalCode;
  }
  if (Object.keys(addressParts).length > 0) {
    organization.address = { '@type': 'PostalAddress', addressCountry: 'BR', ...addressParts };
  }
  graph.push(organization);

  if (context.routeKind === 'property' && data.property) {
    const property = data.property;
    const listing: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Residence',
      name: property.title,
      url: `${base}/imoveis/${property.slug}`,
    };
    if (property.description || property.shortDescription) {
      listing.description = truncate(property.description || property.shortDescription, 300);
    }
    if (property.coverImage?.url) listing.image = property.coverImage.url;
    if (property.builtAreaM2 !== null) {
      listing.floorSize = { '@type': 'QuantitativeValue', value: property.builtAreaM2, unitCode: 'MTK' };
    }
    if (property.bedrooms !== null) listing.numberOfRooms = property.bedrooms;
    const addressLocality: Record<string, string> = { '@type': 'PostalAddress', addressCountry: 'BR' };
    if (property.city) addressLocality.addressLocality = property.city;
    if (property.state) addressLocality.addressRegion = property.state;
    if (property.city || property.state) listing.address = addressLocality;

    // O preco so entra quando a empresa publicou um valor.
    if (property.price !== null && !property.priceOnRequest) {
      listing.offers = {
        '@type': 'Offer',
        price: property.price,
        priceCurrency: property.currency,
        availability:
          property.commercialStatus === 'disponivel'
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
      };
    }
    graph.push(listing);
  }

  if (context.routeKind === 'page' && data.page && data.faqs.length > 0) {
    const usesFaqBlock = data.page.layout.sections.some(
      (section) => section.type === 'faq' && section.visible,
    );
    if (usesFaqBlock) {
      graph.push({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: data.faqs.slice(0, 10).map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      });
    }
  }

  return graph;
}
