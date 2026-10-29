import type { ReactNode } from 'react';
import type { ButtonProps, ImageRef, PageSection, PublicImage } from '@codeca/shared';
import { sectionClassName } from './styles.js';
import { UI_ICONS } from './icons.js';

/**
 * Componentes base dos blocos.
 *
 * Nenhum deles usa `dangerouslySetInnerHTML`: todo texto vem como filho de um
 * elemento React e por isso e escapado. O editor nunca injeta HTML.
 */

export function Section({
  section,
  as: Tag = 'section',
  className,
  children,
  ...rest
}: {
  section: PageSection;
  as?: 'section' | 'header' | 'footer' | 'nav' | 'div';
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  const classes = ['ct-section', sectionClassName(section.id), className].filter(Boolean).join(' ');
  return (
    <Tag id={section.id} className={classes} data-block={section.type} {...rest}>
      {children}
    </Tag>
  );
}

export function Container({
  children,
  className,
  narrow = false,
}: {
  children: ReactNode;
  className?: string;
  narrow?: boolean;
}) {
  const classes = ['ct-container', narrow ? 'ct-narrow' : null, className].filter(Boolean).join(' ');
  return <div className={classes}>{children}</div>;
}

/** Titulo e subtitulo de uma secao. Nao renderiza nada quando ambos vazios. */
export function SectionHeading({
  title,
  subtitle,
  eyebrow,
  level = 2,
}: {
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  level?: 1 | 2 | 3;
}) {
  if (!title && !subtitle && !eyebrow) return null;
  const Tag = (`h${level}` as const) satisfies 'h1' | 'h2' | 'h3';
  return (
    <div className="ct-head">
      {eyebrow ? <span className="ct-eyebrow">{eyebrow}</span> : null}
      {title ? <Tag>{title}</Tag> : null}
      {subtitle ? <p className="ct-lead">{subtitle}</p> : null}
    </div>
  );
}

/** Texto de varios paragrafos, preservando as quebras de linha digitadas. */
export function Prose({ text, className }: { text: string; className?: string }) {
  if (!text.trim()) return null;
  const paragraphs = text.split(/\n{2,}/).filter((part) => part.trim().length > 0);
  return (
    <div className={['ct-prose', className].filter(Boolean).join(' ')}>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

const VARIANT_CLASS: Record<ButtonProps['variant'], string> = {
  primary: 'ct-btn-primary',
  secondary: 'ct-btn-secondary',
  accent: 'ct-btn-accent',
  outline: 'ct-btn-outline',
  ghost: 'ct-btn-ghost',
};

export function ActionButton({ button }: { button: ButtonProps }) {
  if (!button.label) return null;
  const href = button.href || '#';
  const external = /^https?:\/\//i.test(href);
  return (
    <a
      className={`ct-btn ${VARIANT_CLASS[button.variant]}`}
      href={href}
      {...(button.newTab ? { target: '_blank', rel: external ? 'noopener noreferrer' : 'noopener' } : {})}
    >
      {button.label}
    </a>
  );
}

export function ButtonRow({ buttons }: { buttons: readonly ButtonProps[] }) {
  const usable = buttons.filter((button) => button.label);
  if (usable.length === 0) return null;
  return (
    <div className="ct-actions">
      {usable.map((button, index) => (
        <ActionButton key={index} button={button} />
      ))}
    </div>
  );
}

export type AspectRatio = 'original' | '16/9' | '4/3' | '1/1' | '3/4';

const ASPECT_CLASS: Record<Exclude<AspectRatio, 'original'>, string> = {
  '16/9': 'ct-ratio-16-9',
  '4/3': 'ct-ratio-4-3',
  '1/1': 'ct-ratio-1-1',
  '3/4': 'ct-ratio-3-4',
};

/**
 * Imagem com espaco reservado.
 *
 * Quando a empresa ainda nao enviou a imagem, mostramos um bloco com as cores
 * do tema -- nunca uma foto de banco de imagens que o cliente nao escolheu.
 */
export function Picture({
  image,
  aspect = '16/9',
  alt,
  loading = 'lazy',
  className,
  sizes,
}: {
  image: PublicImage | ImageRef | null | undefined;
  aspect?: AspectRatio;
  alt?: string;
  loading?: 'lazy' | 'eager';
  className?: string;
  sizes?: string;
}) {
  const aspectClass = aspect === 'original' ? '' : ASPECT_CLASS[aspect];
  const classes = ['ct-media', aspectClass, className].filter(Boolean).join(' ');
  const url = image?.url ?? '';
  const altText = alt ?? image?.alt ?? '';

  if (!url) {
    const Glyph = UI_ICONS.image;
    return (
      <div className={`${classes} ct-placeholder`} role="img" aria-label={altText || 'Imagem nao enviada'}>
        <Glyph aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={classes}>
      <img
        src={url}
        alt={altText}
        loading={loading}
        decoding="async"
        {...(image?.width ? { width: image.width } : {})}
        {...(image?.height ? { height: image.height } : {})}
        {...(sizes ? { sizes } : {})}
      />
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  if (!message) return null;
  return <p className="ct-empty">{message}</p>;
}

export function Fact({ icon, children }: { icon: keyof typeof UI_ICONS; children: ReactNode }) {
  const Glyph = UI_ICONS[icon];
  return (
    <li>
      <Glyph aria-hidden="true" />
      {children}
    </li>
  );
}

/** Barra de progresso. So aparece quando a empresa informou o percentual. */
export function ProgressBar({ percent, label }: { percent: number | null; label?: string }) {
  if (percent === null) return null;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="ct-progress">
      <span>{label ?? 'Evolucao'}</span>
      <div
        className="ct-progress-track"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Evolucao da obra'}
      >
        <div className="ct-progress-fill" style={{ width: `${clamped}%` }} />
      </div>
      <strong>{clamped}%</strong>
    </div>
  );
}

export function Stars({ rating }: { rating: number | null }) {
  if (rating === null) return null;
  const value = Math.max(1, Math.min(5, Math.round(rating)));
  return (
    <div className="ct-stars" aria-label={`Avaliacao: ${value} de 5`}>
      <span aria-hidden="true">{'★'.repeat(value)}</span>
      <span aria-hidden="true" style={{ opacity: 0.3 }}>
        {'★'.repeat(5 - value)}
      </span>
    </div>
  );
}
