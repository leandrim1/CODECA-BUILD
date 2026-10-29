import { and, eq, gt, isNull, ne, schema, type Database } from '@codeca/database';
import { AppError, type PlatformRole, type TenantRole } from '@codeca/shared';
import { createOpaqueToken, hashIp, hashToken } from '@codeca/shared/server';
import type { Env } from '../env.js';

/**
 * Sessoes do painel.
 *
 * O cookie carrega um token opaco aleatorio; o banco guarda apenas o HMAC desse
 * token com `AUTH_SECRET`. Assim, um vazamento do banco nao permite montar um
 * cookie valido, e o token em claro nunca aparece em log algum.
 */

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
  tenantStatus: string;
  role: TenantRole;
}

export interface AuthenticatedSession {
  sessionId: string;
  user: SessionUser;
  memberships: SessionMembership[];
  csrfTokenHash: string;
  expiresAt: Date;
}

export interface IssuedSession {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
  sessionId: string;
}

export async function createSession(
  db: Database,
  env: Env,
  input: { userId: string; rememberMe: boolean; ip: string; userAgent: string; now?: Date },
): Promise<IssuedSession> {
  const now = input.now ?? new Date();
  const hours = input.rememberMe ? env.SESSION_REMEMBER_TTL_HOURS : env.SESSION_TTL_HOURS;
  const expiresAt = new Date(now.getTime() + hours * 3600 * 1000);

  const sessionToken = createOpaqueToken(32);
  const csrfToken = createOpaqueToken(24);

  const [row] = await db
    .insert(schema.sessions)
    .values({
      userId: input.userId,
      tokenHash: hashToken(sessionToken, env.AUTH_SECRET),
      csrfTokenHash: hashToken(csrfToken, env.AUTH_SECRET),
      userAgent: input.userAgent.slice(0, 300),
      ipHash: hashIp(input.ip, env.AUTH_SECRET),
      expiresAt,
    })
    .returning({ id: schema.sessions.id });

  if (!row) throw AppError.internal('Nao foi possivel iniciar a sessao.');
  return { sessionToken, csrfToken, expiresAt, sessionId: row.id };
}

/** Resolve a sessao a partir do token do cookie. Retorna null se invalida. */
export async function resolveSession(
  db: Database,
  env: Env,
  sessionToken: string,
  now = new Date(),
): Promise<AuthenticatedSession | null> {
  const tokenHash = hashToken(sessionToken, env.AUTH_SECRET);

  const [row] = await db
    .select({
      sessionId: schema.sessions.id,
      csrfTokenHash: schema.sessions.csrfTokenHash,
      expiresAt: schema.sessions.expiresAt,
      userId: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      phone: schema.users.phone,
      platformRole: schema.users.platformRole,
      emailVerifiedAt: schema.users.emailVerifiedAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.tokenHash, tokenHash),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, now),
      ),
    );

  if (!row) return null;

  const memberships = await db
    .select({
      tenantId: schema.memberships.tenantId,
      role: schema.memberships.role,
      tenantSlug: schema.tenants.slug,
      tenantName: schema.tenants.displayName,
      tenantStatus: schema.tenants.status,
    })
    .from(schema.memberships)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(and(eq(schema.memberships.userId, row.userId), eq(schema.memberships.status, 'active')));

  return {
    sessionId: row.sessionId,
    csrfTokenHash: row.csrfTokenHash,
    expiresAt: row.expiresAt,
    user: {
      id: row.userId,
      email: row.email,
      name: row.name,
      phone: row.phone,
      platformRole: row.platformRole as PlatformRole,
      emailVerified: row.emailVerifiedAt !== null,
    },
    memberships: memberships.map((m) => ({
      tenantId: m.tenantId,
      tenantSlug: m.tenantSlug,
      tenantName: m.tenantName,
      tenantStatus: m.tenantStatus,
      role: m.role as TenantRole,
    })),
  };
}

export async function touchSession(db: Database, sessionId: string, now = new Date()): Promise<void> {
  await db.update(schema.sessions).set({ lastUsedAt: now }).where(eq(schema.sessions.id, sessionId));
}

export async function revokeSession(db: Database, sessionId: string, now = new Date()): Promise<void> {
  await db.update(schema.sessions).set({ revokedAt: now }).where(eq(schema.sessions.id, sessionId));
}

/** Encerra todas as sessoes do usuario; usado ao trocar ou redefinir a senha. */
export async function revokeAllUserSessions(
  db: Database,
  userId: string,
  options: { exceptSessionId?: string; now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const conditions = [eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)];
  if (options.exceptSessionId) {
    conditions.push(ne(schema.sessions.id, options.exceptSessionId));
  }
  await db.update(schema.sessions).set({ revokedAt: now }).where(and(...conditions));
}
