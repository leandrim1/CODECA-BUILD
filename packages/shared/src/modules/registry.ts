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
      campo('bedrooms', 'Dormitorios', 'number'),
      campo('suites', 'Suites', 'number'),
      campo('bathrooms', 'Banheiros', 'number'),
      campo('parkingSpots', 'Vagas', 'number'),
      campo('features', 'Caracteristicas', 'tags'),
      campo('coverImageId', 'Capa', 'image'),
      campo('galleryImageIds', 'Galeria', 'imageList'),
      campo('publicationStatus', 'Publicacao', 'select'),
      campo('commercialStatus', 'Situacao comercial', 'select'),
      campo('featured', 'Destaque', 'boolean'),
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
      campo('neighborhood', 'Bairro', 'text'),
      campo('expectedCompletionDate', 'Previsao de entrega', 'date'),
      campo('coverImageId', 'Capa', 'image'),
      campo('publicationStatus', 'Publicacao', 'select'),
      campo('featured', 'Destaque', 'boolean'),
      campo('slug', 'Endereco na URL', 'text', false, {
        help: 'Alterar quebra links ja divulgados e a indexacao no Google.',
      }),
    ],
  },
  servicos: {
    key: 'servicos',
    name: 'Servicos',
    description: 'O que a empresa oferece.',
    kind: 'collection',
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
