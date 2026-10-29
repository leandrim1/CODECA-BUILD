import { api, query } from './api.js';
import type {
  AuditLogRow,
  DomainRecord,
  FaqRecord,
  LeadNoteRecord,
  LeadRecord,
  MediaAssetRecord,
  MemberRecord,
  OverviewResponse,
  PageDetail,
  PageSummary,
  PageVersionSummary,
  Paginated,
  PlanRecord,
  PlatformTenantRow,
  ProjectRecord,
  ProjectUpdateRecord,
  PropertyRecord,
  ServiceRecord,
  SessionResponse,
  SupportGrantRow,
  TeamMemberRecord,
  TenantResponse,
  TestimonialRecord,
} from '../types/index.js';
import type {
  EffectivePlan,
  SessionPayload,
} from '../types/index.js';
import type { NavigationMenuInput, PageLayout, PlanLimits, PublicSeo, PublicSiteSections, Theme, UsageSnapshot } from '@codeca/shared';

/**
 * Endpoints agrupados por recurso.
 *
 * Concentrar as rotas aqui mantem os componentes livres de URLs soltas e deixa
 * explicito que toda operacao de empresa passa pelo `tenantId` da rota.
 */

const tenantBase = (tenantId: string) => `/api/tenants/${tenantId}`;

export const authApi = {
  session: () => api.get<SessionResponse>('/api/auth/session'),
  register: (body: unknown) =>
    api.post<{ session: SessionPayload | null; csrfToken: string; emailDelivery: { delivered: boolean; reason: string | null } }>(
      '/api/auth/register',
      body,
    ),
  login: (body: unknown) =>
    api.post<{ session: SessionPayload | null; csrfToken: string }>('/api/auth/login', body),
  logout: () => api.post<void>('/api/auth/logout'),
  verifyEmail: (token: string) => api.post<{ verified: boolean }>('/api/auth/verify-email', { token }),
  resendVerification: (email: string) => api.post<{ sent: boolean }>('/api/auth/resend-verification', { email }),
  forgotPassword: (email: string) => api.post<{ sent: boolean }>('/api/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    api.post<{ reset: boolean }>('/api/auth/reset-password', { token, password }),
  acceptInvite: (body: unknown) =>
    api.post<{ session: SessionPayload | null; tenantId: string }>('/api/auth/accept-invite', body),
  updateProfile: (body: { name: string; phone: string }) => api.patch<unknown>('/api/auth/profile', body),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.post<{ changed: boolean }>('/api/auth/change-password', body),
  sessions: () =>
    api.get<{ sessions: Array<{ id: string; userAgent: string; createdAt: string; lastUsedAt: string; expiresAt: string; current: boolean }> }>(
      '/api/auth/sessions',
    ),
  revokeOtherSessions: () => api.post<{ revoked: boolean }>('/api/auth/sessions/revoke-others'),
};

export const tenantApi = {
  detail: (tenantId: string) => api.get<TenantResponse>(tenantBase(tenantId)),
  overview: (tenantId: string) => api.get<OverviewResponse>(`${tenantBase(tenantId)}/overview`),
  update: (tenantId: string, body: unknown) => api.patch<unknown>(tenantBase(tenantId), body),
  updateContact: (tenantId: string, body: unknown) => api.patch<unknown>(`${tenantBase(tenantId)}/contact`, body),
  updateTheme: (tenantId: string, theme: Theme) => api.put<{ theme: Theme }>(`${tenantBase(tenantId)}/theme`, theme),
  updateSeo: (tenantId: string, seo: PublicSeo) => api.put<{ seo: PublicSeo }>(`${tenantBase(tenantId)}/seo`, seo),
  updateSections: (tenantId: string, sections: PublicSiteSections) =>
    api.put<{ sections: PublicSiteSections }>(`${tenantBase(tenantId)}/sections`, sections),
  plan: (tenantId: string) =>
    api.get<{
      plan: EffectivePlan;
      usage: UsageSnapshot;
      subscription: {
        status: string;
        currentPeriodStart: string | null;
        currentPeriodEnd: string | null;
        trialEndsAt: string | null;
      } | null;
      availablePlans: Array<{ code: string; name: string; description: string; priceCents: number; limits: PlanLimits }>;
      selfServiceUpgrade: boolean;
    }>(`${tenantBase(tenantId)}/plan`),
};

export const memberApi = {
  list: (tenantId: string) => api.get<{ members: MemberRecord[]; roles: string[] }>(`${tenantBase(tenantId)}/members`),
  invite: (tenantId: string, body: { email: string; role: string; name: string }) =>
    api.post<{ invited: boolean; emailDelivery: { delivered: boolean; reason: string | null } }>(
      `${tenantBase(tenantId)}/members/invite`,
      body,
    ),
  updateRole: (tenantId: string, membershipId: string, role: string) =>
    api.patch<unknown>(`${tenantBase(tenantId)}/members/${membershipId}`, { role }),
  remove: (tenantId: string, membershipId: string) =>
    api.delete<void>(`${tenantBase(tenantId)}/members/${membershipId}`),
};

export const pageApi = {
  list: (tenantId: string) => api.get<{ pages: PageSummary[] }>(`${tenantBase(tenantId)}/pages`),
  detail: (tenantId: string, pageId: string) =>
    api.get<{ page: PageDetail; published: { layout: PageLayout; version: number } | null }>(
      `${tenantBase(tenantId)}/pages/${pageId}`,
    ),
  create: (tenantId: string, body: unknown) => api.post<{ page: PageSummary }>(`${tenantBase(tenantId)}/pages`, body),
  update: (tenantId: string, pageId: string, body: unknown) =>
    api.patch<{ page: PageSummary }>(`${tenantBase(tenantId)}/pages/${pageId}`, body),
  remove: (tenantId: string, pageId: string) => api.delete<void>(`${tenantBase(tenantId)}/pages/${pageId}`),
  saveDraft: (tenantId: string, pageId: string, layout: PageLayout, baseRevision?: number) =>
    api.put<{ draftRevision: number; draftUpdatedAt: string }>(`${tenantBase(tenantId)}/pages/${pageId}/draft`, {
      layout,
      ...(baseRevision !== undefined ? { baseRevision } : {}),
    }),
  publish: (tenantId: string, pageId: string, note = '') =>
    api.post<{ version: number; versionId: string; siteVersion: number; publishedAt: string }>(
      `${tenantBase(tenantId)}/pages/${pageId}/publish`,
      { note },
    ),
  versions: (tenantId: string, pageId: string) =>
    api.get<{ versions: PageVersionSummary[]; historyEnabled: boolean; planName: string }>(
      `${tenantBase(tenantId)}/pages/${pageId}/versions`,
    ),
  restore: (tenantId: string, pageId: string, versionId: string, publish: boolean) =>
    api.post<{ layout: PageLayout; published: { version: number; siteVersion: number } | null }>(
      `${tenantBase(tenantId)}/pages/${pageId}/restore`,
      { versionId, publish },
    ),
  navigation: (tenantId: string) =>
    api.get<{ menus: Array<{ id: string; key: string; label: string; items: NavigationMenuInput['items'] }> }>(
      `${tenantBase(tenantId)}/navigation`,
    ),
  saveNavigation: (tenantId: string, key: string, body: NavigationMenuInput) =>
    api.put<unknown>(`${tenantBase(tenantId)}/navigation/${key}`, body),
  redirects: (tenantId: string) =>
    api.get<{ redirects: Array<{ id: string; fromPath: string; toPath: string; statusCode: number; enabled: boolean }> }>(
      `${tenantBase(tenantId)}/redirects`,
    ),
  createRedirect: (tenantId: string, body: unknown) => api.post<unknown>(`${tenantBase(tenantId)}/redirects`, body),
  removeRedirect: (tenantId: string, redirectId: string) =>
    api.delete<void>(`${tenantBase(tenantId)}/redirects/${redirectId}`),
};

export const propertyApi = {
  list: (tenantId: string, params: Record<string, string | number | undefined> = {}) =>
    api.get<Paginated<PropertyRecord>>(`${tenantBase(tenantId)}/properties${query(params)}`),
  detail: (tenantId: string, propertyId: string) =>
    api.get<{ property: PropertyRecord }>(`${tenantBase(tenantId)}/properties/${propertyId}`),
  facets: (tenantId: string) =>
    api.get<{ cities: string[]; neighborhoods: string[]; maxPublishedProperties: number }>(
      `${tenantBase(tenantId)}/properties/facets`,
    ),
  create: (tenantId: string, body: unknown) =>
    api.post<{ property: PropertyRecord }>(`${tenantBase(tenantId)}/properties`, body),
  update: (tenantId: string, propertyId: string, body: unknown) =>
    api.patch<{ property: PropertyRecord }>(`${tenantBase(tenantId)}/properties/${propertyId}`, body),
  remove: (tenantId: string, propertyId: string) =>
    api.delete<void>(`${tenantBase(tenantId)}/properties/${propertyId}`),
  reorder: (tenantId: string, ids: string[]) =>
    api.post<unknown>(`${tenantBase(tenantId)}/properties/reorder`, { ids }),
};

export const projectApi = {
  list: (tenantId: string, params: Record<string, string | number | undefined> = {}) =>
    api.get<Paginated<ProjectRecord>>(`${tenantBase(tenantId)}/projects${query(params)}`),
  detail: (tenantId: string, projectId: string) =>
    api.get<{ project: ProjectRecord; updates: ProjectUpdateRecord[] }>(
      `${tenantBase(tenantId)}/projects/${projectId}`,
    ),
  create: (tenantId: string, body: unknown) =>
    api.post<{ project: ProjectRecord }>(`${tenantBase(tenantId)}/projects`, body),
  update: (tenantId: string, projectId: string, body: unknown) =>
    api.patch<{ project: ProjectRecord }>(`${tenantBase(tenantId)}/projects/${projectId}`, body),
  remove: (tenantId: string, projectId: string) => api.delete<void>(`${tenantBase(tenantId)}/projects/${projectId}`),
  addUpdate: (tenantId: string, projectId: string, body: unknown) =>
    api.post<{ update: ProjectUpdateRecord }>(`${tenantBase(tenantId)}/projects/${projectId}/updates`, body),
  removeUpdate: (tenantId: string, projectId: string, updateId: string) =>
    api.delete<void>(`${tenantBase(tenantId)}/projects/${projectId}/updates/${updateId}`),
};

export const contentApi = {
  services: (tenantId: string, params: Record<string, string | number | undefined> = {}) =>
    api.get<Paginated<ServiceRecord>>(`${tenantBase(tenantId)}/services${query(params)}`),
  createService: (tenantId: string, body: unknown) =>
    api.post<{ service: ServiceRecord }>(`${tenantBase(tenantId)}/services`, body),
  updateService: (tenantId: string, id: string, body: unknown) =>
    api.patch<{ service: ServiceRecord }>(`${tenantBase(tenantId)}/services/${id}`, body),
  removeService: (tenantId: string, id: string) => api.delete<void>(`${tenantBase(tenantId)}/services/${id}`),

  testimonials: (tenantId: string, params: Record<string, string | number | undefined> = {}) =>
    api.get<Paginated<TestimonialRecord>>(`${tenantBase(tenantId)}/testimonials${query(params)}`),
  createTestimonial: (tenantId: string, body: unknown) =>
    api.post<{ testimonial: TestimonialRecord }>(`${tenantBase(tenantId)}/testimonials`, body),
  updateTestimonial: (tenantId: string, id: string, body: unknown) =>
    api.patch<{ testimonial: TestimonialRecord }>(`${tenantBase(tenantId)}/testimonials/${id}`, body),
  removeTestimonial: (tenantId: string, id: string) =>
    api.delete<void>(`${tenantBase(tenantId)}/testimonials/${id}`),

  team: (tenantId: string) => api.get<{ members: TeamMemberRecord[] }>(`${tenantBase(tenantId)}/team`),
  createTeamMember: (tenantId: string, body: unknown) =>
    api.post<{ member: TeamMemberRecord }>(`${tenantBase(tenantId)}/team`, body),
  updateTeamMember: (tenantId: string, id: string, body: unknown) =>
    api.patch<{ member: TeamMemberRecord }>(`${tenantBase(tenantId)}/team/${id}`, body),
  removeTeamMember: (tenantId: string, id: string) => api.delete<void>(`${tenantBase(tenantId)}/team/${id}`),

  faqs: (tenantId: string) => api.get<{ faqs: FaqRecord[] }>(`${tenantBase(tenantId)}/faqs`),
  createFaq: (tenantId: string, body: unknown) => api.post<{ faq: FaqRecord }>(`${tenantBase(tenantId)}/faqs`, body),
  updateFaq: (tenantId: string, id: string, body: unknown) =>
    api.patch<{ faq: FaqRecord }>(`${tenantBase(tenantId)}/faqs/${id}`, body),
  removeFaq: (tenantId: string, id: string) => api.delete<void>(`${tenantBase(tenantId)}/faqs/${id}`),

  reorder: (tenantId: string, entity: 'services' | 'testimonials' | 'team' | 'faqs', ids: string[]) =>
    api.post<unknown>(`${tenantBase(tenantId)}/content/${entity}/reorder`, { ids }),
};

export const mediaApi = {
  list: (tenantId: string, params: Record<string, string | number | boolean | undefined> = {}) =>
    api.get<Paginated<MediaAssetRecord> & { tags: string[] }>(`${tenantBase(tenantId)}/media${query(params)}`),
  usage: (tenantId: string) =>
    api.get<{
      storageBytes: number;
      storageLimitBytes: number;
      storageLabel: string;
      maxUploadBytes: number;
      blobConfigured: boolean;
    }>(`${tenantBase(tenantId)}/media/usage`),
  upload: (tenantId: string, formData: FormData) =>
    api.upload<{ asset: MediaAssetRecord }>(`${tenantBase(tenantId)}/media`, formData),
  update: (tenantId: string, mediaId: string, body: { alt?: string; title?: string; tag?: string }) =>
    api.patch<{ asset: MediaAssetRecord }>(`${tenantBase(tenantId)}/media/${mediaId}`, body),
  assetUsage: (tenantId: string, mediaId: string) =>
    api.get<{ usage: { total: number }; description: string[] }>(`${tenantBase(tenantId)}/media/${mediaId}/usage`),
  remove: (tenantId: string, mediaId: string) => api.delete<void>(`${tenantBase(tenantId)}/media/${mediaId}`),
};

export const leadApi = {
  list: (tenantId: string, params: Record<string, string | number | undefined> = {}) =>
    api.get<Paginated<LeadRecord> & { statuses: string[]; exportEnabled: boolean }>(
      `${tenantBase(tenantId)}/leads${query(params)}`,
    ),
  detail: (tenantId: string, leadId: string) =>
    api.get<{ lead: LeadRecord; notes: LeadNoteRecord[] }>(`${tenantBase(tenantId)}/leads/${leadId}`),
  update: (tenantId: string, leadId: string, body: { status?: string; assignedToUserId?: string | null }) =>
    api.patch<unknown>(`${tenantBase(tenantId)}/leads/${leadId}`, body),
  addNote: (tenantId: string, leadId: string, note: string) =>
    api.post<{ note: LeadNoteRecord }>(`${tenantBase(tenantId)}/leads/${leadId}/notes`, { note }),
  remove: (tenantId: string, leadId: string) => api.delete<void>(`${tenantBase(tenantId)}/leads/${leadId}`),
  exportCsv: (tenantId: string) => api.get<string>(`${tenantBase(tenantId)}/leads/export`, { raw: true }),
};

export const domainApi = {
  list: (tenantId: string) =>
    api.get<{
      domains: DomainRecord[];
      limits: { maxDomains: number; planName: string };
      customDomainAvailable: boolean;
      providerConfigured: boolean;
    }>(`${tenantBase(tenantId)}/domains`),
  add: (tenantId: string, domain: string) =>
    api.post<{ domain: DomainRecord; message: string; dns: DomainRecord['dns'] }>(
      `${tenantBase(tenantId)}/domains`,
      { domain },
    ),
  verify: (tenantId: string, domainId: string) =>
    api.post<{ domain: DomainRecord | null; message: string; dns: DomainRecord['dns'] }>(
      `${tenantBase(tenantId)}/domains/${domainId}/verify`,
    ),
  setPrimary: (tenantId: string, domainId: string) =>
    api.post<unknown>(`${tenantBase(tenantId)}/domains/${domainId}/primary`),
  remove: (tenantId: string, domainId: string) => api.delete<void>(`${tenantBase(tenantId)}/domains/${domainId}`),
};

export const platformApi = {
  overview: () =>
    api.get<{
      tenants: { total: number; active: number; trialing: number; suspended: number };
      users: number;
      domains: { total: number; active: number; pending: number };
      storageBytes: number;
      leadsLast30Days: number;
      publishedPages: number;
      byPlan: Array<{ planCode: string; planName: string; tenants: number }>;
      recentTenants: Array<{ id: string; displayName: string; slug: string; status: string; createdAt: string }>;
    }>('/api/platform/overview'),
  tenants: (params: Record<string, string | number | undefined> = {}) =>
    api.get<Paginated<PlatformTenantRow>>(`/api/platform/tenants${query(params)}`),
  tenantDetail: (tenantId: string) =>
    api.get<{
      tenant: Record<string, unknown>;
      plan: EffectivePlan;
      usage: UsageSnapshot;
      members: Array<{ role: string; status: string; email: string; name: string; lastLoginAt: string | null }>;
      domains: DomainRecord[];
      supportGrant: { id: string; reason: string; expiresAt: string } | null;
    }>(`/api/platform/tenants/${tenantId}`),
  createTenant: (body: unknown) => api.post<{ tenantId: string; slug: string }>('/api/platform/tenants', body),
  updateTenant: (tenantId: string, body: unknown) => api.patch<unknown>(`/api/platform/tenants/${tenantId}`, body),
  plans: () => api.get<{ plans: PlanRecord[] }>('/api/platform/plans'),
  createPlan: (body: unknown) => api.post<{ plan: PlanRecord }>('/api/platform/plans', body),
  updatePlan: (planId: string, body: unknown) => api.patch<{ plan: PlanRecord }>(`/api/platform/plans/${planId}`, body),
  domains: () =>
    api.get<{
      domains: Array<DomainRecord & { tenantId: string; tenantName: string }>;
      providerConfigured: boolean;
    }>('/api/platform/domains'),
  setPlatformRole: (userId: string, platformRole: 'none' | 'platform_admin') =>
    api.post<unknown>('/api/platform/users/platform-role', { userId, platformRole }),
  grantSupportAccess: (body: { tenantId: string; reason: string; expiresInMinutes: number; readOnly: true }) =>
    api.post<{ grant: { id: string; expiresAt: string; readOnly: boolean } | null }>(
      '/api/platform/support-access',
      body,
    ),
  revokeSupportAccess: (grantId: string) => api.delete<void>(`/api/platform/support-access/${grantId}`),
  supportGrants: () => api.get<{ grants: SupportGrantRow[] }>('/api/platform/support-access'),
  audit: (params: Record<string, string | number | undefined> = {}) =>
    api.get<Paginated<AuditLogRow>>(`/api/platform/audit${query(params)}`),
};

export const previewApi = {
  /** Dados do site para a previa do editor, com o rascunho em edicao. */
  siteData: (tenantId: string, path: string) =>
    api.get<import('@codeca/shared').PublicSiteData>(
      `/api/public/preview/${tenantId}${query({ path })}`,
    ),
};
