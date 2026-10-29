import type { ImageRef, PageSection } from '@codeca/shared';
import { useSite } from '../context.js';
import { BlockIcon } from '../icons.js';
import {
  ButtonRow,
  Container,
  EmptyState,
  Picture,
  Prose,
  Section,
  SectionHeading,
  type AspectRatio,
} from '../primitives.js';

/** Banner, textos, imagens, galeria, sobre, diferenciais e perguntas. */

interface BlockProps {
  section: PageSection;
}

type Button = { label: string; href: string; variant: 'primary' | 'secondary' | 'accent' | 'outline' | 'ghost'; newTab: boolean };

export function HeroBlock({ section }: BlockProps) {
  const props = section.props as {
    eyebrow: string;
    title: string;
    subtitle: string;
    buttons: Button[];
    height: 'small' | 'medium' | 'large' | 'full';
    contentPosition: 'left' | 'center' | 'right';
    showScrollHint: boolean;
  };

  return (
    <Section section={section} className={`ct-hero ct-hero-${props.height}`} data-position={props.contentPosition}>
      <Container>
        <div className="ct-hero-body">
          {props.eyebrow ? <span className="ct-eyebrow">{props.eyebrow}</span> : null}
          {props.title ? <h1>{props.title}</h1> : null}
          {props.subtitle ? <p className="ct-lead">{props.subtitle}</p> : null}
          <ButtonRow buttons={props.buttons} />
        </div>
      </Container>
    </Section>
  );
}

export function TextBlock({ section }: BlockProps) {
  const props = section.props as { title: string; subtitle: string; body: string; columns: number };
  return (
    <Section section={section}>
      <Container>
        <SectionHeading title={props.title} subtitle={props.subtitle} />
        <div style={props.columns > 1 ? { columnCount: props.columns, columnGap: '2.5rem' } : undefined}>
          <Prose text={props.body} />
        </div>
      </Container>
    </Section>
  );
}

export function ImageBlock({ section }: BlockProps) {
  const props = section.props as {
    image: ImageRef;
    caption: string;
    aspect: AspectRatio;
    fullWidth: boolean;
    href: string;
  };

  const figure = (
    <figure style={{ margin: 0 }}>
      <Picture image={props.image} aspect={props.aspect} />
      {props.caption ? (
        <figcaption className="ct-card-text" style={{ marginTop: '.65rem' }}>
          {props.caption}
        </figcaption>
      ) : null}
    </figure>
  );

  const content = props.href ? <a href={props.href}>{figure}</a> : figure;

  return (
    <Section section={section}>
      {props.fullWidth ? content : <Container>{content}</Container>}
    </Section>
  );
}

export function ImageTextBlock({ section }: BlockProps) {
  const props = section.props as {
    image: ImageRef;
    title: string;
    subtitle: string;
    body: string;
    buttons: Button[];
    imagePosition: 'left' | 'right';
    imageWidthPercent: number;
    verticalAlign: 'start' | 'center';
  };

  const media = (
    <div className="ct-split-media">
      <Picture image={props.image} aspect="4/3" />
    </div>
  );
  const text = (
    <div>
      <SectionHeading title={props.title} subtitle={props.subtitle} />
      <Prose text={props.body} />
      <ButtonRow buttons={props.buttons} />
    </div>
  );

  const imageFr = props.imageWidthPercent;
  const columns =
    props.imagePosition === 'left'
      ? `${imageFr}fr ${100 - imageFr}fr`
      : `${100 - imageFr}fr ${imageFr}fr`;

  return (
    <Section section={section}>
      <Container>
        <div
          className="ct-split"
          style={{ ['--ct-split' as string]: columns, alignItems: props.verticalAlign }}
        >
          {props.imagePosition === 'left' ? (
            <>
              {media}
              {text}
            </>
          ) : (
            <>
              {text}
              {media}
            </>
          )}
        </div>
      </Container>
    </Section>
  );
}

export function GalleryBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    title: string;
    subtitle: string;
    source: 'manual' | 'library';
    libraryTag: string;
    images: ImageRef[];
    columns: number;
    gapPx: number;
    aspect: AspectRatio;
    lightbox: boolean;
    limit: number;
  };

  const fromLibrary = site.gallery
    .filter((image) => (props.libraryTag ? image.tag === props.libraryTag : true))
    .map((image) => ({ mediaId: image.id, url: image.url, alt: image.alt, width: image.width, height: image.height }));

  const images = (props.source === 'library' ? fromLibrary : props.images)
    .filter((image) => image.url)
    .slice(0, props.limit);

  return (
    <Section section={section}>
      <Container>
        <SectionHeading title={props.title} subtitle={props.subtitle} />
        {images.length === 0 ? (
          <EmptyState message="Nenhuma imagem publicada nesta galeria." />
        ) : (
          <div
            className="ct-gallery"
            style={{ ['--ct-gap' as string]: `${props.gapPx}px`, ['--ct-cols' as string]: String(props.columns) }}
          >
            {images.map((image, index) => {
              const targetId = `${section.id}-img-${index}`;
              const thumb = (
                <Picture image={image} aspect={props.aspect} loading={index < 3 ? 'eager' : 'lazy'} />
              );
              return props.lightbox ? (
                <div key={index}>
                  <a href={`#${targetId}`} aria-label={image.alt || `Ampliar imagem ${index + 1}`}>
                    {thumb}
                  </a>
                  {/* Ampliacao via :target, sem JavaScript. */}
                  <div className="ct-lightbox" id={targetId}>
                    <a className="ct-lightbox-close" href={`#${section.id}`} aria-label="Fechar">
                      &times;
                    </a>
                    <img src={image.url} alt={image.alt} loading="lazy" decoding="async" />
                  </div>
                </div>
              ) : (
                <div key={index}>{thumb}</div>
              );
            })}
          </div>
        )}
      </Container>
    </Section>
  );
}

export function AboutBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    title: string;
    subtitle: string;
    body: string;
    image: ImageRef | null;
    imagePosition: 'left' | 'right';
    stats: Array<{ value: string; label: string }>;
    buttons: Button[];
  };

  // Sem texto proprio, usamos a descricao cadastrada pela empresa.
  const body = props.body || site.tenant.description;

  const text = (
    <div>
      <SectionHeading title={props.title} subtitle={props.subtitle} />
      <Prose text={body} />
      {props.stats.length > 0 ? (
        <ul className="ct-stats">
          {props.stats.map((stat, index) => (
            <li key={index}>
              <span className="ct-stat-value">{stat.value}</span>
              <span className="ct-stat-label">{stat.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ButtonRow buttons={props.buttons} />
    </div>
  );

  if (!props.image) {
    return (
      <Section section={section}>
        <Container narrow>{text}</Container>
      </Section>
    );
  }

  return (
    <Section section={section}>
      <Container>
        <div className="ct-split">
          {props.imagePosition === 'left' ? (
            <>
              <div className="ct-split-media">
                <Picture image={props.image} aspect="4/3" />
              </div>
              {text}
            </>
          ) : (
            <>
              {text}
              <div className="ct-split-media">
                <Picture image={props.image} aspect="4/3" />
              </div>
            </>
          )}
        </div>
      </Container>
    </Section>
  );
}

export function DifferentialsBlock({ section }: BlockProps) {
  const props = section.props as {
    title: string;
    subtitle: string;
    items: Array<{ icon: string; title: string; text: string }>;
    columns: number;
    layout: 'cards' | 'plain';
  };

  if (props.items.length === 0) {
    return (
      <Section section={section}>
        <Container>
          <SectionHeading title={props.title} subtitle={props.subtitle} />
          <EmptyState message="Nenhum diferencial cadastrado." />
        </Container>
      </Section>
    );
  }

  return (
    <Section section={section}>
      <Container>
        <SectionHeading title={props.title} subtitle={props.subtitle} />
        <div className="ct-grid">
          {props.items.map((item, index) => (
            <article key={index} className={props.layout === 'cards' ? 'ct-card' : ''}>
              <div className={props.layout === 'cards' ? 'ct-card-body' : ''}>
                <span className="ct-icon-box">
                  <BlockIcon name={item.icon} />
                </span>
                <h3 className="ct-card-title">{item.title}</h3>
                {item.text ? <p className="ct-card-text">{item.text}</p> : null}
              </div>
            </article>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export function FaqBlock({ section }: BlockProps) {
  const site = useSite();
  const props = section.props as {
    title: string;
    subtitle: string;
    source: 'content' | 'inline';
    items: Array<{ question: string; answer: string }>;
    limit: number;
    openFirst: boolean;
  };

  const items =
    props.source === 'inline'
      ? props.items
      : site.faqs.map((faq) => ({ question: faq.question, answer: faq.answer }));
  const visible = items.slice(0, props.limit);

  return (
    <Section section={section}>
      <Container>
        <SectionHeading title={props.title} subtitle={props.subtitle} />
        {visible.length === 0 ? (
          <EmptyState message="Nenhuma pergunta cadastrada." />
        ) : (
          <div className="ct-faq">
            {visible.map((item, index) => (
              <details key={index} {...(props.openFirst && index === 0 ? { open: true } : {})}>
                <summary>{item.question}</summary>
                <div className="ct-faq-answer">
                  <Prose text={item.answer} />
                </div>
              </details>
            ))}
          </div>
        )}
      </Container>
    </Section>
  );
}
