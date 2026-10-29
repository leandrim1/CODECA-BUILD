import { lt, schema, sql, type Database } from '@codeca/database';
import { AppError } from '@codeca/shared';
import { hashIp } from '@codeca/shared/server';

/**
 * Rate limiting com janela fixa persistida no banco.
 *
 * Funcoes serverless nao compartilham memoria entre invocacoes, portanto um
 * contador em processo nao protegeria nada. A chave guarda apenas o hash do IP.
 */

export interface RateLimitRule {
  /** Prefixo que identifica a acao, por exemplo `login`. */
  action: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  login: { action: 'login', limit: 10, windowSeconds: 300 },
  register: { action: 'register', limit: 5, windowSeconds: 3600 },
  passwordReset: { action: 'password_reset', limit: 5, windowSeconds: 3600 },
  emailVerification: { action: 'email_verification', limit: 5, windowSeconds: 3600 },
  publicLead: { action: 'public_lead', limit: 5, windowSeconds: 600 },
  publicLeadDaily: { action: 'public_lead_daily', limit: 40, windowSeconds: 86_400 },
  upload: { action: 'upload', limit: 120, windowSeconds: 3600 },
  domainCheck: { action: 'domain_check', limit: 30, windowSeconds: 3600 },
  invite: { action: 'invite', limit: 20, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Consome uma unidade da cota. `subject` deve ser um identificador estavel
 * (hash de IP, id de usuario ou id de empresa).
 */
export async function consumeRateLimit(
  db: Database,
  rule: RateLimitRule,
  subject: string,
  now = new Date(),
): Promise<RateLimitResult> {
  const key = `${rule.action}:${subject}`;
  const expiresAt = new Date(now.getTime() + rule.windowSeconds * 1000);

  const [row] = await db
    .insert(schema.rateLimits)
    .values({ key, count: 1, windowStartedAt: now, expiresAt })
    .onConflictDoUpdate({
      target: schema.rateLimits.key,
      set: {
        // Janela expirada reinicia a contagem; caso contrario incrementa.
        count: sql`case when ${schema.rateLimits.expiresAt} <= ${now} then 1 else ${schema.rateLimits.count} + 1 end`,
        windowStartedAt: sql`case when ${schema.rateLimits.expiresAt} <= ${now} then ${now} else ${schema.rateLimits.windowStartedAt} end`,
        expiresAt: sql`case when ${schema.rateLimits.expiresAt} <= ${now} then ${expiresAt} else ${schema.rateLimits.expiresAt} end`,
      },
    })
    .returning({ count: schema.rateLimits.count, expiresAt: schema.rateLimits.expiresAt });

  const count = row?.count ?? 1;
  const windowEnd = row?.expiresAt ?? expiresAt;
  const allowed = count <= rule.limit;
  return {
    allowed,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((windowEnd.getTime() - now.getTime()) / 1000)),
  };
}

/** Consome a cota e lanca 429 quando excedida. */
export async function enforceRateLimit(
  db: Database,
  rule: RateLimitRule,
  subject: string,
  now = new Date(),
): Promise<void> {
  const result = await consumeRateLimit(db, rule, subject, now);
  if (!result.allowed) {
    throw new AppError(
      'rate_limited',
      `Muitas tentativas. Tente novamente em ${formatWait(result.retryAfterSeconds)}.`,
      { retryAfterSeconds: result.retryAfterSeconds },
    );
  }
}

export function rateLimitSubjectFromIp(ip: string, secret: string): string {
  return hashIp(ip, secret) || 'sem-ip';
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} segundos`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minuto(s)`;
  return `${Math.ceil(minutes / 60)} hora(s)`;
}

/** Remove contadores expirados. */
export async function pruneRateLimits(db: Database, now = new Date()): Promise<void> {
  await db.delete(schema.rateLimits).where(lt(schema.rateLimits.expiresAt, now));
}
