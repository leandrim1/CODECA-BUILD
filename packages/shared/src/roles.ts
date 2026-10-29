/**
 * Papeis e permissoes. A autorizacao efetiva acontece sempre no backend;
 * a interface usa estas mesmas constantes apenas para esconder controles.
 */

export const TENANT_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const PLATFORM_ROLES = ['none', 'platform_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  owner: 'Proprietario',
  admin: 'Administrador',
  editor: 'Editor de conteudo',
  viewer: 'Somente leitura',
};

/** Capacidades dentro do escopo de uma construtora (tenant). */
export const TENANT_CAPABILITIES = [
  'tenant:read',
  'tenant:update',
  'tenant:delete',
  'members:read',
  'members:invite',
  'members:update',
  'members:remove',
  'site:read',
  'site:edit',
  'site:publish',
  'site:restore',
  'content:read',
  'content:write',
  'content:delete',
  'media:read',
  'media:upload',
  'media:delete',
  'leads:read',
  'leads:write',
  'leads:delete',
  'domains:read',
  'domains:manage',
  'seo:read',
  'seo:write',
  'billing:read',
  'billing:manage',
  'audit:read',
] as const;
export type TenantCapability = (typeof TENANT_CAPABILITIES)[number];

/** Capacidades globais, exclusivas do painel mestre da plataforma. */
export const PLATFORM_CAPABILITIES = [
  'platform:overview',
  'platform:tenants:read',
  'platform:tenants:write',
  'platform:tenants:suspend',
  'platform:plans:write',
  'platform:domains:read',
  'platform:usage:read',
  'platform:audit:read',
  'platform:users:write',
  'platform:support:grant',
] as const;
export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

const READ_ONLY: TenantCapability[] = TENANT_CAPABILITIES.filter((c) => c.endsWith(':read'));

const EDITOR: TenantCapability[] = [
  ...READ_ONLY,
  'site:edit',
  'site:publish',
  'content:write',
  'content:delete',
  'media:upload',
  'media:delete',
  'leads:write',
  'seo:write',
];

const ADMIN: TenantCapability[] = [
  ...EDITOR,
  'site:restore',
  'tenant:update',
  'members:invite',
  'members:update',
  'members:remove',
  'leads:delete',
  'domains:manage',
];

const OWNER: TenantCapability[] = [...ADMIN, 'tenant:delete', 'billing:manage'];

const CAPABILITIES_BY_TENANT_ROLE: Record<TenantRole, ReadonlySet<TenantCapability>> = {
  viewer: new Set(READ_ONLY),
  editor: new Set(EDITOR),
  admin: new Set(ADMIN),
  owner: new Set(OWNER),
};

const CAPABILITIES_BY_PLATFORM_ROLE: Record<PlatformRole, ReadonlySet<PlatformCapability>> = {
  none: new Set<PlatformCapability>(),
  platform_admin: new Set(PLATFORM_CAPABILITIES),
};

export function tenantCapabilities(role: TenantRole): TenantCapability[] {
  return [...CAPABILITIES_BY_TENANT_ROLE[role]];
}

export function roleCan(role: TenantRole, capability: TenantCapability): boolean {
  return CAPABILITIES_BY_TENANT_ROLE[role].has(capability);
}

export function platformCapabilities(role: PlatformRole): PlatformCapability[] {
  return [...CAPABILITIES_BY_PLATFORM_ROLE[role]];
}

export function platformRoleCan(role: PlatformRole, capability: PlatformCapability): boolean {
  return CAPABILITIES_BY_PLATFORM_ROLE[role].has(capability);
}

/** Hierarquia usada para impedir que um papel gerencie outro superior a ele. */
const ROLE_RANK: Record<TenantRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export function roleRank(role: TenantRole): number {
  return ROLE_RANK[role];
}

/**
 * Um membro so pode conceder ou alterar papeis de nivel igual ou inferior ao seu.
 * Apenas `owner` pode criar outro `owner`.
 */
export function canAssignRole(actor: TenantRole, target: TenantRole): boolean {
  if (target === 'owner') return actor === 'owner';
  return ROLE_RANK[actor] >= ROLE_RANK[target] && ROLE_RANK[actor] >= ROLE_RANK.admin;
}
