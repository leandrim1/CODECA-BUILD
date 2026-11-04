import { and, eq, gt, isNull, lt, schema, type Database } from '@codeca/database';
import { createOpaqueToken, hashToken } from '@codeca/shared/server';
import type { Env } from '../env.js';

/**
 * `state` do OAuth: o que impede que um retorno forjado vire login.
 *
 * Tres garantias juntas:
 *
 * 1. **Aleatorio e de uso unico.** So o hash fica no banco; consumir e um
 *    `UPDATE ... WHERE consumed_at IS NULL`, atomico: dois retornos com o mesmo
 *    `state` nunca passam os dois.
 * 2. **Validade curta** (10 minutos).
 * 3. **Amarrado ao navegador que comecou.** O mesmo valor vai num cookie
 *    HttpOnly; o retorno so vale se o cookie e a URL conferem. Sem isso, um
 *    atacante poderia comecar o fluxo no navegador dele e mandar o link de
 *    retorno para a vitima (login CSRF).
 */

export const OAUTH_STATE_COOKIE = 'codeca_oauth_state';
export const OAUTH_STATE_TTL_MINUTES = 10;
/** O cookie so e enviado nas rotas do fluxo, nunca no resto da API. */
export const OAUTH_STATE_COOKIE_PATH = '/api/auth/google';

export type OAuthIntent = 'continue' | 'link';
export type OAuthStateRow = typeof schema.oauthStates.$inferSelect;

export async function createOAuthState(
  db: Database,
  env: Env,
  input: { provider: 'google'; intent: OAuthIntent; userId: string | null; nextPath: string; now: Date },
): Promise<string> {
  // Limpeza oportunista: sem tarefa agendada, cada novo fluxo apaga os vencidos.
  await db
    .delete(schema.oauthStates)
    .where(lt(schema.oauthStates.expiresAt, new Date(input.now.getTime() - 60 * 60 * 1000)));

  const state = createOpaqueToken(32);
  await db.insert(schema.oauthStates).values({
    stateHash: hashToken(state, env.AUTH_SECRET),
    provider: input.provider,
    intent: input.intent,
    userId: input.userId,
    nextPath: input.nextPath,
    expiresAt: new Date(input.now.getTime() + OAUTH_STATE_TTL_MINUTES * 60_000),
  });
  return state;
}

/** Consome o `state`; `null` se nao existe, ja foi usado ou venceu. */
export async function consumeOAuthState(
  db: Database,
  env: Env,
  state: string,
  now: Date,
): Promise<OAuthStateRow | null> {
  const [row] = await db
    .update(schema.oauthStates)
    .set({ consumedAt: now })
    .where(
      and(
        eq(schema.oauthStates.stateHash, hashToken(state, env.AUTH_SECRET)),
        isNull(schema.oauthStates.consumedAt),
        gt(schema.oauthStates.expiresAt, now),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * So aceita caminho interno do painel.
 *
 * Um `next` aberto seria redirecionamento para qualquer site depois do login.
 * Lista fechada de prefixos, e nada de `//host`, `\` ou esquema.
 */
export function safeNextPath(value: string | undefined | null): string {
  const fallback = '/painel';
  if (!value) return fallback;
  if (!/^\/(painel|plataforma)(\/[A-Za-z0-9._~\-/%]*)?(\?[A-Za-z0-9._~\-=&%]*)?$/.test(value)) return fallback;
  return value;
}
