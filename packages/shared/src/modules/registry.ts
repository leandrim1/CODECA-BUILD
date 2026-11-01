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
    description: 'Quem e a empresa: apresentacao, historia e proposito.',
    kind: 'document',
    customFields: true,
    fields: [
      campo('companyName', 'Nome da empresa', 'text', true, { required: true }),
      campo('tagline', 'Frase de apresentacao', 'text'),
      campo('shortDescription', 'Descricao curta', 'longText'),
      campo('history', 'Historia', 'longText'),
      campo('mission', 'Missao', 'longText'),
      campo('vision', 'Visao', 'longText'),
      campo('values', 'Valores', 'tags'),
      campo('logoImageId', 'Logotipo', 'image'),
      campo('coverImageId', 'Imagem de destaque', 'image'),
      campo('galleryImageIds', 'Galeria', 'imageList'),
      campo('foundedYear', 'Ano de fundacao', 'number'),
    ],
  },
  contato: {
    key: 'contato',
    name: 'Contato',
    description: 'Como falar com a empresa e onde ela esta.',
    kind: 'document',
    customFields: true,
    fields: [
      campo('email', 'E-mail', 'email'),
      campo('phone', 'Telefone', 'phone'),
      campo('whatsapp', 'WhatsApp', 'phone'),
      campo('whatsappMessage', 'Mensagem inicial do WhatsApp', 'longText'),
      campo('addressLine', 'Endereco', 'text'),
      campo('city', 'Cidade', 'text'),
      campo('state', 'Estado', 'text'),
      campo('postalCode', 'CEP', 'text'),
      campo('businessHours', 'Horario de atendimento', 'longText'),
      campo('serviceArea', 'Area de atuacao', 'longText'),
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
      campo('title', 'Titulo', 'text', true, { required: true }),
      campo('subtitle', 'Subtitulo', 'longText'),
      campo('imageId', 'Imagem', 'image'),
      campo('buttonLabel', 'Texto do botao', 'text'),
      campo('buttonUrl', 'Link do botao', 'url'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('isActive', 'Ativo', 'boolean'),
      campo('startsAt', 'Publicar a partir de', 'date'),
      campo('endsAt', 'Despublicar em', 'date'),
    ],
  },
  imoveis: {
    key: 'imoveis',
    name: 'Imoveis',
    description: 'Carteira de imoveis a venda ou locacao.',
    kind: 'collection',
    customFields: true,
    table: 'properties',
    fields: [
      campo('title', 'Titulo', 'text', true, { required: true }),
      campo('reference', 'Referencia', 'text'),
      campo('description', 'Descricao', 'longText'),
      campo('shortDescription', 'Descricao curta', 'longText'),
      campo('type', 'Tipo', 'select', true, { required: true }),
      campo('purpose', 'Finalidade', 'select', true, { required: true }),
      campo('price', 'Preco', 'money'),
      campo('priceOnRequest', 'Preco sob consulta', 'boolean'),
      campo('condoFee', 'Condominio', 'money'),
      campo('iptu', 'IPTU', 'money'),
      campo('address', 'Endereco', 'text'),
      campo('builtAreaM2', 'Area construida (m2)', 'number'),
      campo('landAreaM2', 'Area do terreno (m2)', 'number'),
      campo('bedrooms', 'Dormitorios', 'number'),
      campo('suites', 'Suites', 'number'),
      campo('bathrooms', 'Banheiros', 'number'),
      campo('parkingSpots', 'Vagas', 'number'),
      campo('floor', 'Andar', 'number'),
      campo('features', 'Caracteristicas', 'tags'),
      campo('coverImageId', 'Capa', 'image'),
      campo('galleryImageIds', 'Galeria', 'imageList'),
      campo('videoUrl', 'Video', 'url'),
      campo('publicationStatus', 'Publicacao', 'select'),
      campo('commercialStatus', 'Situacao comercial', 'select'),
      campo('featured', 'Destaque', 'boolean'),
      campo('deliveryDate', 'Data de entrega', 'date'),
      campo('seoTitle', 'Titulo para busca', 'text'),
      campo('seoDescription', 'Descricao para busca', 'longText'),
      campo('sortOrder', 'Ordem', 'number'),
      // A moeda decide como o site formata todo preco: trocar sozinho
      // quebraria a exibicao de uma carteira inteira.
      campo('currency', 'Moeda', 'select', false, {
        help: 'Definida com a CODECA IA: o site formata os precos a partir dela.',
      }),
      // Endereco do imovel na URL: mexer nele quebra links ja divulgados.
      campo('slug', 'Endereco na URL', 'text', false, {
        help: 'Alterar quebra links ja divulgados e a indexacao no Google.',
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
      campo('title', 'Titulo', 'text', true, { required: true }),
      campo('description', 'Descricao', 'longText'),
      campo('shortDescription', 'Descricao curta', 'longText'),
      campo('category', 'Categoria', 'select'),
      campo('status', 'Situacao', 'select'),
      campo('stage', 'Etapa', 'select'),
      campo('progressPercent', 'Percentual concluido', 'number'),
      campo('city', 'Cidade', 'text'),
      campo('state', 'Estado', 'text'),
      campo('neighborhood', 'Bairro', 'text'),
      campo('showLocation', 'Mostrar a localizacao no site', 'boolean'),
      campo('startDate', 'Inicio da obra', 'date'),
      campo('expectedCompletionDate', 'Previsao de entrega', 'date'),
      campo('completedDate', 'Conclusao', 'date'),
      campo('coverImageId', 'Capa', 'image'),
      campo('galleryImageIds', 'Galeria', 'imageList'),
      campo('publicationStatus', 'Publicacao', 'select'),
      campo('featured', 'Destaque', 'boolean'),
      campo('seoTitle', 'Titulo para busca', 'text'),
      campo('seoDescription', 'Descricao para busca', 'longText'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('slug', 'Endereco na URL', 'text', false, {
        help: 'Alterar quebra links ja divulgados e a indexacao no Google.',
      }),
    ],
  },
  produtos: {
    key: 'produtos',
    name: 'Produtos',
    description: 'O catalogo, o cardapio ou a lista de itens da empresa.',
    kind: 'collection',
    customFields: true,
    table: 'products',
    fields: [
      campo('title', 'Nome', 'text', true, { required: true }),
      campo('summary', 'Resumo', 'longText'),
      campo('description', 'Descricao', 'longText'),
      campo('code', 'Codigo interno', 'text', true, {
        help: 'SKU ou referencia. Aparece no site so se o projeto exibir.',
      }),
      campo('categoryId', 'Categoria', 'select'),
      campo('price', 'Preco', 'money'),
      campo('priceOnRequest', 'Preco sob consulta', 'boolean'),
      campo('unit', 'Unidade', 'text', true, {
        help: 'Ex.: un, kg, porcao. Aparece ao lado do preco.',
      }),
      campo('isAvailable', 'Disponivel', 'boolean', true, {
        help: 'Desmarque para indicar que acabou, sem tirar o produto do site.',
      }),
      campo('coverImageId', 'Imagem principal', 'image'),
      campo('galleryImageIds', 'Mais imagens', 'imageList'),
      campo('publicationStatus', 'Publicacao', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('seoTitle', 'Titulo para busca', 'text'),
      campo('seoDescription', 'Descricao para busca', 'longText'),
      /**
       * Travados por padrao, pelos mesmos motivos de imoveis e servicos: o
       * slug esta em links divulgados e na indexacao do Google, e a moeda
       * define como o site formata todo preco.
       */
      campo('slug', 'Endereco na URL', 'text', false, {
        help: 'Alterar quebra links ja divulgados e a indexacao no Google.',
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
      campo('description', 'Descricao', 'longText'),
      campo('publicationStatus', 'Publicacao', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('moduleKey', 'Modulo', 'select', false, {
        help: 'A que modulo a categoria pertence. Hoje somente produtos usa categorias.',
      }),
      campo('slug', 'Endereco na URL', 'text', false, {
        help: 'Alterar quebra links ja divulgados e a indexacao no Google.',
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
      campo('description', 'Descricao', 'longText'),
      campo('imageIds', 'Imagens', 'imageList', true, {
        help: 'A primeira da ordem e a capa.',
      }),
      campo('publicationStatus', 'Publicacao', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('slug', 'Endereco na URL', 'text', false, {
        help: 'Alterar quebra links ja divulgados e a indexacao no Google.',
      }),
    ],
  },
  depoimentos: {
    key: 'depoimentos',
    name: 'Depoimentos',
    description: 'O que os clientes dizem, com autorizacao de quem disse.',
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
      campo('authorizationConfirmed', 'O autor autorizou a publicacao', 'boolean', true, {
        help: 'Sem esta confirmacao o depoimento fica guardado, mas nao aparece no site.',
      }),
      campo('authorizationNote', 'Como a autorizacao foi obtida', 'text', true, {
        help: 'Ex.: autorizado por WhatsApp em 12/03. Fica so no painel, nunca no site.',
      }),
      campo('publicationStatus', 'Publicacao', 'select'),
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
      campo('bio', 'Apresentacao', 'longText'),
      campo('photoId', 'Foto', 'image'),
      campo('email', 'E-mail', 'email', true, {
        help: 'Fica visivel no site. Deixe vazio para nao exibir.',
      }),
      campo('social', 'Redes sociais', 'tags'),
      campo('publicationStatus', 'Publicacao', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
    ],
  },
  faq: {
    key: 'faq',
    name: 'Perguntas frequentes',
    description: 'As duvidas que o site responde sem ninguem precisar ligar.',
    kind: 'collection',
    table: 'faqs',
    fields: [
      campo('question', 'Pergunta', 'text', true, { required: true }),
      campo('answer', 'Resposta', 'longText', true, { required: true }),
      campo('category', 'Agrupamento', 'text'),
      campo('publicationStatus', 'Publicacao', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
    ],
  },
  servicos: {
    key: 'servicos',
    name: 'Servicos',
    description: 'O que a empresa oferece.',
    kind: 'collection',
    customFields: true,
    table: 'services',
    fields: [
      campo('title', 'Titulo', 'text', true, { required: true }),
      campo('summary', 'Resumo', 'longText'),
      campo('description', 'Descricao', 'longText'),
      campo('icon', 'Icone', 'select'),
      campo('imageId', 'Imagem', 'image'),
      campo('highlights', 'Destaques', 'tags'),
      campo('publicationStatus', 'Publicacao', 'select'),
      campo('sortOrder', 'Ordem', 'number'),
      campo('seoTitle', 'Titulo para busca', 'text'),
      campo('seoDescription', 'Descricao para busca', 'longText'),
      campo('slug', 'Endereco na URL', 'text', false, {
        help: 'Alterar quebra links ja divulgados e a indexacao no Google.',
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
