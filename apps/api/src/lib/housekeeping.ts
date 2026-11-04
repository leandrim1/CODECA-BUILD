import { lt, or, schema, type Database } from '@codeca/database';

/**
 * Limpeza de registros que so servem enquanto vigentes.
 *
 * Sem isto, estas tabelas so crescem: cada login cria uma sessao, cada
 * tentativa grava um contador, cada codigo de login vira uma linha. Em um mes de
 * uso real isso vira o maior volume do banco -- e as consultas de sessao e de
 * limite de taxa (que rodam em quase toda requisicao) ficam mais lentas e mais
 * caras no armazenamento do Neon, sem nenhum beneficio.
 *
 * Mantem uma folga apos o vencimento (auditoria e suporte de contas) e e
 * chamada pelo job agendado -- nao no caminho das requisicoes.
 */
const DAY = 24 * 3600 * 1000;

export interface HousekeepingReport {
  rateLimits: number;
  sessions: number;
  loginCodes: number;
  userTokens: number;
  oauthStates: number;
  analyticsStates: number;
}

export async function pruneExpiredRecords(db: Database, now = new Date()): Promise<HousekeepingReport> {
  const ago = (ms: number) => new Date(now.getTime() - ms);

  const rateLimits = await db
    .delete(schema.rateLimits)
    .where(lt(schema.rateLimits.expiresAt, now))
    .returning({ key: schema.rateLimits.expiresAt });
  const sessions = await db
    .delete(schema.sessions)
    .where(or(lt(schema.sessions.expiresAt, ago(30 * DAY)), lt(schema.sessions.revokedAt, ago(30 * DAY))))
    .returning({ id: schema.sessions.id });
  const loginCodes = await db
    .delete(schema.loginCodes)
    .where(lt(schema.loginCodes.expiresAt, ago(DAY)))
    .returning({ id: schema.loginCodes.id });
  const userTokens = await db
    .delete(schema.userTokens)
    .where(lt(schema.userTokens.expiresAt, ago(30 * DAY)))
    .returning({ id: schema.userTokens.id });
  const oauthStates = await db
    .delete(schema.oauthStates)
    .where(lt(schema.oauthStates.expiresAt, ago(DAY)))
    .returning({ id: schema.oauthStates.expiresAt });

  const analyticsStates = await db
    .delete(schema.analyticsOauthStates)
    .where(lt(schema.analyticsOauthStates.expiresAt, ago(DAY)))
    .returning({ id: schema.analyticsOauthStates.id });

  return {
    rateLimits: rateLimits.length,
    sessions: sessions.length,
    loginCodes: loginCodes.length,
    userTokens: userTokens.length,
    oauthStates: oauthStates.length,
    analyticsStates: analyticsStates.length,
  };
}
