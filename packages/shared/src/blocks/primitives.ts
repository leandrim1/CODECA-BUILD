import { z } from 'zod';
import { colorValueSchema } from '../theme.js';

/**
 * Primitivas reutilizadas pelos schemas de bloco.
 * Toda propriedade que chega ao HTML passa por aqui, o que garante que o
 * conteudo do editor nunca carregue URL executavel, HTML bruto ou CSS livre.
 */

const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Aceita caminho interno (`/imoveis`), ancora (`#contato`) e URL absoluta com
 * esquema seguro. Rejeita `javascript:`, `data:`, `vbscript:` e similares.
 */
export const safeHrefSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (value === '') return true;
    if (value.startsWith('#')) return /^#[\w-]{0,128}$/.test(value);
    if (value.startsWith('/')) return !value.startsWith('//') && !/[<>"']/.test(value);
    try {
      const url = new URL(value);
      return SAFE_URL_SCHEMES.includes(url.protocol);
    } catch {
      return false;
    }
  }, 'Informe um link interno (/pagina), uma ancora (#secao) ou uma URL http(s), mailto: ou tel:.');

/** URL de imagem: apenas https (ou caminho interno para assets da plataforma). */
export const imageUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (value === '') return true;
    if (value.startsWith('/')) return !value.startsWith('//');
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Informe uma URL de imagem valida.');

export const imageRefSchema = z.object({
  /** Id em `media_assets`, quando a imagem vem da biblioteca da empresa. */
  mediaId: z.string().uuid().nullable().default(null),
  url: imageUrlSchema.default(''),
  alt: z.string().trim().max(240).default(''),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
});
export type ImageRef = z.infer<typeof imageRefSchema>;

export const EMPTY_IMAGE: ImageRef = { mediaId: null, url: '', alt: '', width: null, height: null };

export const BUTTON_VARIANTS = ['primary', 'secondary', 'accent', 'outline', 'ghost'] as const;

export const buttonSchema = z.object({
  label: z.string().trim().max(80).default('Saiba mais'),
  href: safeHrefSchema.default(''),
  variant: z.enum(BUTTON_VARIANTS).default('primary'),
  newTab: z.boolean().default(false),
});
export type ButtonProps = z.infer<typeof buttonSchema>;

export const linkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  href: safeHrefSchema,
  newTab: z.boolean().default(false),
});
export type LinkProps = z.infer<typeof linkSchema>;

export const ALIGNMENTS = ['left', 'center', 'right'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

const sizeStep = (max: number) => z.number().int().min(0).max(max);

export const spacingSchema = z.object({
  top: sizeStep(240).default(64),
  bottom: sizeStep(240).default(64),
  left: sizeStep(120).default(0),
  right: sizeStep(120).default(0),
});
export type Spacing = z.infer<typeof spacingSchema>;

export const BACKGROUND_KINDS = ['none', 'color', 'image', 'gradient'] as const;

export const backgroundSchema = z.object({
  kind: z.enum(BACKGROUND_KINDS).default('none'),
  color: colorValueSchema.nullable().default(null),
  gradientTo: colorValueSchema.nullable().default(null),
  image: imageRefSchema.nullable().default(null),
  /** Opacidade do veu escuro sobre a imagem, de 0 a 100. */
  overlayOpacity: z.number().int().min(0).max(100).default(40),
  fixed: z.boolean().default(false),
});
export type Background = z.infer<typeof backgroundSchema>;

export const BORDER_STYLES = ['none', 'solid', 'dashed'] as const;
export const CONTAINER_WIDTHS = ['content', 'narrow', 'wide', 'full'] as const;

/** Estilo visual comum a praticamente todos os blocos. */
export const blockStyleSchema = z.object({
  background: backgroundSchema.prefault({}),
  padding: spacingSchema.prefault({}),
  align: z.enum(ALIGNMENTS).default('left'),
  textColor: colorValueSchema.nullable().default(null),
  containerWidth: z.enum(CONTAINER_WIDTHS).default('content'),
  radiusPx: z.number().int().min(0).max(64).nullable().default(null),
  border: z
    .object({
      style: z.enum(BORDER_STYLES).default('none'),
      widthPx: z.number().int().min(0).max(12).default(1),
      color: colorValueSchema.nullable().default(null),
    })
    .prefault({}),
  minHeightPx: z.number().int().min(0).max(1200).nullable().default(null),
  maxWidthPx: z.number().int().min(160).max(1920).nullable().default(null),
});
export type BlockStyle = z.infer<typeof blockStyleSchema>;

/** Subconjunto de estilo que pode ser sobrescrito por breakpoint. */
export const responsiveOverrideSchema = z.object({
  hidden: z.boolean().optional(),
  align: z.enum(ALIGNMENTS).optional(),
  padding: spacingSchema.partial().optional(),
  columns: z.number().int().min(1).max(6).optional(),
  minHeightPx: z.number().int().min(0).max(1200).nullable().optional(),
});
export type ResponsiveOverride = z.infer<typeof responsiveOverrideSchema>;

export const responsiveSchema = z.object({
  tablet: responsiveOverrideSchema.prefault({}),
  mobile: responsiveOverrideSchema.prefault({}),
});
export type Responsive = z.infer<typeof responsiveSchema>;

export const BREAKPOINTS = ['desktop', 'tablet', 'mobile'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

export const BREAKPOINT_WIDTH_PX: Record<Breakpoint, number> = {
  desktop: 1280,
  tablet: 820,
  mobile: 390,
};

/** Texto simples multilinha: nunca interpretado como HTML. */
export const richTextSchema = z.string().max(8000);

export const headingSchema = z.string().trim().max(200);
export const subheadingSchema = z.string().trim().max(400);
