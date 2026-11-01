import { and, desc, eq, schema, sql, type Database } from '@codeca/database';
import { hashIp } from '@codeca/shared/server';
import type { Env } from '../env.js';

/**
 * Trilha de auditoria.
 *
 * Registramos quem fez o que, em qual empresa e sobre qual registro. Os
 * metadados nunca incluem senhas, tokens, cookies ou o corpo completo de
 * formularios; o IP entra apenas como hash.
 */

export const AUDIT_ACTIONS = {
  userRegistered: 'user.registered',
  userLoggedIn: 'user.logged_in',
  userLoginFailed: 'user.login_failed',
  userLoggedOut: 'user.logged_out',
  userEmailVerified: 'user.email_verified',
  userPasswordResetRequested: 'user.password_reset_requested',
  userPasswordReset: 'user.password_reset',
  userPasswordChanged: 'user.password_changed',
  tenantCreated: 'tenant.created',
  tenantUpdated: 'tenant.updated',
  tenantStatusChanged: 'tenant.status_changed',
  tenantPlanChanged: 'tenant.plan_changed',
  memberInvited: 'member.invited',
  memberRoleChanged: 'member.role_changed',
  memberRemoved: 'member.removed',
  inviteAccepted: 'member.invite_accepted',
  propertyCreated: 'property.created',
  propertyUpdated: 'property.updated',
  propertyDeleted: 'property.deleted',
  projectCreated: 'project.created',
  projectUpdated: 'project.updated',
  projectDeleted: 'project.deleted',
  contentCreated: 'content.created',
  contentUpdated: 'content.updated',
  contentDeleted: 'content.deleted',
  mediaUploaded: 'media.uploaded',
  mediaUpdated: 'media.updated',
  mediaDeleted: 'media.deleted',
  domainAdded: 'domain.added',
  domainVerified: 'domain.verified',
  domainRemoved: 'domain.removed',
  domainPrimaryChanged: 'domain.primary_changed',
  leadReceived: 'lead.received',
  leadUpdated: 'lead.updated',
  leadDeleted: 'lead.deleted',
  leadNoteAdded: 'lead.note_added',
  planCreated: 'platform.plan_created',
  planUpdated: 'platform.plan_updated',
  /**
   * Configuracao de site e de integracao.
   *
   * Antes tudo isto era gravado como `tenant.updated`: emitir uma chave,
   * revoga-la e trocar o nome da empresa apareciam iguais na trilha. Uma
   * auditoria que nao distingue rotacao de credencial de edicao de cadastro
   * nao responde a pergunta que se faz a ela depois de um incidente.
   */
  siteUpdated: 'site.updated',
  siteModulesConfigured: 'site.modules_configured',
  siteCustomFieldsConfigured: 'site.custom_fields_configured',
  siteSegmentApplied: 'site.segment_applied',
  siteKeyIssued: 'site.key_issued',
  siteKeyRotated: 'site.key_rotated',
  siteKeyRevoked: 'site.key_revoked',
  siteOriginsUpdated: 'site.origins_updated',
  siteWebhookCreated: 'site.webhook_created',
  siteWebhookUpdated: 'site.webhook_updated',
  siteWebhookDeleted: 'site.webhook_deleted',
  siteWebhookSecretRotated: 'site.webhook_secret_rotated',
  segmentCreated: 'platform.segment_created',
  segmentUpdated: 'platform.segment_updated',
  segmentDeleted: 'platform.segment_deleted',
  platformRoleChanged: 'platform.role_changed',
  supportAccessGranted: 'platform.support_access_granted',
  supportAccessRevoked: 'platform.support_access_revoked',
  supportAccessUsed: 'platform.support_access_used',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string;
  action: AuditAction | string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/** Chaves que nunca devem ser gravadas, mesmo que cheguem por engano. */
const FORBIDDEN_METADATA_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'passwordhash',
  'token',
  'tokenhash',
  'csrftoken',
  'cookie',
  'authorization',
  'secret',
  'apikey',
]);

export function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))) continue;
    if (value === undefined) continue;
    if (typeof value === 'string') {
      output[key] = value.length > 500 ? `${value.slice(0, 500)}...` : value;
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = sanitizeMetadata(value as Record<string, unknown>);
      continue;
    }
    output[key] = value;
  }
  return output;
}

export async function recordAudit(db: Database, env: Env, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(schema.auditLogs).values({
      tenantId: entry.tenantId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorEmail: entry.actorEmail ?? '',
      action: entry.action,
      entityType: entry.entityType ?? '',
      entityId: entry.entityId ?? '',
      metadata: sanitizeMetadata(entry.metadata ?? {}),
      ipHash: entry.ip ? hashIp(entry.ip, env.AUTH_SECRET) : '',
      userAgent: (entry.userAgent ?? '').slice(0, 300),
    });
  } catch (error) {
    // A auditoria nunca deve derrubar a operacao principal.
    console.error('[audit] falha ao registrar', entry.action, error instanceof Error ? error.message : error);
  }
}

export interface AuditQueryOptions {
  tenantId?: string | undefined;
  actorUserId?: string | undefined;
  action?: string | undefined;
  page: number;
  pageSize: number;
}

export async function listAuditLogs(db: Database, options: AuditQueryOptions) {
  const conditions = [];
  if (options.tenantId) conditions.push(eq(schema.auditLogs.tenantId, options.tenantId));
  if (options.actorUserId) conditions.push(eq(schema.auditLogs.actorUserId, options.actorUserId));
  if (options.action) conditions.push(eq(schema.auditLogs.action, options.action));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await db
    .select()
    .from(schema.auditLogs)
    .where(where)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize);

  const [totals] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(schema.auditLogs)
    .where(where);

  return { items, total: totals?.total ?? 0 };
}
