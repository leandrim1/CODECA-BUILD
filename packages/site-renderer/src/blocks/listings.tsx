import {
  PROPERTY_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  formatPrice,
  type PageSection,
  type PublicProject,
  type PublicProperty,
} from '@codeca/shared';
import { useSite, useWhatsApp } from '../context.js';
import { PropertyCard, PropertyFacts, ProjectCard, ServiceCard } from '../cards.js';
import {
  ButtonRow,
  Container,
  EmptyState,
  Picture,
  Prose,
  Section,
  SectionHeading,
} from '../primitives.js';

/** Grade de imoveis, imovel em destaque, obras e servicos. */

interface BlockProps {
  section: PageSection;
}

type Button = { label: string; href: string; variant: 'primary' | 'secondary' | 'accent' | 'outline' | 'ghost'; newTab: boolean };

/** Aplica os filtros configurados no bloco sobre os imoveis publicados. */
export function filterProperties(
  properties: readonly PublicProperty[],
  filter: {
    purpose: string[];
    types: string[];
    commercialStatus: string[];
    city: string;
    neighborhood: string;
    featuredOnly: boolean;
  },
): PublicProperty[] {
  return properties.filter((property) => {
    if (filter.purpose.length > 0 && !filter.purpose.includes(property.purpose)) return false;
    if (filter.types.length > 0 && !filter.types.includes(property.type)) return false;
    if (filter.commercialStatus.length > 0 && !filter.commercialStatus.includes(property.commercialStatus)) {
      return false;
    }
    if (filter.city && property.city.toLowerCase() !== filter.city.toLowerCase()) return false;
    if (filter.neighborhood && property.neighborhood.toLowerCase() !== filter.neighborhood.toLowerCase()) {
      return false;
    }
    if (filter.featuredOnly && !property.featured) return false;
    return true;
  });
}

function sortProperties(items: PublicProperty[], orderBy: string): PublicProperty[] {
  const copy = [...items];
  if (orderBy === 'price_asc') {
    return copy.sort((a, b) => (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY));
  }
  if (orderBy === 'price_desc') {
    return copy.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  }
  if (orderBy === 'recent') {
    return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return copy;
}

export function PropertyGridBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    title: string;
    subtitle: string;
    filter: Parameters<typeof filterProperties>[1];
    limit: number;
    columns: number;
    orderBy: string;
    showPrice: boolean;
    showLocation: boolean;
    showFeatures: boolean;
    showFilters: boolean;
    cardCtaLabel: string;
    showMoreButton: Button | null;
    emptyMessage: string;
  };

  const filtered = sortProperties(filterProperties(site.properties, props.filter), props.orderBy);
  const items = filtered.slice(0, props.limit);

  const cities = [...new Set(site.properties.map((p) => p.city).filter(Boolean))].sort();

  return (
    <Section section={section}>
      <Container>
        <SectionHeading title={props.title} subtitle={props.subtitle} />

        {/* Filtros como formulario GET: funcionam sem JavaScript. */}
        {props.showFilters && items.length > 0 ? (
          <form className="ct-form" method="get" style={{ marginBottom: '2rem' }}>
            <div className="ct-row" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
              <div className="ct-field">
                <label htmlFor={`${section.id}-tipo`}>Tipo</label>
                <select className="ct-select" id={`${section.id}-tipo`} name="tipo" defaultValue="">
                  <option value="">Todos</option>
                  {[...new Set(site.properties.map((p) => p.type))].map((type) => (
                    <option key={type} value={type}>
                      {PROPERTY_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ct-field">
                <label htmlFor={`${section.id}-finalidade`}>Finalidade</label>
                <select className="ct-select" id={`${section.id}-finalidade`} name="finalidade" defaultValue="">
                  <option value="">Todas</option>
                  {[...new Set(site.properties.map((p) => p.purpose))].map((purpose) => (
                    <option key={purpose} value={purpose}>
                      {PROPERTY_PURPOSE_LABELS[purpose]}
                    </option>
                  ))}
                </select>
              </div>
              {cities.length > 1 ? (
                <div className="ct-field">
                  <label htmlFor={`${section.id}-cidade`}>Cidade</label>
                  <select className="ct-select" id={`${section.id}-cidade`} name="cidade" defaultValue="">
                    <option value="">Todas</option>
                    {cities.map((city) => (
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="ct-field" style={{ alignSelf: 'end' }}>
                <button className="ct-btn ct-btn-primary" type="submit">
                  Filtrar
                </button>
              </div>
            </div>
          </form>
        ) : null}

        {items.length === 0 ? (
          <EmptyState message={props.emptyMessage} />
        ) : (
          <div className="ct-grid">
            {items.map((property) => (
              <PropertyCard
                key={property.id}
                property={property}
                showPrice={props.showPrice}
                showLocation={props.showLocation}
                showFeatures={props.showFeatures}
                ctaLabel={props.cardCtaLabel}
              />
            ))}
          </div>
        )}

        {props.showMoreButton ? <ButtonRow buttons={[props.showMoreButton]} /> : null}
      </Container>
    </Section>
  );
}

export function PropertyFeaturedBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    title: string;
    subtitle: string;
    selection: 'auto' | 'manual';
    propertyId: string | null;
    showGallery: boolean;
    showFeatures: boolean;
    showPrice: boolean;
    ctaLabel: string;
    whatsAppCta: boolean;
  };

  const property =
    (props.selection === 'manual' && props.propertyId
      ? site.properties.find((item) => item.id === props.propertyId)
      : null)
    ?? site.properties.find((item) => item.featured)
    ?? site.properties[0];

  const whatsapp = useWhatsApp(
    property
      ? {
          kind: 'property',
          title: property.title,
          reference: property.reference,
          price: props.showPrice ? formatPrice(property.price, property.currency, property.priceOnRequest) : null,
        }
      : { kind: 'generic' },
  );

  if (!property) {
    return (
      <Section section={section}>
        <Container>
          <SectionHeading title={props.title} subtitle={props.subtitle} />
          <EmptyState message="Nenhum imovel publicado para destacar." />
        </Container>
      </Section>
    );
  }

  const gallery = props.showGallery ? property.gallery.slice(0, 4) : [];

  return (
    <Section section={section}>
      <Container>
        <SectionHeading title={props.title} subtitle={props.subtitle} />
        <div className="ct-split">
          <div className="ct-split-media">
            <Picture
              image={property.coverImage}
              aspect="4/3"
              alt={property.coverImage?.alt || property.title}
              loading="eager"
            />
            {gallery.length > 0 ? (
              <div className="ct-gallery" style={{ ['--ct-cols' as string]: '4', marginTop: '.75rem' }}>
                {gallery.map((image, index) => (
                  <Picture key={index} image={image} aspect="1/1" />
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <div className="ct-chips">
              <span className="ct-chip">{PROPERTY_TYPE_LABELS[property.type]}</span>
              <span className="ct-chip">{PROPERTY_PURPOSE_LABELS[property.purpose]}</span>
            </div>
            <h3>{property.title}</h3>
            {property.addressLine ? <p className="ct-lead">{property.addressLine}</p> : null}
            {props.showPrice ? (
              <p className="ct-price" style={{ fontSize: '1.6rem' }}>
                {formatPrice(property.price, property.currency, property.priceOnRequest)}
              </p>
            ) : null}
            {props.showFeatures ? <PropertyFacts property={property} /> : null}
            {property.shortDescription ? <Prose text={property.shortDescription} /> : null}
            <div className="ct-actions">
              <a className="ct-btn ct-btn-primary" href={`/imoveis/${property.slug}`}>
                {props.ctaLabel}
              </a>
              {props.whatsAppCta && whatsapp ? (
                <a className="ct-btn ct-btn-outline" href={whatsapp} target="_blank" rel="noopener noreferrer">
                  Falar no WhatsApp
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

function filterProjects(
  projects: readonly PublicProject[],
  filter: { statuses: string[]; categories: string[] },
): PublicProject[] {
  return projects.filter((project) => {
    if (filter.statuses.length > 0 && !filter.statuses.includes(project.status)) return false;
    if (filter.categories.length > 0 && !filter.categories.includes(project.category)) return false;
    return true;
  });
}

export function ProjectsBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    title: string;
    subtitle: string;
    filter: { statuses: string[]; categories: string[] };
    limit: number;
    columns: number;
    showStage: boolean;
    showProgress: boolean;
    showLocation: boolean;
    showDates: boolean;
    cardCtaLabel: string;
    showMoreButton: Button | null;
    emptyMessage: string;
  };

  const items = filterProjects(site.projects, props.filter).slice(0, props.limit);

  return (
    <Section section={section}>
      <Container>
        <SectionHeading title={props.title} subtitle={props.subtitle} />
        {items.length === 0 ? (
          <EmptyState message={props.emptyMessage} />
        ) : (
          <div className="ct-grid">
            {items.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                showStage={props.showStage}
                showProgress={props.showProgress}
                showLocation={props.showLocation}
                showDates={props.showDates}
                ctaLabel={props.cardCtaLabel}
              />
            ))}
          </div>
        )}
        {props.showMoreButton ? <ButtonRow buttons={[props.showMoreButton]} /> : null}
      </Container>
    </Section>
  );
}

export function ServicesBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    title: string;
    subtitle: string;
    limit: number;
    columns: number;
    layout: 'cards' | 'list' | 'icons';
    showImage: boolean;
    showIcon: boolean;
    showCta: boolean;
    ctaLabel: string;
    emptyMessage: string;
  };

  const items = site.services.slice(0, props.limit);

  return (
    <Section section={section}>
      <Container>
        <SectionHeading title={props.title} subtitle={props.subtitle} />
        {items.length === 0 ? (
          <EmptyState message={props.emptyMessage} />
        ) : (
          <div className="ct-grid" style={props.layout === 'list' ? { ['--ct-cols' as string]: '1' } : undefined}>
            {items.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                layout={props.layout}
                showImage={props.showImage}
                showIcon={props.showIcon}
                showCta={props.showCta}
                ctaLabel={props.ctaLabel}
              />
            ))}
          </div>
        )}
      </Container>
    </Section>
  );
}
