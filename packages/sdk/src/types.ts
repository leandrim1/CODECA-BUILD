/**
 * Contrato do conteudo entregue pelo CODECA Build.
 *
 * Esta copia e deliberada. O pacote precisa ser instalavel em um site que vive
 * fora deste repositorio, entao ele nao pode depender de `@codeca/shared` --
 * nem em tempo de execucao, nem para tipar.
 *
 * O risco obvio e a deriva em relacao ao contrato real da API.
 * `tests/unit/sdk-contract.test.ts` compara os dois **em tempo de
 * compilacao**: se um campo mudar de um lado so, o `typecheck` falha antes de
 * qualquer site receber a versao errada.
 */

/**
 * Redes sociais reconhecidas pela plataforma.
 *
 * Declaradas aqui, e nao como `string`, porque o contrato real e fechado --
 * e a verificacao de contrato recusa a versao frouxa.
 */
export type SocialNetwork = 'instagram' | 'facebook' | 'linkedin' | 'youtube' | 'tiktok' | 'x';

export interface PublicImage {
  id: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface PublicAddress {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
}

/**
 * Campos que a CODECA IA definiu para este site, por chave.
 *
 * `unknown` e honesto: as definicoes vivem no painel, nao no SDK, entao nao ha
 * como tipar isto sem gerar tipo por site. Voce conhece as chaves do seu
 * projeto -- faca a conversao na borda:
 *
 * ```ts
 * const creci = String(membro.customFields.creci ?? '');
 * ```
 */
export type PublicCustomFields = Record<string, unknown>;

export interface PublicSeo {
  title: string;
  description: string;
}

export interface PublicProperty {
  id: string;
  slug: string;
  title: string;
  reference: string;
  description: string;
  shortDescription: string;
  type: string;
  purpose: string;
  price: number | null;
  priceOnRequest: boolean;
  condoFee: number | null;
  iptu: number | null;
  currency: string;
  address: PublicAddress;
  builtAreaM2: number | null;
  landAreaM2: number | null;
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parkingSpots: number | null;
  floor: number | null;
  features: string[];
  cover: PublicImage | null;
  gallery: PublicImage[];
  commercialStatus: string;
  featured: boolean;
  deliveryDate: string | null;
  videoUrl: string;
  seo: PublicSeo;
  publishedAt: string | null;
  customFields: PublicCustomFields;
}

export interface PublicProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  shortDescription: string;
  category: string;
  status: string;
  stage: string;
  progressPercent: number | null;
  city: string;
  state: string;
  neighborhood: string;
  startDate: string | null;
  expectedCompletionDate: string | null;
  completedDate: string | null;
  cover: PublicImage | null;
  gallery: PublicImage[];
  featured: boolean;
  seo: PublicSeo;
  publishedAt: string | null;
  customFields: PublicCustomFields;
}

export interface PublicService {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  icon: string;
  image: PublicImage | null;
  highlights: string[];
  sortOrder: number;
  seo: PublicSeo;
  customFields: PublicCustomFields;
}

export interface PublicBanner {
  id: string;
  title: string;
  subtitle: string;
  image: PublicImage | null;
  buttonLabel: string;
  buttonUrl: string;
  sortOrder: number;
}

export interface PublicPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PublicCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
}

/**
 * Produto do catalogo.
 *
 * `price` e `null` quando nao ha preco publicado ou quando `priceOnRequest`
 * esta ligado -- o texto ("sob consulta", "a combinar") e escolha do projeto.
 * `isAvailable` falso e produto no ar porem esgotado: riscar, esmaecer ou
 * esconder tambem e decisao do projeto.
 *
 * `gallery` vem vazia na listagem e preenchida em `products.get(slug)`.
 */
export interface PublicProduct {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  code: string;
  price: number | null;
  priceOnRequest: boolean;
  currency: string;
  unit: string;
  isAvailable: boolean;
  category: PublicCategory | null;
  cover: PublicImage | null;
  gallery: PublicImage[];
  sortOrder: number;
  seo: PublicSeo;
  customFields: PublicCustomFields;
}

/** Galeria na listagem: capa e contagem, sem as imagens. */
export interface PublicGallerySummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  cover: PublicImage | null;
  imageCount: number;
  sortOrder: number;
}

export interface PublicGallery extends PublicGallerySummary {
  images: PublicImage[];
}

/**
 * Depoimento, ja autorizado pelo autor.
 *
 * A plataforma nao entrega depoimento sem a autorizacao de quem o deu -- nem
 * em previa. Por isso nao ha sinalizador a conferir aqui: o que chega pode ser
 * exibido.
 */
export interface PublicTestimonial {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  rating: number | null;
  photo: PublicImage | null;
  relatedProjectId: string | null;
  sortOrder: number;
  customFields: PublicCustomFields;
}

export interface PublicTeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  /** Vazio quando o cliente escolheu nao exibir. */
  email: string;
  photo: PublicImage | null;
  social: Record<string, string>;
  sortOrder: number;
  customFields: PublicCustomFields;
}

export interface PublicFaq {
  id: string;
  question: string;
  answer: string;
  /** Agrupamento livre definido pelo cliente; vazio quando nao usado. */
  category: string;
  sortOrder: number;
}

/**
 * Registro de um modulo criado para este projeto.
 *
 * `data` e `Record<string, unknown>` porque os campos sao definidos por site,
 * no painel mestre -- nao existe tipo estatico possivel para eles. Pela mesma
 * razao, campo novo, renomeado ou removido aqui **nao** e quebra de contrato:
 * e configuracao do projeto. Confira o tipo do valor antes de usar e trate
 * chave ausente como nao informada.
 *
 * Se o seu site precisa de garantia de forma, declare a sua propria interface
 * e valide o que chega -- a plataforma nao pode prometer uma forma que quem
 * configura o projeto pode mudar.
 */
export interface PublicCustomRecord {
  id: string;
  title: string;
  /** Vazio no registro de um modulo `document`. */
  slug: string;
  data: Record<string, unknown>;
  featured: boolean;
  sortOrder: number;
  publishedAt: string | null;
}

export interface SiteInfo {
  site: {
    id: string;
    name: string;
    slug: string;
    status: string;
    /**
     * Ramo do projeto, definido pela CODECA IA no painel.
     *
     * Texto livre, nao uma lista fechada: a plataforma atende qualquer
     * segmento. Compare pelo valor combinado para o seu projeto, e trate
     * qualquer outro como caso padrao -- o conjunto cresce sem nova versao
     * do SDK.
     */
    segment: string | null;
  };
  modules: Array<{ key: string; name: string; kind: 'document' | 'collection' }>;
  /**
   * Modulos criados para este projeto, lidos por `custom(chave)`.
   *
   * Lista separada de `modules` porque sao coisas diferentes: `modules` sao os
   * modulos da plataforma, e estes existem somente neste site. A lista muda
   * quando a CODECA IA configura o projeto, sem versao nova do SDK.
   */
  customModules: Array<{ key: string; name: string; kind: 'document' | 'collection' }>;
  scopes: string[];
  /**
   * Aviso para exibir ao visitante, ou `null`.
   *
   * Vem preenchido quando o plano do site pede aviso durante uma pendencia
   * de assinatura. O texto ja chega pronto para ser exibido; nao descreve a
   * pendencia nem cita valores.
   */
  notice: string | null;
}

export interface InstitutionalContent {
  companyName: string;
  tagline: string;
  shortDescription: string;
  history: string;
  mission: string;
  vision: string;
  values: string[];
  logoImageId: string | null;
  coverImageId: string | null;
  galleryImageIds: string[];
  foundedYear: number | null;
}

export interface ContactContent {
  email: string;
  phone: string;
  whatsapp: string;
  whatsappMessage: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  businessHours: string;
  serviceArea: string;
  mapUrl: string;
  social: Partial<Record<SocialNetwork, string>>;
}

export interface PropertyQuery {
  page?: number;
  pageSize?: number;
  purpose?: string;
  type?: string;
  city?: string;
  neighborhood?: string;
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  featured?: boolean;
  search?: string;
  /** Inclui rascunhos. Exige chave secreta. */
  preview?: boolean;
}

export interface ProjectQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  category?: string;
  city?: string;
  featured?: boolean;
  search?: string;
  preview?: boolean;
}

export interface ProductQuery {
  page?: number;
  pageSize?: number;
  /** Slug da categoria, como vem de `categories.list()`. */
  category?: string;
  /** `true` esconde o que esta esgotado. Por padrao vem junto. */
  availableOnly?: boolean;
  search?: string;
  preview?: boolean;
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  preview?: boolean;
}

export interface LeadInput {
  name: string;
  phone: string;
  email?: string;
  interestType: string;
  message?: string;
  propertyId?: string | null;
  projectId?: string | null;
  serviceId?: string | null;
  sourcePath?: string;
  /** Obrigatorio: o visitante precisa autorizar o contato (LGPD). */
  consent: true;
  /** Campo oculto do formulario. Preenchido indica robo. */
  honeypot?: string;
}
