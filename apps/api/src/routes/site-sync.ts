import { and, eq, inArray, schema, sql, type Database } from '@codeca/database';
import {
  AppError,
  schedulerNote as schedulerNoteDe,
  applyChangesSchema,
  checkImportUrl,
  connectSourceSchema,
  decideChangesSchema,
  nextCheckAt,
  stripWww,
  updateSourceSchema,
  type SyncTarget,
} from '@codeca/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { ok, parseJsonBody, parseParams } from '../lib/http.js';
import { RATE_LIMITS, enforceRateLimit } from '../lib/ratelimit.js';
import { applyApproved, revertChange } from '../lib/sync/applier.js';
import { checkOneSource } from '../lib/sync/scheduler.js';
import { schedulerStatus } from '../lib/sync/runs.js';
import {
  countPending,
  createSource,
  deleteSource,
  listChanges,
  listChecks,
  loadPageStates,
  loadSource,
  updateChangeDecision,
  updateSource,
} from '../lib/sync/store.js';
import {
  SYNC_VIEW_LIMITS,
  toChangeView,
  toCheckView,
  toSchedulerView,
  toSourceView,
} from '../lib/sync/views.js';
import { loadMediaUrls } from '../lib/sync/codeca-side.js';
import { requireCapability, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Sincronizacao com o site de origem.
 *
 * ## O ciclo
 *
 * conectar -> a plataforma verifica sozinha (job diario) -> alteracoes
 * aparecem como **pendentes** -> o cliente decide uma a uma ou por categoria
 * -> aplica -> pode desfazer.
 *
 * ## Permissoes
 *
 * `content:write` para conectar, configurar, verificar, decidir e aplicar;
 * `content:delete` para desconectar e desfazer; `content:read` para olhar.
 * Um `viewer` acompanha, mas nao muda nada.
 *
 * ## Isolamento
 *
 * Empresa e site vem SEMPRE de `c.get('tenant')`, resolvido pela sessao, e
 * nunca do corpo ou da URL. Fonte de outra empresa responde 404 -- nao 403,
 * que confirmaria a existencia dela.
 */

const changeParams = z.object({
  tenantId: z.string().uuid(),
  changeId: z.string().uuid(),
});

export function siteSyncRoutes() {
  const app = new Hono<AppBindings>();

  // ------------------------------------------------- estado da sincronizacao
  app.get('/:tenantId/sync', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const source = await loadSource(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
    });

    // Medido, nao configurado: e daqui que sai a cadencia que a tela
    // anuncia. Ver `lib/sync/runs.ts`.
    const agendador = await schedulerStatus(ctx.db, ctx.now());

    if (!source) {
      return ok(c, {
        source: null,
        checks: [],
        changes: [],
        limits: SYNC_VIEW_LIMITS,
        schedulerNote: schedulerNoteDe(agendador),
        scheduler: toSchedulerView(agendador),
      });
    }

    const [pages, changes, checks, counts] = await Promise.all([
      loadPageStates(ctx.db, { sourceId: source.id, tenantId: tenant.tenantId }),
      listChanges(ctx.db, { sourceId: source.id, tenantId: tenant.tenantId }),
      listChecks(ctx.db, { sourceId: source.id, tenantId: tenant.tenantId }),
      countPending(ctx.db, { tenantId: tenant.tenantId, siteId: tenant.siteId }),
    ]);

    const nomes = await loadUserNames(ctx.db, [
      ...checks.map((check) => check.triggeredByUserId),
      ...changes.map((change) => change.approvedByUserId),
    ]);

    // Enderecos das imagens que estao na biblioteca, para a tela comparar
    // lado a lado sem uma consulta por alteracao.
    const idsDeImagem = changes
      .filter((change) => change.target === 'midia' && change.entityId !== null)
      .map((change) => change.entityId as string);
    const urls = await loadMediaUrls(ctx.db, { tenantId: tenant.tenantId, ids: idsDeImagem });

    /** Aprovadas e ignoradas por verificacao, para o historico. */
    const porCheck = new Map<string, { approved: number; ignored: number }>();
    for (const change of changes) {
      const atual = porCheck.get(change.checkId) ?? { approved: 0, ignored: 0 };
      if (change.decision === 'aprovada') atual.approved += 1;
      if (change.decision === 'ignorada' || change.decision === 'manter_atual') atual.ignored += 1;
      porCheck.set(change.checkId, atual);
    }

    return ok(c, {
      source: toSourceView({
        source,
        pages,
        counts: { ...counts, found: changes.length },
        scheduler: agendador,
      }),
      checks: checks.map((check) =>
        toCheckView(check, {
          ...(porCheck.get(check.id) ?? { approved: 0, ignored: 0 }),
          triggeredByName: nomes.get(check.triggeredByUserId ?? '') ?? '',
        }),
      ),
      changes: changes.map((change) =>
        toChangeView(change, {
          approvedByName: nomes.get(change.approvedByUserId ?? '') ?? '',
          codecaImageUrl: change.entityId ? (urls.get(change.entityId) ?? null) : null,
        }),
      ),
      limits: SYNC_VIEW_LIMITS,
      schedulerNote: schedulerNoteDe(agendador),
      scheduler: toSchedulerView(agendador),
    });
  });

  // ----------------------------------------------------------- conectar
  app.post('/:tenantId/sync', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, connectSourceSchema);

    /**
     * A mesma barreira de forma da importacao, aplicada antes de gravar.
     *
     * Conectar uma fonte e pior que uma importacao avulsa: o endereco passa a
     * ser visitado **para sempre**, sozinho. Deixar um endereco de rede
     * interna entrar aqui criaria uma varredura periodica da infraestrutura.
     */
    const check = checkImportUrl(input.url);
    if (!check.ok) {
      throw AppError.validation(check.message, { fields: { url: check.message } });
    }

    const existente = await loadSource(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
    });
    if (existente) {
      throw AppError.conflict(
        'Este site já está conectado a uma origem. Desconecte antes de ligar outra.',
        { sourceId: existente.id },
      );
    }

    // Liga a fonte a importacao mais recente do mesmo endereco, quando houver:
    // e o que permite reconhecer as imagens que ja vieram de la.
    const [importacao] = await ctx.db
      .select({ id: schema.siteImports.id })
      .from(schema.siteImports)
      .where(
        and(
          eq(schema.siteImports.tenantId, tenant.tenantId),
          eq(schema.siteImports.siteId, tenant.siteId),
          eq(schema.siteImports.sourceHost, stripWww(check.hostname)),
        ),
      )
      .orderBy(sql`${schema.siteImports.createdAt} desc`)
      .limit(1);

    const source = await createSource(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      sourceUrl: check.url,
      sourceHost: stripWww(check.hostname),
      frequency: input.frequency,
      importId: importacao?.id ?? null,
      userId: session.user.id,
      now: ctx.now(),
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.syncConnected,
      entityType: 'sync_source',
      entityId: source.id,
      metadata: { sourceUrl: check.url, frequency: input.frequency },
    });

    const pages = await loadPageStates(ctx.db, {
      sourceId: source.id,
      tenantId: tenant.tenantId,
    });

    return ok(
      c,
      {
        source: toSourceView({
          source,
          pages,
          counts: { pending: 0, conflicts: 0, removals: 0, found: 0 },
        }),
      },
      201,
    );
  });

  // --------------------------------------------- frequencia e pausa
  app.patch('/:tenantId/sync', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const input = await parseJsonBody(c, updateSourceSchema);

    const source = await requireSource(c);
    const agora = ctx.now();
    const frequencia = input.frequency ?? source.frequency;

    /**
     * Pausar e sair da fila.
     *
     * `next_check_at` nulo tira a linha do indice parcial que o agendador
     * consulta -- pausar nao e um filtro a mais na consulta quente, e a
     * ausencia dela.
     */
    const pausada = input.paused ?? source.state === 'pausada';
    const proxima = pausada ? null : nextCheckAt(frequencia, agora);

    await updateSource(ctx.db, {
      sourceId: source.id,
      tenantId: tenant.tenantId,
      frequency: frequencia,
      state: pausada ? 'pausada' : 'ativa',
      nextCheckAt: proxima,
      // Retomar limpa o contador de falhas: o cliente provavelmente resolveu
      // o que estava errado antes de religar.
      ...(pausada ? {} : { consecutiveFailures: 0, lastError: '' }),
      now: agora,
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.syncUpdated,
      entityType: 'sync_source',
      entityId: source.id,
      metadata: { frequency: frequencia, paused: pausada },
    });

    const atualizada = await loadSource(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
    });
    const [pages, counts, changes] = await Promise.all([
      loadPageStates(ctx.db, { sourceId: source.id, tenantId: tenant.tenantId }),
      countPending(ctx.db, { tenantId: tenant.tenantId, siteId: tenant.siteId }),
      listChanges(ctx.db, { sourceId: source.id, tenantId: tenant.tenantId }),
    ]);

    return ok(c, {
      source: toSourceView({
        source: atualizada ?? source,
        pages,
        counts: { ...counts, found: changes.length },
      }),
    });
  });

  // ------------------------------------------------- verificar agora
  app.post('/:tenantId/sync/verificar', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const source = await requireSource(c);

    await enforceRateLimit(ctx.db, RATE_LIMITS.syncManualCheck, tenant.tenantId, ctx.now());

    /**
     * Mesmo caminho da passagem agendada.
     *
     * O clique do cliente e o cron executam `checkOneSource`, e nao duas
     * implementacoes parecidas -- que divergiriam no primeiro ajuste.
     */
    const resultado = await checkOneSource(
      { db: ctx.db, fetcher: ctx.siteFetcher, now: ctx.now },
      { source, trigger: 'manual' },
    );

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.syncChecked,
      entityType: 'sync_source',
      entityId: source.id,
      metadata: {
        sourceUrl: source.sourceUrl,
        changesFound: resultado.changesFound,
        conflicts: resultado.conflicts,
        failed: resultado.failed,
      },
    });

    // A verificacao manual e do usuario: registra quem pediu.
    await ctx.db
      .update(schema.syncChecks)
      .set({ triggeredByUserId: session.user.id })
      .where(
        and(
          eq(schema.syncChecks.sourceId, source.id),
          eq(schema.syncChecks.tenantId, tenant.tenantId),
          eq(schema.syncChecks.trigger, 'manual'),
          sql`${schema.syncChecks.triggeredByUserId} is null`,
        ),
      );

    return ok(c, {
      changesFound: resultado.changesFound,
      conflicts: resultado.conflicts,
      failed: resultado.failed,
      autoPaused: resultado.autoPaused,
      message: resultado.message,
    });
  });

  // ---------------------------------------------------------- decidir
  app.patch('/:tenantId/sync/decisoes', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, decideChangesSchema);
    const source = await requireSource(c);

    const agora = ctx.now();
    let aplicadas = 0;
    for (const decisao of input.items) {
      const ok = await updateChangeDecision(ctx.db, {
        tenantId: tenant.tenantId,
        sourceId: source.id,
        changeId: decisao.changeId,
        decision: decisao.decision,
        ...(decisao.conflictChoice !== undefined ? { conflictChoice: decisao.conflictChoice } : {}),
        ...(decisao.removalAction !== undefined ? { removalAction: decisao.removalAction } : {}),
        userId: session.user.id,
        now: agora,
      });
      if (ok) aplicadas += 1;
    }

    return ok(c, { applied: aplicadas });
  });

  // ----------------------------------------------------------- aplicar
  app.post('/:tenantId/sync/aplicar', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, applyChangesSchema);
    const source = await requireSource(c);

    const resultado = await applyApproved(
      {
        db: ctx.db,
        blob: ctx.blob,
        fetcher: ctx.siteFetcher,
        now: ctx.now,
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        userId: session.user.id,
      },
      { source, targets: input.targets as SyncTarget[] },
    );

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.syncApplied,
      entityType: 'sync_source',
      entityId: source.id,
      metadata: {
        sourceUrl: source.sourceUrl,
        applied: resultado.applied,
        failed: resultado.failed,
        skipped: resultado.skipped,
        archived: resultado.archived,
        deleted: resultado.deleted,
        targets: input.targets,
      },
    });

    return ok(c, { result: resultado });
  });

  // ---------------------------------------------------------- desfazer
  app.post('/:tenantId/sync/alteracoes/:changeId/desfazer', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const { changeId } = parseParams(c, changeParams);
    const source = await requireSource(c);

    const resultado = await revertChange(
      {
        db: ctx.db,
        blob: ctx.blob,
        fetcher: ctx.siteFetcher,
        now: ctx.now,
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        userId: session.user.id,
      },
      { source, changeId },
    );

    if (!resultado.reverted) throw AppError.conflict(resultado.message);

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.syncReverted,
      entityType: 'sync_change',
      entityId: changeId,
      metadata: { sourceUrl: source.sourceUrl },
    });

    return ok(c, { reverted: true, message: resultado.message });
  });

  // ------------------------------------------------------ desconectar
  app.delete('/:tenantId/sync', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const source = await requireSource(c);

    /**
     * Desconectar apaga o acompanhamento, nao o conteudo.
     *
     * Saem a fonte, o estado das paginas, o baseline, o historico e as
     * alteracoes pendentes. O que ja foi aplicado ao painel **fica**: ele
     * virou conteudo do cliente no momento em que ele aprovou.
     */
    await deleteSource(ctx.db, { sourceId: source.id, tenantId: tenant.tenantId });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.syncDisconnected,
      entityType: 'sync_source',
      entityId: source.id,
      metadata: { sourceUrl: source.sourceUrl },
    });

    return ok(c, { disconnected: true });
  });

  return app;
}

/** A fonte deste site, ou 404. */
async function requireSource(c: Context<AppBindings>) {
  const ctx = c.get('ctx');
  const tenant = c.get('tenant');
  const source = await loadSource(ctx.db, {
    tenantId: tenant.tenantId,
    siteId: tenant.siteId,
  });
  if (!source) throw AppError.notFound('Nenhum site de origem conectado.');
  return source;
}

/** Nomes de quem agiu, para o historico. */
async function loadUserNames(
  db: Database,
  ids: readonly (string | null)[],
): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((id): id is string => id !== null))];
  const mapa = new Map<string, string>();
  if (unicos.length === 0) return mapa;

  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(inArray(schema.users.id, unicos));

  for (const row of rows) mapa.set(row.id, row.name);
  return mapa;
}
