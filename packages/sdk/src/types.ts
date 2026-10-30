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

export interface SiteInfo {
  site: {
    id: string;
    name: string;
    slug: string;
    status: string;
    segment: string | null;
  };
  modules: Array<{ key: string; name: string; kind: 'document' | 'collection' }>;
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
