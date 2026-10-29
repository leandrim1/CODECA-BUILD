import {
  PROJECT_STAGE_LABELS,
  PROJECT_STATUS_LABELS,
  PROPERTY_COMMERCIAL_STATUS_LABELS,
  PROPERTY_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  formatArea,
  formatIsoDate,
  formatPrice,
  truncate,
  type PublicProject,
  type PublicProperty,
  type PublicService,
  type PublicTeamMember,
  type PublicTestimonial,
} from '@codeca/shared';
import { BlockIcon, SOCIAL_ICONS, UI_ICONS } from './icons.js';
import { Fact, Picture, ProgressBar, Stars } from './primitives.js';

/** Cartoes reaproveitados pelos blocos de listagem e pelas paginas de detalhe. */

export function PropertyCard({
  property,
  showPrice = true,
  showLocation = true,
  showFeatures = true,
  ctaLabel = 'Ver detalhes',
}: {
  property: PublicProperty;
  showPrice?: boolean;
  showLocation?: boolean;
  showFeatures?: boolean;
  ctaLabel?: string;
}) {
  const href = `/imoveis/${property.slug}`;
  const sold = property.commercialStatus === 'vendido' || property.commercialStatus === 'alugado';

  return (
    <article className="ct-card">
      <a href={href} aria-label={property.title}>
        <Picture image={property.coverImage} aspect="4/3" alt={property.coverImage?.alt || property.title} />
      </a>
      <div className="ct-card-body">
        <div className="ct-chips">
          <span className="ct-chip">{PROPERTY_TYPE_LABELS[property.type]}</span>
          <span className="ct-chip">{PROPERTY_PURPOSE_LABELS[property.purpose]}</span>
          {property.commercialStatus !== 'disponivel' ? (
            <span className={sold ? 'ct-badge ct-badge-muted' : 'ct-badge'}>
              {PROPERTY_COMMERCIAL_STATUS_LABELS[property.commercialStatus]}
            </span>
          ) : null}
        </div>

        <h3 className="ct-card-title">
          <a href={href}>{property.title}</a>
        </h3>

        {showLocation && property.addressLine ? (
          <p className="ct-card-text">
            <UI_ICONS.location aria-hidden="true" style={{ display: 'inline', width: 14, height: 14, verticalAlign: '-2px' }} />{' '}
            {property.addressLine}
          </p>
        ) : null}

        {property.shortDescription ? (
          <p className="ct-card-text">{truncate(property.shortDescription, 120)}</p>
        ) : null}

        {showFeatures ? <PropertyFacts property={property} /> : null}

        <div className="ct-card-foot">
          {showPrice ? (
            <span className="ct-price">
              {formatPrice(property.price, property.currency, property.priceOnRequest)}
            </span>
          ) : (
            <span />
          )}
          <a className="ct-btn ct-btn-ghost" href={href}>
            {ctaLabel}
          </a>
        </div>
      </div>
    </article>
  );
}

export function PropertyFacts({ property }: { property: PublicProperty }) {
  const facts = [
    property.bedrooms !== null
      ? { icon: 'bedrooms' as const, text: `${property.bedrooms} dorm.` }
      : null,
    property.suites !== null && property.suites > 0
      ? { icon: 'bedrooms' as const, text: `${property.suites} suite(s)` }
      : null,
    property.bathrooms !== null
      ? { icon: 'bathrooms' as const, text: `${property.bathrooms} banho` }
      : null,
    property.parkingSpots !== null
      ? { icon: 'parking' as const, text: `${property.parkingSpots} vaga(s)` }
      : null,
    property.builtAreaM2 !== null
      ? { icon: 'area' as const, text: formatArea(property.builtAreaM2) }
      : null,
    property.landAreaM2 !== null
      ? { icon: 'landArea' as const, text: `terreno ${formatArea(property.landAreaM2)}` }
      : null,
  ].filter((fact): fact is { icon: 'bedrooms' | 'bathrooms' | 'parking' | 'area' | 'landArea'; text: string } =>
    fact !== null,
  );

  if (facts.length === 0) return null;
  return (
    <ul className="ct-facts">
      {facts.map((fact, index) => (
        <Fact key={index} icon={fact.icon}>
          {fact.text}
        </Fact>
      ))}
    </ul>
  );
}

export function ProjectCard({
  project,
  showStage = true,
  showProgress = true,
  showLocation = true,
  showDates = false,
  ctaLabel = 'Acompanhar obra',
}: {
  project: PublicProject;
  showStage?: boolean;
  showProgress?: boolean;
  showLocation?: boolean;
  showDates?: boolean;
  ctaLabel?: string;
}) {
  const href = `/obras/${project.slug}`;

  return (
    <article className="ct-card">
      <a href={href} aria-label={project.title}>
        <Picture image={project.coverImage} aspect="4/3" alt={project.coverImage?.alt || project.title} />
      </a>
      <div className="ct-card-body">
        <div className="ct-chips">
          <span className="ct-chip">{PROJECT_STATUS_LABELS[project.status]}</span>
          {showStage ? <span className="ct-chip">{PROJECT_STAGE_LABELS[project.stage]}</span> : null}
        </div>

        <h3 className="ct-card-title">
          <a href={href}>{project.title}</a>
        </h3>

        {showLocation && project.locationLabel ? (
          <p className="ct-card-text">{project.locationLabel}</p>
        ) : null}

        {project.shortDescription ? (
          <p className="ct-card-text">{truncate(project.shortDescription, 120)}</p>
        ) : null}

        {showDates && (project.startDate || project.expectedCompletionDate) ? (
          <ul className="ct-facts">
            {project.startDate ? (
              <Fact icon="calendar">Inicio em {formatIsoDate(project.startDate, 'month')}</Fact>
            ) : null}
            {project.expectedCompletionDate ? (
              <Fact icon="clock">Previsao {formatIsoDate(project.expectedCompletionDate, 'month')}</Fact>
            ) : null}
          </ul>
        ) : null}

        {/* O percentual aparece somente quando informado pela construtora. */}
        {showProgress ? <ProgressBar percent={project.progressPercent} /> : null}

        <div className="ct-card-foot">
          <span />
          <a className="ct-btn ct-btn-ghost" href={href}>
            {ctaLabel}
          </a>
        </div>
      </div>
    </article>
  );
}

export function ServiceCard({
  service,
  layout,
  showImage,
  showIcon,
  showCta,
  ctaLabel,
}: {
  service: PublicService;
  layout: 'cards' | 'list' | 'icons';
  showImage: boolean;
  showIcon: boolean;
  showCta: boolean;
  ctaLabel: string;
}) {
  const body = (
    <div className="ct-card-body">
      {(showIcon || layout === 'icons') && (
        <span className="ct-icon-box">
          <BlockIcon name={service.icon} />
        </span>
      )}
      <h3 className="ct-card-title">{service.title}</h3>
      {service.summary ? <p className="ct-card-text">{service.summary}</p> : null}
      {service.highlights.length > 0 ? (
        <ul className="ct-facts" style={{ flexDirection: 'column', gap: '.35rem' }}>
          {service.highlights.slice(0, 4).map((highlight, index) => (
            <Fact key={index} icon="arrow">
              {highlight}
            </Fact>
          ))}
        </ul>
      ) : null}
      {showCta ? (
        <div className="ct-card-foot">
          <span />
          <a className="ct-btn ct-btn-ghost" href="/contato">
            {ctaLabel}
          </a>
        </div>
      ) : null}
    </div>
  );

  if (layout === 'list') {
    return (
      <article className="ct-card" style={{ flexDirection: 'row', alignItems: 'stretch' }}>
        {showImage && service.image ? (
          <div style={{ flex: '0 0 200px' }}>
            <Picture image={service.image} aspect="1/1" />
          </div>
        ) : null}
        {body}
      </article>
    );
  }

  return (
    <article className="ct-card">
      {showImage && layout === 'cards' ? <Picture image={service.image} aspect="16/9" /> : null}
      {body}
    </article>
  );
}

export function TestimonialCard({
  testimonial,
  showPhoto,
  showRole,
}: {
  testimonial: PublicTestimonial;
  showPhoto: boolean;
  showRole: boolean;
}) {
  return (
    <figure className="ct-quote">
      <Stars rating={testimonial.rating} />
      <blockquote>{testimonial.content}</blockquote>
      <figcaption className="ct-quote-author">
        {showPhoto && testimonial.photo?.url ? (
          <img
            className="ct-avatar"
            src={testimonial.photo.url}
            alt={testimonial.photo.alt || testimonial.authorName}
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <span>
          <strong>{testimonial.authorName}</strong>
          {showRole && testimonial.authorRole ? (
            <>
              <br />
              <span className="ct-card-text">{testimonial.authorRole}</span>
            </>
          ) : null}
        </span>
      </figcaption>
    </figure>
  );
}

export function TeamCard({
  member,
  showRole,
  showBio,
  showSocial,
}: {
  member: PublicTeamMember;
  showRole: boolean;
  showBio: boolean;
  showSocial: boolean;
}) {
  const networks = Object.entries(member.social).filter(([, url]) => Boolean(url));

  return (
    <article className="ct-card">
      <Picture image={member.photo} aspect="1/1" alt={member.photo?.alt || member.name} />
      <div className="ct-card-body">
        <h3 className="ct-card-title">{member.name}</h3>
        {showRole && member.role ? <p className="ct-card-text">{member.role}</p> : null}
        {showBio && member.bio ? <p className="ct-card-text">{truncate(member.bio, 180)}</p> : null}
        {showSocial && networks.length > 0 ? (
          <div className="ct-social" style={{ marginTop: '.5rem' }}>
            {networks.map(([network, url]) => {
              const Glyph = SOCIAL_ICONS[network as keyof typeof SOCIAL_ICONS];
              return (
                <a key={network} href={url} target="_blank" rel="noopener noreferrer" aria-label={network}>
                  {Glyph ? <Glyph size={18} aria-hidden="true" /> : network.slice(0, 2)}
                </a>
              );
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}
