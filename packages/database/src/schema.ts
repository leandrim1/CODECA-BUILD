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
    /**
     * Identificador curto do segmento, escolhido pela CODECA IA.
     *
     * Texto, e nao enum, pelo mesmo motivo de `site_modules.module_key`:
     * atender um ramo novo e cadastrar uma linha, nao alterar o schema e
     * implantar. O indice unico abaixo impede duplicata.
     */
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Modulos habilitados por padrao para sites deste segmento. */
    defaultModules: jsonb('default_modules').$type<string[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    /** Segmento aplicado a uma empresa recem-cadastrada. No maximo um. */
    isDefault: boolean('is_default').notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('segments_code_key').on(table.code),
    uniqueIndex('segments_default_key').on(table.isDefault).where(sql`${table.isDefault}`),
  ],
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
    /**
     * Projeto Vercel onde o site do cliente esta hospedado.
     *
     * Do **site**, e nao do ambiente: o projeto da plataforma serve o painel,
     * e anexar a ele o dominio de um cliente faria o endereco abrir o login.
     * So e usado quando o plano inclui hospedagem; nulo e o caso comum.
     */
    hostingProjectId: text('hosting_project_id'),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('sites_id_tenant_key').on(table.id, table.tenantId),
    /** Um projeto de hospedagem pertence a um site: nunca dois. */
    uniqueIndex('sites_hosting_project_key')
      .on(table.hostingProjectId)
      .where(sql`${table.hostingProjectId} is not null`),
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
    /** Valores dos campos definidos para este site. Ver `siteCustomFields`. */
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
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
    /**
     * Aceite dos termos de uso e da politica de privacidade: quando e qual
     * versao do texto (`LEGAL_VERSION`). Nulo em contas anteriores ao registro
     * do aceite e em quem ainda nao cadastrou empresa (entrada pelo Google).
     */
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    termsVersion: text('terms_version'),
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

/**
 * Identidades externas: um login por provedor (Google) ligado a um usuario.
 *
 * A identidade INTERNA do usuario continua sendo `users.id`. Esta tabela so diz
 * "este usuario tambem entra por este provedor". Um usuario pode ter senha,
 * Google, ou os dois.
 *
 * ## Por que a chave e `sub`, e nao o e-mail
 *
 * O e-mail de uma conta Google pode mudar e ser reaproveitado; o `sub` e o
 * identificador estavel do provedor. Procurar por e-mail para decidir "quem e
 * este" permitiria que outra pessoa, ao assumir um endereco antigo, entrasse na
 * conta de alguem. O e-mail aqui e so informativo.
 *
 * ## Dois indices unicos, dois riscos
 *
 * - `(provider, provider_subject)`: uma conta Google pertence a UM usuario. Sem
 *   isso, a mesma conta Google abriria duas contas da plataforma.
 * - `(user_id, provider)`: um usuario tem UMA conta Google. Sem isso, trocar de
 *   Google deixaria o vinculo antigo ativo.
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    /** Informativo: o e-mail que o provedor informou na ultima entrada. */
    email: text('email').notNull().default(''),
    emailVerified: boolean('email_verified').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('user_identities_provider_subject_key').on(table.provider, table.providerSubject),
    uniqueIndex('user_identities_user_provider_key').on(table.userId, table.provider),
  ],
);

/**
 * Tentativas de login por provedor em andamento (`state` do OAuth).
 *
 * Guarda so o HASH do `state`: quem lesse o banco nao conseguiria completar o
 * fluxo de ninguem. Uso unico (`consumed_at`) e validade curta (`expires_at`).
 * `user_id` so existe quando a intencao e vincular uma conta a quem ja esta
 * logado, e amarra o fluxo a essa pessoa.
 */
export const oauthStates = pgTable(
  'oauth_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateHash: text('state_hash').notNull(),
    provider: text('provider').notNull(),
    /** `continue` (entrar ou cadastrar) ou `link` (vincular a conta logada). */
    intent: text('intent').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Destino depois de entrar; ja validado como caminho interno. */
    nextPath: text('next_path').notNull().default(''),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('oauth_states_hash_key').on(table.stateHash),
    index('oauth_states_expires_idx').on(table.expiresAt),
  ],
);

/**
 * Codigos de acesso por e-mail (login sem senha).
 *
 * Guarda so o HASH do codigo (HMAC com o segredo do servidor): como o codigo
 * tem 6 digitos, um hash simples seria quebrado por forca bruta em
 * milissegundos por quem lesse o banco; com o segredo, nao.
 *
 * Nao tem `user_id` de proposito. O codigo e pedido para um ENDERECO, exista
 * conta ou nao -- ter (ou nao) uma linha aqui nao pode revelar se o e-mail esta
 * cadastrado. Quem decide entrar ou cadastrar e a verificacao, depois.
 *
 * - `attempts`: tentativas de validacao deste codigo; no limite, ele morre.
 * - `used_at`: usado, OU invalidado por um pedido mais novo. Nos dois casos o
 *   codigo nao vale mais.
 * - `request_ip_hash`: so o hash, para investigar abuso sem guardar o IP.
 */
export const loginCodes = pgTable(
  'login_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: smallint('attempts').notNull().default(0),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestIpHash: text('request_ip_hash').notNull().default(''),
    createdAt,
  },
  (table) => [
    index('login_codes_email_created_idx').on(table.email, table.createdAt),
    index('login_codes_expires_idx').on(table.expiresAt),
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
    /** Valores dos campos definidos para este site. Ver `siteCustomFields`. */
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
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
    /** Valores dos campos definidos para este site. Ver `siteCustomFields`. */
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
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
    /** Valores dos campos definidos para este site. Ver `siteCustomFields`. */
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
    /** Valores dos campos definidos para este site. Ver `siteCustomFields`. */
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
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
    /** Valores dos campos definidos para este site. Ver `siteCustomFields`. */
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
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
    /** Valores dos campos definidos para este site. Ver `siteCustomFields`. */
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
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
    /** Valores dos campos definidos para este site. Ver `siteCustomFields`. */
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

/**
 * Categorias de conteudo.
 *
 * Tabela **compartilhada**, com `module_key` dizendo a que modulo a categoria
 * pertence. Categoria de produto e categoria de imovel sao coisas diferentes,
 * e duas tabelas especificas dariam relacionamento mais firme -- mas cada
 * modulo novo que quisesse agrupar conteudo pediria migracao, e a plataforma
 * foi desenhada para crescer por cadastro.
 *
 * Sem aninhamento, de proposito: `parent_id` traria verificacao de ciclo,
 * limite de profundidade e arvore no painel. O caso que motivou isto -- o
 * cardapio -- e plano (Entradas, Pratos, Sobremesas, Bebidas).
 */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    /** Modulo a que a categoria pertence. Hoje so `produtos` a consome. */
    moduleKey: text('module_key').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('published'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Valores dos campos definidos para este site. Ver `siteCustomFields`. */
    createdAt,
    updatedAt,
  },
  (table) => [
    /** O slug e unico dentro do modulo, nao do site: `bebidas` pode existir
     * em produtos e em outro modulo sem conflito. */
    uniqueIndex('categories_site_module_slug_key').on(table.siteId, table.moduleKey, table.slug),
    index('categories_site_module_idx').on(table.siteId, table.moduleKey, table.sortOrder),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'categories_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Produtos: o que a empresa vende.
 *
 * Uma tabela, nao duas: **sem variacao**. Tamanho e cor pediriam
 * `product_variants` com preco e disponibilidade por combinacao, e nenhum
 * cliente pediu isso ainda -- um cardapio e um catalogo de servicos nao
 * precisam. Quando precisar, a variante entra como tabela filha sem mexer
 * aqui.
 *
 * `price` usa o mesmo `money()` de imovel -- `NUMERIC(14,2)`, nunca ponto
 * flutuante. Nao sao centavos inteiros como em `plans` porque este preco e de
 * **exibicao**, nao valor cobrado: `plans.price_cents` existe para conversar
 * com a ValidaPay. Duas representacoes de dinheiro no mesmo codigo e como
 * comecam erros de arredondamento, entao cada uma tem seu motivo escrito.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    /** `set null`: remover a categoria nao apaga o produto. */
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary').notNull().default(''),
    description: text('description').notNull().default(''),
    /** Codigo interno, SKU ou numero de referencia. Opcional. */
    code: text('code').notNull().default(''),
    price: money('price'),
    priceOnRequest: boolean('price_on_request').notNull().default(false),
    currency: currencyEnum('currency').notNull().default('BRL'),
    /** Unidade exibida ao lado do preco: `un`, `kg`, `porcao`. */
    unit: text('unit').notNull().default(''),
    /** Fora de estoque ou fora do dia, sem despublicar o produto. */
    isAvailable: boolean('is_available').notNull().default(true),
    coverImageId: uuid('cover_image_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('draft'),
    sortOrder: integer('sort_order').notNull().default(0),
    seoTitle: text('seo_title').notNull().default(''),
    seoDescription: text('seo_description').notNull().default(''),
    /** Valores dos campos definidos para este site. Ver `siteCustomFields`. */
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('products_tenant_slug_key').on(table.tenantId, table.slug),
    index('products_site_status_idx').on(table.siteId, table.publicationStatus),
    index('products_site_category_idx').on(table.siteId, table.categoryId, table.sortOrder),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'products_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
  },
  (table) => [
    uniqueIndex('product_images_unique').on(table.productId, table.mediaAssetId),
    index('product_images_product_idx').on(table.productId, table.sortOrder),
    index('product_images_media_idx').on(table.mediaAssetId),
  ],
);

/**
 * Galerias: conjuntos de imagens com nome.
 *
 * "Nossa estrutura", "Antes e depois", "Evento de lancamento". Sem coluna de
 * capa: a primeira imagem da ordem e a capa, e uma coluna separada seria mais
 * um estado a manter coerente com a lista.
 *
 * As imagens nao tem legenda propria aqui. `alt` e `title` vivem em
 * `media_assets`, onde o cliente os escreve **uma vez** para todos os usos --
 * legenda por galeria significaria reescrever o mesmo texto a cada reuso.
 */
export const galleries = pgTable(
  'galleries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('published'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Valores dos campos definidos para este site. Ver `siteCustomFields`. */
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('galleries_tenant_slug_key').on(table.tenantId, table.slug),
    index('galleries_site_status_idx').on(table.siteId, table.publicationStatus),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'galleries_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

export const galleryImages = pgTable(
  'gallery_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    galleryId: uuid('gallery_id')
      .notNull()
      .references(() => galleries.id, { onDelete: 'cascade' }),
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
  },
  (table) => [
    uniqueIndex('gallery_images_unique').on(table.galleryId, table.mediaAssetId),
    index('gallery_images_gallery_idx').on(table.galleryId, table.sortOrder),
    index('gallery_images_media_idx').on(table.mediaAssetId),
  ],
);

/**
 * Campos personalizados definidos pela CODECA IA para um site.
 *
 * As definicoes ficam aqui; os valores, numa coluna `custom_fields` em JSONB
 * na propria tabela do conteudo. Uma tabela de valores
 * (`entity_id`, `field_key`, `value`) faria cada leitura de imovel ganhar uma
 * juncao e a listagem do painel fazer uma consulta por linha.
 *
 * O campo entra na **mesma lista** que o painel ja usa para desenhar o
 * formulario, marcado como `custom`. Por isso a politica de campos, o
 * formulario de documento e a conferencia de escrita valem para ele sem
 * codigo novo.
 */
export const siteCustomFields = pgTable(
  'site_custom_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    moduleKey: text('module_key').notNull(),
    /** Chave no JSONB dos valores. Formato de identificador. */
    fieldKey: text('field_key').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull(),
    required: boolean('required').notNull().default(false),
    help: text('help').notNull().default(''),
    /** Opcoes de um campo de escolha. Vazio nos outros tipos. */
    options: jsonb('options').$type<string[]>().notNull().default([]),
    /** `false` quando a CODECA IA preenche e o cliente so consulta. */
    editable: boolean('editable').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    /** Uma definicao por chave: dois campos com o mesmo nome no mesmo
     * formulario sao impossiveis. */
    uniqueIndex('site_custom_fields_key').on(table.siteId, table.moduleKey, table.fieldKey),
    index('site_custom_fields_module_idx').on(table.siteId, table.moduleKey, table.sortOrder),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'site_custom_fields_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Modulos criados para um site.
 *
 * A existencia do modulo passa a ser dado: "Cardapio", "Turmas", "Processos".
 * Os campos dele reaproveitam `site_custom_fields` -- `module_key` aponta para
 * a chave daqui em vez de para uma do registro -- e os registros vao em
 * `custom_records`.
 *
 * Nao existe tabela por modulo. `CREATE TABLE` em tempo de execucao faria o
 * schema diferir entre instalacoes e poria `DROP` ao alcance de um erro de
 * chave; o motivo completo esta na migracao 0013.
 */
export const siteCustomModules = pgTable(
  'site_custom_modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    /** Chave do modulo, usada na rota publica e no codigo do site. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    kind: text('kind').notNull(),
    icon: text('icon').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    /** `false` esconde sem apagar: e o caminho para tirar do ar. */
    enabled: boolean('enabled').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('site_custom_modules_key').on(table.siteId, table.key),
    index('site_custom_modules_ordem_idx').on(table.siteId, table.sortOrder),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'site_custom_modules_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Registros de todos os modulos personalizados.
 *
 * As colunas fora de `data` sao as que a plataforma precisa conhecer para
 * listar, ordenar, publicar e entregar. O resto e o conteudo dos campos
 * definidos para aquele modulo, validado em tempo de execucao pelo schema que
 * `buildCustomFieldsSchema` monta a partir das definicoes.
 */
export const customRecords = pgTable(
  'custom_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    moduleKey: text('module_key').notNull(),
    title: text('title').notNull(),
    /**
     * Vazio no registro de um `document`.
     *
     * O indice unico de slug e o que mantem o documento unico -- um documento
     * e uma colecao de um registro, nao um segundo mecanismo.
     */
    slug: text('slug').notNull().default(''),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    publicationStatus: text('publication_status').notNull().default('draft'),
    featured: boolean('featured').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('custom_records_slug').on(table.siteId, table.moduleKey, table.slug),
    index('custom_records_listagem_idx').on(
      table.siteId,
      table.moduleKey,
      table.publicationStatus,
      table.sortOrder,
    ),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'custom_records_site_tenant_fk',
    }).onDelete('cascade'),
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

/**
 * Conexao de um site com uma propriedade do Google Analytics 4.
 *
 * Independente do login com Google: tabela, `state`, escopo e callback proprios.
 * Uma conexao por site (indice unico em `site_id`), e o par `(site, empresa)` e
 * conferido pelo banco como em toda tabela de site.
 *
 * `refresh_token_enc` e o token de renovacao **cifrado** (AES-256-GCM, com
 * empresa e site como dado autenticado): quem lesse o banco nao teria o token, e
 * uma linha copiada para outra empresa nao decifraria. O token de acesso nunca
 * e gravado: vive so em memoria, por no maximo ~45 min.
 *
 * `status`: `pending_property` (autorizado, falta escolher a propriedade),
 * `active`, `needs_reconnect` (o Google recusou a renovacao: acesso revogado).
 */
export const analyticsConnections = pgTable(
  'analytics_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    status: text('status').notNull().default('pending_property'),
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    /** Escopos que o Google de fato concedeu (informativo). */
    scope: text('scope').notNull().default(''),
    /** Identificador numerico da propriedade GA4 (sem o prefixo `properties/`). */
    propertyId: text('property_id'),
    propertyName: text('property_name').notNull().default(''),
    accountName: text('account_name').notNull().default(''),
    connectedByUserId: uuid('connected_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastRefreshAt: timestamp('last_refresh_at', { withTimezone: true }),
    /** Motivo da ultima falha, sem corpo de resposta alheia e sem token. */
    lastError: text('last_error').notNull().default(''),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('analytics_connections_site_key').on(table.siteId),
    index('analytics_connections_tenant_idx').on(table.tenantId),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'analytics_connections_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * `state` do OAuth do Analytics: o que impede um retorno forjado de conectar
 * uma conta a uma empresa. Mesmas garantias do login (hash, uso unico, 10 min),
 * em tabela propria, e amarrado a empresa, site e usuario que clicaram em
 * "Conectar" -- o callback nunca confia em empresa vinda da URL.
 */
export const analyticsOauthStates = pgTable(
  'analytics_oauth_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stateHash: text('state_hash').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('analytics_oauth_states_hash_key').on(table.stateHash),
    index('analytics_oauth_states_expires_idx').on(table.expiresAt),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'analytics_oauth_states_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

// ------------------------------------------------- importacao de sites

/**
 * Uma analise de site externo.
 *
 * Guarda o **que foi encontrado**, nao o conteudo final: o conteudo importado
 * vai para as tabelas que o painel ja usa (`content_documents`, `services`,
 * `faqs`, `media_assets`...). Esta tabela e o registro da operacao -- de onde
 * veio, quem pediu, o que a analise viu, em que pe esta -- e e o que permite
 * reverter e auditar depois.
 *
 * Nao e uma segunda estrutura de conteudo: nada aqui e lido pela API publica
 * nem pelo site do cliente.
 */
export const siteImports = pgTable(
  'site_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    /** Endereco informado, ja normalizado por `checkImportUrl`. */
    sourceUrl: text('source_url').notNull(),
    /** Host de origem, para limitar reanalise e para a auditoria. */
    sourceHost: text('source_host').notNull(),
    /** Ver `IMPORT_STATES` em `@codeca/shared`. Texto, nao enum: a lista muda sem `ALTER TYPE`. */
    state: text('state').notNull().default('validando'),
    /** Mensagem para quem opera. Nunca rastro de pilha nem corpo de resposta alheia. */
    message: text('message').notNull().default(''),
    /** Paginas visitadas, com papel, tamanho e falha. Ver `AnalyzedPage`. */
    pages: jsonb('pages').$type<unknown[]>().notNull().default([]),
    /** Contagens reais exibidas no resumo. Ver `ImportSummary`. */
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Estado do rastreamento entre fatias.
     *
     * A funcao da Vercel para em 60 s, entao a analise avanca em pedacos e
     * precisa lembrar onde parou: fila de enderecos, profundidade de cada um,
     * o que ja foi lido. Fica aqui, e nao em memoria, porque a fatia seguinte
     * pode cair em outra instancia.
     */
    cursor: jsonb('cursor').$type<Record<string, unknown>>().notNull().default({}),
    requestedByUserId: uuid('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /** Quando a analise terminou e ficou disponivel para revisao. */
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
    /** Quando o cliente confirmou a importacao. */
    importedAt: timestamp('imported_at', { withTimezone: true }),
    /** Quando a analise parou de avancar, com sucesso ou com erro. */
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('site_imports_site_created_idx').on(table.siteId, table.createdAt),
    index('site_imports_tenant_created_idx').on(table.tenantId, table.createdAt),
    index('site_imports_state_idx').on(table.state),
    /** O par (site, empresa) e conferido pelo banco: ver `sites`. */
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'site_imports_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Um candidato encontrado pela analise.
 *
 * Uma linha por coisa que pode ser importada: um campo do institucional, um
 * servico, uma imagem. A linha carrega o valor proposto, o valor que ja estava
 * no painel e a decisao de quem revisou -- os tres juntos, porque e isso que
 * sustenta as duas garantias do produto:
 *
 * - **nada entra sem confirmacao**: `decision` nasce `ignorado` para campo que
 *   colide com conteudo existente, e so a revisao muda isso;
 * - **tudo pode ser revertido**: `previous_value` guarda o que havia antes, e
 *   `created_entity_id` diz o que foi criado, entao desfazer e devolver um ao
 *   lugar e apagar o outro.
 */
export const siteImportItems = pgTable(
  'site_import_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    importId: uuid('import_id')
      .notNull()
      .references(() => siteImports.id, { onDelete: 'cascade' }),
    /** Ver `IMPORT_ITEM_KINDS`: campo de documento, registro de colecao ou imagem. */
    kind: text('kind').notNull(),
    /** Modulo de destino, ou `midia`. Ver `IMPORT_TARGETS`. */
    target: text('target').notNull(),
    /** Campo do modulo de documento. Vazio nos outros tipos. */
    fieldKey: text('field_key').notNull().default(''),
    label: text('label').notNull().default(''),
    /** Valor proposto pela analise. */
    value: jsonb('value').notNull(),
    /**
     * Valor que estava no painel antes da importacao.
     *
     * `null` quando nao havia nada. Preenchido na gravacao, nao na analise:
     * entre analisar e confirmar o cliente pode ter editado o campo, e o que
     * precisa voltar na reversao e o valor do momento da gravacao.
     */
    previousValue: jsonb('previous_value'),
    /** De onde o valor saiu: pagina, sinal e trecho. Ver `ImportEvidence`. */
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    /** Ver `IMPORT_DECISIONS`. */
    decision: text('decision').notNull().default('selecionado'),
    /** Ver `CONFLICT_RESOLUTIONS`. Só tem efeito em campo de documento. */
    resolution: text('resolution').notNull().default('manter'),
    /** Ver `IMPORT_OUTCOMES`. */
    outcome: text('outcome').notNull().default('pendente'),
    /** `true` quando o campo de destino ja tinha conteudo. */
    conflict: boolean('conflict').notNull().default(false),
    /** `true` quando outro candidato da mesma analise propoe a mesma coisa. */
    duplicate: boolean('duplicate').notNull().default(false),
    /** `true` quando o modulo de destino nao esta habilitado para este site. */
    targetDisabled: boolean('target_disabled').notNull().default(false),
    /** Registro criado na gravacao, para a reversao saber o que apagar. */
    createdEntityId: uuid('created_entity_id'),
    /** Motivo da falha, em portugues e sem rastro de pilha. */
    error: text('error').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('site_import_items_import_idx').on(table.importId, table.sortOrder),
    index('site_import_items_tenant_idx').on(table.tenantId),
    index('site_import_items_target_idx').on(table.importId, table.target),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'site_import_items_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

// ---------------------------------------------- sincronizacao de sites

/**
 * Ligacao viva com o site de origem de uma empresa.
 *
 * Uma por site. Enquanto a importacao (`site_imports`) e um evento -- aconteceu
 * uma vez, terminou --, a fonte e um **estado**: ela tem frequencia, vence,
 * falha, e pode ser pausada sem perder o historico.
 *
 * `next_check_at` e o que o agendador consulta. Ele ordena por esse campo e
 * pega as que venceram, o que torna a fila uma consulta indexada em vez de
 * uma tabela de tarefas separada.
 */
export const syncSources = pgTable(
  'sync_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    /** Endereco normalizado por `checkImportUrl`. */
    sourceUrl: text('source_url').notNull(),
    sourceHost: text('source_host').notNull(),
    /** Ver `SYNC_SOURCE_STATES` em `@codeca/shared`. */
    state: text('state').notNull().default('ativa'),
    /** Ver `SYNC_FREQUENCIES`. */
    frequency: text('frequency').notNull().default('semanal'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    /** Ultima vez que o cliente aplicou alteracoes vindas daqui. */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /**
     * Quando esta fonte vence.
     *
     * Nulo em `manual` e quando a fonte esta pausada: o indice parcial do
     * agendador so enxerga linha com data, entao pausar e literalmente sair
     * da fila, sem precisar filtrar por estado na consulta quente.
     */
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
    /** Falhas seguidas. Zera no primeiro sucesso; alimenta o adiamento. */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** Motivo da ultima falha, em portugues e sem rastro de pilha. */
    lastError: text('last_error').notNull().default(''),
    /** Importacao que deu origem a esta fonte, quando houve uma. */
    importId: uuid('import_id').references(() => siteImports.id, { onDelete: 'set null' }),
    connectedByUserId: uuid('connected_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
    updatedAt,
  },
  (table) => [
    /** Uma fonte por site: duas filas sobre o mesmo site se atropelariam. */
    uniqueIndex('sync_sources_site_key').on(table.siteId),
    index('sync_sources_tenant_idx').on(table.tenantId),
    /**
     * A consulta do agendador, e so ela.
     *
     * Parcial de proposito: fonte pausada ou manual tem `next_check_at` nulo
     * e nem entra no indice, entao a fila nao cresce com quem nao esta nela.
     */
    index('sync_sources_due_idx')
      .on(table.nextCheckAt)
      .where(sql`${table.nextCheckAt} is not null`),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'sync_sources_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Estado de cada pagina acompanhada.
 *
 * Guarda o resumo do conteudo, o `ETag` e o `Last-Modified` da ultima visita.
 * Com eles a verificacao seguinte manda uma requisicao condicional, e uma
 * pagina que nao mudou responde `304` sem corpo -- o que torna uma
 * verificacao semanal de 25 paginas barata para a plataforma e, sobretudo,
 * para o site do cliente.
 *
 * `missing_since` e o que sustenta o item 8: pagina que sumiu nao e apagada,
 * e marcada. E o que permite dizer "sumiu ha tres dias" em vez de so "sumiu".
 */
export const syncPageStates = pgTable(
  'sync_page_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => syncSources.id, { onDelete: 'cascade' }),
    /** Endereco na forma canonica (`canonicalPageUrl`). */
    url: text('url').notNull(),
    /** Resumo do texto extraido. Decide alteracao quando nao ha ETag. */
    contentHash: text('content_hash').notNull().default(''),
    /** Validadores do servidor de origem, quando ele os oferece. */
    etag: text('etag').notNull().default(''),
    lastModified: text('last_modified').notNull().default(''),
    status: integer('status').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** Desde quando a pagina nao responde. Nulo quando ela esta no ar. */
    missingSince: timestamp('missing_since', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('sync_page_states_source_url_key').on(table.sourceId, table.url),
    index('sync_page_states_tenant_idx').on(table.tenantId),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'sync_page_states_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * O que a origem dizia na ultima sincronizacao.
 *
 * A terceira ponta da comparacao, e a razao de a sincronizacao conseguir
 * distinguir "a origem mudou" de "o cliente editou no painel". Sem esta
 * tabela so daria para comparar origem com CODECA, e toda edicao feita pelo
 * cliente voltaria como alteracao a ser desfeita.
 *
 * `codeca_fingerprint` guarda o que estava na CODECA no momento em que o
 * baseline foi gravado. Comparar o valor atual do painel contra ele e o que
 * detecta a edicao local -- ver `compareThreeWay`.
 */
export const syncBaseline = pgTable(
  'sync_baseline',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => syncSources.id, { onDelete: 'cascade' }),
    /** Identidade do conteudo entre verificacoes. Ver `syncKey`. */
    contentKey: text('content_key').notNull(),
    /** Modulo de destino, ou `midia`. */
    target: text('target').notNull(),
    fieldKey: text('field_key').notNull().default(''),
    label: text('label').notNull().default(''),
    /** Valor que a origem tinha na ultima sincronizacao. */
    sourceValue: jsonb('source_value'),
    /** Impressao desse valor, que decide igualdade. */
    sourceFingerprint: text('source_fingerprint').notNull().default(''),
    /** Impressao do que estava na CODECA quando o baseline foi gravado. */
    codecaFingerprint: text('codeca_fingerprint').notNull().default(''),
    /** Registro da CODECA que corresponde a este conteudo, quando ha um. */
    entityId: uuid('entity_id'),
    /** Pagina da origem de onde o conteudo veio. */
    pageUrl: text('page_url').notNull().default(''),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** Desde quando o conteudo nao aparece mais na origem. */
    missingSince: timestamp('missing_since', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex('sync_baseline_source_key').on(table.sourceId, table.contentKey),
    index('sync_baseline_tenant_idx').on(table.tenantId),
    index('sync_baseline_target_idx').on(table.sourceId, table.target),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'sync_baseline_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

/** Uma verificacao da origem. Alimenta o historico do item 10. */
export const syncChecks = pgTable(
  'sync_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => syncSources.id, { onDelete: 'cascade' }),
    /** Ver `SYNC_CHECK_STATES`. */
    state: text('state').notNull().default('verificando'),
    /** Ver `SYNC_TRIGGERS`: agendada, manual ou a primeira depois de conectar. */
    trigger: text('trigger').notNull().default('agendada'),
    pagesChecked: integer('pages_checked').notNull().default(0),
    /** Paginas que responderam 304 ou cujo resumo nao mudou. */
    pagesUnchanged: integer('pages_unchanged').notNull().default(0),
    pagesFailed: integer('pages_failed').notNull().default(0),
    changesFound: integer('changes_found').notNull().default(0),
    conflicts: integer('conflicts').notNull().default(0),
    message: text('message').notNull().default(''),
    /** Fila do rastreamento entre fatias, como na importacao. */
    cursor: jsonb('cursor').$type<Record<string, unknown>>().notNull().default({}),
    triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('sync_checks_source_created_idx').on(table.sourceId, table.createdAt),
    index('sync_checks_tenant_idx').on(table.tenantId),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'sync_checks_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Uma alteracao encontrada, esperando decisao do cliente.
 *
 * Guarda as **tres** versoes do conteudo -- a do baseline, a da origem e a da
 * CODECA no momento da deteccao. E o que a tela precisa para mostrar os tres
 * lados de um conflito, e o que a reversao precisa para desfazer.
 *
 * `decision` nasce `pendente` sempre: nada entra sem autorizacao, e um padrao
 * diferente tornaria "aplicar" um clique com efeito que o cliente nao
 * escolheu conscientemente.
 */
export const syncChanges = pgTable(
  'sync_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').notNull(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => syncSources.id, { onDelete: 'cascade' }),
    checkId: uuid('check_id')
      .notNull()
      .references(() => syncChecks.id, { onDelete: 'cascade' }),
    contentKey: text('content_key').notNull(),
    target: text('target').notNull(),
    fieldKey: text('field_key').notNull().default(''),
    label: text('label').notNull().default(''),
    /** Ver `SYNC_CHANGE_TYPES`. */
    changeType: text('change_type').notNull(),
    pageUrl: text('page_url').notNull().default(''),
    /** As tres versoes, no momento em que a alteracao foi detectada. */
    baselineValue: jsonb('baseline_value'),
    sourceValue: jsonb('source_value'),
    codecaValue: jsonb('codeca_value'),
    /** `true` quando o cliente editou o conteudo **e** a origem mudou. */
    conflict: boolean('conflict').notNull().default(false),
    /** `true` quando o modulo de destino nao esta habilitado neste site. */
    targetDisabled: boolean('target_disabled').notNull().default(false),
    /** Ver `SYNC_DECISIONS`. */
    decision: text('decision').notNull().default('pendente'),
    /** Ver `CONFLICT_CHOICES`. So vale em alteracao com conflito. */
    conflictChoice: text('conflict_choice'),
    /** Ver `REMOVAL_ACTIONS`. So vale em remocao. */
    removalAction: text('removal_action'),
    /** Ver `SYNC_OUTCOMES`. */
    outcome: text('outcome').notNull().default('pendente'),
    /**
     * Valor que estava na CODECA imediatamente antes de aplicar.
     *
     * Diferente de `codeca_value`, que e do momento da **deteccao**: entre
     * detectar e aplicar o cliente pode ter editado de novo, e o que a
     * reversao precisa devolver e o valor do momento da gravacao.
     */
    revertValue: jsonb('revert_value'),
    /** Registro criado ou alterado, para a reversao saber onde mexer. */
    entityId: uuid('entity_id'),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    error: text('error').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    index('sync_changes_source_decision_idx').on(table.sourceId, table.decision),
    index('sync_changes_check_idx').on(table.checkId, table.sortOrder),
    index('sync_changes_tenant_idx').on(table.tenantId),
    /**
     * Uma alteracao pendente por conteudo.
     *
     * Parcial, so sobre as pendentes: e o que impede a verificacao seguinte de
     * empilhar a mesma alteracao de novo (item 11 -- "evitar notificacoes
     * repetidas"), sem travar o historico de alteracoes ja decididas sobre o
     * mesmo campo.
     */
    uniqueIndex('sync_changes_pending_key')
      .on(table.sourceId, table.contentKey)
      .where(sql`${table.decision} = 'pendente'`),
    foreignKey({
      columns: [table.siteId, table.tenantId],
      foreignColumns: [sites.id, sites.tenantId],
      name: 'sync_changes_site_tenant_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * Cada passagem do agendador, com origem e resultado.
 *
 * ## Por que isto existe
 *
 * A sincronizacao pode ser disparada por tres caminhos -- os dois
 * agendamentos da Vercel, um agendador externo e o disparo a mao. Sem um
 * registro proprio nao da para responder as perguntas que a operacao faz
 * todo dia: *rodou?*, *quando?*, *por quem?*, *demorou quanto?*, *o
 * agendador externo que eu configurei esta mesmo chamando?*
 *
 * E e esse ultimo ponto que manda: a tela so anuncia cadencia de 6 horas
 * depois de **ver** 6 horas acontecer, e e aqui que ela ve.
 *
 * ## Por que nao tem `tenant_id`
 *
 * Uma passagem nao pertence a uma empresa: ela percorre a fila de todas. O
 * recorte por empresa continua sendo `sync_checks`, que grava a verificacao
 * de cada fonte. Pendurar um tenant aqui criaria um dono falso.
 */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Ver `SYNC_RUN_ORIGINS`: vercel, externo ou manual. */
    origin: text('origin').notNull(),
    /** Ver `SYNC_RUN_STATES`. */
    state: text('state').notNull().default('executando'),
    /**
     * Chave enviada por quem chamou, para nao processar a mesma entrega duas
     * vezes. Vazia quando o chamador nao mandou nenhuma.
     */
    idempotencyKey: text('idempotency_key').notNull().default(''),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    /**
     * A fila no instante da passagem, para explicar um zero.
     *
     * "0 verificadas" sozinho nao diz nada: pode ser que nada tenha vencido
     * -- normal com frequencia semanal e agendamento diario -- ou que algo
     * tenha vencido e nao tenha sido processado, que e problema. Guardar o
     * denominador separa os dois casos sem precisar adivinhar depois.
     */
    sourcesConnected: integer('sources_connected').notNull().default(0),
    sourcesPaused: integer('sources_paused').notNull().default(0),
    sourcesDue: integer('sources_due').notNull().default(0),
    sourcesClaimed: integer('sources_claimed').notNull().default(0),
    sourcesChecked: integer('sources_checked').notNull().default(0),
    sourcesFailed: integer('sources_failed').notNull().default(0),
    changesFound: integer('changes_found').notNull().default(0),
    autoPaused: integer('auto_paused').notNull().default(0),
    /** `true` quando a passagem parou pelo tempo, nao por falta de fonte. */
    budgetExhausted: boolean('budget_exhausted').notNull().default(false),
    /** Motivo da falha, em portugues e sem rastro de pilha nem segredo. */
    error: text('error').notNull().default(''),
    createdAt,
    updatedAt,
  },
  (table) => [
    /**
     * Uma passagem por vez, garantido pelo banco.
     *
     * Parcial sobre `state`: so as linhas `executando` entram no indice, e
     * como todas elas teriam o mesmo valor, a unicidade do indice significa
     * "no maximo uma passagem em andamento". Duas chamadas simultaneas --
     * a Vercel e o cron-job.org caindo no mesmo minuto -- viram uma execucao
     * e uma recusa, decidido pelo banco e nao por uma checagem em memoria que
     * duas instancias fariam ao mesmo tempo.
     */
    uniqueIndex('sync_runs_uma_execucao')
      .on(table.state)
      .where(sql`${table.state} = 'executando'`),
    /**
     * A mesma entrega nunca roda duas vezes.
     *
     * Parcial porque chave vazia e o caso comum (agendador que nao manda
     * nenhuma) e nao deve colidir consigo mesma.
     */
    uniqueIndex('sync_runs_idempotencia')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} <> ''`),
    /** Historico e apuracao da cadencia observada. */
    index('sync_runs_started_idx').on(table.startedAt),
    index('sync_runs_origin_started_idx').on(table.origin, table.startedAt),
  ],
);
