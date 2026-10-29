import {
  BLOCK_DEFINITIONS,
  LEAD_INTEREST_LABELS,
  LEAD_INTEREST_TYPES,
  PROJECT_CATEGORIES,
  PROJECT_CATEGORY_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  PROPERTY_COMMERCIAL_STATUSES,
  PROPERTY_COMMERCIAL_STATUS_LABELS,
  PROPERTY_PURPOSES,
  PROPERTY_PURPOSE_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  SAFE_ICONS,
  type BlockType,
} from '@codeca/shared';

/**
 * Descricao dos controles do painel de propriedades do editor.
 *
 * Os schemas Zod em `@codeca/shared` definem o que e valido; aqui dizemos como
 * cada propriedade e apresentada ao usuario -- rotulo em portugues, tipo de
 * controle e faixa. Manter isso explicito evita formularios gerados
 * automaticamente com rotulos tecnicos.
 */

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'range'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'color'
  | 'image'
  | 'icon'
  | 'link'
  | 'buttons'
  | 'links'
  | 'items';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  path: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  placeholder?: string;
  options?: readonly FieldOption[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Campos de cada item, para listas de objetos. */
  itemFields?: readonly FieldDef[];
  itemLabel?: string;
  maxItems?: number;
  /** Rotulo mostrado quando o valor e nulo (campos opcionais). */
  nullable?: boolean;
}

export interface FieldGroup {
  title: string;
  fields: readonly FieldDef[];
  /** Grupo recolhido por padrao. */
  collapsed?: boolean;
}

const text = (path: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  path,
  label,
  kind: 'text',
  ...extra,
});
const area = (path: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  path,
  label,
  kind: 'textarea',
  ...extra,
});
const bool = (path: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  path,
  label,
  kind: 'boolean',
  ...extra,
});
const pick = (path: string, label: string, options: readonly FieldOption[], extra: Partial<FieldDef> = {}): FieldDef => ({
  path,
  label,
  kind: 'select',
  options,
  ...extra,
});
const range = (path: string, label: string, min: number, max: number, extra: Partial<FieldDef> = {}): FieldDef => ({
  path,
  label,
  kind: 'range',
  min,
  max,
  ...extra,
});

const columns = (path = 'columns'): FieldDef => range(path, 'Colunas', 1, 4, { unit: '' });
const limit = (path = 'limit', label = 'Quantidade exibida'): FieldDef =>
  range(path, label, 1, 24, { unit: '' });

const optionsFrom = <T extends string>(values: readonly T[], map: Record<T, string>): FieldOption[] =>
  values.map((value) => ({ value, label: map[value] }));

const ICON_OPTIONS: FieldOption[] = SAFE_ICONS.map((icon) => ({ value: icon, label: icon }));

const BUTTON_FIELDS: FieldDef[] = [
  text('label', 'Texto do botao'),
  { path: 'href', label: 'Link', kind: 'link', hint: 'Pagina interna (/contato), ancora (#secao) ou URL completa.' },
  pick('variant', 'Estilo', [
    { value: 'primary', label: 'Primario' },
    { value: 'secondary', label: 'Secundario' },
    { value: 'accent', label: 'Destaque' },
    { value: 'outline', label: 'Contornado' },
    { value: 'ghost', label: 'Discreto' },
  ]),
  bool('newTab', 'Abrir em nova aba'),
];

const LINK_FIELDS: FieldDef[] = [
  text('label', 'Texto'),
  { path: 'href', label: 'Link', kind: 'link' },
  bool('newTab', 'Abrir em nova aba'),
];

const ALIGN_OPTIONS: FieldOption[] = [
  { value: 'left', label: 'Esquerda' },
  { value: 'center', label: 'Centro' },
  { value: 'right', label: 'Direita' },
];

/** Grupos de propriedades por tipo de bloco. */
export const BLOCK_FIELDS: Record<BlockType, readonly FieldGroup[]> = {
  header: [
    {
      title: 'Conteudo',
      fields: [
        pick('source', 'Origem do menu', [
          { value: 'menu', label: 'Menu de navegacao do site' },
          { value: 'inline', label: 'Links definidos neste bloco' },
        ]),
        text('menuKey', 'Chave do menu', { hint: 'Normalmente "principal".' }),
        { path: 'links', label: 'Links do bloco', kind: 'links', itemFields: LINK_FIELDS, maxItems: 12 },
        { path: 'logo', label: 'Logo especifico deste bloco', kind: 'image', nullable: true },
      ],
    },
    {
      title: 'Contato e acao',
      fields: [
        bool('showPhone', 'Mostrar telefone'),
        bool('showWhatsApp', 'Mostrar botao de WhatsApp'),
        { path: 'cta', label: 'Botao de acao', kind: 'buttons', itemFields: BUTTON_FIELDS, maxItems: 1 },
      ],
    },
    {
      title: 'Aparencia',
      collapsed: true,
      fields: [
        pick('variant', 'Variacao', [
          { value: 'inherit', label: 'Seguir a identidade visual' },
          { value: 'light', label: 'Claro' },
          { value: 'dark', label: 'Escuro' },
          { value: 'transparent', label: 'Transparente' },
        ]),
        bool('sticky', 'Fixar ao rolar a pagina'),
      ],
    },
  ],

  navigation: [
    {
      title: 'Links',
      fields: [
        { path: 'links', label: 'Links', kind: 'links', itemFields: LINK_FIELDS, maxItems: 12 },
        pick('align', 'Alinhamento', ALIGN_OPTIONS),
        bool('compact', 'Compacto'),
      ],
    },
  ],

  hero: [
    {
      title: 'Textos',
      fields: [
        text('eyebrow', 'Texto acima do titulo', { placeholder: 'Construtora e incorporadora' }),
        text('title', 'Titulo'),
        area('subtitle', 'Subtitulo'),
      ],
    },
    {
      title: 'Botoes',
      fields: [{ path: 'buttons', label: 'Botoes', kind: 'buttons', itemFields: BUTTON_FIELDS, maxItems: 3 }],
    },
    {
      title: 'Layout',
      fields: [
        pick('height', 'Altura', [
          { value: 'small', label: 'Baixa' },
          { value: 'medium', label: 'Media' },
          { value: 'large', label: 'Alta' },
          { value: 'full', label: 'Tela cheia' },
        ]),
        pick('contentPosition', 'Posicao do conteudo', ALIGN_OPTIONS),
      ],
    },
  ],

  text: [
    {
      title: 'Conteudo',
      fields: [
        text('title', 'Titulo'),
        area('subtitle', 'Subtitulo'),
        { path: 'body', label: 'Texto', kind: 'richtext', hint: 'Deixe uma linha em branco para separar paragrafos.' },
        range('columns', 'Colunas de texto', 1, 2, { unit: '' }),
      ],
    },
  ],

  image: [
    {
      title: 'Imagem',
      fields: [
        { path: 'image', label: 'Imagem', kind: 'image' },
        text('caption', 'Legenda'),
        pick('aspect', 'Proporcao', [
          { value: 'original', label: 'Original' },
          { value: '16/9', label: '16:9' },
          { value: '4/3', label: '4:3' },
          { value: '1/1', label: 'Quadrada' },
          { value: '3/4', label: 'Retrato' },
        ]),
        bool('fullWidth', 'Ocupar toda a largura'),
        { path: 'href', label: 'Link ao clicar', kind: 'link' },
      ],
    },
  ],

  image_text: [
    {
      title: 'Conteudo',
      fields: [
        { path: 'image', label: 'Imagem', kind: 'image' },
        text('title', 'Titulo'),
        area('subtitle', 'Subtitulo'),
        { path: 'body', label: 'Texto', kind: 'richtext' },
        { path: 'buttons', label: 'Botoes', kind: 'buttons', itemFields: BUTTON_FIELDS, maxItems: 2 },
      ],
    },
    {
      title: 'Layout',
      fields: [
        pick('imagePosition', 'Posicao da imagem', [
          { value: 'left', label: 'Esquerda' },
          { value: 'right', label: 'Direita' },
        ]),
        range('imageWidthPercent', 'Largura da imagem', 25, 75, { unit: '%' }),
        pick('verticalAlign', 'Alinhamento vertical', [
          { value: 'start', label: 'Topo' },
          { value: 'center', label: 'Centro' },
        ]),
      ],
    },
  ],

  gallery: [
    {
      title: 'Conteudo',
      fields: [
        text('title', 'Titulo'),
        area('subtitle', 'Subtitulo'),
        pick('source', 'Origem das imagens', [
          { value: 'manual', label: 'Imagens escolhidas aqui' },
          { value: 'library', label: 'Biblioteca de imagens da empresa' },
        ]),
        text('libraryTag', 'Filtrar pela etiqueta', { hint: 'Deixe vazio para usar todas as imagens.' }),
      ],
    },
    {
      title: 'Layout',
      fields: [
        columns(),
        limit('limit', 'Maximo de imagens'),
        range('gapPx', 'Espaco entre imagens', 0, 48),
        pick('aspect', 'Proporcao', [
          { value: 'original', label: 'Original' },
          { value: '16/9', label: '16:9' },
          { value: '4/3', label: '4:3' },
          { value: '1/1', label: 'Quadrada' },
        ]),
        bool('lightbox', 'Ampliar ao clicar'),
      ],
    },
  ],

  property_grid: [
    {
      title: 'Conteudo',
      fields: [text('title', 'Titulo'), area('subtitle', 'Subtitulo')],
    },
    {
      title: 'Quais imoveis mostrar',
      fields: [
        {
          path: 'filter.purpose',
          label: 'Finalidade',
          kind: 'multiselect',
          options: optionsFrom(PROPERTY_PURPOSES, PROPERTY_PURPOSE_LABELS),
          hint: 'Sem selecao, mostra todas.',
        },
        {
          path: 'filter.types',
          label: 'Tipo de imovel',
          kind: 'multiselect',
          options: optionsFrom(PROPERTY_TYPES, PROPERTY_TYPE_LABELS),
        },
        {
          path: 'filter.commercialStatus',
          label: 'Situacao comercial',
          kind: 'multiselect',
          options: optionsFrom(PROPERTY_COMMERCIAL_STATUSES, PROPERTY_COMMERCIAL_STATUS_LABELS),
        },
        text('filter.city', 'Cidade'),
        text('filter.neighborhood', 'Bairro'),
        bool('filter.featuredOnly', 'Somente imoveis em destaque'),
        pick('orderBy', 'Ordenacao', [
          { value: 'recent', label: 'Mais recentes' },
          { value: 'price_asc', label: 'Menor preco' },
          { value: 'price_desc', label: 'Maior preco' },
          { value: 'manual', label: 'Ordem definida no cadastro' },
        ]),
      ],
    },
    {
      title: 'Layout e cartao',
      fields: [
        limit(),
        columns(),
        bool('showPrice', 'Mostrar preco'),
        bool('showLocation', 'Mostrar localizacao'),
        bool('showFeatures', 'Mostrar caracteristicas'),
        bool('showFilters', 'Mostrar filtros para o visitante'),
        text('cardCtaLabel', 'Texto do botao do cartao'),
        { path: 'showMoreButton', label: 'Botao "ver todos"', kind: 'buttons', itemFields: BUTTON_FIELDS, maxItems: 1 },
        text('emptyMessage', 'Mensagem quando nao houver imoveis'),
      ],
    },
  ],

  property_featured: [
    {
      title: 'Conteudo',
      fields: [
        text('title', 'Titulo'),
        area('subtitle', 'Subtitulo'),
        pick('selection', 'Qual imovel', [
          { value: 'auto', label: 'O imovel marcado como destaque' },
          { value: 'manual', label: 'Escolher um imovel especifico' },
        ]),
      ],
    },
    {
      title: 'Exibicao',
      fields: [
        bool('showGallery', 'Mostrar galeria'),
        bool('showFeatures', 'Mostrar caracteristicas'),
        bool('showPrice', 'Mostrar preco'),
        text('ctaLabel', 'Texto do botao'),
        bool('whatsAppCta', 'Incluir botao de WhatsApp'),
      ],
    },
  ],

  projects: [
    { title: 'Conteudo', fields: [text('title', 'Titulo'), area('subtitle', 'Subtitulo')] },
    {
      title: 'Quais obras mostrar',
      fields: [
        {
          path: 'filter.statuses',
          label: 'Situacao',
          kind: 'multiselect',
          options: optionsFrom(PROJECT_STATUSES, PROJECT_STATUS_LABELS),
        },
        {
          path: 'filter.categories',
          label: 'Categoria',
          kind: 'multiselect',
          options: optionsFrom(PROJECT_CATEGORIES, PROJECT_CATEGORY_LABELS),
        },
      ],
    },
    {
      title: 'Layout e cartao',
      fields: [
        limit(),
        columns(),
        bool('showStage', 'Mostrar etapa atual'),
        bool('showProgress', 'Mostrar percentual de evolucao', {
          hint: 'O percentual aparece apenas nas obras em que a empresa informou o valor.',
        }),
        bool('showLocation', 'Mostrar localizacao'),
        bool('showDates', 'Mostrar datas'),
        text('cardCtaLabel', 'Texto do botao do cartao'),
        { path: 'showMoreButton', label: 'Botao "ver todas"', kind: 'buttons', itemFields: BUTTON_FIELDS, maxItems: 1 },
        text('emptyMessage', 'Mensagem quando nao houver obras'),
      ],
    },
  ],

  services: [
    { title: 'Conteudo', fields: [text('title', 'Titulo'), area('subtitle', 'Subtitulo')] },
    {
      title: 'Layout',
      fields: [
        limit(),
        columns(),
        pick('layout', 'Formato', [
          { value: 'cards', label: 'Cartoes com imagem' },
          { value: 'list', label: 'Lista' },
          { value: 'icons', label: 'Icones' },
        ]),
        bool('showImage', 'Mostrar imagem do servico'),
        bool('showIcon', 'Mostrar icone'),
        bool('showCta', 'Mostrar botao'),
        text('ctaLabel', 'Texto do botao'),
        text('emptyMessage', 'Mensagem quando nao houver servicos'),
      ],
    },
  ],

  about: [
    {
      title: 'Conteudo',
      fields: [
        text('title', 'Titulo'),
        area('subtitle', 'Subtitulo'),
        {
          path: 'body',
          label: 'Texto',
          kind: 'richtext',
          hint: 'Se ficar vazio, usamos a descricao cadastrada nas configuracoes da empresa.',
        },
        { path: 'image', label: 'Imagem', kind: 'image', nullable: true },
        pick('imagePosition', 'Posicao da imagem', [
          { value: 'left', label: 'Esquerda' },
          { value: 'right', label: 'Direita' },
        ]),
      ],
    },
    {
      title: 'Numeros',
      fields: [
        {
          path: 'stats',
          label: 'Numeros em destaque',
          kind: 'items',
          maxItems: 4,
          itemLabel: 'Numero',
          itemFields: [text('value', 'Valor', { placeholder: '18 anos' }), text('label', 'Descricao')],
        },
      ],
    },
    {
      title: 'Botoes',
      fields: [{ path: 'buttons', label: 'Botoes', kind: 'buttons', itemFields: BUTTON_FIELDS, maxItems: 2 }],
    },
  ],

  differentials: [
    { title: 'Conteudo', fields: [text('title', 'Titulo'), area('subtitle', 'Subtitulo')] },
    {
      title: 'Itens',
      fields: [
        {
          path: 'items',
          label: 'Diferenciais',
          kind: 'items',
          maxItems: 12,
          itemLabel: 'Diferencial',
          itemFields: [
            { path: 'icon', label: 'Icone', kind: 'icon', options: ICON_OPTIONS },
            text('title', 'Titulo'),
            area('text', 'Descricao'),
          ],
        },
      ],
    },
    {
      title: 'Layout',
      fields: [
        columns(),
        pick('layout', 'Formato', [
          { value: 'cards', label: 'Cartoes' },
          { value: 'plain', label: 'Sem cartao' },
        ]),
      ],
    },
  ],

  team: [
    { title: 'Conteudo', fields: [text('title', 'Titulo'), area('subtitle', 'Subtitulo')] },
    {
      title: 'Layout',
      fields: [
        limit(),
        columns(),
        bool('showRole', 'Mostrar cargo'),
        bool('showBio', 'Mostrar mini biografia'),
        bool('showSocial', 'Mostrar redes sociais'),
        text('emptyMessage', 'Mensagem quando nao houver equipe'),
      ],
    },
  ],

  testimonials: [
    { title: 'Conteudo', fields: [text('title', 'Titulo'), area('subtitle', 'Subtitulo')] },
    {
      title: 'Layout',
      fields: [
        limit(),
        columns(),
        bool('showPhoto', 'Mostrar foto'),
        bool('showRole', 'Mostrar cargo ou empreendimento'),
        pick('layout', 'Formato', [
          { value: 'cards', label: 'Cartoes' },
          { value: 'quotes', label: 'Citacoes' },
        ]),
        text('emptyMessage', 'Mensagem quando nao houver depoimentos'),
      ],
    },
  ],

  faq: [
    {
      title: 'Conteudo',
      fields: [
        text('title', 'Titulo'),
        area('subtitle', 'Subtitulo'),
        pick('source', 'Origem das perguntas', [
          { value: 'content', label: 'Perguntas cadastradas no painel' },
          { value: 'inline', label: 'Perguntas definidas neste bloco' },
        ]),
        {
          path: 'items',
          label: 'Perguntas do bloco',
          kind: 'items',
          maxItems: 24,
          itemLabel: 'Pergunta',
          itemFields: [text('question', 'Pergunta'), area('answer', 'Resposta')],
        },
        limit('limit', 'Maximo de perguntas'),
        bool('openFirst', 'Primeira pergunta aberta'),
      ],
    },
  ],

  whatsapp_button: [
    {
      title: 'Botao',
      fields: [
        text('label', 'Texto do botao'),
        pick('context', 'Assunto da mensagem', [
          { value: 'generic', label: 'Contato geral' },
          { value: 'quote', label: 'Pedido de orcamento' },
        ]),
        area('customMessage', 'Mensagem personalizada', {
          hint: 'Deixe vazio para usar a mensagem automatica conforme o assunto.',
        }),
        pick('placement', 'Posicao', [
          { value: 'inline', label: 'Dentro da pagina' },
          { value: 'floating', label: 'Flutuante no canto' },
        ]),
        pick('size', 'Tamanho', [
          { value: 'md', label: 'Normal' },
          { value: 'lg', label: 'Grande' },
        ]),
        bool('showIcon', 'Mostrar icone'),
      ],
    },
  ],

  contact_form: [
    { title: 'Conteudo', fields: [text('title', 'Titulo'), area('subtitle', 'Subtitulo')] },
    {
      title: 'Campos',
      fields: [
        {
          path: 'interestOptions',
          label: 'Assuntos disponiveis',
          kind: 'multiselect',
          options: optionsFrom(LEAD_INTEREST_TYPES, LEAD_INTEREST_LABELS),
        },
        bool('requireEmail', 'Exigir e-mail'),
        bool('showMessage', 'Mostrar campo de mensagem'),
        text('submitLabel', 'Texto do botao de envio'),
      ],
    },
    {
      title: 'Privacidade e retorno',
      fields: [
        area('consentText', 'Texto do consentimento', {
          hint: 'O visitante precisa marcar esta autorizacao para enviar o formulario.',
        }),
        area('successMessage', 'Mensagem de sucesso'),
      ],
    },
    {
      title: 'Layout',
      fields: [
        bool('showContactInfo', 'Mostrar telefone, e-mail e endereco'),
        pick('layout', 'Formato', [
          { value: 'split', label: 'Formulario e contato lado a lado' },
          { value: 'stacked', label: 'Um abaixo do outro' },
        ]),
      ],
    },
  ],

  cta: [
    {
      title: 'Conteudo',
      fields: [
        text('title', 'Titulo'),
        area('subtitle', 'Subtitulo'),
        { path: 'buttons', label: 'Botoes', kind: 'buttons', itemFields: BUTTON_FIELDS, maxItems: 2 },
        pick('layout', 'Formato', [
          { value: 'center', label: 'Centralizado' },
          { value: 'split', label: 'Texto e botoes lado a lado' },
        ]),
      ],
    },
  ],

  footer: [
    {
      title: 'Conteudo',
      fields: [
        bool('showLogo', 'Mostrar logo'),
        area('about', 'Texto sobre a empresa'),
        {
          path: 'columns',
          label: 'Colunas de links',
          kind: 'items',
          maxItems: 4,
          itemLabel: 'Coluna',
          itemFields: [
            text('title', 'Titulo da coluna'),
            { path: 'links', label: 'Links', kind: 'links', itemFields: LINK_FIELDS, maxItems: 8 },
          ],
        },
      ],
    },
    {
      title: 'Exibicao',
      fields: [
        bool('showSocial', 'Mostrar redes sociais'),
        bool('showAddress', 'Mostrar endereco'),
        bool('showWhatsApp', 'Mostrar WhatsApp'),
        text('legalText', 'Texto legal'),
        bool('showPlatformBadge', 'Mostrar selo da plataforma', {
          hint: 'Planos que incluem a remocao do selo podem desligar esta opcao.',
        }),
      ],
    },
  ],

  spacer: [{ title: 'Espaco', fields: [range('heightPx', 'Altura', 4, 400)] }],

  divider: [
    {
      title: 'Divisor',
      fields: [
        range('thicknessPx', 'Espessura', 1, 12),
        { path: 'color', label: 'Cor', kind: 'color', nullable: true },
        range('widthPercent', 'Largura', 10, 100, { unit: '%' }),
        pick('style', 'Estilo', [
          { value: 'solid', label: 'Solido' },
          { value: 'dashed', label: 'Tracejado' },
          { value: 'dotted', label: 'Pontilhado' },
        ]),
      ],
    },
  ],
};

/** Campos de estilo, iguais para todos os blocos. */
export const STYLE_GROUPS: readonly FieldGroup[] = [
  {
    title: 'Espacamento',
    fields: [
      range('padding.top', 'Espaco acima', 0, 240),
      range('padding.bottom', 'Espaco abaixo', 0, 240),
      range('padding.left', 'Espaco a esquerda', 0, 120),
      range('padding.right', 'Espaco a direita', 0, 120),
    ],
  },
  {
    title: 'Fundo',
    fields: [
      pick('background.kind', 'Tipo de fundo', [
        { value: 'none', label: 'Sem fundo' },
        { value: 'color', label: 'Cor solida' },
        { value: 'gradient', label: 'Degrade' },
        { value: 'image', label: 'Imagem' },
      ]),
      { path: 'background.color', label: 'Cor do fundo', kind: 'color', nullable: true },
      { path: 'background.gradientTo', label: 'Cor final do degrade', kind: 'color', nullable: true },
      { path: 'background.image', label: 'Imagem de fundo', kind: 'image', nullable: true },
      range('background.overlayOpacity', 'Escurecer a imagem', 0, 100, { unit: '%' }),
      bool('background.fixed', 'Fundo fixo ao rolar'),
    ],
  },
  {
    title: 'Texto e alinhamento',
    fields: [
      pick('align', 'Alinhamento', ALIGN_OPTIONS),
      { path: 'textColor', label: 'Cor do texto', kind: 'color', nullable: true },
    ],
  },
  {
    title: 'Dimensoes e bordas',
    collapsed: true,
    fields: [
      pick('containerWidth', 'Largura do conteudo', [
        { value: 'content', label: 'Padrao do tema' },
        { value: 'narrow', label: 'Estreita' },
        { value: 'wide', label: 'Ampla' },
        { value: 'full', label: 'Total' },
      ]),
      range('radiusPx', 'Cantos arredondados', 0, 64, { nullable: true }),
      range('minHeightPx', 'Altura minima', 0, 1200, { nullable: true }),
      range('maxWidthPx', 'Largura maxima do texto', 160, 1920, { nullable: true }),
      pick('border.style', 'Borda', [
        { value: 'none', label: 'Sem borda' },
        { value: 'solid', label: 'Solida' },
        { value: 'dashed', label: 'Tracejada' },
      ]),
      range('border.widthPx', 'Espessura da borda', 0, 12),
      { path: 'border.color', label: 'Cor da borda', kind: 'color', nullable: true },
    ],
  },
];

/** Campos disponiveis por tamanho de tela. */
export const RESPONSIVE_FIELDS: readonly FieldDef[] = [
  bool('hidden', 'Ocultar neste tamanho'),
  pick('align', 'Alinhamento', ALIGN_OPTIONS, { nullable: true }),
  range('columns', 'Colunas', 1, 6, { unit: '', nullable: true }),
  range('padding.top', 'Espaco acima', 0, 240, { nullable: true }),
  range('padding.bottom', 'Espaco abaixo', 0, 240, { nullable: true }),
  range('minHeightPx', 'Altura minima', 0, 1200, { nullable: true }),
];

/** Grupos de blocos para o painel de insercao. */
export function blockGroups() {
  const groups = new Map<string, BlockType[]>();
  for (const [type, definition] of Object.entries(BLOCK_DEFINITIONS)) {
    const list = groups.get(definition.group) ?? [];
    list.push(type as BlockType);
    groups.set(definition.group, list);
  }
  return groups;
}
