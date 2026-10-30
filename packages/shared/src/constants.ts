/** Constantes de dominio compartilhadas entre backend, painel e site publico. */

export const PROPERTY_TYPES = [
  'apartamento',
  'casa',
  'casa_condominio',
  'terreno',
  'sala_comercial',
  'loja',
  'galpao',
  'cobertura',
  'studio',
  'rural',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartamento: 'Apartamento',
  casa: 'Casa',
  casa_condominio: 'Casa em condominio',
  terreno: 'Terreno',
  sala_comercial: 'Sala comercial',
  loja: 'Loja',
  galpao: 'Galpao',
  cobertura: 'Cobertura',
  studio: 'Studio',
  rural: 'Area rural',
};

export const PROPERTY_PURPOSES = ['venda', 'locacao', 'venda_locacao', 'lancamento'] as const;
export type PropertyPurpose = (typeof PROPERTY_PURPOSES)[number];

export const PROPERTY_PURPOSE_LABELS: Record<PropertyPurpose, string> = {
  venda: 'Venda',
  locacao: 'Locacao',
  venda_locacao: 'Venda ou locacao',
  lancamento: 'Lancamento',
};

/** Estado editorial: controla se o registro aparece no site publico. */
export const PUBLICATION_STATUSES = ['draft', 'published', 'archived'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const PUBLICATION_STATUS_LABELS: Record<PublicationStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  archived: 'Arquivado',
};

/** Estado comercial do imovel, independente da publicacao. */
export const PROPERTY_COMMERCIAL_STATUSES = [
  'disponivel',
  'em_construcao',
  'reservado',
  'vendido',
  'alugado',
] as const;
export type PropertyCommercialStatus = (typeof PROPERTY_COMMERCIAL_STATUSES)[number];

export const PROPERTY_COMMERCIAL_STATUS_LABELS: Record<PropertyCommercialStatus, string> = {
  disponivel: 'Disponivel',
  em_construcao: 'Em construcao',
  reservado: 'Reservado',
  vendido: 'Vendido',
  alugado: 'Alugado',
};

export const CURRENCIES = ['BRL', 'USD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const PROJECT_STAGES = [
  'planejamento',
  'fundacao',
  'estrutura',
  'alvenaria',
  'instalacoes',
  'acabamentos',
  'concluida',
] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  planejamento: 'Planejamento',
  fundacao: 'Fundacao',
  estrutura: 'Estrutura',
  alvenaria: 'Alvenaria',
  instalacoes: 'Instalacoes',
  acabamentos: 'Acabamentos',
  concluida: 'Concluida',
};

export const PROJECT_STATUSES = ['em_andamento', 'concluida', 'pausada', 'prevista'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  prevista: 'Prevista',
  em_andamento: 'Em andamento',
  pausada: 'Pausada',
  concluida: 'Concluida',
};

export const PROJECT_CATEGORIES = [
  'residencial',
  'comercial',
  'industrial',
  'reforma',
  'infraestrutura',
  'institucional',
] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export const PROJECT_CATEGORY_LABELS: Record<ProjectCategory, string> = {
  residencial: 'Residencial',
  comercial: 'Comercial',
  industrial: 'Industrial',
  reforma: 'Reforma',
  infraestrutura: 'Infraestrutura',
  institucional: 'Institucional',
};

export const LEAD_INTEREST_TYPES = [
  'compra_imovel',
  'locacao_imovel',
  'construcao',
  'reforma',
  'acabamentos',
  'orcamento',
  'obra',
  'servico',
  'outro',
] as const;
export type LeadInterestType = (typeof LEAD_INTEREST_TYPES)[number];

export const LEAD_INTEREST_LABELS: Record<LeadInterestType, string> = {
  compra_imovel: 'Compra de imovel',
  locacao_imovel: 'Locacao de imovel',
  construcao: 'Construcao',
  reforma: 'Reforma',
  acabamentos: 'Acabamentos',
  orcamento: 'Orcamento',
  obra: 'Duvida sobre uma obra',
  servico: 'Outro servico',
  outro: 'Outro assunto',
};

export const LEAD_STATUSES = ['novo', 'em_atendimento', 'qualificado', 'convertido', 'perdido'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  novo: 'Novo',
  em_atendimento: 'Em atendimento',
  qualificado: 'Qualificado',
  convertido: 'Convertido',
  perdido: 'Perdido',
};

export const TENANT_STATUSES = ['trialing', 'active', 'suspended', 'canceled'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  trialing: 'Em avaliacao',
  active: 'Ativa',
  suspended: 'Suspensa',
  canceled: 'Cancelada',
};

/**
 * Icones permitidos nos blocos. Restringir a lista evita que o editor
 * injete nomes arbitrarios no renderizador.
 */
export const SAFE_ICONS = [
  'building-2',
  'home',
  'hard-hat',
  'ruler',
  'hammer',
  'wrench',
  'paint-roller',
  'shield-check',
  'award',
  'badge-check',
  'clock',
  'calendar',
  'map-pin',
  'phone',
  'mail',
  'message-circle',
  'users',
  'handshake',
  'thumbs-up',
  'star',
  'trending-up',
  'leaf',
  'sun',
  'key',
  'file-check',
  'layers',
  'blocks',
  'crane',
  'truck',
  'sparkles',
] as const;
export type SafeIcon = (typeof SAFE_ICONS)[number];

/**
 * Segmentos atendidos.
 *
 * Um segmento e um **conjunto padrao** de modulos e campos aplicado ao
 * cadastrar um site, nao uma trava: um site de corretor pode habilitar o
 * modulo de obras se o projeto dele tiver. Adicionar um segmento e declarar um
 * conjunto novo, sem alterar o schema.
 */
export const SEGMENT_CODES = ['construtora', 'imobiliaria', 'corretor'] as const;
export type SegmentCode = (typeof SEGMENT_CODES)[number];

/**
 * Estado de um site na plataforma.
 *
 * Independente do estado da assinatura: um site `active` com assinatura
 * vencida continua existindo e com os dados intactos; o que a cobranca decide
 * e o que a API publica entrega.
 */
export const SITE_STATUSES = ['draft', 'active', 'suspended', 'archived'] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

/**
 * Como o estado do site e dito ao cliente.
 *
 * Em termos do projeto dele, nao da plataforma: `draft` e um site que a
 * CODECA IA ainda esta conectando, nao um rascunho que o cliente precisa
 * publicar -- o cliente nao publica nada aqui.
 */
export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  draft: 'Em conexao pela CODECA IA',
  active: 'Integrado',
  suspended: 'Integracao suspensa',
  archived: 'Arquivado',
};

export const SOCIAL_NETWORKS = ['instagram', 'facebook', 'linkedin', 'youtube', 'tiktok', 'x'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
};

export const BRAZIL_STATES = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
] as const;
export type BrazilState = (typeof BRAZIL_STATES)[number];
