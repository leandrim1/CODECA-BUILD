import { z } from 'zod';

/**
 * Identidade visual por empresa. Todos os valores sao validados de forma
 * estrita: cores so aceitam hexadecimal e medidas so aceitam numeros em faixas
 * conhecidas. Nada aqui e interpolado como CSS livre, o que impede injecao de
 * estilo/script a partir do editor.
 */

export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const hexColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR, 'Informe uma cor hexadecimal, por exemplo #1E3A8A.');

export const THEME_COLOR_TOKENS = [
  'primary',
  'secondary',
  'accent',
  'background',
  'surface',
  'text',
  'muted',
  'border',
  'inverse',
] as const;
export type ThemeColorToken = (typeof THEME_COLOR_TOKENS)[number];

const TOKEN_REFERENCE = new RegExp(`^token:(?:${THEME_COLOR_TOKENS.join('|')})$`);

/**
 * Uma cor de bloco pode referenciar um token do tema (`primary`) ou um
 * hexadecimal. O valor e normalizado para `token:<nome>`, de forma idempotente:
 * reprocessar um valor ja normalizado produz o mesmo resultado, o que permite
 * validar novamente um layout persistido.
 */
export const colorValueSchema = z
  .string()
  .trim()
  .transform((value) =>
    (THEME_COLOR_TOKENS as readonly string[]).includes(value) ? `token:${value}` : value,
  )
  .refine(
    (value) => TOKEN_REFERENCE.test(value) || HEX_COLOR.test(value),
    'Informe uma cor hexadecimal (#1E3A8A) ou um token do tema (primary, secondary, accent, background, surface, text, muted, border, inverse).',
  );

export const FONT_FAMILIES = [
  'inter',
  'manrope',
  'dm-sans',
  'poppins',
  'montserrat',
  'source-sans',
  'playfair',
  'lora',
  'system',
] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const FONT_STACKS: Record<FontFamily, string> = {
  inter: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  manrope: "'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif",
  'dm-sans': "'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  poppins: "'Poppins', system-ui, -apple-system, 'Segoe UI', sans-serif",
  montserrat: "'Montserrat', system-ui, -apple-system, 'Segoe UI', sans-serif",
  'source-sans': "'Source Sans 3', system-ui, -apple-system, 'Segoe UI', sans-serif",
  playfair: "'Playfair Display', Georgia, 'Times New Roman', serif",
  lora: "'Lora', Georgia, 'Times New Roman', serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

/** Fontes que precisam ser carregadas do Google Fonts no site publico. */
export const GOOGLE_FONT_FAMILIES: Partial<Record<FontFamily, string>> = {
  inter: 'Inter:wght@400;500;600;700',
  manrope: 'Manrope:wght@400;500;600;700',
  'dm-sans': 'DM+Sans:wght@400;500;700',
  poppins: 'Poppins:wght@400;500;600;700',
  montserrat: 'Montserrat:wght@400;500;600;700',
  'source-sans': 'Source+Sans+3:wght@400;500;600;700',
  playfair: 'Playfair+Display:wght@400;600;700',
  lora: 'Lora:wght@400;600;700',
};

export const BUTTON_STYLES = ['solid', 'outline', 'soft', 'link'] as const;
export const BUTTON_SHAPES = ['sharp', 'rounded', 'pill'] as const;
export const CARD_STYLES = ['flat', 'outlined', 'elevated'] as const;
export const HEADER_STYLES = ['light', 'dark', 'transparent'] as const;
export const HEADER_LAYOUTS = ['logo-left', 'logo-center'] as const;
export const FOOTER_STYLES = ['light', 'dark', 'brand'] as const;
export const CONTENT_WIDTHS = ['narrow', 'default', 'wide', 'full'] as const;

export const CONTENT_WIDTH_PX: Record<(typeof CONTENT_WIDTHS)[number], number> = {
  narrow: 960,
  default: 1152,
  wide: 1360,
  full: 1920,
};

export const themeSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  logoUrl: z.string().url().nullable().default(null),
  logoDarkUrl: z.string().url().nullable().default(null),
  faviconUrl: z.string().url().nullable().default(null),
  colors: z
    .object({
      primary: hexColorSchema.default('#1D4ED8'),
      secondary: hexColorSchema.default('#0F172A'),
      accent: hexColorSchema.default('#F59E0B'),
      background: hexColorSchema.default('#FFFFFF'),
      surface: hexColorSchema.default('#F8FAFC'),
      text: hexColorSchema.default('#0F172A'),
      muted: hexColorSchema.default('#64748B'),
      border: hexColorSchema.default('#E2E8F0'),
      inverse: hexColorSchema.default('#FFFFFF'),
    })
    .prefault({}),
  typography: z
    .object({
      headingFont: z.enum(FONT_FAMILIES).default('manrope'),
      bodyFont: z.enum(FONT_FAMILIES).default('inter'),
      baseSizePx: z.number().int().min(14).max(20).default(16),
      headingScale: z.number().min(1.1).max(1.5).default(1.25),
    })
    .prefault({}),
  buttons: z
    .object({
      style: z.enum(BUTTON_STYLES).default('solid'),
      shape: z.enum(BUTTON_SHAPES).default('rounded'),
      uppercase: z.boolean().default(false),
    })
    .prefault({}),
  radiusPx: z.number().int().min(0).max(32).default(10),
  contentWidth: z.enum(CONTENT_WIDTHS).default('default'),
  cardStyle: z.enum(CARD_STYLES).default('elevated'),
  header: z
    .object({
      style: z.enum(HEADER_STYLES).default('light'),
      layout: z.enum(HEADER_LAYOUTS).default('logo-left'),
      sticky: z.boolean().default(true),
    })
    .prefault({}),
  footer: z
    .object({
      style: z.enum(FOOTER_STYLES).default('dark'),
      showSocial: z.boolean().default(true),
    })
    .prefault({}),
});

export type Theme = z.infer<typeof themeSchema>;

export const DEFAULT_THEME: Theme = themeSchema.parse({});

export function parseTheme(value: unknown): Theme {
  const result = themeSchema.safeParse(value ?? {});
  return result.success ? result.data : DEFAULT_THEME;
}

/** Converte `token:primary` ou `#fff` em um valor CSS seguro. */
export function resolveColor(value: string | null | undefined, fallback = 'inherit'): string {
  if (!value) return fallback;
  if (value.startsWith('token:')) {
    const token = value.slice('token:'.length);
    return (THEME_COLOR_TOKENS as readonly string[]).includes(token) ? `var(--ct-${token})` : fallback;
  }
  return HEX_COLOR.test(value) ? value : fallback;
}

function radiusFor(shape: (typeof BUTTON_SHAPES)[number], base: number): string {
  if (shape === 'sharp') return '0px';
  if (shape === 'pill') return '999px';
  return `${base}px`;
}

/**
 * Variaveis CSS do tema. Como todos os valores vem de schemas validados,
 * a string resultante nunca contem conteudo arbitrario do usuario.
 */
export function themeToCssVariables(theme: Theme): Record<string, string> {
  return {
    '--ct-primary': theme.colors.primary,
    '--ct-secondary': theme.colors.secondary,
    '--ct-accent': theme.colors.accent,
    '--ct-background': theme.colors.background,
    '--ct-surface': theme.colors.surface,
    '--ct-text': theme.colors.text,
    '--ct-muted': theme.colors.muted,
    '--ct-border': theme.colors.border,
    '--ct-inverse': theme.colors.inverse,
    '--ct-font-heading': FONT_STACKS[theme.typography.headingFont],
    '--ct-font-body': FONT_STACKS[theme.typography.bodyFont],
    '--ct-font-size': `${theme.typography.baseSizePx}px`,
    '--ct-heading-scale': String(theme.typography.headingScale),
    '--ct-radius': `${theme.radiusPx}px`,
    '--ct-radius-button': radiusFor(theme.buttons.shape, theme.radiusPx),
    '--ct-content-width': `${CONTENT_WIDTH_PX[theme.contentWidth]}px`,
    '--ct-button-transform': theme.buttons.uppercase ? 'uppercase' : 'none',
    '--ct-button-letter-spacing': theme.buttons.uppercase ? '0.04em' : '0',
  };
}

export function themeCssVariableBlock(theme: Theme, selector = ':root'): string {
  const vars = themeToCssVariables(theme);
  const body = Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}

/** URL do Google Fonts para as familias usadas, ou null quando nao houver. */
export function googleFontsHref(theme: Theme): string | null {
  const families = new Set<string>();
  const heading = GOOGLE_FONT_FAMILIES[theme.typography.headingFont];
  const body = GOOGLE_FONT_FAMILIES[theme.typography.bodyFont];
  if (heading) families.add(heading);
  if (body) families.add(body);
  if (families.size === 0) return null;
  const params = [...families].map((f) => `family=${f}`).join('&');
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}
