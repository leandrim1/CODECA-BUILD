import {
  BREAKPOINT_WIDTH_PX,
  resolveColor,
  type BlockStyle,
  type PageSection,
  type ResponsiveOverride,
} from '@codeca/shared';

/**
 * Conversao do estilo de um bloco em CSS.
 *
 * Todo valor vem de um schema validado (numeros em faixas conhecidas, enums e
 * cores hexadecimais ou tokens do tema), portanto a folha de estilo gerada
 * nunca contem conteudo arbitrario do editor. As variacoes por tamanho de tela
 * saem como media queries de verdade, o que mantem o comportamento identico
 * entre o site publicado e a previa do editor (que roda em um iframe).
 */

export const TABLET_MAX_PX = BREAKPOINT_WIDTH_PX.tablet + 204; // 1024
export const MOBILE_MAX_PX = 640;

/** Classe determinada pelo id da secao, que o schema restringe a [A-Za-z0-9_-]. */
export function sectionClassName(sectionId: string): string {
  return `ct-s-${sectionId}`;
}

const CONTAINER_WIDTH: Record<BlockStyle['containerWidth'], string> = {
  content: 'var(--ct-content-width)',
  narrow: 'min(var(--ct-content-width), 820px)',
  wide: 'min(calc(var(--ct-content-width) + 200px), 1600px)',
  full: '100%',
};

function backgroundDeclarations(style: BlockStyle): string[] {
  const { background } = style;
  const declarations: string[] = [];

  switch (background.kind) {
    case 'color':
      declarations.push(`background-color: ${resolveColor(background.color, 'transparent')}`);
      break;
    case 'gradient':
      declarations.push(
        `background-image: linear-gradient(160deg, ${resolveColor(background.color, 'transparent')}, ${resolveColor(
          background.gradientTo,
          'transparent',
        )})`,
      );
      break;
    case 'image': {
      const url = background.image?.url ?? '';
      if (url) {
        const overlay = Math.min(100, Math.max(0, background.overlayOpacity)) / 100;
        declarations.push(
          `background-image: linear-gradient(rgba(0,0,0,${overlay}), rgba(0,0,0,${overlay})), url(${cssUrl(url)})`,
          'background-size: cover',
          'background-position: center',
          background.fixed ? 'background-attachment: fixed' : 'background-attachment: scroll',
        );
      }
      break;
    }
    case 'none':
    default:
      break;
  }

  return declarations;
}

/** Escapa a URL para uso dentro de `url(...)`. A URL ja foi validada pelo schema. */
function cssUrl(url: string): string {
  return `"${url.replace(/["\\\n\r]/g, '')}"`;
}

function paddingDeclaration(padding: BlockStyle['padding']): string {
  return `padding: ${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`;
}

function baseDeclarations(style: BlockStyle, columns: number | null): string[] {
  const declarations: string[] = [paddingDeclaration(style.padding), `text-align: ${style.align}`];

  declarations.push(...backgroundDeclarations(style));

  if (style.textColor) declarations.push(`color: ${resolveColor(style.textColor, 'inherit')}`);
  if (style.radiusPx !== null) declarations.push(`border-radius: ${style.radiusPx}px`);
  if (style.minHeightPx !== null) declarations.push(`min-height: ${style.minHeightPx}px`);

  if (style.border.style !== 'none') {
    declarations.push(
      `border: ${style.border.widthPx}px ${style.border.style} ${resolveColor(style.border.color, 'currentColor')}`,
    );
  }

  declarations.push(`--ct-section-width: ${CONTAINER_WIDTH[style.containerWidth]}`);
  if (style.maxWidthPx !== null) declarations.push(`--ct-section-max: ${style.maxWidthPx}px`);
  if (columns !== null) declarations.push(`--ct-cols: ${columns}`);

  return declarations;
}

function overrideDeclarations(override: ResponsiveOverride, base: BlockStyle): string[] {
  const declarations: string[] = [];

  if (override.hidden) declarations.push('display: none');
  if (override.align) declarations.push(`text-align: ${override.align}`);
  if (override.columns !== undefined) declarations.push(`--ct-cols: ${override.columns}`);
  if (override.minHeightPx !== undefined && override.minHeightPx !== null) {
    declarations.push(`min-height: ${override.minHeightPx}px`);
  }
  if (override.padding) {
    const padding = { ...base.padding, ...override.padding };
    declarations.push(paddingDeclaration(padding));
  }

  return declarations;
}

function rule(selector: string, declarations: string[]): string {
  if (declarations.length === 0) return '';
  return `${selector}{${declarations.join(';')}}`;
}

/** Quantidade de colunas declarada nas propriedades do bloco, se houver. */
function columnsOf(section: PageSection): number | null {
  const value = (section.props as { columns?: unknown }).columns;
  return typeof value === 'number' ? value : null;
}

/** CSS de uma secao, incluindo as variacoes por tamanho de tela. */
export function sectionCss(section: PageSection): string {
  const selector = `.${sectionClassName(section.id)}`;
  const parts: string[] = [rule(selector, baseDeclarations(section.style, columnsOf(section)))];

  const tablet = overrideDeclarations(section.responsive.tablet, section.style);
  if (tablet.length > 0) {
    parts.push(`@media (max-width:${TABLET_MAX_PX}px){${rule(selector, tablet)}}`);
  }

  const mobile = overrideDeclarations(section.responsive.mobile, section.style);
  if (mobile.length > 0) {
    parts.push(`@media (max-width:${MOBILE_MAX_PX}px){${rule(selector, mobile)}}`);
  }

  return parts.filter(Boolean).join('');
}

/** CSS de todas as secoes visiveis da pagina. */
export function layoutCss(sections: readonly PageSection[]): string {
  return sections.map(sectionCss).join('\n');
}
