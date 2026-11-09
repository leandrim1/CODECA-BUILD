import { and, desc, eq, gte, lt, schema, sql, type Database } from '@codeca/database';
import {
  SCHEDULER_BASELINE_MINUTES,
  SCHEDULER_VALIDATION,
  computeSchedulerStatus,
  type SchedulerStatus,
  type SyncRunOrigin,
  type SyncRunState,
  type SyncRunSummary,
} from '@codeca/shared';

/**
 * As passagens do agendador: trava, idempotencia e historico.
 *
 * ## O problema que este arquivo resolve
 *
 * Enquanto existia um disparador so, nada disto era necessario. Com tres --
 * os dois agendamentos da Vercel, um agendador externo e o disparo a mao --
 * aparecem duas corridas que nenhum `if` em memoria resolve:
 *
 * - **duas passagens ao mesmo tempo**, porque duas instancias da funcao
 *   fariam a mesma checagem no mesmo instante e as duas passariam;
 * - **a mesma entrega duas vezes**, porque agendador externo repete a chamada
 *   quando a resposta demora -- e a resposta pode ter se perdido *depois* de
 *   o trabalho ter sido feito.
 *
 * As duas sao decididas pelo banco, por indice unico parcial, que e o unico
 * lugar onde "no maximo um" vale para todas as instancias ao mesmo tempo.
 */

/** Tempo apos o qual uma passagem iniciada e dada por morta. */
const LEASE_MS = 5 * 60_000;

export interface SyncRunRow {
  id: string;
  origin: SyncRunOrigin;
  state: SyncRunState;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  sourcesClaimed: number;
  sourcesChecked: number;
  sourcesFailed: number;
  changesFound: number;
  error: string;
}

export type StartRunResult =
  | { status: 'iniciada'; runId: string }
  /** Outra passagem esta em andamento. Nao e erro: e a trava funcionando. */
  | { status: 'em_andamento'; startedAt: Date }
  /** Esta entrega ja foi processada; devolve o resultado de entao. */
  | { status: 'duplicada'; run: SyncRunSummary };

export function toSummary(row: SyncRunRow): SyncRunSummary {
  return {
    id: row.id,
    origin: row.origin,
    state: row.state,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    durationMs: row.durationMs,
    sourcesClaimed: row.sourcesClaimed,
    sourcesChecked: row.sourcesChecked,
    sourcesFailed: row.sourcesFailed,
    changesFound: row.changesFound,
    error: row.error,
  };
}

/**
 * Marca como expirada qualquer passagem iniciada ha tempo demais.
 *
 * A funcao da Vercel para em 60 s; uma linha `executando` com cinco minutos
 * so pode ser de uma execucao que morreu antes de concluir. Sem esta limpeza
 * a trava seria permanente -- um unico processo morto travaria a
 * sincronizacao para sempre.
 *
 * Nada se perde quando isso acontece: as fontes daquela passagem ja tiveram
 * `next_check_at` empurrado pela reserva atomica, entao elas voltam a vencer
 * no ciclo seguinte.
 */
export async function expireStaleRuns(db: Database, now: Date): Promise<number> {
  const limite = new Date(now.getTime() - LEASE_MS);
  const linhas = await db
    .update(schema.syncRuns)
    .set({
      state: 'expirada',
      finishedAt: now,
      error: 'A execução não terminou dentro do tempo previsto.',
      updatedAt: now,
    })
    .where(and(eq(schema.syncRuns.state, 'executando'), lt(schema.syncRuns.startedAt, limite)))
    .returning({ id: schema.syncRuns.id });
  return linhas.length;
}

/**
 * Abre uma passagem, ou diz por que nao abriu.
 *
 * A ordem aqui importa e e a mesma de sempre: limpar o que morreu, procurar
 * entrega repetida, e so entao tentar a insercao -- deixando o indice unico
 * decidir o empate. A tentativa vem por ultimo porque e ela que cria o fato;
 * as duas primeiras so olham.
 */
export async function startRun(
  db: Database,
  input: { origin: SyncRunOrigin; idempotencyKey?: string; now: Date },
): Promise<StartRunResult> {
  const { now } = input;
  const chave = (input.idempotencyKey ?? '').trim().slice(0, 200);

  await expireStaleRuns(db, now);

  /**
   * Entrega repetida com chave: devolve o resultado da primeira.
   *
   * Responder o resultado anterior, e nao um erro, e o que faz a repeticao
   * ser segura para quem chamou: o agendador externo recebe 200 e para de
   * tentar, sem que a fila tenha sido percorrida duas vezes.
   */
  if (chave !== '') {
    const anterior = await buscarPorChave(db, chave);
    if (anterior) return { status: 'duplicada', run: toSummary(anterior) };
  }

  /**
   * Sem chave nao ha deduplicacao por chamada -- e nao precisa haver.
   *
   * A garantia contra processar a mesma atualizacao duas vezes nao mora
   * aqui: mora em `claimDueSources`, que empurra `next_check_at` para a
   * frente **na mesma instrucao** que seleciona a fonte. Uma segunda
   * passagem imediata reserva zero fontes e nao faz nada. O estrago de uma
   * entrega repetida e, no maximo, uma linha a mais no historico.
   *
   * Adivinhar repeticao por "mesma origem ha poucos segundos" seria pior que
   * o problema: engoliria silenciosamente uma chamada legitima -- um teste de
   * implantacao logo apos um cron, por exemplo -- e o operador veria
   * "duplicada" sem ter duplicado nada. Quem precisa da garantia explicita
   * manda `Idempotency-Key`.
   */

  try {
    const inserida = await db
      .insert(schema.syncRuns)
      .values({
        origin: input.origin,
        state: 'executando',
        idempotencyKey: chave,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.syncRuns.id });

    const id = inserida[0]?.id;
    if (!id) throw new Error('insercao da execucao nao devolveu id');
    return { status: 'iniciada', runId: id };
  } catch (error) {
    /**
     * O indice unico recusou. Duas causas possiveis, as duas esperadas.
     *
     * Chegar aqui nao e uma falha da plataforma: e a trava fazendo o trabalho
     * dela num empate que so o banco podia resolver.
     */
    if (chave !== '') {
      const anterior = await buscarPorChave(db, chave);
      if (anterior) return { status: 'duplicada', run: toSummary(anterior) };
    }

    const emAndamento = await db
      .select({ startedAt: schema.syncRuns.startedAt })
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.state, 'executando'))
      .limit(1);
    const corrente = emAndamento[0];
    if (corrente) return { status: 'em_andamento', startedAt: corrente.startedAt };

    throw error;
  }
}

/** Fecha a passagem com o que ela produziu. */
export async function finishRun(
  db: Database,
  input: {
    runId: string;
    state: Extract<SyncRunState, 'concluida' | 'falhou'>;
    sourcesClaimed?: number;
    sourcesChecked?: number;
    sourcesFailed?: number;
    changesFound?: number;
    autoPaused?: number;
    budgetExhausted?: boolean;
    /** Ja em portugues e sem rastro de pilha. Nunca carrega segredo. */
    error?: string;
    startedAt: Date;
    now: Date;
  },
): Promise<SyncRunSummary | null> {
  const linhas = await db
    .update(schema.syncRuns)
    .set({
      state: input.state,
      finishedAt: input.now,
      durationMs: Math.max(0, input.now.getTime() - input.startedAt.getTime()),
      sourcesClaimed: input.sourcesClaimed ?? 0,
      sourcesChecked: input.sourcesChecked ?? 0,
      sourcesFailed: input.sourcesFailed ?? 0,
      changesFound: input.changesFound ?? 0,
      autoPaused: input.autoPaused ?? 0,
      budgetExhausted: input.budgetExhausted ?? false,
      error: (input.error ?? '').slice(0, 500),
      updatedAt: input.now,
    })
    .where(eq(schema.syncRuns.id, input.runId))
    .returning();

  const linha = linhas[0];
  return linha ? toSummary(mapRow(linha)) : null;
}

/** A ultima passagem, em qualquer estado. */
export async function lastRun(db: Database): Promise<SyncRunSummary | null> {
  const linhas = await db
    .select()
    .from(schema.syncRuns)
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(1);
  const linha = linhas[0];
  return linha ? toSummary(mapRow(linha)) : null;
}

/**
 * O estado do agendador, medido no historico.
 *
 * Le apenas as passagens **concluidas** da janela: falha e expiracao nao
 * provam cadencia, e sao justamente elas que precisam abrir um buraco na
 * medida. A conta fica em `computeSchedulerStatus`, no pacote compartilhado,
 * para poder ser testada sem banco.
 */
export async function schedulerStatus(db: Database, now: Date): Promise<SchedulerStatus> {
  const inicioJanela = new Date(
    now.getTime() - SCHEDULER_VALIDATION.windowDays * 24 * 60 * 60_000,
  );

  const concluidas = await db
    .select({ origin: schema.syncRuns.origin, startedAt: schema.syncRuns.startedAt })
    .from(schema.syncRuns)
    .where(
      and(eq(schema.syncRuns.state, 'concluida'), gte(schema.syncRuns.startedAt, inicioJanela)),
    )
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(500);

  return computeSchedulerStatus({
    now,
    runs: concluidas.map((linha) => ({
      origin: linha.origin as SyncRunOrigin,
      startedAt: linha.startedAt,
    })),
    lastRun: await lastRun(db),
    baselineMinutes: SCHEDULER_BASELINE_MINUTES,
  });
}

/** Historico das ultimas passagens, para o painel mestre. */
export async function recentRuns(db: Database, limit = 20): Promise<SyncRunSummary[]> {
  const linhas = await db
    .select()
    .from(schema.syncRuns)
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return linhas.map((linha) => toSummary(mapRow(linha)));
}

/**
 * Remove passagens antigas.
 *
 * A tabela so cresce, e quatro chamadas por dia enchem um ano com pouco mais
 * de mil linhas -- nada, mas nada que precise ficar para sempre. A janela de
 * apuracao da cadencia e de sete dias; guardar noventa dias cobre qualquer
 * pergunta de operacao com folga.
 */
export async function pruneRuns(db: Database, now: Date, days = 90): Promise<number> {
  const limite = new Date(now.getTime() - days * 24 * 60 * 60_000);
  const linhas = await db
    .delete(schema.syncRuns)
    .where(and(lt(schema.syncRuns.startedAt, limite), sql`${schema.syncRuns.state} <> 'executando'`))
    .returning({ id: schema.syncRuns.id });
  return linhas.length;
}

async function buscarPorChave(db: Database, chave: string): Promise<SyncRunRow | null> {
  const linhas = await db
    .select()
    .from(schema.syncRuns)
    .where(eq(schema.syncRuns.idempotencyKey, chave))
    .limit(1);
  const linha = linhas[0];
  return linha ? mapRow(linha) : null;
}

function mapRow(linha: typeof schema.syncRuns.$inferSelect): SyncRunRow {
  return {
    id: linha.id,
    origin: linha.origin as SyncRunOrigin,
    state: linha.state as SyncRunState,
    startedAt: linha.startedAt,
    finishedAt: linha.finishedAt,
    durationMs: linha.durationMs,
    sourcesClaimed: linha.sourcesClaimed,
    sourcesChecked: linha.sourcesChecked,
    sourcesFailed: linha.sourcesFailed,
    changesFound: linha.changesFound,
    error: linha.error,
  };
}
