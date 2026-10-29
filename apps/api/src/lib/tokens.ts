import { and, eq, gt, isNull, schema, type Database } from '@codeca/database';
import { AppError, type TenantRole } from '@codeca/shared';
import { createOpaqueToken, hashToken } from '@codeca/shared/server';
import type { Env } from '../env.js';

/**
 * Tokens de uso unico para confirmar e-mail, redefinir senha e aceitar convite.
 *
 * Somente o HMAC do token e persistido. O valor em claro existe apenas no link
 * enviado por e-mail, nunca em log ou resposta de API.
 */

export type UserTokenType = 'email_verification' | 'password_reset' | 'invitation';

const TTL_HOURS: Record<UserTokenType, number> = {
  email_verification: 48,
  password_reset: 2,
  invitation: 24 * 7,
};

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

export async function issueUserToken(
  db: Database,
  env: Env,
  input: {
    userId: string;
    type: UserTokenType;
    tenantId?: string | null;
    role?: TenantRole | null;
    now?: Date;
  },
): Promise<IssuedToken> {
  const now = input.now ?? new Date();
  const token = createOpaqueToken(32);
  const expiresAt = new Date(now.getTime() + TTL_HOURS[input.type] * 3600 * 1000);

  // Invalida tokens anteriores do mesmo tipo para o mesmo usuario.
  await db
    .update(schema.userTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.userTokens.userId, input.userId),
        eq(schema.userTokens.type, input.type),
        isNull(schema.userTokens.usedAt),
      ),
    );

  await db.insert(schema.userTokens).values({
    userId: input.userId,
    tenantId: input.tenantId ?? null,
    type: input.type,
    role: input.role ?? null,
    tokenHash: hashToken(token, env.AUTH_SECRET),
    expiresAt,
  });

  return { token, expiresAt };
}

export interface ConsumedToken {
  id: string;
  userId: string;
  tenantId: string | null;
  role: TenantRole | null;
}

/**
 * Valida e marca o token como usado em uma unica operacao condicional, de modo
 * que duas requisicoes simultaneas nao consigam usar o mesmo token.
 */
export async function consumeUserToken(
  db: Database,
  env: Env,
  input: { token: string; type: UserTokenType; now?: Date },
): Promise<ConsumedToken> {
  const now = input.now ?? new Date();
  const tokenHash = hashToken(input.token, env.AUTH_SECRET);

  const [row] = await db
    .update(schema.userTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.userTokens.tokenHash, tokenHash),
        eq(schema.userTokens.type, input.type),
        isNull(schema.userTokens.usedAt),
        gt(schema.userTokens.expiresAt, now),
      ),
    )
    .returning({
      id: schema.userTokens.id,
      userId: schema.userTokens.userId,
      tenantId: schema.userTokens.tenantId,
      role: schema.userTokens.role,
    });

  if (!row) {
    throw AppError.badRequest('Este link e invalido ou expirou. Solicite um novo.');
  }

  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    role: (row.role as TenantRole | null) ?? null,
  };
}

/** Monta um link absoluto do painel com o token. */
export function buildActionUrl(env: Env, path: string, token: string): string {
  const base = env.APP_URL.replace(/\/$/, '');
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}
