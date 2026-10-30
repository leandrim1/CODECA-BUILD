import { describeDatabaseFailure, sql, type Database } from '@codeca/database';

/**
 * Sondagem do banco para o `/api/health`.
 *
 * O health respondia `ok` sem nunca tocar no banco, entao um banco
 * inalcancavel era indistinguivel de um bug da aplicacao -- a tela dava 504 e
 * nao havia onde olhar.
 *
 * A sondagem separa duas capacidades que falham por motivos diferentes:
 *
 * - **consulta simples**, que o driver do Neon resolve por HTTP;
 * - **transacao**, que exige uma conexao WebSocket.
 *
 * A distincao nao e academica: com a consulta passando e a transacao falhando,
 * o problema esta no WebSocket, e so o cadastro, a publicacao e a cobranca
 * quebram -- tudo que le continua funcionando. Sem separar, isso aparece como
 * "o site as vezes falha".
 */

export type ProbeResult = 'ok' | 'falha' | 'nao testada';

export interface DatabaseProbe {
  query: ProbeResult;
  transaction: ProbeResult;
  /** Tempo da consulta simples, em milissegundos. */
  latencyMs: number | null;
  /** Codigo do erro, quando houver. */
  code: string | null;
  /** Causa provavel em portugues, quando reconhecida. */
  cause: string | null;
}

class ProbeTimeout extends Error {
  constructor(ms: number) {
    super(`a resposta do banco passou de ${ms} ms`);
    this.name = 'ProbeTimeout';
  }
}

async function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeout(ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * O health e publico, entao a resposta leva a classificacao do erro -- codigo e
 * causa -- e nunca a mensagem crua do driver, que pode nomear tabelas e hosts.
 * A mensagem completa vai para o log do servidor.
 */
export async function probeDatabase(db: Database, timeoutMs = 4_000): Promise<DatabaseProbe> {
  const started = Date.now();
  try {
    await withTimeout(db.execute(sql`select 1`), timeoutMs);
  } catch (error) {
    const failure = describeDatabaseFailure(error);
    console.error('[health] consulta ao banco falhou:', failure.message);
    return {
      query: 'falha',
      transaction: 'nao testada',
      latencyMs: null,
      code: failure.code,
      cause: failure.cause,
    };
  }
  const latencyMs = Date.now() - started;

  try {
    await withTimeout(
      db.transaction(async (tx) => {
        await tx.execute(sql`select 1`);
      }),
      timeoutMs,
    );
  } catch (error) {
    const failure = describeDatabaseFailure(error);
    console.error('[health] transacao no banco falhou:', failure.message);
    return {
      query: 'ok',
      transaction: 'falha',
      latencyMs,
      code: failure.code,
      cause:
        failure.cause
        ?? 'a consulta simples passa e a transacao nao: o driver nao esta conseguindo abrir a '
          + 'conexao WebSocket com o banco.',
    };
  }

  return { query: 'ok', transaction: 'ok', latencyMs, code: null, cause: null };
}
