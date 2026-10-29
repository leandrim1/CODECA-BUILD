import {
  PROPERTY_COMMERCIAL_STATUS_LABELS,
  PROPERTY_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  formatCurrency,
  formatIsoDate,
  formatPrice,
  type PublicProperty,
} from '@codeca/shared';
import { useSite, useWhatsApp } from '../context.js';
import { PropertyFacts } from '../cards.js';
import { Container, Picture, Prose } from '../primitives.js';
import { UI_ICONS } from '../icons.js';

/**
 * Pagina de detalhe do imovel.
 *
 * Renderizada no servidor para que cada imovel tenha URL propria, titulo e
 * descricao indexaveis -- o que uma aplicacao somente cliente nao entrega.
 */
export function PropertyDetail({ property }: { property: PublicProperty }) {
  const site = useSite();
  const whatsapp = useWhatsApp({
    kind: 'property',
    title: property.title,
    reference: property.reference,
    price: formatPrice(property.price, property.currency, property.priceOnRequest),
  });

  const gallery = property.gallery.length > 0 ? property.gallery : property.coverImage ? [property.coverImage] : [];

  return (
    <article className="ct-section" style={{ paddingBlock: '2.5rem 4rem' }}>
      <Container>
        <nav className="ct-breadcrumb" aria-label="Trilha de navegacao">
          <a href="/">Inicio</a>
          <span aria-hidden="true">/</span>
          <a href="/imoveis">Imoveis</a>
          <span aria-hidden="true">/</span>
          <span>{property.title}</span>
        </nav>

        <header className="ct-detail-head">
          <div className="ct-chips">
            <span className="ct-chip">{PROPERTY_TYPE_LABELS[property.type]}</span>
            <span className="ct-chip">{PROPERTY_PURPOSE_LABELS[property.purpose]}</span>
            <span className={property.commercialStatus === 'disponivel' ? 'ct-badge' : 'ct-badge ct-badge-muted'}>
              {PROPERTY_COMMERCIAL_STATUS_LABELS[property.commercialStatus]}
            </span>
            {property.reference ? <span className="ct-chip">Ref. {property.reference}</span> : null}
          </div>
          <h1>{property.title}</h1>
          {property.addressLine ? (
            <p className="ct-lead">
              <UI_ICONS.location aria-hidden="true" style={{ display: 'inline', width: 16, height: 16, verticalAlign: '-3px' }} />{' '}
              {property.addressLine}
            </p>
          ) : null}
        </header>

        <div className="ct-detail-grid">
          <div>
            <Picture
              image={property.coverImage}
              aspect="16/9"
              alt={property.coverImage?.alt || property.title}
              loading="eager"
            />

            {gallery.length > 1 ? (
              <div className="ct-gallery" style={{ ['--ct-cols' as string]: '3', marginTop: '1rem' }}>
                {gallery.map((image, index) => {
                  const targetId = `imovel-foto-${index}`;
                  return (
                    <div key={index}>
                      <a href={`#${targetId}`} aria-label={`Ampliar foto ${index + 1}`}>
                        <Picture image={image} aspect="4/3" />
                      </a>
                      <div className="ct-lightbox" id={targetId}>
                        <a className="ct-lightbox-close" href="#galeria" aria-label="Fechar">
                          &times;
                        </a>
                        <img src={image.url} alt={image.alt} loading="lazy" decoding="async" />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <section style={{ marginTop: '2.5rem' }}>
              <h2>Sobre o imovel</h2>
              <PropertyFacts property={property} />
              <div style={{ marginTop: '1.25rem' }}>
                <Prose text={property.description || property.shortDescription} />
              </div>
            </section>

            {property.features.length > 0 ? (
              <section style={{ marginTop: '2.5rem' }}>
                <h2>Caracteristicas</h2>
                <ul className="ct-chips">
                  {property.features.map((feature, index) => (
                    <li key={index} className="ct-chip">
                      {feature}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {property.videoUrl ? (
              <section style={{ marginTop: '2.5rem' }}>
                <h2>Video</h2>
                <a className="ct-btn ct-btn-outline" href={property.videoUrl} target="_blank" rel="noopener noreferrer">
                  Assistir ao video do imovel
                </a>
              </section>
            ) : null}
          </div>

          <aside className="ct-aside">
            <div>
              <span className="ct-card-text">Valor</span>
              <p className="ct-price" style={{ fontSize: '1.7rem', margin: '.15rem 0 0' }}>
                {formatPrice(property.price, property.currency, property.priceOnRequest)}
              </p>
            </div>

            {property.condoFee !== null || property.iptu !== null ? (
              <ul className="ct-facts" style={{ flexDirection: 'column', gap: '.4rem' }}>
                {property.condoFee !== null ? (
                  <li>Condominio: {formatCurrency(property.condoFee, property.currency)}</li>
                ) : null}
                {property.iptu !== null ? <li>IPTU: {formatCurrency(property.iptu, property.currency)}</li> : null}
              </ul>
            ) : null}

            {property.deliveryDate ? (
              <p className="ct-card-text">Entrega prevista: {formatIsoDate(property.deliveryDate, 'month')}</p>
            ) : null}

            <div className="ct-actions" style={{ marginTop: 0, flexDirection: 'column' }}>
              {whatsapp ? (
                <a className="ct-btn ct-btn-primary" href={whatsapp} target="_blank" rel="noopener noreferrer">
                  <UI_ICONS.whatsapp size={18} aria-hidden="true" />
                  Falar no WhatsApp
                </a>
              ) : null}
              <a className="ct-btn ct-btn-outline" href="/contato">
                Enviar mensagem
              </a>
              {site.tenant.phone ? (
                <a className="ct-btn ct-btn-ghost" href={`tel:${site.tenant.phone.replace(/\D+/g, '')}`}>
                  {site.tenant.phone}
                </a>
              ) : null}
            </div>

            <p className="ct-card-text" style={{ fontSize: '.82rem' }}>
              Informacoes sujeitas a alteracao sem aviso previo. Consulte a {site.tenant.displayName} para
              confirmar valores e disponibilidade.
            </p>
          </aside>
        </div>
      </Container>
    </article>
  );
}
