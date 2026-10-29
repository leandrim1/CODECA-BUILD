import { createSection, type PageSection, type PublicSiteData } from '@codeca/shared';
import { SiteDataProvider } from './context.js';
import { BlockRenderer } from './blocks/registry.js';
import { WhatsAppButtonBlock } from './blocks/conversion.js';
import { NotFound } from './pages/NotFound.js';
import { ProjectDetail } from './pages/ProjectDetail.js';
import { PropertyDetail } from './pages/PropertyDetail.js';

/**
 * Renderizador do site publico.
 *
 * O mesmo componente atende a pagina montada no editor, as paginas de detalhe
 * de imovel e de obra e a pagina 404 -- sempre com o cabecalho e o rodape
 * publicados pela empresa.
 */

function visibleSections(sections: readonly PageSection[]): PageSection[] {
  return sections.filter((section) => section.visible);
}

/** Botao flutuante de WhatsApp, quando a empresa habilita a opcao. */
function FloatingWhatsApp() {
  const section: PageSection = {
    ...createSection('whatsapp_button'),
    id: 'whatsapp-flutuante',
    props: {
      label: 'Falar no WhatsApp',
      context: 'generic',
      customMessage: '',
      placement: 'floating',
      size: 'lg',
      showIcon: true,
    },
  };
  return <WhatsAppButtonBlock section={section} />;
}

function SiteBody({ site }: { site: PublicSiteData }) {
  const { routeKind } = site.context;

  if (routeKind === 'page' && site.page) {
    return (
      <>
        {visibleSections(site.page.layout.sections).map((section) => (
          <BlockRenderer key={section.id} section={section} />
        ))}
      </>
    );
  }

  const header = site.chrome.header;
  const footer = site.chrome.footer;

  return (
    <>
      {header ? <BlockRenderer section={header} /> : null}
      <main id="conteudo">
        {routeKind === 'property' && site.property ? <PropertyDetail property={site.property} /> : null}
        {routeKind === 'project' && site.project ? <ProjectDetail project={site.project} /> : null}
        {routeKind === 'not_found' ? <NotFound /> : null}
      </main>
      {footer ? <BlockRenderer section={footer} /> : null}
    </>
  );
}

export function SiteRenderer({ data }: { data: PublicSiteData }) {
  return (
    <SiteDataProvider value={data}>
      <a className="ct-skip" href="#conteudo">
        Ir para o conteudo
      </a>
      <SiteBody site={data} />
      {data.sections.floatingWhatsApp ? <FloatingWhatsApp /> : null}
      {data.context.preview ? (
        <p className="ct-preview-flag">Previa do rascunho - este conteudo ainda nao esta publicado</p>
      ) : null}
    </SiteDataProvider>
  );
}

/** Secoes efetivamente renderizadas, usado para gerar o CSS da pagina. */
export function renderedSections(data: PublicSiteData): PageSection[] {
  if (data.context.routeKind === 'page' && data.page) {
    return visibleSections(data.page.layout.sections);
  }
  return [data.chrome.header, data.chrome.footer].filter((section): section is PageSection => section !== null);
}
