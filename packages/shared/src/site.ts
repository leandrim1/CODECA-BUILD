import type { PageLayout } from './blocks/layout.js';
import type {
  Currency,
  LeadInterestType,
  ProjectCategory,
  ProjectStage,
  ProjectStatus,
  PropertyCommercialStatus,
  PropertyPurpose,
  PropertyType,
  SafeIcon,
  SocialNetwork,
} from './constants.js';
import type { Theme } from './theme.js';

/**
 * Contrato dos dados entregues ao renderizador do site publico.
 * Contem exclusivamente informacoes publicas: nenhum dado de usuario,
 * interessado, observacao interna ou configuracao administrativa aparece aqui.
 */

export interface PublicImage {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface PublicTenant {
  id: string;
  slug: string;
  displayName: string;
  legalName: string;
  description: string;
  taxId: string;
  foundedYear: number | null;
  creaNumber: string;
  email: string;
  phone: string;
  whatsapp: string;
  whatsappDefaultMessage: string;
  businessHours: string;
  serviceArea: string;
  address: {
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    postalCode: string;
    showFullAddress: boolean;
  };
  social: Partial<Record<SocialNetwork, string>>;
}

export interface PublicSiteSections {
  showProperties: boolean;
  showProjects: boolean;
  showServices: boolean;
  showGallery: boolean;
  showTestimonials: boolean;
  showTeam: boolean;
  showFaq: boolean;
  floatingWhatsApp: boolean;
  privacyPolicyUrl: string;
  privacyPolicyText: string;
}

export interface PublicSeo {
  defaultTitle: string;
  titleTemplate: string;
  defaultDescription: string;
  shareImageUrl: string;
  canonicalBaseUrl: string;
  robots: 'index' | 'noindex';
  googleSiteVerification: string;
  sitemapEnabled: boolean;
}

export interface PublicNavigationItem {
  label: string;
  href: string;
  newTab: boolean;
  children?: PublicNavigationItem[];
}

export interface PublicNavigationMenu {
  key: string;
  label: string;
  items: PublicNavigationItem[];
}

export interface PublicProperty {
  id: string;
  slug: string;
  title: string;
  reference: string;
  shortDescription: string;
  description: string;
  type: PropertyType;
  purpose: PropertyPurpose;
  commercialStatus: PropertyCommercialStatus;
  price: number | null;
  priceOnRequest: boolean;
  condoFee: number | null;
  iptu: number | null;
  currency: Currency;
  city: string;
  neighborhood: string;
  state: string;
  addressLine: string;
  builtAreaM2: number | null;
  landAreaM2: number | null;
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parkingSpots: number | null;
  features: string[];
  coverImage: PublicImage | null;
  gallery: PublicImage[];
  featured: boolean;
  deliveryDate: string | null;
  videoUrl: string;
  seoTitle: string;
  seoDescription: string;
  updatedAt: string;
}

export interface PublicProjectUpdate {
  id: string;
  title: string;
  note: string;
  stage: ProjectStage | null;
  progressPercent: number | null;
  recordedAt: string | null;
  images: PublicImage[];
}

export interface PublicProject {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  description: string;
  category: ProjectCategory;
  status: ProjectStatus;
  stage: ProjectStage;
  /** Null quando a construtora nao informou o percentual. */
  progressPercent: number | null;
  locationLabel: string;
  startDate: string | null;
  expectedCompletionDate: string | null;
  completedDate: string | null;
  coverImage: PublicImage | null;
  gallery: PublicImage[];
  updates: PublicProjectUpdate[];
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  updatedAt: string;
}

export interface PublicService {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  icon: SafeIcon;
  image: PublicImage | null;
  highlights: string[];
}

export interface PublicTestimonial {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  rating: number | null;
  photo: PublicImage | null;
}

export interface PublicTeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  photo: PublicImage | null;
  social: Partial<Record<SocialNetwork, string>>;
}

export interface PublicFaq {
  id: string;
  question: string;
  answer: string;
  category: string;
}

export interface PublicGalleryImage extends PublicImage {
  id: string;
  title: string;
  tag: string;
}

export interface PublicPage {
  id: string;
  slug: string;
  title: string;
  isHome: boolean;
  seoTitle: string;
  seoDescription: string;
  seoImageUrl: string;
  canonicalUrl: string;
  robots: 'index' | 'noindex';
  layout: PageLayout;
  publishedAt: string | null;
}

/** Tipo de rota resolvida pelo renderizador publico. */
export type PublicRouteKind = 'page' | 'property' | 'project' | 'not_found';

export interface PublicSiteContext {
  /** Origem completa do site, por exemplo `https://www.construtora.com.br`. */
  origin: string;
  /** Caminho solicitado, iniciando com `/`. */
  path: string;
  routeKind: PublicRouteKind;
  /** Quando true, trata-se de uma previa autenticada com conteudo de rascunho. */
  preview: boolean;
  /** Identificador da versao publicada, usado em cache e ETag. */
  siteVersion: string;
}

export interface PublicSiteData {
  context: PublicSiteContext;
  tenant: PublicTenant;
  theme: Theme;
  sections: PublicSiteSections;
  seo: PublicSeo;
  menus: PublicNavigationMenu[];
  pages: Array<Pick<PublicPage, 'id' | 'slug' | 'title' | 'isHome'>>;
  page: PublicPage | null;
  property: PublicProperty | null;
  project: PublicProject | null;
  properties: PublicProperty[];
  projects: PublicProject[];
  services: PublicService[];
  testimonials: PublicTestimonial[];
  team: PublicTeamMember[];
  faqs: PublicFaq[];
  gallery: PublicGalleryImage[];
  showPlatformBadge: boolean;
  platformName: string;
  platformUrl: string;
}

export interface PublicLeadFormOption {
  value: LeadInterestType;
  label: string;
}
