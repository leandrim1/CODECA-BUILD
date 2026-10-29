import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  AddressInput,
  LeadInterestType,
  NavigationMenuInput,
  PageLayout,
  PlanLimits,
  PublicSeo,
  PublicSiteSections,
  SocialNetwork,
  Theme,
} from '@codeca/shared';
import {
  CURRENCIES,
  LEAD_INTEREST_TYPES,
  LEAD_STATUSES,
  PLATFORM_ROLES,
  PROJECT_CATEGORIES,
  PROJECT_STAGES,
  PROJECT_STATUSES,
  PROPERTY_COMMERCIAL_STATUSES,
  PROPERTY_PURPOSES,
  PROPERTY_TYPES,
  PUBLICATION_STATUSES,
  SAFE_ICONS,
  TENANT_ROLES,
  TENANT_STATUSES,
  DOMAIN_STATUSES,
  MEDIA_KINDS,
} from '@codeca/shared';

/**
 * Schema do Neon PostgreSQL.
 *
 * Isolamento multiempresa: toda tabela de conteudo carrega `tenant_id` com
 * chave estrangeira e `ON DELETE CASCADE`, e os indices garantem unicidade
 * sempre dentro do escopo da empresa (por exemplo, slug unico por tenant).
 * As consultas da API filtram por `tenant_id` resolvido no servidor.
 */

const enumValues = <T extends readonly string[]>(values: T): [string, ...string[]] =>
  values as unknown as [string, ...string[]];

// ------------------------------------------------------------------- enums

export const tenantStatusEnum = pgEnum('tenant_status', enumValues(TENANT_STATUSES));
export const tenantRoleEnum = pgEnum('tenant_role', enumValues(TENANT_ROLES));
export const platformRoleEnum = pgEnum('platform_role', enumValues(PLATFORM_ROLES));
export const membershipStatusEnum = pgEnum('membership_status', ['invited', 'active', 'disabled']);
export const publicationStatusEnum = pgEnum('publication_status', enumValues(PUBLICATION_STATUSES));
export const propertyTypeEnum = pgEnum('property_type', enumValues(PROPERTY_TYPES));
export const propertyPurposeEnum = pgEnum('property_purpose', enumValues(PROPERTY_PURPOSES));
export const propertyCommercialStatusEnum = pgEnum(
  'property_commercial_status',
  enumValues(PROPERTY_COMMERCIAL_STATUSES),
);
export const currencyEnum = pgEnum('currency', enumValues(CURRENCIES));
export const projectCategoryEnum = pgEnum('project_category', enumValues(PROJECT_CATEGORIES));
export const projectStatusEnum = pgEnum('project_status', enumValues(PROJECT_STATUSES));
export const projectStageEnum = pgEnum('project_stage', enumValues(PROJECT_STAGES));
export const leadInterestEnum = pgEnum('lead_interest_type', enumValues(LEAD_INTEREST_TYPES));
export const leadStatusEnum = pgEnum('lead_status', enumValues(LEAD_STATUSES));
export const domainStatusEnum = pgEnum('domain_status', enumValues(DOMAIN_STATUSES));
export const sslStatusEnum = pgEnum('ssl_status', ['pending', 'active', 'error']);
export const mediaKindEnum = pgEnum('media_kind', enumValues(MEDIA_KINDS));
export const userTokenTypeEnum = pgEnum('user_token_type', [
  'email_verification',
  'password_reset',
  'invitation',
]);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
]);
export const robotsPolicyEnum = pgEnum('robots_policy', ['index', 'noindex']);
export const serviceIconEnum = pgEnum('service_icon', enumValues(SAFE_ICONS));

// -------------------------------------------------------------- utilitarios

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const area = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });

// -------------------------------------------------------- contas e empresas

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    priceCents: integer('price_cents').notNull().default(0),
    limits: jsonb('limits').$type<PlanLimits>().notNull(),
    isPublic: boolean('is_public').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex('plans_code_key').on(table.code)],
);

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    taxId: text('tax_id').notNull().default(''),
    description: text('description').notNull().default(''),
    foundedYear: integer('founded_year'),
    creaNumber: text('crea_number').notNull().default(''),
    status: tenantStatusEnum('status').notNull().default('trialing'),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    /** Limites especificos desta empresa, sobrepondo os do plano. */
    limitOverrides: jsonb('limit_overrides').$type<Partial<PlanLimits> | null>(),
    contactEmail: text('contact_email').notNull().default(''),
    contactPhone: text('contact_phone').notNull().default(''),
    whatsapp: text('whatsapp').notNull().default(''),
    whatsappDefaultMessage: text('whatsapp_default_message').notNull().default(''),
    address: jsonb('address').$type<AddressInput>().notNull(),
    serviceArea: text('service_area').notNull().default(''),
    businessHours: text('business_hours').notNull().default(''),
    social: jsonb('social').$type<Partial<Record<SocialNetwork, string>>>().notNull().default({}),
    storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
    /** Anotacoes internas da plataforma; nunca expostas no site publico. */
    internalNotes: text('internal_notes').notNull().default(''),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('tenants_slug_key').on(table.slug),
    index('tenants_status_idx').on(table.status),
    index('tenants_plan_idx').on(table.planId),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** Null enquanto o convite nao foi aceito. */
    passwordHash: text('password_hash'),
    phone: text('phone').notNull().default(''),
    platformRole: platformRoleEnum('platform_role').notNull().default('none'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('users_email_key').on(table.email),
    index('users_platform_role_idx').on(table.platformRole),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: tenantRoleEnum('role').notNull().default('viewer'),
    status: membershipStatusEnum('status').notNull().default('active'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('memberships_tenant_user_key').on(table.tenantId, table.userId),
    index('memberships_user_idx').on(table.userId),
    index('memberships_tenant_idx').on(table.tenantId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 do token opaco guardado no cookie HttpOnly. */
    tokenHash: text('token_hash').notNull(),
    /** SHA-256 do token anti-CSRF entregue ao navegador. */
    csrfTokenHash: text('csrf_token_hash').notNull(),
    userAgent: text('user_agent').notNull().default(''),
    /** Hash do IP: permite auditoria sem armazenar o endereco em claro. */
    ipHash: text('ip_hash').notNull().default(''),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_expires_idx').on(table.expiresAt),
  ],
);

export const userTokens = pgTable(
  'user_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    type: userTokenTypeEnum('type').notNull(),
    tokenHash: text('token_hash').notNull(),
    role: tenantRoleEnum('role'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('user_tokens_hash_key').on(table.tokenHash),
    index('user_tokens_user_type_idx').on(table.userId, table.type),
    index('user_tokens_expires_idx').on(table.expiresAt),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: subscriptionStatusEnum('status').notNull().default('trialing'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    /** Reservado para a futura integracao de cobranca. */
    externalCustomerId: text('external_customer_id'),
    externalSubscriptionId: text('external_subscription_id'),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('subscriptions_tenant_key').on(table.tenantId),
    index('subscriptions_plan_idx').on(table.planId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null para acoes no escopo da plataforma. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Copia do e-mail no momento da acao, para o log sobreviver a exclusao. */
    actorEmail: text('actor_email').notNull().default(''),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull().default(''),
    entityId: text('entity_id').notNull().default(''),
    /** Metadados sem credenciais nem dados pessoais sensiveis. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ipHash: text('ip_hash').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    createdAt,
  },
  (table) => [
    index('audit_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('audit_logs_actor_idx').on(table.actorUserId),
    index('audit_logs_action_idx').on(table.action),
  ],
);

/**
 * Autorizacao explicita, temporaria e auditada para que um administrador da
 * plataforma consulte dados de uma empresa. Sem uma concessao valida, o papel
 * `platform_admin` nao da acesso a conteudo de nenhum tenant.
 */
export const supportAccessGrants = pgTable(
  'support_access_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    platformUserId: uuid('platform_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    readOnly: boolean('read_only').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    index('support_grants_lookup_idx').on(table.platformUserId, table.tenantId, table.expiresAt),
  ],
);

/** Rate limiting persistente: funcoes serverless nao compartilham memoria. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull().default(0),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('rate_limits_expires_idx').on(table.expiresAt)],
);

// ------------------------------------------------------- sites e dominios

export const domains = pgTable(
  'domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    status: domainStatusEnum('status').notNull().default('pending'),
    isPrimary: boolean('is_primary').notNull().default(false),
    verificationRecordName: text('verification_record_name').notNull().default(''),
    verificationRecordValue: text('verification_record_value').notNull().default(''),
    dnsConfigured: boolean('dns_configured').notNull().default(false),
    ownershipVerified: boolean('ownership_verified').notNull().default(false),
    sslStatus: sslStatusEnum('ssl_status').notNull().default('pending'),
    vercelDomainId: text('vercel_domain_id'),
    lastError: text('last_error').notNull().default(''),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    /** Unicidade global: um dominio nunca pertence a duas empresas. */
    uniqueIndex('domains_hostname_key').on(table.hostname),
    index('domains_tenant_idx').on(table.tenantId),
    index('domains_status_idx').on(table.status),
    uniqueIndex('domains_primary_per_tenant_key')
      .on(table.tenantId)
      .where(sql`${table.isPrimary}`),
  ],
);

export const siteSettings = pgTable(
  'site_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    theme: jsonb('theme').$type<Theme>().notNull(),
    sections: jsonb('sections').$type<PublicSiteSections>().notNull(),
    seo: jsonb('seo').$type<PublicSeo>().notNull(),
    /** Incrementado a cada publicacao; usado em ETag e invalidacao de cache. */
    publishedVersion: integer('published_version').notNull().default(0),
    lastPublishedAt: timestamp('last_published_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex('site_settings_tenant_key').on(table.tenantId)],
);

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    isHome: boolean('is_home').notNull().default(false),
    status: publicationStatusEnum('status').notNull().default('draft'),
    /** Conteudo em edicao. O site publico nunca le este campo. */
    draftLayout: jsonb('draft_layout').$type<PageLayout>().notNull(),
    draftRevision: integer('draft_revision').notNull().default(0),
    draftUpdatedAt: timestamp('draft_updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Versao atualmente publicada; o site publico le somente daqui. */
    publishedVersionId: uuid('published_version_id'),
    seoTitle: text('seo_title').notNull().default(''),
    seoDescription: text('seo_description').notNull().default(''),
    seoImageUrl: text('seo_image_url').notNull().default(''),
    canonicalUrl: text('canonical_url').notNull().default(''),
    robots: robotsPolicyEnum('robots').notNull().default('index'),
    showInNavigation: boolean('show_in_navigation').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedByUserId: uuid('published_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('pages_tenant_slug_key').on(table.tenantId, table.slug),
    uniqueIndex('pages_tenant_home_key')
      .on(table.tenantId)
      .where(sql`${table.isHome}`),
    index('pages_tenant_status_idx').on(table.tenantId, table.status),
  ],
);

export const pageVersions = pgTable(
  'page_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    layout: jsonb('layout').$type<PageLayout>().notNull(),
    note: text('note').notNull().default(''),
    publishedByUserId: uuid('published_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
  },
  (table) => [
    uniqueIndex('page_versions_page_version_key').on(table.pageId, table.version),
    index('page_versions_tenant_idx').on(table.tenantId),
  ],
);

export const navigationMenus = pgTable(
  'navigation_menus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    items: jsonb('items').$type<NavigationMenuInput['items']>().notNull().default([]),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex('navigation_menus_tenant_key_key').on(table.tenantId, table.key)],
);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    blobUrl: text('blob_url').notNull(),
    /** Caminho no Vercel Blob; sempre prefixado por `tenants/<tenantId>/`. */
    blobPathname: text('blob_pathname').notNull(),
    downloadUrl: text('download_url').notNull().default(''),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    kind: mediaKindEnum('kind').notNull().default('image'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    alt: text('alt').notNull().default(''),
    title: text('title').notNull().default(''),
    tag: text('tag').notNull().default(''),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('media_assets_pathname_key').on(table.blobPathname),
    index('media_assets_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('media_assets_tenant_tag_idx').on(table.tenantId, table.tag),
  ],
);

export const redirects = pgTable(
  'redirects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    fromPath: text('from_path').notNull(),
    toPath: text('to_path').notNull(),
    statusCode: smallint('status_code').notNull().default(301),
    enabled: boolean('enabled').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex('redirects_tenant_from_key').on(table.tenantId, table.fromPath)],
);

// ----------------------------------------------------------------- conteudo

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    reference: text('reference').notNull().default(''),
    description: text('description').notNull().default(''),
    shortDescription: text('short_description').notNull().default(''),
    type: propertyTypeEnum('type').notNull(),
    purpose: propertyPurposeEnum('purpose').notNull(),
    price: money('price'),
    priceOnRequest: boolean('price_on_request').notNull().default(false),
    condoFee: money('condo_fee'),
    iptu: money('iptu'),
    currency: currencyEnum('currency').notNull().default('BRL'),
    address: jsonb('address').$type<AddressInput>().notNull(),
    builtAreaM2: area('built_area_m2'),
    landAreaM2: area('land_area_m2'),
    bedrooms: smallint('bedrooms'),
    suites: smallint('suites'),
    bathrooms: smallint('bathrooms'),
    parkingSpots: smallint('parking_spots'),
    floor: smallint('floor'),
    features: jsonb('features').$type<string[]>().notNull().default([]),
    coverImageId: uuid('cover_image_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    /** Estado editorial, independente do estado comercial. */
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('draft'),
    commercialStatus: propertyCommercialStatusEnum('commercial_status').notNull().default('disponivel'),
    featured: boolean('featured').notNull().default(false),
    deliveryDate: date('delivery_date'),
    videoUrl: text('video_url').notNull().default(''),
    seoTitle: text('seo_title').notNull().default(''),
    seoDescription: text('seo_description').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('properties_tenant_slug_key').on(table.tenantId, table.slug),
    index('properties_tenant_status_idx').on(table.tenantId, table.publicationStatus),
    index('properties_tenant_purpose_idx').on(table.tenantId, table.purpose),
    index('properties_tenant_featured_idx').on(table.tenantId, table.featured),
    index('properties_cover_idx').on(table.coverImageId),
  ],
);

export const propertyImages = pgTable(
  'property_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
  },
  (table) => [
    uniqueIndex('property_images_unique').on(table.propertyId, table.mediaAssetId),
    index('property_images_property_idx').on(table.propertyId, table.sortOrder),
    index('property_images_media_idx').on(table.mediaAssetId),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    shortDescription: text('short_description').notNull().default(''),
    category: projectCategoryEnum('category').notNull(),
    status: projectStatusEnum('status').notNull().default('em_andamento'),
    stage: projectStageEnum('stage').notNull().default('planejamento'),
    /** Null quando a empresa nao informou o percentual: nunca estimamos. */
    progressPercent: smallint('progress_percent'),
    city: text('city').notNull().default(''),
    state: text('state').notNull().default(''),
    neighborhood: text('neighborhood').notNull().default(''),
    showLocation: boolean('show_location').notNull().default(true),
    startDate: date('start_date'),
    expectedCompletionDate: date('expected_completion_date'),
    completedDate: date('completed_date'),
    coverImageId: uuid('cover_image_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('draft'),
    featured: boolean('featured').notNull().default(false),
    seoTitle: text('seo_title').notNull().default(''),
    seoDescription: text('seo_description').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('projects_tenant_slug_key').on(table.tenantId, table.slug),
    index('projects_tenant_status_idx').on(table.tenantId, table.publicationStatus),
    index('projects_tenant_category_idx').on(table.tenantId, table.category),
  ],
);

export const projectImages = pgTable(
  'project_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
  },
  (table) => [
    uniqueIndex('project_images_unique').on(table.projectId, table.mediaAssetId),
    index('project_images_project_idx').on(table.projectId, table.sortOrder),
    index('project_images_media_idx').on(table.mediaAssetId),
  ],
);

/** Registros de evolucao da obra, com fotos e etapa. */
export const projectUpdates = pgTable(
  'project_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    note: text('note').notNull().default(''),
    stage: projectStageEnum('stage'),
    progressPercent: smallint('progress_percent'),
    recordedAt: date('recorded_at'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
    updatedAt,
  },
  (table) => [index('project_updates_project_idx').on(table.projectId, table.createdAt)],
);

export const projectUpdateImages = pgTable(
  'project_update_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectUpdateId: uuid('project_update_id')
      .notNull()
      .references(() => projectUpdates.id, { onDelete: 'cascade' }),
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
  },
  (table) => [
    uniqueIndex('project_update_images_unique').on(table.projectUpdateId, table.mediaAssetId),
    index('project_update_images_media_idx').on(table.mediaAssetId),
  ],
);

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    description: text('description').notNull().default(''),
    icon: serviceIconEnum('icon').notNull().default('wrench'),
    imageId: uuid('image_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    highlights: jsonb('highlights').$type<string[]>().notNull().default([]),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('published'),
    sortOrder: integer('sort_order').notNull().default(0),
    seoTitle: text('seo_title').notNull().default(''),
    seoDescription: text('seo_description').notNull().default(''),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('services_tenant_slug_key').on(table.tenantId, table.slug),
    index('services_tenant_status_idx').on(table.tenantId, table.publicationStatus),
  ],
);

export const testimonials = pgTable(
  'testimonials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    authorName: text('author_name').notNull(),
    authorRole: text('author_role').notNull().default(''),
    content: text('content').notNull(),
    rating: smallint('rating'),
    photoId: uuid('photo_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    relatedProjectId: uuid('related_project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Publicacao exige declaracao de autorizacao do autor. */
    authorizationConfirmed: boolean('authorization_confirmed').notNull().default(false),
    authorizationNote: text('authorization_note').notNull().default(''),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('draft'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [index('testimonials_tenant_status_idx').on(table.tenantId, table.publicationStatus)],
);

export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role').notNull().default(''),
    bio: text('bio').notNull().default(''),
    photoId: uuid('photo_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    email: text('email').notNull().default(''),
    social: jsonb('social').$type<Partial<Record<SocialNetwork, string>>>().notNull().default({}),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('published'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [index('team_members_tenant_status_idx').on(table.tenantId, table.publicationStatus)],
);

export const faqs = pgTable(
  'faqs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    category: text('category').notNull().default(''),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('published'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [index('faqs_tenant_status_idx').on(table.tenantId, table.publicationStatus)],
);

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email').notNull().default(''),
    interestType: leadInterestEnum('interest_type').notNull().default('outro'),
    message: text('message').notNull().default(''),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    status: leadStatusEnum('status').notNull().default('novo'),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
    sourcePath: text('source_path').notNull().default(''),
    /** Momento do consentimento explicito para contato (LGPD). */
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull().defaultNow(),
    ipHash: text('ip_hash').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('leads_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('leads_tenant_status_idx').on(table.tenantId, table.status),
    index('leads_property_idx').on(table.propertyId),
  ],
);

/** Observacoes internas sobre o interessado: nunca expostas no site publico. */
export const leadNotes = pgTable(
  'lead_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note').notNull(),
    createdAt,
  },
  (table) => [index('lead_notes_lead_idx').on(table.leadId, table.createdAt)],
);

// ------------------------------------------------------------------- tipos

export type PlanRow = typeof plans.$inferSelect;
export type TenantRow = typeof tenants.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type UserTokenRow = typeof userTokens.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type SupportAccessGrantRow = typeof supportAccessGrants.$inferSelect;
export type DomainRow = typeof domains.$inferSelect;
export type SiteSettingsRow = typeof siteSettings.$inferSelect;
export type PageRow = typeof pages.$inferSelect;
export type PageVersionRow = typeof pageVersions.$inferSelect;
export type NavigationMenuRow = typeof navigationMenus.$inferSelect;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type RedirectRow = typeof redirects.$inferSelect;
export type PropertyRow = typeof properties.$inferSelect;
export type PropertyImageRow = typeof propertyImages.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ProjectImageRow = typeof projectImages.$inferSelect;
export type ProjectUpdateRow = typeof projectUpdates.$inferSelect;
export type ServiceRow = typeof services.$inferSelect;
export type TestimonialRow = typeof testimonials.$inferSelect;
export type TeamMemberRow = typeof teamMembers.$inferSelect;
export type FaqRow = typeof faqs.$inferSelect;
export type LeadRow = typeof leads.$inferSelect;
export type LeadNoteRow = typeof leadNotes.$inferSelect;
