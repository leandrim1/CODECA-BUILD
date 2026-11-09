import type { schema } from '@codeca/database';
import {
  SCHEDULER_BASELINE_MINUTES,
  SCHEDULER_NOTE,
  fingerprint,
  SYNC_CHANGE_TYPE_LABELS,
  SYNC_FREQUENCY_LABELS,
  SYNC_LIMITS,
  describeInterval,
  effectiveSchedulerMinutes,
  frequencyExceedsScheduler,
  isImageChange,
  previewOf,
  schedulerNote,
  syncTargetLabel,
  type SchedulerStatus,
  type SyncChangeView,
  type SyncCheckView,
  type SyncOverviewView,
  type SyncPageView,
  type SyncSourceView,
} from '@codeca/shared';
import type { SyncChangeRow, SyncPageStateRow, SyncSourceRow } from './store.js';

/**
 * Conversao para o que a tela consome.
 *
 * Fica separada do acesso ao banco porque e aqui que o dado vira **texto para
 * uma pessoa** -- rotulo em portugues, previa de uma linha, aviso sobre a
 * cadencia real. Misturar isso com as consultas faria cada rota decidir
 * sozinha como apresentar a mesma coisa.
 */

export function toSourceView(input: {
  source: SyncSourceRow;
  pages: readonly SyncPageStateRow[];
  counts: { pending: number; conflicts: number; removals: number; found: number };
  /** O que foi medido sobre o agendador. Sem ele vale o piso. */
  scheduler?: SchedulerStatus;
}): SyncSourceView {
  const { source } = input;
  const intervalo = input.scheduler
    ? effectiveSchedulerMinutes(input.scheduler)
    : SCHEDULER_BASELINE_MINUTES;

  return {
    id: source.id,
    sourceUrl: source.sourceUrl,
    state: source.state,
    frequency: source.frequency,
    frequencyLabel: SYNC_FREQUENCY_LABELS[source.frequency],
    /**
     * O aviso so aparece quando ha o que avisar.
     *
     * Pedir "a cada 6 horas" e legitimo, e a fonte realmente vence a cada 6
     * horas. O que pode nao acompanhar e a cadencia com que a plataforma olha
     * a fila -- e essa agora e **medida**, nao suposta: com um agendador
     * externo comprovadamente chamando de 6 em 6 horas, nao ha o que avisar e
     * o aviso some sozinho. Enquanto nao houver medida, vale o piso da Vercel
     * e o cliente ouve a verdade em vez de uma promessa.
     */
    schedulerNote: frequencyExceedsScheduler(source.frequency, intervalo)
      ? (input.scheduler ? schedulerNote(input.scheduler) : SCHEDULER_NOTE)
      : null,
    lastCheckedAt: source.lastCheckedAt?.toISOString() ?? null,
    lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    nextCheckAt: source.nextCheckAt?.toISOString() ?? null,
    changesFound: input.counts.found,
    changesPending: input.counts.pending,
    conflictsPending: input.counts.conflicts,
    removalsPending: input.counts.removals,
    consecutiveFailures: source.consecutiveFailures,
    lastError: source.lastError,
    pages: input.pages.map(toPageView),
    createdAt: source.createdAt.toISOString(),
  };
}

function toPageView(page: SyncPageStateRow): SyncPageView {
  return {
    url: page.url,
    lastSeenAt: page.lastSeenAt?.toISOString() ?? null,
    missingSince: page.missingSince?.toISOString() ?? null,
    status: page.status,
    unchanged: page.status === 304,
  };
}

export function toCheckView(
  row: typeof schema.syncChecks.$inferSelect,
  input: { approved: number; ignored: number; triggeredByName: string },
): SyncCheckView {
  return {
    id: row.id,
    state: row.state as SyncCheckView['state'],
    trigger: row.trigger as SyncCheckView['trigger'],
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    pagesChecked: row.pagesChecked,
    pagesUnchanged: row.pagesUnchanged,
    pagesFailed: row.pagesFailed,
    changesFound: row.changesFound,
    changesApproved: input.approved,
    changesIgnored: input.ignored,
    conflicts: row.conflicts,
    message: row.message,
    triggeredByName: input.triggeredByName,
  };
}

export function toChangeView(
  change: SyncChangeRow,
  input: { approvedByName: string; codecaImageUrl: string | null },
): SyncChangeView {
  const imagem = isImageChange(change.changeType);
  const recorte = differingFields(change.sourceValue, change.codecaValue);

  return {
    id: change.id,
    target: change.target,
    targetLabel: syncTargetLabel(change.target),
    fieldKey: change.fieldKey,
    label: change.label,
    type: change.changeType,
    typeLabel: SYNC_CHANGE_TYPE_LABELS[change.changeType],
    pageUrl: change.pageUrl,
    baselinePreview: previewOf(pick(change.baselineValue, recorte)),
    sourcePreview: previewOf(pick(change.sourceValue, recorte)),
    codecaPreview: previewOf(pick(change.codecaValue, recorte)),
    sourceValue: change.sourceValue,
    sourceImageUrl: imagem ? imageUrlOf(change.sourceValue) : null,
    codecaImageUrl: input.codecaImageUrl,
    conflict: change.conflict,
    decision: change.decision,
    conflictChoice: change.conflictChoice,
    removalAction: change.removalAction,
    outcome: change.outcome,
    detectedAt: change.createdAt.toISOString(),
    appliedAt: change.appliedAt?.toISOString() ?? null,
    approvedByName: input.approvedByName,
    error: change.error,
    targetDisabled: change.targetDisabled,
  };
}

/**
 * Campos que de fato diferem entre a origem e a CODECA.
 *
 * Sem isto a tela mostrava o **titulo** dos dois lados -- porque e ele que
 * identifica o registro -- e um banner cujo subtitulo mudou aparecia como
 * "Conteudo modificado" com exatamente o mesmo texto nas duas colunas. A
 * pessoa via que havia uma alteracao e nao conseguia ver qual.
 *
 * Devolve `null` quando nao ha o que recortar (campo de documento, imagem, ou
 * um dos lados ausente): ai o valor inteiro e a resposta certa.
 */
function differingFields(source: unknown, codeca: unknown): string[] | null {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return null;
  if (codeca === null || typeof codeca !== 'object' || Array.isArray(codeca)) return null;

  const a = source as Record<string, unknown>;
  const b = codeca as Record<string, unknown>;
  const chaves = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (chave) => !chave.startsWith('__'),
  );

  const diferentes = chaves.filter((chave) => fingerprint(a[chave]) !== fingerprint(b[chave]));
  // Nenhuma diferenca de campo: mostra tudo, em vez de uma previa vazia.
  return diferentes.length > 0 ? diferentes : null;
}

/** Recorta um objeto aos campos informados. */
function pick(value: unknown, campos: string[] | null): unknown {
  if (campos === null) return value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const origem = value as Record<string, unknown>;
  const recorte: Record<string, unknown> = {};
  for (const campo of campos) {
    if (origem[campo] !== undefined) recorte[campo] = origem[campo];
  }
  return Object.keys(recorte).length > 0 ? recorte : value;
}

/** Endereco da imagem dentro do valor de uma alteracao de imagem. */
function imageUrlOf(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const url = (value as { url?: unknown }).url;
  return typeof url === 'string' && url !== '' ? url : null;
}

export const SYNC_VIEW_LIMITS = {
  manualChecksPerHour: SYNC_LIMITS.manualChecksPerHour,
  maxChangesPerCheck: SYNC_LIMITS.maxChangesPerCheck,
} as const;

export { SCHEDULER_NOTE };

/**
 * O bloco do agendador que a tela mostra.
 *
 * Carrega os dois numeros com nomes separados -- piso garantido e intervalo
 * observado -- porque a tela precisa poder dizer "garantimos X, estamos
 * entregando Y" sem que um vire o outro.
 */
export function toSchedulerView(status: SchedulerStatus): SyncOverviewView['scheduler'] {
  const efetivo = effectiveSchedulerMinutes(status);
  return {
    ...status,
    effectiveMinutes: efetivo,
    effectiveLabel: describeInterval(efetivo),
    baselineLabel: describeInterval(status.baselineMinutes),
  };
}
