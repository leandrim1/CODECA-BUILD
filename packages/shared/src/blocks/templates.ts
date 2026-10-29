import type { BlockType } from './catalog.js';
import { LAYOUT_SCHEMA_VERSION, type PageLayout, createSection } from './layout.js';

/**
 * Layouts iniciais usados ao criar uma construtora. Garantem que o site
 * publique algo coerente antes de qualquer edicao manual.
 */

function layout(entries: Array<[BlockType, Record<string, unknown>?]>): PageLayout {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    sections: entries.map(([type, props], index) => {
      const section = createSection(type);
      return {
        ...section,
        order: index,
        props: props ? { ...section.props, ...props } : section.props,
      };
    }),
  };
}

export interface PageTemplate {
  slug: string;
  title: string;
  isHome: boolean;
  layout: PageLayout;
  seoTitle?: string;
  seoDescription?: string;
}

export function defaultPageTemplates(companyName: string): PageTemplate[] {
  return [
    {
      slug: 'home',
      title: 'Pagina inicial',
      isHome: true,
      seoTitle: `${companyName} | Construcao e incorporacao`,
      seoDescription: `Conheca os imoveis, as obras e os servicos da ${companyName}.`,
      layout: layout([
        ['header'],
        [
          'hero',
          {
            eyebrow: 'Construtora e incorporadora',
            title: `${companyName}`,
            subtitle: 'Projetos entregues com planejamento, qualidade e prazo respeitado.',
            buttons: [
              { label: 'Ver imoveis', href: '/imoveis', variant: 'primary', newTab: false },
              { label: 'Falar com a equipe', href: '/contato', variant: 'outline', newTab: false },
            ],
          },
        ],
        [
          'differentials',
          {
            title: 'Por que escolher a nossa construtora',
            items: [
              { icon: 'shield-check', title: 'Obra acompanhada', text: 'Equipe tecnica dedicada do projeto a entrega.' },
              { icon: 'clock', title: 'Prazo respeitado', text: 'Cronograma acompanhado etapa por etapa.' },
              { icon: 'badge-check', title: 'Acabamento conferido', text: 'Checklist de qualidade antes da entrega.' },
            ],
          },
        ],
        ['property_grid', { title: 'Imoveis disponiveis', limit: 6, columns: 3 }],
        ['projects', { title: 'Obras em andamento', limit: 3, columns: 3 }],
        ['services', { title: 'Nossos servicos', limit: 6, columns: 3 }],
        ['about', { title: 'Sobre a empresa' }],
        ['testimonials', { title: 'O que dizem nossos clientes', limit: 3 }],
        ['cta', { title: 'Vamos conversar sobre o seu projeto?', buttons: [{ label: 'Pedir orcamento', href: '/contato', variant: 'secondary', newTab: false }] }],
        ['contact_form', { title: 'Fale com a nossa equipe' }],
        ['footer'],
      ]),
    },
    {
      slug: 'sobre',
      title: 'Sobre a empresa',
      isHome: false,
      seoTitle: `Sobre a ${companyName}`,
      layout: layout([
        ['header'],
        ['hero', { title: 'Sobre a empresa', subtitle: '', height: 'small', buttons: [] }],
        ['about', { title: `A ${companyName}` }],
        ['differentials', { title: 'Como trabalhamos' }],
        ['team', { title: 'Nossa equipe' }],
        ['cta', { title: 'Quer conhecer nossos projetos?', buttons: [{ label: 'Ver obras', href: '/obras', variant: 'secondary', newTab: false }] }],
        ['footer'],
      ]),
    },
    {
      slug: 'servicos',
      title: 'Servicos',
      isHome: false,
      seoTitle: `Servicos | ${companyName}`,
      layout: layout([
        ['header'],
        ['hero', { title: 'Servicos', height: 'small', buttons: [] }],
        ['services', { title: '', limit: 12, columns: 3 }],
        ['contact_form', { title: 'Solicite um orcamento' }],
        ['footer'],
      ]),
    },
    {
      slug: 'imoveis',
      title: 'Imoveis',
      isHome: false,
      seoTitle: `Imoveis a venda | ${companyName}`,
      layout: layout([
        ['header'],
        ['hero', { title: 'Imoveis', height: 'small', buttons: [] }],
        ['property_grid', { title: '', limit: 24, columns: 3, showFilters: true }],
        ['footer'],
      ]),
    },
    {
      slug: 'obras',
      title: 'Obras e projetos',
      isHome: false,
      seoTitle: `Obras e projetos | ${companyName}`,
      layout: layout([
        ['header'],
        ['hero', { title: 'Obras e projetos', height: 'small', buttons: [] }],
        ['projects', { title: '', limit: 24, columns: 3, filter: { statuses: ['em_andamento', 'concluida'], categories: [] } }],
        ['footer'],
      ]),
    },
    {
      slug: 'galeria',
      title: 'Galeria',
      isHome: false,
      layout: layout([
        ['header'],
        ['hero', { title: 'Galeria', height: 'small', buttons: [] }],
        ['gallery', { title: '', source: 'library', limit: 24, columns: 3 }],
        ['footer'],
      ]),
    },
    {
      slug: 'contato',
      title: 'Contato',
      isHome: false,
      seoTitle: `Contato | ${companyName}`,
      layout: layout([
        ['header'],
        ['hero', { title: 'Contato', height: 'small', buttons: [] }],
        ['contact_form', { title: 'Como podemos ajudar?', layout: 'split' }],
        ['whatsapp_button', { label: 'Falar no WhatsApp agora' }],
        ['footer'],
      ]),
    },
  ];
}

export const DEFAULT_NAVIGATION = [
  { label: 'Inicio', href: '/', newTab: false },
  { label: 'Sobre', href: '/sobre', newTab: false },
  { label: 'Servicos', href: '/servicos', newTab: false },
  { label: 'Imoveis', href: '/imoveis', newTab: false },
  { label: 'Obras', href: '/obras', newTab: false },
  { label: 'Contato', href: '/contato', newTab: false },
];
