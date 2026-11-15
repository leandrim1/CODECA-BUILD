import { desc, inArray, schema, type Database } from '@codeca/database';
import type { Env } from '../../env.js';
import { recordAudit } from '../audit.js';
import type { Monitor } from './monitor.js';

/**
 * Batimento da conciliacao diaria.
 *
 * ## O problema
 *
 * Uma tarefa agendada que falha grita: da erro, vai para o log, vira alerta.
 * Uma tarefa agendada que **nao roda** nao faz barulho nenhum -- e a
 * conciliacao e quem retoma pagamentos cujo webhook se perdeu. Se o
 * agendamento da Vercel for desligado, mudar de plano ou o segredo for
 * trocado, ninguem percebe ate um cliente pago continuar bloqueado.
 *
 * ## A solucao, sem servico novo
 *
 * A conciliacao deixa um registro ao terminar. A outra tarefa agendada (a
 * verificacao de sincronizacao, em outro horario) confere se esse registro e
 * recente; se nao for, alerta. Uma vigia a outra.
 *
 * O registro mora na auditoria, sem empresa (escopo da plataforma). Nao ha
 * tabela nova.
 *
 * ## O limite conhecido
 *
 * Se as DUAS tarefas pararem, ninguem aqui dentro percebe. Para isso, o
 * `/api/health?ops=1` expoe o instante do ultimo batimento, e um monitor
 * externo de disponibilidade pode vigia-lo (ver `docs/monitoramento.md`).
 */

export const HEARTBEAT_ACTIONS = {
  /** A conciliacao terminou. */
  completed: 'ops.reconcile_completed',
  /** Ponto de partida da vigia, gravado quando ainda nao ha batimento. */
  watchStarted: 'ops.reconcile_watch_started',
} as const;

/** Folga sobre as 24 h do agendamento: a Vercel dispara dentro de uma janela. */
const MAX_SILENCE_MS = 26 * 3600 * 1000;

interface HeartbeatContext {
  db: Database;
  env: Env;
  now: () => Date;
  monitor: Monitor;
}

/** Marca que a conciliacao terminou agora. */
export async function recordReconcileHeartbeat(
  ctx: Omit<HeartbeatContext, 'monitor'>,
  resumo: Record<string, number> = {},
): Promise<void> {
  await recordAudit(ctx.db, ctx.env, {
    tenantId: null,
    action: HEARTBEAT_ACTIONS.completed,
    entityType: 'job',
    entityId: 'billing_reconcile',
    // O instante vem do relogio da aplicacao, e nao do banco, para que o
    // batimento e a conferencia usem a mesma fonte de tempo.
    metadata: { at: ctx.now().toISOString(), ...resumo },
  });
}

/** Instante do ultimo batimento (ou do inicio da vigia), se houver. */
export async function lastReconcileHeartbeat(
  db: Database,
): Promise<{ at: Date; kind: 'completed' | 'watch_started' } | null> {
  const [linha] = await db
    .select({ action: schema.auditLogs.action, metadata: schema.auditLogs.metadata, createdAt: schema.auditLogs.createdAt })
    .from(schema.auditLogs)
    .where(inArray(schema.auditLogs.action, [HEARTBEAT_ACTIONS.completed, HEARTBEAT_ACTIONS.watchStarted]))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(1);
  if (!linha) return null;

  const registrado = typeof linha.metadata.at === 'string' ? new Date(linha.metadata.at) : linha.createdAt;
  return {
    at: Number.isNaN(registrado.getTime()) ? linha.createdAt : registrado,
    kind: linha.action === HEARTBEAT_ACTIONS.completed ? 'completed' : 'watch_started',
  };
}

/**
 * Confere se a conciliacao rodou no prazo; alerta se nao.
 *
 * Na primeira vez, ainda sem batimento, nao ha como saber desde quando ela
 * deveria estar rodando: grava o inicio da vigia e nao alerta. Dali em diante,
 * mais de 26 h sem batimento e alerta.
 */
export async function checkReconcileHeartbeat(
  ctx: HeartbeatContext,
): Promise<{ status: 'ok' | 'watch_started' | 'missed'; lastAt: Date | null }> {
  const ultimo = await lastReconcileHeartbeat(ctx.db);

  if (!ultimo) {
    await recordAudit(ctx.db, ctx.env, {
      tenantId: null,
      action: HEARTBEAT_ACTIONS.watchStarted,
      entityType: 'job',
      entityId: 'billing_reconcile',
      metadata: { at: ctx.now().toISOString() },
    });
    return { status: 'watch_started', lastAt: null };
  }

  const silencio = ctx.now().getTime() - ultimo.at.getTime();
  if (silencio <= MAX_SILENCE_MS) return { status: 'ok', lastAt: ultimo.at };

  await ctx.monitor.report({
    kind: 'job_missed',
    severity: 'critical',
    message: 'A conciliação diária de cobrança não roda há mais de 26 horas.',
    context: {
      ultimaExecucao: ultimo.kind === 'completed' ? ultimo.at.toISOString() : 'nunca',
      horasSemExecutar: Math.floor(silencio / 3600_000),
    },
    alertKey: 'job_missed:billing_reconcile',
  });
  return { status: 'missed', lastAt: ultimo.at };
}
