import type { Context } from 'hono';
import type { AppBindings } from '../types.js';
import { recordAudit } from './audit.js';
import { clientIp, userAgent } from './http.js';

/**
 * Registra uma acao usando os dados ja presentes no contexto da requisicao
 * (empresa resolvida, usuario autenticado, IP e agente), evitando repetir a
 * montagem do registro em cada rota.
 */
export async function auditFromContext(
  c: Context<AppBindings>,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    tenantId?: string | null;
  },
): Promise<void> {
  const ctx = c.get('ctx');
  const session = c.get('session');
  let tenantId = input.tenantId ?? null;
  if (tenantId === null) {
    try {
      tenantId = c.get('tenant')?.tenantId ?? null;
    } catch {
      tenantId = null;
    }
  }

  await recordAudit(ctx.db, ctx.env, {
    tenantId,
    actorUserId: session?.user.id ?? null,
    actorEmail: session?.user.email ?? '',
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? {},
    ip: clientIp(c),
    userAgent: userAgent(c),
  });
}
