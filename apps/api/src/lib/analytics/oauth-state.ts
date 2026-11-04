import { and, eq, gt, isNull, schema, type Database } from '@codeca/database';
import { createOpaqueToken, hashToken } from '@codeca/shared/server';
import type { Env } from '../../env.js';

/**
 * `state` do OAuth do Analytics.
 *
 * Mesmas garantias do `state` do login (aleatorio, so o hash no banco, uso
 * unico atomico, 10 minutos, amarrado ao navegador por cookie HttpOnly), em
 * tabela propria e com os dados que o callback precisa: empresa, site e o
 * usuario que clicou em "Conectar". Nada disso vem da URL do retorno.
 */

export const ANALYTICS_STATE_COOKIE = 'codeca_ga_state';
/** O cookie so e enviado nas rotas deste fluxo. */
export const ANALYTICS_STATE_COOKIE_PATH = '/api/integrations/google-analytics';
export const ANALYTICS_STATE_TTL_MINUTES = 10;

export type AnalyticsStateRow = typeof schema.analyticsOauthStates.$inferSelect;

export async function createAnalyticsState(
  db: Database,
  env: Env,
  input: { tenantId: string; siteId: string; userId: string; now: Date },
): Promise<string> {
  const state = createOpaqueToken(32);
  await db.insert(schema.analyticsOauthStates).values({
    stateHash: hashToken(state, env.AUTH_SECRET),
    tenantId: input.tenantId,
    siteId: input.siteId,
    userId: input.userId,
    expiresAt: new Date(input.now.getTime() + ANALYTICS_STATE_TTL_MINUTES * 60_000),
  });
  return state;
}

/** Consome o `state`; `null` se nao existe, ja foi usado ou venceu. */
export async function consumeAnalyticsState(
  db: Database,
  env: Env,
  state: string,
  now: Date,
): Promise<AnalyticsStateRow | null> {
  const [row] = await db
    .update(schema.analyticsOauthStates)
    .set({ consumedAt: now })
    .where(
      and(
        eq(schema.analyticsOauthStates.stateHash, hashToken(state, env.AUTH_SECRET)),
        isNull(schema.analyticsOauthStates.consumedAt),
        gt(schema.analyticsOauthStates.expiresAt, now),
      ),
    )
    .returning();
  return row ?? null;
}
