import {
  bigint,
  boolean,
  date,
  foreignKey,
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
  PlanBillingInput,
  SuspensionPolicy,
  DeliveryState,
  PlanLimits,
  SocialNetwork,
} from '@codeca/shared';
import {
  CURRENCIES,
  LEAD_INTEREST_TYPES,
  LEAD_STATUSES,
  PLATFORM_ROLES,
  API_KEY_KINDS,
  SEGMENT_CODES,
  SITE_STATUSES,
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
  BILLING_STATES,
  CHARGE_STATES,
  PAYMENT_METHOD_CODES,
  PUBLICATION_STATES,
} from '@codeca/shared';

/**
 * Schema do Neon PostgreSQL.
 *
 * Isolamento multiempresa: toda tabela de conteudo carrega `tenant_id` com
 * chave estrangeira e `ON DELETE CASCADE`, e os indices garantem unicidade
 * sempre dentro do escopo da empresa (por exemplo, slug unico por tenant).
 * As consultas da API filtram por `tenant_id` resolvido no servidor.
 */

/**
 * Repassa a tupla de literais ao `pgEnum` preservando a uniao de tipos, para
 * que as colunas sejam tipadas com os valores exatos e nao com `string`.
 */
const enumValues = <T extends readonly [string, ...string[]]>(values: T): [T[number], ...T[number][]] =>
  values as unknown as [T[number], ...T[number][]];

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
export const apiKeyKindEnum = pgEnum('api_key_kind', enumValues(API_KEY_KINDS));
export const segmentCodeEnum = pgEnum('segment_code', enumValues(SEGMENT_CODES));
export const siteStatusEnum = pgEnum('site_status', enumValues(SITE_STATUSES));
export const mediaKindEnum = pgEnum('media_kind', enumValues(MEDIA_KINDS));
export const userTokenTypeEnum = pgEnum('user_token_type', [
  'email_verification',
  'password_reset',
  'invitation',
]);
/**
 * Estado comercial da assinatura na plataforma. Nao e o status da ValidaPay:
 * o status cru do provedor fica em `subscriptions.provider_status`.
 *
 * O tipo no banco continua chamado `subscription_status`, criado na migracao
 * inicial: manter o nome permite acrescentar os estados novos com
 * `ALTER TYPE ... ADD VALUE`, sem reescrever a coluna de uma tabela em uso.
 */
export const billingStateEnum = pgEnum('subscription_status', enumValues(BILLING_STATES));
/** Se o site publico da empresa pode ser servido, e por que nao. */
export const publicationStateEnum = pgEnum('publication_state', enumValues(PUBLICATION_STATES));
/** Estado local de uma cobranca, espelhando o do provedor. */
export const chargeStateEnum = pgEnum('charge_state', enumValues(CHARGE_STATES));
export const paymentMethodEnum = pgEnum('payment_method', enumValues(PAYMENT_METHOD_CODES));
export const webhookEventStatusEnum = pgEnum('webhook_event_status', [
  'pending',
  'processed',
  'failed',
  'ignored',
  'unresolved',
]);
export const billingAuditSourceEnum = pgEnum('billing_audit_source', [
  'checkout',
  'webhook',
  'reconciliation',
  'admin',
  'system',
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
    /** Periodicidade, avaliacao e formas de pagamento enviadas a ValidaPay. */
    billing: jsonb('billing').$type<PlanBillingInput>().notNull().default({
      recurrenceType: 'MONTHLY',
      recurrenceInterval: 1,
      trialDays: null,
      paymentMethods: ['creditcard'],
    }),
    /**
     * O que a suspensao faz neste plano.
     *
     * Fica no plano, e nao na assinatura: o que acontece ao atrasar e
     * caracteristica comercial do plano, igual para todo cliente que o
     * assina. Nenhuma opcao apaga dado -- isso nao e configuravel.
     */
    suspension: jsonb('suspension').$type<SuspensionPolicy>().notNull().default({
      publicSite: 'serve',
      panel: 'read_only',
    }),
    /** Produto e preco correspondentes na ValidaPay, criados ao sincronizar. */
    externalProductId: text('external_product_id'),
    externalPriceId: text('external_price_id'),
    externalCheckoutUrl: text('external_checkout_url'),
    externalSyncedAt: timestamp('external_synced_at', { withTimezone: true }),
    /** Ultima falha de sincronizacao, sem segredos. */
    externalSyncError: text('external_sync_error').notNull().default(''),
    isPublic: boolean('is_public').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('plans_code_key').on(table.code),
    uniqueIndex('plans_external_price_key')
      .on(table.externalPriceId)
      .where(sql`${table.externalPriceId} is not null`),
  ],
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

/**
 * Segmentos de mercado atendidos.
 *
 * Guarda o conjunto padrao de modulos que um site do segmento recebe ao ser
 * cadastrado. O conjunto e ponto de partida, nao limite: o painel mestre
 * ajusta site a site depois.
 */
export const segments = pgTable(
  'segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: segmentCodeEnum('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Modulos habilitados por padrao para sites deste segmento. */
    defaultModules: jsonb('default_modules').$type<string[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex('segments_code_key').on(table.code)],
);

/**
 * Site de um cliente.
 *
 * E a entidade que faltava entre a empresa e o conteudo. Antes `tenants`
 * acumulava os dois papeis, o que impedia uma empresa ter mais de um site com
 * segmento, modulos, dominio e credenciais proprios.
 *
 * O indice unico sobre `(id, tenant_id)` nao e redundante com a chave
 * primaria: ele e o que permite as tabelas de conteudo referenciarem o par,
 * fazendo o banco garantir que o site informado pertence mesmo aquela empresa.
 * Sem ele, bastaria um `site_id` de outra empresa passar numa escrita para o
 * isolamento cair.
 */
export const sites = pgTable(
  'sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: siteStatusEnum('status').notNull().default('draft'),
    /** Site que o painel abre por padrao para esta empresa. */
    isPrimary: boolean('is_primary').notNull().default(false),
    /** Anotacoes da CODECA IA sobre o projeto; nunca expostas ao cliente. */
    internalNotes: text('internal_notes').notNull().default(''),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('sites_id_tenant_key').on(table.id, table.tenantId),
    uniqueIndex('sites_tenant_slug_key').on(table.tenantId, table.slug),
    uniqueIndex('sites_primary_per_tenant_key')
      .on(table.tenantId)
      .where(sql`${table.isPrimary}`),
    index('sites_tenant_idx').on(table.tenantId),
    index('sites_status_idx').on(table.status),
  ],
);

/**
 * Modulos habilitados em um site.
 *
 * O catalogo dos modulos vive em `packages/shared`; aqui fica so o que varia
 * por projeto. `moduleKey` e texto, e nao enum, de proposito: acrescentar um
 * modulo passa a ser uma entrada no registro, sem `ALTER TYPE` e sem migracao.
 */
export const siteModules = pgTable(
  'site_modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    moduleKey: text('module_key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Ajustes do modulo neste site. Validados pelo registro. */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('site_modules_site_key').on(table.siteId, table.moduleKey),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'site_modules_site_tenant_fk',
    }).onDelete('cascade'),
    index('site_modules_site_idx').on(table.siteId),
  ],
);

/**
 * Excecoes a politica de campos de um site.
 *
 * Guarda **somente o que difere do padrao** declarado no registro. Uma linha
 * por campo de cada site repetiria o padrao milhares de vezes e envelheceria
 * sozinha: um campo novo no registro ficaria invisivel para todo site criado
 * antes dele.
 */
export const siteFieldPolicies = pgTable(
  'site_field_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    moduleKey: text('module_key').notNull(),
    fieldKey: text('field_key').notNull(),
    /** O cliente pode editar este campo neste site. */
    editable: boolean('editable').notNull(),
    /** Por que a CODECA IA travou o campo. Aparece no painel do cliente. */
    note: text('note').notNull().default(''),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('site_field_policies_key').on(table.siteId, table.moduleKey, table.fieldKey),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'site_field_policies_site_tenant_fk',
    }).onDelete('cascade'),
    index('site_field_policies_site_idx').on(table.siteId),
  ],
);

/**
 * Conteudo dos modulos de instancia unica.
 *
 * Institucional e contato tem cardinalidade um por site e nenhuma busca, entao
 * tabela tipada seria peso sem retorno. O JSONB aceita qualquer coisa, por
 * isso a escrita passa obrigatoriamente pelo schema do registro.
 */
export const contentDocuments = pgTable(
  'content_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    moduleKey: text('module_key').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('content_documents_site_key').on(table.siteId, table.moduleKey),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'content_documents_site_tenant_fk',
    }).onDelete('cascade'),
    index('content_documents_site_idx').on(table.siteId),
  ],
);

/**
 * Credenciais de integracao de um site.
 *
 * Duas naturezas na mesma tabela porque o ciclo de vida e identico -- criar,
 * rotacionar, revogar -- e o que muda e o escopo e o sigilo:
 *
 * - **publicavel**: viaja no navegador, entao fica legivel em `token`. Nao e
 *   segredo; e um identificador com escopo, cercado por origem autorizada.
 * - **secreta**: so o hash e guardado. O valor em claro existe uma unica vez,
 *   na resposta da criacao. Perdido, rotaciona-se.
 *
 * `lookup` viaja em claro dentro do token e tem indice proprio: sem ele,
 * conferir uma chave exigiria comparar o hash de todas as chaves do banco.
 */
export const siteApiKeys = pgTable(
  'site_api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    kind: apiKeyKindEnum('kind').notNull(),
    name: text('name').notNull().default(''),
    lookup: text('lookup').notNull(),
    /** SHA-256 do segredo apresentado. Conferido em tempo constante. */
    secretHash: text('secret_hash').notNull(),
    /** Token completo, somente para chaves publicaveis. */
    token: text('token'),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    /** Preenchido na rotacao: a chave antiga vale ate aqui. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Gravado de forma esparsa: uma escrita por requisicao seria desperdicio. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('site_api_keys_lookup_key').on(table.lookup),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'site_api_keys_site_tenant_fk',
    }).onDelete('cascade'),
    index('site_api_keys_site_idx').on(table.siteId),
  ],
);

/**
 * Origens autorizadas a usar a chave publicavel do site.
 *
 * Guardadas ja normalizadas (esquema e host, porta padrao removida) para que a
 * comparacao na requisicao seja exata. Comparacao por sufixo autorizaria
 * `exemplo.com.br.invasor.com`.
 */
export const siteOrigins = pgTable(
  'site_origins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    origin: text('origin').notNull(),
    note: text('note').notNull().default(''),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('site_origins_site_origin_key').on(table.siteId, table.origin),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'site_origins_site_tenant_fk',
    }).onDelete('cascade'),
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
    siteId: uuid('site_id').notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),

    /** Estado comercial decidido pela plataforma. */
    status: billingStateEnum('status').notNull().default('trialing'),
    /** Status cru da ValidaPay, guardado como recebido, sem traducao. */
    providerStatus: text('provider_status').notNull().default(''),
    /** Estado da publicacao do site, derivado do estado comercial. */
    publicationState: publicationStateEnum('publication_state').notNull().default('allowed'),

    paymentMethod: paymentMethodEnum('payment_method'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    /**
     * Fim do acesso pago. E o campo que decide a publicacao: avanca somente
     * quando um pagamento e confirmado ou quando o provedor informa o proximo
     * ciclo. Nunca e estendido por uma simples criacao de assinatura.
     */
    accessUntil: timestamp('access_until', { withTimezone: true }),
    /** Dias de tolerancia apos `access_until` antes de suspender o site. */
    gracePeriodDays: smallint('grace_period_days').notNull().default(5),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    nextChargeAt: timestamp('next_charge_at', { withTimezone: true }),
    currentCycleNumber: integer('current_cycle_number').notNull().default(0),
    /** Valor do ciclo corrente em centavos, como informado pelo provedor. */
    currentCycleAmountCents: integer('current_cycle_amount_cents'),

    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    cancelReason: text('cancel_reason').notNull().default(''),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),

    /** Suspensao manual da publicacao pelo painel mestre, com justificativa. */
    adminHold: boolean('admin_hold').notNull().default(false),
    adminHoldReason: text('admin_hold_reason').notNull().default(''),
    adminHoldAt: timestamp('admin_hold_at', { withTimezone: true }),
    adminHoldByUserId: uuid('admin_hold_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Estorno, contestacao ou chargeback aguardando revisao. */
    disputeHold: boolean('dispute_hold').notNull().default(false),
    disputeReason: text('dispute_reason').notNull().default(''),

    /** Plano agendado para o proximo ciclo (downgrade). */
    pendingPlanId: uuid('pending_plan_id').references(() => plans.id, { onDelete: 'set null' }),

    externalCustomerId: text('external_customer_id'),
    externalSubscriptionId: text('external_subscription_id'),
    externalItemId: text('external_item_id'),
    externalPriceId: text('external_price_id'),
    externalCheckoutId: text('external_checkout_id'),
    /** Sessao de checkout da contratacao em andamento. */
    checkoutSessionId: text('checkout_session_id'),
    checkoutUrl: text('checkout_url'),
    checkoutCreatedAt: timestamp('checkout_created_at', { withTimezone: true }),
    /**
     * Token opaco enviado em `metadata` da sessao e devolvido nos eventos.
     * Permite ligar a assinatura criada pelo provedor a esta empresa sem
     * confiar em e-mail ou documento.
     */
    intentToken: text('intent_token'),

    /** Ultima vez que o estado foi confirmado consultando a ValidaPay. */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** Instante do evento mais recente ja aplicado, para descartar atrasados. */
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    lastErrorMessage: text('last_error_message').notNull().default(''),

    createdAt,
    updatedAt,
  },
  (table) => [
    /**
     * Uma assinatura por **site**, nao por empresa: o que se contrata e o
     * projeto. Uma empresa com dois sites pode ter um pago e outro nao.
     */
    uniqueIndex('subscriptions_site_key').on(table.siteId),
    index('subscriptions_tenant_idx').on(table.tenantId),
    index('subscriptions_plan_idx').on(table.planId),
    index('subscriptions_status_idx').on(table.status),
    index('subscriptions_sync_idx').on(table.lastSyncedAt),
    uniqueIndex('subscriptions_external_key')
      .on(table.externalSubscriptionId)
      .where(sql`${table.externalSubscriptionId} is not null`),
    uniqueIndex('subscriptions_intent_key')
      .on(table.intentToken)
      .where(sql`${table.intentToken} is not null`),
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'subscriptions_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Cobrancas de assinatura.
 *
 * Uma linha por cobranca da ValidaPay (`cha_...`), com o identificador externo
 * unico: e o que torna o processamento de webhooks idempotente e impede que uma
 * retentativa credite o mesmo pagamento duas vezes.
 */
export const charges = pgTable(
  'charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    externalChargeId: text('external_charge_id').notNull(),
    externalSubscriptionId: text('external_subscription_id'),
    externalInvoiceId: text('external_invoice_id'),
    status: chargeStateEnum('status').notNull().default('pending'),
    providerStatus: text('provider_status').notNull().default(''),
    amountCents: integer('amount_cents').notNull().default(0),
    /** Valor efetivamente estornado, quando houver. */
    refundedAmountCents: integer('refunded_amount_cents').notNull().default(0),
    paymentMethod: paymentMethodEnum('payment_method'),
    cycleNumber: integer('cycle_number'),
    description: text('description').notNull().default(''),
    dueAt: timestamp('due_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    /** Codigo e motivo da falha informados pela API, sem dados de cartao. */
    failureCode: text('failure_code').notNull().default(''),
    failureReason: text('failure_reason').notNull().default(''),
    /** Numero da tentativa do provedor, quando informado. */
    attempt: smallint('attempt'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('charges_external_key').on(table.externalChargeId),
    index('charges_tenant_idx').on(table.tenantId, table.createdAt),
    index('charges_subscription_idx').on(table.subscriptionId),
    index('charges_status_idx').on(table.status),
    index('charges_sync_idx').on(table.status, table.lastSyncedAt),
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'charges_site_tenant_fk',
    }).onDelete('cascade'),
    index('charges_site_idx').on(table.siteId),
  ],
);

/**
 * Eventos de webhook recebidos.
 *
 * O `X-Webhook-Id` entra como chave unica: a ValidaPay entrega *pelo menos uma
 * vez* e reenvia por 72 horas, portanto o mesmo evento chega mais de uma vez. O
 * payload fica gravado para reprocessamento e auditoria.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `X-Webhook-Id`, ou um identificador derivado quando ausente. */
    externalEventId: text('external_event_id').notNull(),
    event: text('event').notNull(),
    /** Instante informado pelo provedor no corpo do evento. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    attempt: smallint('attempt'),
    status: webhookEventStatusEnum('status').notNull().default('pending'),
    /** Empresa resolvida a partir do evento; nulo quando nao foi possivel. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    externalSubscriptionId: text('external_subscription_id'),
    externalChargeId: text('external_charge_id'),
    /** Corpo recebido, como JSON. Nao guarda cabecalhos nem assinatura. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    processingAttempts: smallint('processing_attempts').notNull().default(0),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /** Mensagem de erro sanitizada da ultima tentativa. */
    errorMessage: text('error_message').notNull().default(''),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('webhook_events_external_key').on(table.externalEventId),
    index('webhook_events_status_idx').on(table.status, table.receivedAt),
    index('webhook_events_tenant_idx').on(table.tenantId),
    index('webhook_events_subscription_idx').on(table.externalSubscriptionId),
  ],
);

/**
 * Historico das decisoes de cobranca e publicacao.
 *
 * Separa de proposito a acao administrativa do estado externo: uma suspensao
 * manual nao reescreve o que a ValidaPay confirmou, apenas registra a decisao.
 */
export const billingAuditLogs = pgTable(
  'billing_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    chargeId: uuid('charge_id').references(() => charges.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    source: billingAuditSourceEnum('source').notNull(),
    /** Usuario responsavel, quando a mudanca partiu de uma pessoa. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Evento que originou a mudanca, quando partiu de um webhook. */
    webhookEventId: uuid('webhook_event_id').references(() => webhookEvents.id, {
      onDelete: 'set null',
    }),
    previousState: text('previous_state').notNull().default(''),
    newState: text('new_state').notNull().default(''),
    previousPublication: text('previous_publication').notNull().default(''),
    newPublication: text('new_publication').notNull().default(''),
    reason: text('reason').notNull().default(''),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [
    index('billing_audit_tenant_idx').on(table.tenantId, table.createdAt),
    index('billing_audit_action_idx').on(table.action),
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
    siteId: uuid('site_id').notNull(),
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
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'domains_site_tenant_fk',
    }).onDelete('cascade'),
    index('domains_site_idx').on(table.siteId),
  ],
);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
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
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'media_assets_site_tenant_fk',
    }).onDelete('cascade'),
    index('media_assets_site_idx').on(table.siteId),
  ],
);

// ----------------------------------------------------------------- conteudo

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
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
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'properties_site_tenant_fk',
    }).onDelete('cascade'),
    index('properties_site_idx').on(table.siteId),
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
    siteId: uuid('site_id').notNull(),
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
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'projects_site_tenant_fk',
    }).onDelete('cascade'),
    index('projects_site_idx').on(table.siteId),
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

/**
 * Destaques rotativos na abertura do site.
 *
 * A visibilidade e uma janela (`startsAt`/`endsAt`) alem do interruptor:
 * campanha com data marcada entra e sai sozinha, sem alguem precisar lembrar
 * de desligar no domingo a noite.
 */
export const banners = pgTable(
  'banners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle').notNull().default(''),
    imageId: uuid('image_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    buttonLabel: text('button_label').notNull().default(''),
    buttonUrl: text('button_url').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'banners_site_tenant_fk',
    }).onDelete('cascade'),
    index('banners_site_order_idx').on(table.siteId, table.sortOrder),
    index('banners_site_active_idx').on(table.siteId, table.isActive),
  ],
);

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
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
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'services_site_tenant_fk',
    }).onDelete('cascade'),
    index('services_site_idx').on(table.siteId),
  ],
);

export const testimonials = pgTable(
  'testimonials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
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
  (table) => [
    index('testimonials_tenant_status_idx').on(table.tenantId, table.publicationStatus),
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'testimonials_site_tenant_fk',
    }).onDelete('cascade'),
    index('testimonials_site_idx').on(table.siteId),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
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
  (table) => [
    index('team_members_tenant_status_idx').on(table.tenantId, table.publicationStatus),
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'team_members_site_tenant_fk',
    }).onDelete('cascade'),
    index('team_members_site_idx').on(table.siteId),
  ],
);

export const faqs = pgTable(
  'faqs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    category: text('category').notNull().default(''),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('published'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('faqs_tenant_status_idx').on(table.tenantId, table.publicationStatus),
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'faqs_site_tenant_fk',
    }).onDelete('cascade'),
    index('faqs_site_idx').on(table.siteId),
  ],
);

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
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
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'leads_site_tenant_fk',
    }).onDelete('cascade'),
    index('leads_site_idx').on(table.siteId),
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
// --------------------------------------------- webhooks de saida (etapa 8)

/**
 * Endereco do site do cliente que recebe os avisos de publicacao.
 *
 * Um site Vite nao precisa disto -- busca o conteudo em tempo de execucao e a
 * mudanca aparece na proxima visita. Existe para o site que renderiza no
 * servidor e guarda cache: sem aviso, ele so descobriria a alteracao quando o
 * cache expirasse.
 */
export const siteWebhooks = pgTable(
  'site_webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    url: text('url').notNull(),
    description: text('description').notNull().default(''),
    /**
     * Segredo de assinatura, em claro.
     *
     * Diferente das chaves de integracao, que ficam em hash: assinar exige o
     * segredo a cada entrega. A contrapartida e que ele nunca aparece em log,
     * em auditoria nem numa leitura posterior do painel.
     */
    secret: text('secret').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastStatus: integer('last_status'),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    /** Motivo da ultima falha, sem o corpo da resposta alheia. */
    lastError: text('last_error').notNull().default(''),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    /** O mesmo endereco duas vezes dobraria as entregas. */
    uniqueIndex('site_webhooks_site_url_key').on(table.siteId, table.url),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'site_webhooks_site_tenant_fk',
    }).onDelete('cascade'),
    index('site_webhooks_site_idx').on(table.siteId),
  ],
);

/**
 * Fila de entregas, gravada antes de ser tentada.
 *
 * E o que torna o recurso confiavel numa funcao serverless: o processo que
 * atende a requisicao pode morrer no instante seguinte, entao a entrega nao
 * pode existir so na memoria dele. O que falha volta na proxima passagem do
 * cron.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => siteWebhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<DeliveryState>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastStatus: integer('last_status'),
    lastError: text('last_error').notNull().default(''),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'webhook_deliveries_site_tenant_fk',
    }).onDelete('cascade'),
    index('webhook_deliveries_site_idx').on(table.siteId),
    index('webhook_deliveries_pending_idx').on(table.nextAttemptAt),
  ],
);

export type SiteWebhookRow = typeof siteWebhooks.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;

export type UserRow = typeof users.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type UserTokenRow = typeof userTokens.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type SupportAccessGrantRow = typeof supportAccessGrants.$inferSelect;
export type DomainRow = typeof domains.$inferSelect;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
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
