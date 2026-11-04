import type { ModuleDefinition, ModuleField } from './types.js';

/**
 * Catalogo dos modulos da plataforma.
 *
 * Fonte unica: daqui saem a validacao do conteudo, a politica de campos, o que
 * o painel desenha e os tipos do SDK. Acrescentar um modulo e acrescentar uma
 * entrada -- e, para `collection`, a tabela correspondente.
 */

export const MODULE_KEYS = [
  'institucional',
  'contato',
  'banners',
  'imoveis',
  'obras',
  'servicos',
  'depoimentos',
  'equipe',
  'faq',
  'produtos',
  'categorias',
  'galerias',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

const campo = (
  key: string,
  label: string,
  type: ModuleField['type'],
  editableByDefault = true,
  extra: Partial<ModuleField> = {},
): ModuleField => ({ key, label, type, editableByDefault, ...extra });

export const MODULE_REGISTRY: Readonly<Record<ModuleKey, ModuleDefinition>> = {
  institucional: {
    key: 'institucional',
    name: 'Institucional',
    description: 'Quem é a empresa: apresentação, história e propósito.',
    kind: 'document',
    customFields: true,
    fields: [
      campo('companyName', 'Nome da empresa', 'text', true, { required: true }),
      campo('tagline', 'Frase de apresentação', 'text'),
      campo('shortDescription', 'Descrição curta', 'longText'),
      campo('history', 'História', 'longText'),
      campo('mission', 'Missao', 'longText'),
      campo('vision', 'Visão', 'longText'),
      campo('values', 'Valores', 'tags'),
      campo('logoImageId', 'Logotipo', 'image'),
      campo('coverImageId', 'Imagem de destaque', 'image'),
      campo('galleryImageIds', 'Galeria', 'imageList'),
      campo('foundedYear', 'Ano de fundação', 'number'),
    ],
  },
  contato: {
    key: 'contato',
    name: 'Contato',
    description: 'Como falar com a empresa e onde ela está.',
    kind: 'document',
    customFields: true,
    fields: [
      campo('email', 'E-mail', 'email'),
      campo('phone', 'Telefone', 'phone'),
      campo('whatsapp', 'WhatsApp', 'phone'),
      campo('whatsappMessage', 'Mensagem inicial do WhatsApp', 'longText'),
      campo('addressLine', 'Endereço', 'text'),
      campo('city', 'Cidade', 'text'),
      campo('state', 'Estado', 'text'),
      campo('postalCode', 'CEP', 'text'),
      campo('businessHours', 'Horário de atendimento', 'longText'),
      campo('serviceArea', 'Área de atuação', 'longText'),
      campo('mapUrl', 'Link do mapa', 'url'),
      campo('social', 'Redes sociais', 'tags'),
    ],
  },
  banners: {
    key: 'banners',
    name: 'Banners',
    description: 'Destaques rotativos na abertura do site.',
    kind: 'collection',
    table: 'banners',
    fields: [
      campo('title', 'Título', 'text', true, { required: true }),
      campo('subtitle', 'Subtítulo', 'longText'),
      campo('imageId', 'Imagem', 'image'),
      campo('buttonLabel', 'Texto do botão', 'text'),
      campo('buttonUrl', 'Link do botão', 'url'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('isActive', 'Ativo', 'boolean'),
      campo('startsAt', 'Publicar a partir de', 'date'),
      campo('endsAt', 'Despublicar em', 'date'),
    ],
  },
  imoveis: {
    key: 'imoveis',
    name: 'Imóveis',
    description: 'Carteira de imóveis a venda ou locação.',
    kind: 'collection',
    customFields: true,
    table: 'properties',
    fields: [
      campo('title', 'Título', 'text', true, { required: true }),
      campo('reference', 'Referência', 'text'),
      campo('description', 'Descrição', 'longText'),
      campo('shortDescription', 'Descrição curta', 'longText'),
      campo('type', 'Tipo', 'select', true, { required: true }),
      campo('purpose', 'Finalidade', 'select', true, { required: true }),
      campo('price', 'Preço', 'money'),
      campo('priceOnRequest', 'Preço sob consulta', 'boolean'),
      campo('condoFee', 'Condomínio', 'money'),
      campo('iptu', 'IPTU', 'money'),
      campo('address', 'Endereço', 'text'),
      campo('builtAreaM2', 'Área construída (m²)', 'number'),
      campo('landAreaM2', 'Área do terreno (m²)', 'number'),
      campo('bedrooms', 'Dormitórios', 'number'),
      campo('suites', 'Suítes', 'number'),
      campo('bathrooms', 'Banheiros', 'number'),
      campo('parkingSpots', 'Vagas', 'number'),
      campo('floor', 'Andar', 'number'),
      campo('features', 'Características', 'tags'),
      campo('coverImageId', 'Capa', 'image'),
      campo('galleryImageIds', 'Galeria', 'imageList'),
      campo('videoUrl', 'Video', 'url'),
      campo('publicationStatus', 'Publicação', 'select'),
      campo('commercialStatus', 'Situação comercial', 'select'),
      campo('featured', 'Destaque', 'boolean'),
      campo('deliveryDate', 'Data de entrega', 'date'),
      campo('seoTitle', 'Título para busca', 'text'),
      campo('seoDescription', 'Descrição para busca', 'longText'),
      campo('sortOrder', 'Ordem', 'number'),
      // A moeda decide como o site formata todo preco: trocar sozinho
      // quebraria a exibicao de uma carteira inteira.
      campo('currency', 'Moeda', 'select', false, {
        help: 'Definida com a CODECA IA: o site formata os precos a partir dela.',
      }),
      // Endereco do imovel na URL: mexer nele quebra links ja divulgados.
      campo('slug', 'Endereço na URL', 'text', false, {
        help: 'Alterar quebra links já divulgados e a indexação no Google.',
      }),
    ],
  },
  obras: {
    key: 'obras',
    name: 'Obras e projetos',
    description: 'Empreendimentos em andamento e concluidos.',
    kind: 'collection',
    customFields: true,
    table: 'projects',
    fields: [
      campo('title', 'Título', 'text', true, { required: true }),
      campo('description', 'Descrição', 'longText'),
      campo('shortDescription', 'Descrição curta', 'longText'),
      campo('category', 'Categoria', 'select'),
      campo('status', 'Situação', 'select'),
      campo('stage', 'Etapa', 'select'),
      campo('progressPercent', 'Percentual concluido', 'number'),
      campo('city', 'Cidade', 'text'),
      campo('state', 'Estado', 'text'),
      campo('neighborhood', 'Bairro', 'text'),
      campo('showLocation', 'Mostrar a localização no site', 'boolean'),
      campo('startDate', 'Início da obra', 'date'),
      campo('expectedCompletionDate', 'Previsão de entrega', 'date'),
      campo('completedDate', 'Conclusão', 'date'),
      campo('coverImageId', 'Capa', 'image'),
      campo('galleryImageIds', 'Galeria', 'imageList'),
      campo('publicationStatus', 'Publicação', 'select'),
      campo('featured', 'Destaque', 'boolean'),
      campo('seoTitle', 'Título para busca', 'text'),
      campo('seoDescription', 'Descrição para busca', 'longText'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('slug', 'Endereço na URL', 'text', false, {
        help: 'Alterar quebra links já divulgados e a indexação no Google.',
      }),
    ],
  },
  produtos: {
    key: 'produtos',
    name: 'Produtos',
    description: 'O catálogo, o cardápio ou a lista de itens da empresa.',
    kind: 'collection',
    customFields: true,
    table: 'products',
    fields: [
      campo('title', 'Nome', 'text', true, { required: true }),
      campo('summary', 'Resumo', 'longText'),
      campo('description', 'Descrição', 'longText'),
      campo('code', 'Código interno', 'text', true, {
        help: 'SKU ou referência. Aparece no site só se o projeto exibir.',
      }),
      campo('categoryId', 'Categoria', 'select'),
      campo('price', 'Preço', 'money'),
      campo('priceOnRequest', 'Preço sob consulta', 'boolean'),
      campo('unit', 'Unidade', 'text', true, {
        help: 'Ex.: un, kg, porção. Aparece ao lado do preço.',
      }),
      campo('isAvailable', 'Disponível', 'boolean', true, {
        help: 'Desmarque para indicar que acabou, sem tirar o produto do site.',
      }),
      campo('coverImageId', 'Imagem principal', 'image'),
      campo('galleryImageIds', 'Mais imagens', 'imageList'),
      campo('publicationStatus', 'Publicação', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('seoTitle', 'Título para busca', 'text'),
      campo('seoDescription', 'Descrição para busca', 'longText'),
      /**
       * Travados por padrao, pelos mesmos motivos de imoveis e servicos: o
       * slug esta em links divulgados e na indexacao do Google, e a moeda
       * define como o site formata todo preco.
       */
      campo('slug', 'Endereço na URL', 'text', false, {
        help: 'Alterar quebra links já divulgados e a indexação no Google.',
      }),
      campo('currency', 'Moeda', 'select', false, {
        help: 'Definida com a CODECA IA: o site formata os precos a partir dela.',
      }),
    ],
  },
  categorias: {
    key: 'categorias',
    name: 'Categorias',
    description: 'Como os produtos ficam agrupados no site.',
    kind: 'collection',
    table: 'categories',
    fields: [
      campo('name', 'Nome', 'text', true, { required: true }),
      campo('description', 'Descrição', 'longText'),
      campo('publicationStatus', 'Publicação', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('moduleKey', 'Módulo', 'select', false, {
        help: 'A que módulo a categoria pertence. Hoje somente produtos usa categorias.',
      }),
      campo('slug', 'Endereço na URL', 'text', false, {
        help: 'Alterar quebra links já divulgados e a indexação no Google.',
      }),
    ],
  },
  galerias: {
    key: 'galerias',
    name: 'Galerias',
    description: 'Conjuntos de imagens com nome: estrutura, antes e depois, eventos.',
    kind: 'collection',
    table: 'galleries',
    fields: [
      campo('title', 'Nome da galeria', 'text', true, { required: true }),
      campo('description', 'Descrição', 'longText'),
      campo('imageIds', 'Imagens', 'imageList', true, {
        help: 'A primeira da ordem é a capa.',
      }),
      campo('publicationStatus', 'Publicação', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('slug', 'Endereço na URL', 'text', false, {
        help: 'Alterar quebra links já divulgados e a indexação no Google.',
      }),
    ],
  },
  depoimentos: {
    key: 'depoimentos',
    name: 'Depoimentos',
    description: 'O que os clientes dizem, com autorização de quem disse.',
    kind: 'collection',
    customFields: true,
    table: 'testimonials',
    fields: [
      campo('authorName', 'Nome de quem deu o depoimento', 'text', true, { required: true }),
      campo('authorRole', 'Quem e a pessoa', 'text'),
      campo('content', 'Depoimento', 'longText', true, { required: true }),
      campo('rating', 'Nota', 'number'),
      campo('photoId', 'Foto', 'image'),
      campo('relatedProjectId', 'Obra relacionada', 'select'),
      /**
       * Nao e burocracia: um depoimento e o nome, a foto e as palavras de
       * **outra pessoa**. Publicar sem autorizacao dela e tratar dado pessoal
       * de terceiro sem base legal. O servidor recusa publicar sem isto, e a
       * API publica nao entrega o depoimento sem isto -- nem em previa.
       */
      campo('authorizationConfirmed', 'O autor autorizou a publicação', 'boolean', true, {
        help: 'Sem esta confirmação o depoimento fica guardado, mas não aparece no site.',
      }),
      campo('authorizationNote', 'Como a autorização foi obtida', 'text', true, {
        help: 'Ex.: autorizado por WhatsApp em 12/03. Fica só no painel, nunca no site.',
      }),
      campo('publicationStatus', 'Publicação', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
    ],
  },
  equipe: {
    key: 'equipe',
    name: 'Equipe',
    description: 'As pessoas da empresa que aparecem no site.',
    kind: 'collection',
    customFields: true,
    table: 'team_members',
    fields: [
      campo('name', 'Nome', 'text', true, { required: true }),
      campo('role', 'Cargo', 'text'),
      campo('bio', 'Apresentação', 'longText'),
      campo('photoId', 'Foto', 'image'),
      campo('email', 'E-mail', 'email', true, {
        help: 'Fica visível no site. Deixe vazio para não exibir.',
      }),
      campo('social', 'Redes sociais', 'tags'),
      campo('publicationStatus', 'Publicação', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
    ],
  },
  faq: {
    key: 'faq',
    name: 'Perguntas frequentes',
    description: 'As dúvidas que o site responde sem ninguém precisar ligar.',
    kind: 'collection',
    table: 'faqs',
    fields: [
      campo('question', 'Pergunta', 'text', true, { required: true }),
      campo('answer', 'Resposta', 'longText', true, { required: true }),
      campo('category', 'Agrupamento', 'text'),
      campo('publicationStatus', 'Publicação', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
    ],
  },
  servicos: {
    key: 'servicos',
    name: 'Serviços',
    description: 'O que a empresa oferece.',
    kind: 'collection',
    customFields: true,
    table: 'services',
    fields: [
      campo('title', 'Título', 'text', true, { required: true }),
      campo('summary', 'Resumo', 'longText'),
      campo('description', 'Descrição', 'longText'),
      campo('icon', 'Ícone', 'select'),
      campo('imageId', 'Imagem', 'image'),
      campo('highlights', 'Destaques', 'tags'),
      campo('publicationStatus', 'Publicação', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('seoTitle', 'Título para busca', 'text'),
      campo('seoDescription', 'Descrição para busca', 'longText'),
      campo('slug', 'Endereço na URL', 'text', false, {
        help: 'Alterar quebra links já divulgados e a indexação no Google.',
      }),
    ],
  },
};

export function moduleDefinition(key: ModuleKey): ModuleDefinition {
  return MODULE_REGISTRY[key];
}

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/** Modulos de instancia unica, guardados como documento validado. */
export const DOCUMENT_MODULE_KEYS = MODULE_KEYS.filter(
  (key) => MODULE_REGISTRY[key].kind === 'document',
);
export type DocumentModuleKey = 'institucional' | 'contato';

/**
 * Modulos cujos registros contam para o limite geral de conteudos do plano.
 *
 * Sao os de **colecao**: cada registro e um conteudo cadastrado (um produto,
 * um servico, um imovel, um profissional...). Os de documento -- `institucional`
 * e `contato` -- sao uma pagina so, nao uma lista, e nao contam.
 *
 * Derivada do registro de proposito: um modulo novo de colecao entra no limite
 * sem ninguem lembrar de acrescenta-lo a uma lista. O que o codigo da API
 * precisa fazer por ele e dizer de que tabela vem a contagem, e um teste
 * (`content-usage.test.ts`) falha enquanto algum modulo daqui nao tiver tabela.
 */
export const CONTENT_LIMIT_MODULE_KEYS: readonly ModuleKey[] = MODULE_KEYS.filter(
  (key) => MODULE_REGISTRY[key].kind === 'collection',
);
