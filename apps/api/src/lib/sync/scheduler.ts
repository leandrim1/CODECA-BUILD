import type { Database } from '@codeca/database';
import { SYNC_LIMITS, type SyncRunOrigin, type SyncRunSummary } from '@codeca/shared';
import type { SiteFetcher } from '../import/fetcher.js';
import type { PageRenderer } from '../import/renderer.js';
import { runCheck } from './checker.js';
import { finishRun, startRun } from './runs.js';
import {
  claimDueSources,
  countSourceQueue,
  createCheck,
  finishCheck,
  scheduleNext,
  updateSource,
  type SyncSourceRow,
} from './store.js';

/**
 * Agendador das verificacoes.
 *
 * ## Como isto roda sem aba aberta
 *
 * Tres gatilhos, todos no servidor, nenhum dependendo de alguem com o painel
 * aberto:
 *
 * - o cron `/api/sync/run` (`vercel.json`), as 17:47;
 * - o job diario de reconciliacao, as 05:23, que chama a mesma passagem;
 * - um agendador externo (cron-job.org e afins) chamando `/api/sync/run`
 *   com o mesmo segredo, para cadencia maior que a diaria.
 *
 * Os dois primeiros sao o teto do plano gratuito da Vercel, que dispara cada
 * agendamento uma vez por dia; juntos cobrem a fila de manha e a tarde, e
 * esse e o piso garantido. Rodar por varios nao duplica trabalho -- a reserva
 * da fila e atomica e uma fonte que ainda nao venceu simplesmente nao e
 * selecionada.
 *
 * A cadencia que a tela anuncia sai do historico real das passagens, nunca de
 * configuracao: ver `runSchedulerPass` e `lib/sync/runs.ts`.
 *
 * ## Isolamento entre clientes
 *
 * Cada fonte roda dentro do proprio `try`. Um site fora do ar, um HTML
 * gigante ou um erro inesperado derrubam **aquela** verificacao e nada mais:
 * a fila continua, e a fonte que falhou e adiada progressivamente em vez de
 * ser tentada de novo no instante seguinte.
 *
 * ## Recuperacao
 *
 * A reserva (`claimDueSources`) ja empurra `next_check_at` para a frente na
 * mesma instrucao que seleciona. Se a funcao morrer no meio da passagem, a
 * fonte nao fica presa num estado "processando" que ninguem limpa -- ela
 * simplesmente volta a vencer no proximo ciclo.
 */

export interface SchedulerContext {
  db: Database;
  fetcher: SiteFetcher;
  /** O mesmo navegador da importacao, quando configurado. Ver `checker.ts`. */
  renderer?: PageRenderer;
  now: () => Date;
}

export interface SchedulerReport {
  /** A fila no instante da passagem, para explicar um zero. */
  connected: number;
  paused: number;
  due: number;
  /** Fontes reservadas nesta passagem. */
  claimed: number;
  checked: number;
  failed: number;
  changesFound: number;
  /** Fontes pausadas sozinhas por falharem demais. */
  autoPaused: number;
  /** `true` quando a passagem parou pelo tempo, nao por falta de fonte. */
  budgetExhausted: boolean;
}

/**
 * Uma passagem do agendador.
 *
 * `limit` e o teto de fontes; `budgetMs` e o teto de tempo. O menor dos dois
 * manda -- a funcao da Vercel para em 60 s, e uma passagem que estoura esse
 * tempo perde o trabalho dela inteiro.
 */
export async function runScheduledChecks(
  ctx: SchedulerContext,
  options: { limit?: number; budgetMs?: number } = {},
): Promise<SchedulerReport> {
  const limite = Math.min(options.limit ?? SYNC_LIMITS.sourcesPerRun, SYNC_LIMITS.sourcesPerRun);
  const orcamento = options.budgetMs ?? SYNC_LIMITS.runBudgetMs;
  const inicio = ctx.now().getTime();

  /**
   * O censo vem **antes** da reserva, de proposito.
   *
   * Depois dela os vencimentos ja foram empurrados para a frente, e o
   * numero de vencidas apareceria como zero mesmo numa passagem cheia de
   * trabalho -- justamente o dado que se quer registrar.
   */
  const fila = await countSourceQueue(ctx.db, ctx.now());
  const fontes = await claimDueSources(ctx.db, { now: ctx.now(), limit: limite });

  const report: SchedulerReport = {
    connected: fila.connected,
    paused: fila.paused,
    due: fila.due,
    claimed: fontes.length,
    checked: 0,
    failed: 0,
    changesFound: 0,
    autoPaused: 0,
    budgetExhausted: false,
  };

  for (const fonte of fontes) {
    const decorrido = ctx.now().getTime() - inicio;
    if (decorrido >= orcamento) {
      /**
       * Acabou o tempo da passagem.
       *
       * As fontes que sobraram ja tiveram `next_check_at` empurrado pela
       * reserva, entao elas voltam no ciclo seguinte. Nada se perde; so
       * atrasa.
       */
      report.budgetExhausted = true;
      break;
    }

    const restante = Math.min(SYNC_LIMITS.sourceBudgetMs, orcamento - decorrido);
    const resultado = await checkOneSource(ctx, { source: fonte, budgetMs: restante });

    report.checked += 1;
    report.changesFound += resultado.changesFound;
    if (resultado.failed) report.failed += 1;
    if (resultado.autoPaused) report.autoPaused += 1;
  }

  return report;
}

/**
 * Verifica uma fonte, isolando qualquer falha dela.
 *
 * Exportada porque e o mesmo caminho do "Verificar agora" da tela: um clique
 * do cliente e uma passagem do cron fazem exatamente a mesma coisa, o que
 * evita dois comportamentos para a mesma operacao.
 */
export async function checkOneSource(
  ctx: SchedulerContext,
  input: {
    source: SyncSourceRow;
    budgetMs?: number;
    trigger?: 'agendada' | 'manual' | 'primeira';
  },
): Promise<{ changesFound: number; conflicts: number; failed: boolean; autoPaused: boolean; message: string }> {
  const { source } = input;
  const agora = ctx.now();

  const checkId = await createCheck(ctx.db, {
    tenantId: source.tenantId,
    siteId: source.siteId,
    sourceId: source.id,
    trigger: input.trigger ?? 'agendada',
    userId: null,
    now: agora,
  });

  await updateSource(ctx.db, {
    sourceId: source.id,
    tenantId: source.tenantId,
    state: 'verificando',
    now: agora,
  });

  try {
    const resultado = await runCheck(
      {
        db: ctx.db,
        fetcher: ctx.fetcher,
        ...(ctx.renderer !== undefined ? { renderer: ctx.renderer } : {}),
        now: ctx.now,
      },
      { source, checkId, ...(input.budgetMs !== undefined ? { budgetMs: input.budgetMs } : {}) },
    );

    /**
     * Todas as paginas falharam: isto e falha da fonte, nao "nada mudou".
     *
     * A distincao importa porque o adiamento progressivo so deve valer para
     * origem com problema -- tratar "site fora do ar" como verificacao bem
     * sucedida faria a plataforma martelar um servidor caido na cadencia
     * cheia, todo dia.
     */
    const falhouTudo = resultado.pagesChecked > 0 && resultado.pagesFailed === resultado.pagesChecked;

    const fim = ctx.now();
    await finishCheck(ctx.db, {
      checkId,
      tenantId: source.tenantId,
      state: falhouTudo ? 'erro' : 'concluida',
      pagesChecked: resultado.pagesChecked,
      pagesUnchanged: resultado.pagesUnchanged,
      pagesFailed: resultado.pagesFailed,
      changesFound: resultado.changesFound,
      conflicts: resultado.conflicts,
      message: resultado.message,
      now: fim,
    });

    const falhas = falhouTudo ? source.consecutiveFailures + 1 : 0;
    const pausar = falhas >= SYNC_LIMITS.maxConsecutiveFailures;

    await updateSource(ctx.db, {
      sourceId: source.id,
      tenantId: source.tenantId,
      state: pausar ? 'pausada' : falhouTudo ? 'erro' : 'ativa',
      lastCheckedAt: fim,
      consecutiveFailures: falhas,
      lastError: falhouTudo ? resultado.message : '',
      now: fim,
    });

    if (pausar) {
      /**
       * Pausa automatica depois de muitas falhas seguidas.
       *
       * Um site que nao responde ha cinco ciclos provavelmente saiu do ar
       * para valer. Continuar batendo nele toda semana para sempre nao ajuda
       * ninguem; a tela mostra a fonte pausada com o motivo, e o cliente
       * retoma quando resolver.
       */
      await updateSource(ctx.db, {
        sourceId: source.id,
        tenantId: source.tenantId,
        nextCheckAt: null,
        now: fim,
      });
    } else {
      await scheduleNext(ctx.db, {
        sourceId: source.id,
        tenantId: source.tenantId,
        frequency: source.frequency,
        from: fim,
        failures: falhas,
      });
    }

    return {
      changesFound: resultado.changesFound,
      conflicts: resultado.conflicts,
      failed: falhouTudo,
      autoPaused: pausar,
      message: resultado.message,
    };
  } catch (error) {
    /**
     * Falha inesperada da plataforma, nao da origem.
     *
     * O detalhe tecnico vai para o log; o cliente ve uma frase em portugues.
     * E, acima de tudo, a excecao morre aqui: a fila dos outros clientes
     * segue.
     */
    console.error(
      '[sync] falha ao verificar a fonte',
      source.id,
      error instanceof Error ? error.message : error,
    );

    const fim = ctx.now();
    const mensagem = 'Não foi possível concluir a verificação do site de origem.';

    await finishCheck(ctx.db, {
      checkId,
      tenantId: source.tenantId,
      state: 'erro',
      pagesChecked: 0,
      pagesUnchanged: 0,
      pagesFailed: 0,
      changesFound: 0,
      conflicts: 0,
      message: mensagem,
      now: fim,
    });

    const falhas = source.consecutiveFailures + 1;
    const pausar = falhas >= SYNC_LIMITS.maxConsecutiveFailures;

    await updateSource(ctx.db, {
      sourceId: source.id,
      tenantId: source.tenantId,
      state: pausar ? 'pausada' : 'erro',
      lastCheckedAt: fim,
      consecutiveFailures: falhas,
      lastError: mensagem,
      ...(pausar ? { nextCheckAt: null } : {}),
      now: fim,
    });

    if (!pausar) {
      await scheduleNext(ctx.db, {
        sourceId: source.id,
        tenantId: source.tenantId,
        frequency: source.frequency,
        from: fim,
        failures: falhas,
      });
    }

    return { changesFound: 0, conflicts: 0, failed: true, autoPaused: pausar, message: mensagem };
  }
}

/**
 * Uma passagem **registrada**: com trava, idempotencia e historico.
 *
 * Esta e a porta pela qual todo disparador entra -- os dois agendamentos da
 * Vercel, o agendador externo e o disparo a mao. `runScheduledChecks`
 * continua existindo como o miolo sem bookkeeping, usado por quem ja esta
 * dentro de uma passagem.
 *
 * Passar todos pela mesma porta e o que torna a cadencia **mensuravel**: a
 * tela so anuncia 6 horas depois de ver 6 horas acontecer, e ela ve pelas
 * linhas que esta funcao grava. Um disparador que escapasse daqui ficaria
 * invisivel na medida e faria a tela subestimar a propria cadencia.
 */
export async function runSchedulerPass(
  ctx: SchedulerContext,
  input: {
    origin: SyncRunOrigin;
    idempotencyKey?: string;
    limit?: number;
    budgetMs?: number;
  },
): Promise<
  | { status: 'concluida'; run: SyncRunSummary; report: SchedulerReport }
  | { status: 'falhou'; run: SyncRunSummary | null; message: string }
  | { status: 'em_andamento'; startedAt: string }
  | { status: 'duplicada'; run: SyncRunSummary }
> {
  const inicio = ctx.now();
  const abertura = await startRun(ctx.db, {
    origin: input.origin,
    ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
    now: inicio,
  });

  if (abertura.status === 'em_andamento') {
    return { status: 'em_andamento', startedAt: abertura.startedAt.toISOString() };
  }
  if (abertura.status === 'duplicada') {
    return { status: 'duplicada', run: abertura.run };
  }

  try {
    const report = await runScheduledChecks(ctx, {
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.budgetMs !== undefined ? { budgetMs: input.budgetMs } : {}),
    });

    const run = await finishRun(ctx.db, {
      runId: abertura.runId,
      state: 'concluida',
      sourcesConnected: report.connected,
      sourcesPaused: report.paused,
      sourcesDue: report.due,
      sourcesClaimed: report.claimed,
      sourcesChecked: report.checked,
      sourcesFailed: report.failed,
      changesFound: report.changesFound,
      autoPaused: report.autoPaused,
      budgetExhausted: report.budgetExhausted,
      startedAt: inicio,
      now: ctx.now(),
    });

    return { status: 'concluida', run: run ?? toSummary0(abertura.runId, input.origin, inicio), report };
  } catch (error) {
    /**
     * Falha da passagem inteira, nao de uma fonte.
     *
     * Falha de fonte ja morre dentro de `checkOneSource` e nao chega aqui --
     * e e assim que um cliente com o site fora do ar nao interrompe a fila
     * dos outros. O que chega aqui e problema da plataforma: banco fora,
     * erro inesperado. A linha e fechada como `falhou` de qualquer jeito,
     * porque uma passagem que fica `executando` para sempre travaria todas
     * as seguintes ate o arrendamento vencer.
     *
     * A mensagem gravada e em portugues e nao carrega o detalhe tecnico: o
     * rastro vai para o log do servidor, que nao e resposta de API.
     */
    const detalhe = error instanceof Error ? error.message : String(error);
    console.error('[sync] falha na passagem do agendador:', detalhe);

    const mensagem = 'A passagem do agendador não pôde ser concluída.';
    const run = await finishRun(ctx.db, {
      runId: abertura.runId,
      state: 'falhou',
      error: mensagem,
      startedAt: inicio,
      now: ctx.now(),
    }).catch(() => null);

    return { status: 'falhou', run, message: mensagem };
  }
}

/** Retrato minimo, para o caso raro de a linha sumir entre abrir e fechar. */
function toSummary0(id: string, origin: SyncRunOrigin, startedAt: Date): SyncRunSummary {
  return {
    id,
    origin,
    state: 'concluida',
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    durationMs: null,
    sourcesConnected: 0,
    sourcesPaused: 0,
    sourcesDue: 0,
    sourcesClaimed: 0,
    sourcesChecked: 0,
    sourcesFailed: 0,
    changesFound: 0,
    error: '',
  };
}
