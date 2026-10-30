import type {
  BillingState,
  ChargeState,
  LeadInterestType,
  LeadStatus,
  PaymentMethodCode,
  PublicationState,
  PlanLimits,
  EffectivePlan,
  OverviewDomain,
  TenantOverview,
  ProjectCategory,
  ProjectStage,
  ProjectStatus,
  PropertyCommercialStatus,
  PropertyPurpose,
  PropertyType,
  PublicationStatus,
  SafeIcon,
  SiteStatus,
  SocialNetwork,
  DeliveryState,
  SuspensionEffect,
  SuspensionPolicy,
  TenantRole,
  TenantStatus,
  UsageSnapshot,
  PlatformRole,
  TenantCapability,
  DomainStatus,
  AddressInput,
} from '@codeca/shared';

// Reexportado porque as respostas do painel mestre o usam diretamente.
export type { SiteStatus } from '@codeca/shared';

/** Formas das respostas da API, conforme devolvidas pelos endpoints. */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  phone: string;
  platformRole: PlatformRole;
  emailVerified: boolean;
}

export interface SessionMembership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: TenantStatus;
  role: TenantRole;
}

export interface SessionPayload {
  user: SessionUser;
  memberships: SessionMembership[];
  expiresAt: string;
}

export interface FeatureFlags {
  blobStorage: boolean;
  vercelDomains: boolean;
  transactionalEmail: boolean;
}

export interface SessionResponse {
  session: SessionPayload | null;
  features: FeatureFlags;
  platform: { name: string; url: string };
}

export type { EffectivePlan };

export interface TenantAccess {
  role: TenantRole;
  capabilities: TenantCapability[];
  readOnly: boolean;
  viaSupportGrant: boolean;
}

export interface TenantDetail {
  id: string;
  slug: string;
  legalName: string;
  displayName: string;
  taxId: string;
  description: string;
  foundedYear: number | null;
  creaNumber: string;
  status: TenantStatus;
  contactEmail: string;
  contactPhone: string;
  whatsapp: string;
  whatsappDefaultMessage: string;
  address: AddressInput;
  serviceArea: string;
  businessHours: string;
  social: Partial<Record<SocialNetwork, string>>;
  createdAt: string;
}

export interface TenantResponse {
  tenant: TenantDetail;
  access: TenantAccess;
  plan: EffectivePlan;
  usage: UsageSnapshot;
}

/**
 * Visao geral do painel.
 *
 * Declarada em `@codeca/shared` e usada pelos dois lados. Antes cada lado
 * tinha a sua copia, e foi assim que o painel continuou lendo `pages` depois
 * de a API parar de enviar: o `typecheck` nao tinha como notar.
 */
export type OverviewResponse = TenantOverview;

export type DomainSummary = OverviewDomain;

export interface DomainRecord extends DomainSummary {
  statusLabel: string;
  dnsConfigured: boolean;
  ownershipVerified: boolean;
  lastError: string;
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  verificationRecordName: string;
  verificationRecordValue: string;
  dns: {
    domain: string;
    apex: boolean;
    records: Array<{ type: 'A' | 'CNAME' | 'TXT'; name: string; value: string; note?: string }>;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface MediaRef {
  id: string;
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface PropertyRecord {
  id: string;
  slug: string;
  title: string;
  reference: string;
  description: string;
  shortDescription: string;
  type: PropertyType;
  purpose: PropertyPurpose;
  price: number | null;
  priceOnRequest: boolean;
  condoFee: number | null;
  iptu: number | null;
  currency: 'BRL' | 'USD' | 'EUR';
  address: AddressInput;
  builtAreaM2: number | null;
  landAreaM2: number | null;
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parkingSpots: number | null;
  floor: number | null;
  features: string[];
  coverImageId: string | null;
  coverImage?: MediaRef | null;
  gallery?: MediaRef[];
  publicationStatus: PublicationStatus;
  commercialStatus: PropertyCommercialStatus;
  featured: boolean;
  deliveryDate: string | null;
  videoUrl: string;
  seoTitle: string;
  seoDescription: string;
  sortOrder: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  slug: string;
  title: string;
  description: string;
  shortDescription: string;
  category: ProjectCategory;
  status: ProjectStatus;
  stage: ProjectStage;
  progressPercent: number | null;
  city: string;
  state: string;
  neighborhood: string;
  showLocation: boolean;
  startDate: string | null;
  expectedCompletionDate: string | null;
  completedDate: string | null;
  coverImageId: string | null;
  coverImage?: MediaRef | null;
  gallery?: MediaRef[];
  publicationStatus: PublicationStatus;
  featured: boolean;
  seoTitle: string;
  seoDescription: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectUpdateRecord {
  id: string;
  title: string;
  note: string;
  stage: ProjectStage | null;
  progressPercent: number | null;
  recordedAt: string | null;
  images: MediaRef[];
  createdAt: string;
}

export interface ServiceRecord {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  icon: SafeIcon;
  imageId: string | null;
  image?: MediaRef | null;
  highlights: string[];
  publicationStatus: PublicationStatus;
  sortOrder: number;
  seoTitle: string;
  seoDescription: string;
}

export interface TestimonialRecord {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  rating: number | null;
  photoId: string | null;
  photo?: MediaRef | null;
  relatedProjectId: string | null;
  authorizationConfirmed: boolean;
  authorizationNote: string;
  publicationStatus: PublicationStatus;
  sortOrder: number;
}

export interface TeamMemberRecord {
  id: string;
  name: string;
  role: string;
  bio: string;
  photoId: string | null;
  photo?: MediaRef | null;
  email: string;
  social: Partial<Record<SocialNetwork, string>>;
  publicationStatus: PublicationStatus;
  sortOrder: number;
}

export interface FaqRecord {
  id: string;
  question: string;
  answer: string;
  category: string;
  publicationStatus: PublicationStatus;
  sortOrder: number;
}

export interface MediaAssetRecord {
  id: string;
  blobUrl: string;
  blobPathname: string;
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  kind: 'image' | 'document';
  sizeBytes: number;
  width: number | null;
  height: number | null;
  alt: string;
  title: string;
  tag: string;
  createdAt: string;
}

export interface LeadRecord {
  id: string;
  name: string;
  phone: string;
  email: string;
  interestType: LeadInterestType;
  message: string;
  status: LeadStatus;
  sourcePath: string;
  assignedToUserId: string | null;
  propertyId: string | null;
  projectId: string | null;
  serviceId: string | null;
  propertyTitle: string | null;
  projectTitle: string | null;
  createdAt: string;
  consentAt?: string;
}

export interface LeadNoteRecord {
  id: string;
  note: string;
  createdAt: string;
  authorName: string | null;
}

export interface MemberRecord {
  membershipId: string;
  role: TenantRole;
  status: 'invited' | 'active' | 'disabled';
  acceptedAt: string | null;
  createdAt: string;
  userId: string;
  name: string;
  email: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
}

export interface PlanRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  priceCents: number;
  limits: PlanLimits;
  /** O que a suspensao faz neste plano. Nenhuma opcao apaga dado. */
  suspension: SuspensionPolicy;
  isPublic: boolean;
  isActive: boolean;
  tenantCount: number;
}

export interface PlatformTenantRow {
  id: string;
  slug: string;
  displayName: string;
  legalName: string;
  status: TenantStatus;
  createdAt: string;
  suspendedAt: string | null;
  planCode: string;
  planName: string;
  hasOverrides: boolean;
}

export interface AuditLogRow {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SupportGrantRow {
  id: string;
  tenantId: string;
  tenantName: string;
  reason: string;
  readOnly: boolean;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  adminEmail: string;
}

// ------------------------------------------------------------- cobranca

/** Resumo de cobranca da empresa, como devolvido por `GET /billing`. */
export interface BillingSubscriptionView {
  state: BillingState;
  stateLabel: string;
  publicationState: PublicationState;
  publicationLabel: string;
  publicationMessage: string;
  inGracePeriod: boolean;
  graceEndsAt: string | null;
  gracePeriodDays: number;
  /** O que esta restringido agora. */
  suspension: SuspensionEffect;
  /** O que o plano faz quando a assinatura nao esta em dia. */
  suspensionPolicy: SuspensionPolicy;
  paymentMethod: PaymentMethodCode | null;
  paymentMethodLabel: string | null;
  automaticRenewal: boolean | null;
  accessUntil: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextChargeAt: string | null;
  currentCycleNumber: number;
  currentCycleAmountCents: number | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  cancelReason: string;
  adminHold: boolean;
  disputeHold: boolean;
  lastErrorMessage: string;
  lastSyncedAt: string | null;
  checkoutUrl: string | null;
  pendingPlanId: string | null;
  externalSubscriptionId: string | null;
}

export interface ChargeView {
  id: string;
  externalChargeId: string;
  status: ChargeState;
  statusLabel: string;
  providerStatus: string;
  amountCents: number;
  amountLabel: string;
  refundedAmountCents: number;
  paymentMethod: PaymentMethodCode | null;
  paymentMethodLabel: string | null;
  cycleNumber: number | null;
  dueAt: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  canceledAt: string | null;
  failureReason: string;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface BillingPlanOption {
  id: string;
  code: string;
  name: string;
  description: string;
  priceCents: number;
  priceLabel: string;
  limits: PlanLimits;
  recurrenceType: string;
  recurrenceInterval: number;
  trialDays: number | null;
  paymentMethods: Array<{
    code: PaymentMethodCode;
    label: string;
    description: string;
    automatic: boolean;
  }>;
  current: boolean;
  contractable: boolean;
}

export interface BillingOverview {
  subscription: BillingSubscriptionView | null;
  plan: { id: string; code: string; name: string; limits: PlanLimits; overridden: boolean };
  usage: UsageSnapshot;
  plans: BillingPlanOption[];
  charges: ChargeView[];
  available: boolean;
  environment: string | null;
}

export interface PlatformSubscriptionRow {
  id: string;
  tenantId: string;
  /** Site assinante. As acoes administrativas agem sobre ele. */
  siteId: string;
  siteName: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  planName: string;
  planCode: string;
  planPriceLabel: string;
  state: BillingState;
  stateLabel: string;
  providerStatus: string;
  publicationState: PublicationState;
  publicationLabel: string;
  paymentMethod: PaymentMethodCode | null;
  paymentMethodLabel: string | null;
  accessUntil: string | null;
  nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean;
  adminHold: boolean;
  adminHoldReason: string;
  disputeHold: boolean;
  gracePeriodDays: number;
  externalSubscriptionId: string | null;
  externalCustomerId: string | null;
  lastSyncedAt: string | null;
  lastErrorMessage: string;
}

export interface WebhookEventRow {
  id: string;
  externalEventId: string;
  event: string;
  status: 'pending' | 'processed' | 'failed' | 'ignored' | 'unresolved';
  attempt: number | null;
  processingAttempts: number;
  tenantId: string | null;
  externalSubscriptionId: string | null;
  externalChargeId: string | null;
  occurredAt: string | null;
  receivedAt: string;
  processedAt: string | null;
  errorMessage: string;
}

export interface ReconcileReportView {
  subscriptionsChecked: number;
  subscriptionsUpdated: number;
  chargesChecked: number;
  chargesUpdated: number;
  publicationsChanged: number;
  pendingEventsReplayed: number;
  divergences: Array<{ kind: string; id: string; detail: string }>;
  failures: Array<{ kind: string; id: string; error: string }>;
}

/** Site como o painel mestre o enxerga. */
export interface PlatformSite {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  status: SiteStatus;
  isPrimary: boolean;
  internalNotes: string;
  segmentId: string | null;
}

export interface SiteModuleFieldView {
  key: string;
  label: string;
  type: string;
  editableByDefault: boolean;
  editable: boolean;
  overridden: boolean;
  required?: boolean;
  help?: string;
}

export interface SiteModuleView {
  key: string;
  name: string;
  description: string;
  kind: 'document' | 'collection';
  enabled: boolean;
  settings: Record<string, unknown>;
  fields: SiteModuleFieldView[];
}

export interface SiteApiKeyRow {
  id: string;
  kind: 'publishable' | 'secret';
  name: string;
  scopes: string[];
  token: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Chave recem-emitida. A secreta so aparece aqui, uma vez. */
export interface IssuedKey {
  id: string;
  kind: 'publishable' | 'secret';
  scopes: string[];
  token: string;
}

/** Banner da abertura do site. */
export interface BannerRecord {
  id: string;
  title: string;
  subtitle: string;
  imageId: string | null;
  image: MediaRef | null;
  buttonLabel: string;
  buttonUrl: string;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** O que o painel do cliente desenha para o site dele. */
export interface SiteModulesResponse {
  siteId: string;
  modules: SiteModuleView[];
  /** Restricao em vigor por causa da assinatura. */
  suspension: SuspensionEffect;
}

/**
 * Conteudo de um modulo de instancia unica.
 *
 * `fields` acompanha o documento porque a tela precisa saber, campo a campo,
 * o que este site deixa editar -- e a resposta e a mesma que a escrita
 * confere.
 */
export interface ModuleDocumentResponse {
  moduleKey: string;
  data: Record<string, unknown>;
  fields: SiteModuleFieldView[];
  updatedAt: string | null;
}

/** Endereco do site do cliente que recebe os avisos de publicacao. */
export interface SiteWebhookRow {
  id: string;
  url: string;
  description: string;
  isActive: boolean;
  lastStatus: number | null;
  lastAttemptAt: string | null;
  lastError: string;
  consecutiveFailures: number;
  createdAt: string;
}

/** Uma tentativa de entrega, para a tela mostrar o historico. */
export interface WebhookDeliveryRow {
  id: string;
  url: string;
  event: string;
  status: DeliveryState;
  attempts: number;
  lastStatus: number | null;
  lastError: string;
  deliveredAt: string | null;
  createdAt: string;
}
