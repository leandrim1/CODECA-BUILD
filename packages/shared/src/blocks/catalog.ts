import { z } from 'zod';
import {
  LEAD_INTEREST_TYPES,
  PROJECT_CATEGORIES,
  PROJECT_STATUSES,
  PROPERTY_COMMERCIAL_STATUSES,
  PROPERTY_PURPOSES,
  PROPERTY_TYPES,
  SAFE_ICONS,
} from '../constants.js';
import { colorValueSchema } from '../theme.js';
import {
  ALIGNMENTS,
  blockStyleSchema,
  buttonSchema,
  headingSchema,
  imageRefSchema,
  linkSchema,
  responsiveSchema,
  richTextSchema,
  safeHrefSchema,
  subheadingSchema,
} from './primitives.js';

/**
 * Catalogo de blocos. Cada bloco tem schema de propriedades validado e uma
 * implementacao React em `@codeca/site-renderer`. Nao existe bloco que aceite
 * HTML, CSS ou JavaScript livre.
 */

export const BLOCK_GROUPS = ['estrutura', 'conteudo', 'imoveis', 'obras', 'social', 'conversao'] as const;
export type BlockGroup = (typeof BLOCK_GROUPS)[number];

export const BLOCK_GROUP_LABELS: Record<BlockGroup, string> = {
  estrutura: 'Estrutura',
  conteudo: 'Conteudo',
  imoveis: 'Imoveis',
  obras: 'Obras e projetos',
  social: 'Prova social',
  conversao: 'Contato e conversao',
};

const columns = (def: number) => z.number().int().min(1).max(4).default(def);
const limit = (def: number) => z.number().int().min(1).max(48).default(def);
const iconSchema = z.enum(SAFE_ICONS);

// ---------------------------------------------------------------- estrutura

const headerProps = z.object({
  source: z.enum(['menu', 'inline']).default('menu'),
  menuKey: z.string().trim().max(60).default('principal'),
  links: z.array(linkSchema).max(12).default([]),
  logo: imageRefSchema.nullable().default(null),
  showPhone: z.boolean().default(true),
  showWhatsApp: z.boolean().default(true),
  cta: buttonSchema.nullable().default(null),
  variant: z.enum(['inherit', 'light', 'dark', 'transparent']).default('inherit'),
  sticky: z.boolean().default(true),
});

const navigationProps = z.object({
  links: z.array(linkSchema).max(12).default([]),
  align: z.enum(ALIGNMENTS).default('center'),
  compact: z.boolean().default(false),
});

const footerProps = z.object({
  showLogo: z.boolean().default(true),
  about: richTextSchema.default(''),
  columns: z
    .array(
      z.object({
        title: z.string().trim().max(60),
        links: z.array(linkSchema).max(8).default([]),
      }),
    )
    .max(4)
    .default([]),
  showSocial: z.boolean().default(true),
  showAddress: z.boolean().default(true),
  showWhatsApp: z.boolean().default(true),
  legalText: z.string().trim().max(400).default(''),
  showPlatformBadge: z.boolean().default(true),
});

const spacerProps = z.object({
  heightPx: z.number().int().min(4).max(400).default(48),
});

const dividerProps = z.object({
  thicknessPx: z.number().int().min(1).max(12).default(1),
  color: colorValueSchema.nullable().default(null),
  widthPercent: z.number().int().min(10).max(100).default(100),
  style: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
});

// ----------------------------------------------------------------- conteudo

const heroProps = z.object({
  eyebrow: z.string().trim().max(80).default(''),
  title: headingSchema.default('Construimos o lugar onde a sua historia acontece'),
  subtitle: subheadingSchema.default(''),
  buttons: z.array(buttonSchema).max(3).default([]),
  height: z.enum(['small', 'medium', 'large', 'full']).default('large'),
  contentPosition: z.enum(['left', 'center', 'right']).default('left'),
  showScrollHint: z.boolean().default(false),
});

const textProps = z.object({
  title: headingSchema.default(''),
  subtitle: subheadingSchema.default(''),
  body: richTextSchema.default(''),
  columns: z.number().int().min(1).max(2).default(1),
});

const imageProps = z.object({
  image: imageRefSchema.prefault({}),
  caption: z.string().trim().max(240).default(''),
  aspect: z.enum(['original', '16/9', '4/3', '1/1', '3/4']).default('16/9'),
  fullWidth: z.boolean().default(false),
  href: safeHrefSchema.default(''),
});

const imageTextProps = z.object({
  image: imageRefSchema.prefault({}),
  title: headingSchema.default(''),
  subtitle: subheadingSchema.default(''),
  body: richTextSchema.default(''),
  buttons: z.array(buttonSchema).max(2).default([]),
  imagePosition: z.enum(['left', 'right']).default('left'),
  imageWidthPercent: z.number().int().min(25).max(75).default(50),
  verticalAlign: z.enum(['start', 'center']).default('center'),
});

const galleryProps = z.object({
  title: headingSchema.default(''),
  subtitle: subheadingSchema.default(''),
  source: z.enum(['manual', 'library']).default('manual'),
  /** Rotulo da galeria da biblioteca quando `source === 'library'`. */
  libraryTag: z.string().trim().max(60).default(''),
  images: z.array(imageRefSchema).max(48).default([]),
  columns: columns(3),
  gapPx: z.number().int().min(0).max(48).default(16),
  aspect: z.enum(['original', '16/9', '4/3', '1/1']).default('4/3'),
  lightbox: z.boolean().default(true),
  limit: limit(12),
});

const aboutProps = z.object({
  title: headingSchema.default('Sobre a empresa'),
  subtitle: subheadingSchema.default(''),
  body: richTextSchema.default(''),
  image: imageRefSchema.nullable().default(null),
  imagePosition: z.enum(['left', 'right']).default('right'),
  stats: z
    .array(
      z.object({
        value: z.string().trim().max(24),
        label: z.string().trim().max(60),
      }),
    )
    .max(4)
    .default([]),
  buttons: z.array(buttonSchema).max(2).default([]),
});

const differentialsProps = z.object({
  title: headingSchema.default('Nossos diferenciais'),
  subtitle: subheadingSchema.default(''),
  items: z
    .array(
      z.object({
        icon: iconSchema.default('badge-check'),
        title: z.string().trim().max(80),
        text: z.string().trim().max(400).default(''),
      }),
    )
    .max(12)
    .default([]),
  columns: columns(3),
  layout: z.enum(['cards', 'plain']).default('cards'),
});

const faqProps = z.object({
  title: headingSchema.default('Perguntas frequentes'),
  subtitle: subheadingSchema.default(''),
  source: z.enum(['content', 'inline']).default('content'),
  items: z
    .array(
      z.object({
        question: z.string().trim().max(240),
        answer: z.string().trim().max(2000),
      }),
    )
    .max(24)
    .default([]),
  limit: limit(10),
  openFirst: z.boolean().default(false),
});

// ------------------------------------------------------------------ imoveis

const propertyFilterSchema = z.object({
  purpose: z.array(z.enum(PROPERTY_PURPOSES)).max(4).default([]),
  types: z.array(z.enum(PROPERTY_TYPES)).max(10).default([]),
  commercialStatus: z.array(z.enum(PROPERTY_COMMERCIAL_STATUSES)).max(5).default([]),
  city: z.string().trim().max(80).default(''),
  neighborhood: z.string().trim().max(80).default(''),
  featuredOnly: z.boolean().default(false),
});

const propertyGridProps = z.object({
  title: headingSchema.default('Imoveis disponiveis'),
  subtitle: subheadingSchema.default(''),
  filter: propertyFilterSchema.prefault({}),
  limit: limit(6),
  columns: columns(3),
  orderBy: z.enum(['recent', 'price_asc', 'price_desc', 'manual']).default('recent'),
  showPrice: z.boolean().default(true),
  showLocation: z.boolean().default(true),
  showFeatures: z.boolean().default(true),
  showFilters: z.boolean().default(false),
  cardCtaLabel: z.string().trim().max(40).default('Ver detalhes'),
  showMoreButton: buttonSchema.nullable().default(null),
  emptyMessage: z.string().trim().max(240).default('Nenhum imovel disponivel no momento.'),
});

const propertyFeaturedProps = z.object({
  title: headingSchema.default('Destaque'),
  subtitle: subheadingSchema.default(''),
  selection: z.enum(['auto', 'manual']).default('auto'),
  propertyId: z.string().uuid().nullable().default(null),
  showGallery: z.boolean().default(true),
  showFeatures: z.boolean().default(true),
  showPrice: z.boolean().default(true),
  ctaLabel: z.string().trim().max(40).default('Quero saber mais'),
  whatsAppCta: z.boolean().default(true),
});

// -------------------------------------------------------------------- obras

const projectsProps = z.object({
  title: headingSchema.default('Obras em andamento'),
  subtitle: subheadingSchema.default(''),
  filter: z
    .object({
      statuses: z.array(z.enum(PROJECT_STATUSES)).max(4).default(['em_andamento']),
      categories: z.array(z.enum(PROJECT_CATEGORIES)).max(6).default([]),
    })
    .prefault({}),
  limit: limit(6),
  columns: columns(3),
  showStage: z.boolean().default(true),
  /** O percentual so aparece quando a empresa informou o valor no cadastro. */
  showProgress: z.boolean().default(true),
  showLocation: z.boolean().default(true),
  showDates: z.boolean().default(false),
  cardCtaLabel: z.string().trim().max(40).default('Acompanhar obra'),
  showMoreButton: buttonSchema.nullable().default(null),
  emptyMessage: z.string().trim().max(240).default('Nenhuma obra publicada no momento.'),
});

const servicesProps = z.object({
  title: headingSchema.default('Nossos servicos'),
  subtitle: subheadingSchema.default(''),
  limit: limit(9),
  columns: columns(3),
  layout: z.enum(['cards', 'list', 'icons']).default('cards'),
  showImage: z.boolean().default(true),
  showIcon: z.boolean().default(false),
  showCta: z.boolean().default(true),
  ctaLabel: z.string().trim().max(40).default('Solicitar orcamento'),
  emptyMessage: z.string().trim().max(240).default('Nenhum servico cadastrado.'),
});

// -------------------------------------------------------------------- social

const teamProps = z.object({
  title: headingSchema.default('Nossa equipe'),
  subtitle: subheadingSchema.default(''),
  limit: limit(8),
  columns: columns(4),
  showRole: z.boolean().default(true),
  showBio: z.boolean().default(false),
  showSocial: z.boolean().default(false),
  emptyMessage: z.string().trim().max(240).default('Equipe nao cadastrada.'),
});

const testimonialsProps = z.object({
  title: headingSchema.default('O que dizem nossos clientes'),
  subtitle: subheadingSchema.default(''),
  limit: limit(6),
  columns: columns(3),
  showPhoto: z.boolean().default(true),
  showRole: z.boolean().default(true),
  layout: z.enum(['cards', 'quotes']).default('cards'),
  emptyMessage: z.string().trim().max(240).default('Nenhum depoimento publicado.'),
});

// ----------------------------------------------------------------- conversao

const whatsAppProps = z.object({
  label: z.string().trim().max(60).default('Falar no WhatsApp'),
  context: z.enum(['generic', 'quote']).default('generic'),
  customMessage: z.string().trim().max(400).default(''),
  placement: z.enum(['inline', 'floating']).default('inline'),
  size: z.enum(['md', 'lg']).default('lg'),
  showIcon: z.boolean().default(true),
});

const contactFormProps = z.object({
  title: headingSchema.default('Fale com a nossa equipe'),
  subtitle: subheadingSchema.default(''),
  interestOptions: z
    .array(z.enum(LEAD_INTEREST_TYPES))
    .max(LEAD_INTEREST_TYPES.length)
    .default(['compra_imovel', 'construcao', 'reforma', 'orcamento', 'outro']),
  requireEmail: z.boolean().default(false),
  showMessage: z.boolean().default(true),
  submitLabel: z.string().trim().max(40).default('Enviar mensagem'),
  consentText: z
    .string()
    .trim()
    .max(600)
    .default('Autorizo o contato da empresa sobre esta solicitacao, conforme a Politica de Privacidade.'),
  successMessage: z.string().trim().max(300).default('Recebemos a sua mensagem. Nossa equipe entrara em contato.'),
  showContactInfo: z.boolean().default(true),
  layout: z.enum(['stacked', 'split']).default('split'),
});

const ctaProps = z.object({
  title: headingSchema.default('Pronto para comecar o seu projeto?'),
  subtitle: subheadingSchema.default(''),
  buttons: z.array(buttonSchema).max(2).default([]),
  layout: z.enum(['center', 'split']).default('center'),
});

// --------------------------------------------------------------- definicoes

export const BLOCK_TYPES = [
  'header',
  'navigation',
  'hero',
  'text',
  'image',
  'image_text',
  'gallery',
  'property_grid',
  'property_featured',
  'projects',
  'services',
  'about',
  'differentials',
  'team',
  'testimonials',
  'faq',
  'whatsapp_button',
  'contact_form',
  'cta',
  'footer',
  'spacer',
  'divider',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface BlockDefinition {
  type: BlockType;
  label: string;
  description: string;
  icon: string;
  group: BlockGroup;
  propsSchema: z.ZodType<Record<string, unknown>>;
  /** Blocos avancados exigem o recurso `visual_editor_advanced_blocks` no plano. */
  advanced: boolean;
  /** Blocos que podem aparecer no maximo uma vez por pagina. */
  singleton: boolean;
  /** Estilo padrao aplicado ao inserir o bloco. */
  styleDefaults?: Partial<z.input<typeof blockStyleSchema>>;
}

function def(
  type: BlockType,
  label: string,
  description: string,
  icon: string,
  group: BlockGroup,
  propsSchema: z.ZodType<any>,
  options: { advanced?: boolean; singleton?: boolean; styleDefaults?: Partial<z.input<typeof blockStyleSchema>> } = {},
): BlockDefinition {
  return {
    type,
    label,
    description,
    icon,
    group,
    propsSchema: propsSchema as z.ZodType<Record<string, unknown>>,
    advanced: options.advanced ?? false,
    singleton: options.singleton ?? false,
    ...(options.styleDefaults ? { styleDefaults: options.styleDefaults } : {}),
  };
}

const NO_PADDING = { padding: { top: 0, bottom: 0, left: 0, right: 0 } } as const;

export const BLOCK_DEFINITIONS: Record<BlockType, BlockDefinition> = {
  header: def('header', 'Cabecalho', 'Logo, menu de navegacao e contato.', 'panel-top', 'estrutura', headerProps, {
    singleton: true,
    styleDefaults: NO_PADDING,
  }),
  navigation: def('navigation', 'Menu de navegacao', 'Barra de links adicional.', 'menu', 'estrutura', navigationProps, {
    styleDefaults: { padding: { top: 12, bottom: 12, left: 0, right: 0 } },
  }),
  hero: def('hero', 'Banner principal', 'Imagem de destaque com titulo e botoes.', 'image-play', 'conteudo', heroProps, {
    styleDefaults: {
      padding: { top: 96, bottom: 96, left: 0, right: 0 },
      background: { kind: 'color', color: 'secondary' },
      textColor: 'inverse',
    },
  }),
  text: def('text', 'Texto', 'Paragrafos simples com titulo opcional.', 'type', 'conteudo', textProps),
  image: def('image', 'Imagem', 'Uma imagem com legenda opcional.', 'image', 'conteudo', imageProps),
  image_text: def(
    'image_text',
    'Imagem com texto',
    'Imagem ao lado de um texto com botoes.',
    'panels-top-left',
    'conteudo',
    imageTextProps,
  ),
  gallery: def('gallery', 'Galeria', 'Grade de imagens da biblioteca.', 'images', 'conteudo', galleryProps),
  property_grid: def(
    'property_grid',
    'Grade de imoveis',
    'Lista de imoveis publicados com filtros.',
    'building-2',
    'imoveis',
    propertyGridProps,
  ),
  property_featured: def(
    'property_featured',
    'Imovel em destaque',
    'Apresenta um imovel com galeria e contato.',
    'star',
    'imoveis',
    propertyFeaturedProps,
    { advanced: true },
  ),
  projects: def(
    'projects',
    'Obras em andamento',
    'Obras e projetos com etapa e evolucao.',
    'hard-hat',
    'obras',
    projectsProps,
  ),
  services: def('services', 'Servicos', 'Servicos oferecidos pela construtora.', 'wrench', 'obras', servicesProps),
  about: def('about', 'Sobre a empresa', 'Historia, numeros e imagem.', 'info', 'conteudo', aboutProps),
  differentials: def(
    'differentials',
    'Diferenciais',
    'Lista de vantagens com icones.',
    'badge-check',
    'conteudo',
    differentialsProps,
  ),
  team: def('team', 'Equipe', 'Integrantes da equipe cadastrados.', 'users', 'social', teamProps),
  testimonials: def(
    'testimonials',
    'Depoimentos',
    'Depoimentos autorizados pela empresa.',
    'quote',
    'social',
    testimonialsProps,
  ),
  faq: def('faq', 'Perguntas frequentes', 'Perguntas e respostas em acordeao.', 'circle-help', 'conteudo', faqProps),
  whatsapp_button: def(
    'whatsapp_button',
    'Botao de WhatsApp',
    'Abre conversa com mensagem contextualizada.',
    'message-circle',
    'conversao',
    whatsAppProps,
    { styleDefaults: { padding: { top: 24, bottom: 24, left: 0, right: 0 }, align: 'center' } },
  ),
  contact_form: def(
    'contact_form',
    'Formulario de contato',
    'Recebe interessados direto no painel.',
    'mail',
    'conversao',
    contactFormProps,
  ),
  cta: def('cta', 'Chamada para acao', 'Faixa de destaque com botoes.', 'megaphone', 'conversao', ctaProps, {
    styleDefaults: { background: { kind: 'color', color: 'primary' }, textColor: 'inverse', align: 'center' },
  }),
  footer: def('footer', 'Rodape', 'Contato, links e dados da empresa.', 'panel-bottom', 'estrutura', footerProps, {
    singleton: true,
    styleDefaults: NO_PADDING,
  }),
  spacer: def('spacer', 'Espacador', 'Espaco vertical entre secoes.', 'move-vertical', 'estrutura', spacerProps, {
    styleDefaults: NO_PADDING,
  }),
  divider: def('divider', 'Divisor', 'Linha separadora.', 'minus', 'estrutura', dividerProps, {
    styleDefaults: { padding: { top: 24, bottom: 24, left: 0, right: 0 } },
  }),
};

export const BLOCK_LIST: readonly BlockDefinition[] = BLOCK_TYPES.map((t) => BLOCK_DEFINITIONS[t]);

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === 'string' && (BLOCK_TYPES as readonly string[]).includes(value);
}

export function blockDefinition(type: BlockType): BlockDefinition {
  return BLOCK_DEFINITIONS[type];
}

/** Propriedades padrao de um bloco recem-inserido. */
export function defaultBlockProps(type: BlockType): Record<string, unknown> {
  return BLOCK_DEFINITIONS[type].propsSchema.parse({}) as Record<string, unknown>;
}

export function defaultBlockStyle(type: BlockType): z.infer<typeof blockStyleSchema> {
  return blockStyleSchema.parse(BLOCK_DEFINITIONS[type].styleDefaults ?? {});
}

export function defaultResponsive(): z.infer<typeof responsiveSchema> {
  return responsiveSchema.parse({});
}
