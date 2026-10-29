import { renderToStaticMarkup } from 'react-dom/server';
import {
  googleFontsHref,
  themeCssVariableBlock,
  type PublicSiteData,
} from '@codeca/shared';
import { BASE_CSS } from './base-css.js';
import { CLIENT_SCRIPT } from './client-script.js';
import { SiteRenderer, renderedSections } from './SiteRenderer.js';
import { buildSeoMeta, buildStructuredData } from './seo.js';
import { layoutCss } from './styles.js';

/**
 * Renderizacao do site no servidor.
 *
 * O documento sai completo do servidor -- titulo, descricao, dados
 * estruturados e conteudo -- justamente o que uma aplicacao somente cliente
 * nao entrega aos buscadores. O unico JavaScript enviado cuida do formulario
 * de contato.
 */

export interface RenderedSite {
  html: string;
  status: number;
  /** Valor do ETag, derivado da versao publicada e do caminho. */
  etag: string;
  seo: ReturnType<typeof buildSeoMeta>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Serializa JSON-LD impedindo que o conteudo feche a tag <script>. */
function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function metaTag(attributes: Record<string, string>): string {
  const serialized = Object.entries(attributes)
    .map(([key, attributeValue]) => `${key}="${escapeHtml(attributeValue)}"`)
    .join(' ');
  return `<meta ${serialized}>`;
}

export function renderSiteDocument(data: PublicSiteData): RenderedSite {
  const seo = buildSeoMeta(data);
  const structuredData = buildStructuredData(data);
  const fontsHref = googleFontsHref(data.theme);

  const css = [
    themeCssVariableBlock(data.theme, ':root'),
    BASE_CSS,
    layoutCss(renderedSections(data)),
  ].join('\n');

  const body = renderToStaticMarkup(<SiteRenderer data={data} />);

  const head = [
    '<meta charset="utf-8">',
    metaTag({ name: 'viewport', content: 'width=device-width, initial-scale=1' }),
    `<title>${escapeHtml(seo.title)}</title>`,
    seo.description ? metaTag({ name: 'description', content: seo.description }) : '',
    metaTag({ name: 'robots', content: seo.robots }),
    `<link rel="canonical" href="${escapeHtml(seo.canonical)}">`,
    seo.googleSiteVerification
      ? metaTag({ name: 'google-site-verification', content: seo.googleSiteVerification })
      : '',
    metaTag({ property: 'og:site_name', content: seo.siteName }),
    metaTag({ property: 'og:title', content: seo.title }),
    seo.description ? metaTag({ property: 'og:description', content: seo.description }) : '',
    metaTag({ property: 'og:type', content: seo.type }),
    metaTag({ property: 'og:url', content: seo.canonical }),
    metaTag({ property: 'og:locale', content: 'pt_BR' }),
    seo.imageUrl ? metaTag({ property: 'og:image', content: seo.imageUrl }) : '',
    metaTag({ name: 'twitter:card', content: seo.imageUrl ? 'summary_large_image' : 'summary' }),
    metaTag({ name: 'theme-color', content: data.theme.colors.primary }),
    data.theme.faviconUrl ? `<link rel="icon" href="${escapeHtml(data.theme.faviconUrl)}">` : '',
    data.seo.sitemapEnabled
      ? `<link rel="sitemap" type="application/xml" href="/sitemap.xml">`
      : '',
    fontsHref
      ? '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        + `<link rel="stylesheet" href="${escapeHtml(fontsHref)}">`
      : '',
    `<style>${css}</style>`,
    ...structuredData.map(
      (item) => `<script type="application/ld+json">${serializeJsonLd(item)}</script>`,
    ),
  ]
    .filter(Boolean)
    .join('\n');

  const html =
    '<!doctype html>\n'
    + `<html lang="pt-BR" data-card="${data.theme.cardStyle}" data-buttons="${data.theme.buttons.style}">\n`
    + `<head>\n${head}\n</head>\n`
    + '<body>\n'
    + body
    + `\n<script>${CLIENT_SCRIPT}</script>\n`
    + '</body>\n</html>\n';

  return {
    html,
    status: data.context.routeKind === 'not_found' ? 404 : 200,
    etag: `W/"${data.tenant.id}-${data.context.siteVersion}-${data.context.path}"`,
    seo,
  };
}

/** Marcacao apenas do corpo, usada pela previa do editor dentro do iframe. */
export function renderSiteBody(data: PublicSiteData): { body: string; css: string } {
  return {
    body: renderToStaticMarkup(<SiteRenderer data={data} />),
    css: [
      themeCssVariableBlock(data.theme, ':root'),
      BASE_CSS,
      layoutCss(renderedSections(data)),
    ].join('\n'),
  };
}
