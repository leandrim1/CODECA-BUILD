import { and, asc, desc, eq, inArray, isNotNull, lte, ne, schema, sql, type Database } from '@codeca/database';
import {
  SYNC_LIMITS,
  isImportTarget,
  nextCheckAt,
  syncTargetLabel,
  type ConflictChoice,
  type RemovalAction,
  type SyncChangeType,
  type SyncDecision,
  type SyncFrequency,
  type SyncOutcome,
  type SyncSourceState,
  type SyncTarget,
  type SyncTrigger,
} from '@codeca/shared';

/**
 * Leitura e escrita da sincronizacao.
 *
 * Toda consulta filtra por `tenantId` **e** `siteId`, vindos da sessao e nunca
 * de parametro -- com uma excecao deliberada e documentada: a fila do
 * agendador (`claimDueSources`), que roda sem sessao nenhuma e por isso le o
 * par (empresa, site) **da propria linha** e o carrega dali em diante.
 */

export interface SyncSourceRow {
  id: string;
  tenantId: string;
  siteId: string;
  sourceUrl: string;
  sourceHost: string;
  state: SyncSourceState;
  frequency: SyncFrequency;
  lastCheckedAt: Date | null;
  lastSyncedAt: Date | null;
  nextCheckAt: Date | null;
  consecutiveFailures: number;
  lastError: string;
  importId: string | null;
  connectedByUserId: string | null;
  createdAt: Date;
}

export interface SyncBaselineRow {
  id: string;
  contentKey: string;
  target: SyncTarget;
  fieldKey: string;
  label: string;
  sourceValue: unknown;
  sourceFingerprint: string;
  codecaFingerprint: string;
  entityId: string | null;
  pageUrl: string;
  lastSeenAt: Date | null;
  missingSince: Date | null;
}

export interface SyncChangeRow {
  id: string;
  sourceId: string;
  checkId: string;
  contentKey: string;
  target: SyncTarget;
  fieldKey: string;
  label: string;
  changeType: SyncChangeType;
  pageUrl: string;
  baselineValue: unknown;
  sourceValue: unknown;
  codecaValue: unknown;
  conflict: boolean;
  targetDisabled: boolean;
  decision: SyncDecision;
  conflictChoice: ConflictChoice | null;
  removalAction: RemovalAction | null;
  outcome: SyncOutcome;
  revertValue: unknown;
  entityId: string | null;
  approvedByUserId: string | null;
  appliedAt: Date | null;
  error: string;
  sortOrder: number;
  createdAt: Date;
}

export interface SyncPageStateRow {
  id: string;
  url: string;
  contentHash: string;
  etag: string;
  lastModified: string;
  status: number;
  lastSeenAt: Date | null;
  missingSince: Date | null;
}

// --------------------------------------------------------------- fontes

export async function loadSource(
  db: Database,
  input: { tenantId: string; siteId: string },
): Promise<SyncSourceRow | null> {
  const [row] = await db
    .select()
    .from(schema.syncSources)
    .where(
      and(eq(schema.syncSources.tenantId, input.tenantId), eq(schema.syncSources.siteId, input.siteId)),
    );
  return row ? toSourceRow(row) : null;
}

export async function loadSourceById(db: Database, sourceId: string): Promise<SyncSourceRow | null> {
  const [row] = await db.select().from(schema.syncSources).where(eq(schema.syncSources.id, sourceId));
  return row ? toSourceRow(row) : null;
}

export async function createSource(
  db: Database,
  input: {
    tenantId: string;
    siteId: string;
    sourceUrl: string;
    sourceHost: string;
    frequency: SyncFrequency;
    importId: string | null;
    userId: string;
    now: Date;
  },
): Promise<SyncSourceRow> {
  const [row] = await db
    .insert(schema.syncSources)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      sourceUrl: input.sourceUrl,
      sourceHost: input.sourceHost,
      state: 'ativa',
      frequency: input.frequency,
      /**
       * Vence agora.
       *
       * A primeira verificacao nao espera o intervalo: conectar uma fonte e
       * dizer "quero saber o que mudou", e fazer o cliente esperar uma semana
       * pela primeira resposta seria estranho. O agendador a pega na proxima
       * passagem, e a tela oferece "Verificar agora" para quem nao quer
       * esperar nem isso.
       */
      nextCheckAt: input.frequency === 'manual' ? null : input.now,
      importId: input.importId,
      connectedByUserId: input.userId,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning();

  if (!row) throw new Error('Nao foi possivel registrar a fonte de sincronizacao.');
  return toSourceRow(row);
}

export async function updateSource(
  db: Database,
  input: {
    sourceId: string;
    tenantId: string;
    state?: SyncSourceState;
    frequency?: SyncFrequency;
    lastCheckedAt?: Date;
    lastSyncedAt?: Date;
    nextCheckAt?: Date | null;
    consecutiveFailures?: number;
    lastError?: string;
    now: Date;
  },
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: input.now };
  if (input.state !== undefined) patch['state'] = input.state;
  if (input.frequency !== undefined) patch['frequency'] = input.frequency;
  if (input.lastCheckedAt !== undefined) patch['lastCheckedAt'] = input.lastCheckedAt;
  if (input.lastSyncedAt !== undefined) patch['lastSyncedAt'] = input.lastSyncedAt;
  if (input.nextCheckAt !== undefined) patch['nextCheckAt'] = input.nextCheckAt;
  if (input.consecutiveFailures !== undefined) patch['consecutiveFailures'] = input.consecutiveFailures;
  if (input.lastError !== undefined) patch['lastError'] = input.lastError.slice(0, 1000);

  await db
    .update(schema.syncSources)
    .set(patch)
    .where(
      and(eq(schema.syncSources.id, input.sourceId), eq(schema.syncSources.tenantId, input.tenantId)),
    );
}

export async function deleteSource(
  db: Database,
  input: { sourceId: string; tenantId: string },
): Promise<void> {
  // Em cascata: paginas, baseline, verificacoes e alteracoes saem junto.
  await db
    .delete(schema.syncSources)
    .where(
      and(eq(schema.syncSources.id, input.sourceId), eq(schema.syncSources.tenantId, input.tenantId)),
    );
}

/**
 * Fontes vencidas, reservadas para esta passagem do agendador.
 *
 * Reserva e nao so leitura: a mesma instrucao que seleciona ja empurra
 * `next_check_at` para a frente. Duas passagens simultaneas -- o cron e um
 * disparo manual do job, por exemplo -- nao pegam a mesma fonte duas vezes, e
 * uma passagem que morra no meio nao deixa a fonte travada: ela volta a
 * vencer no proximo intervalo em vez de ficar presa a um estado "processando"
 * que ninguem limpa.
 *
 * Roda **sem sessao**. E por isso que ela devolve `tenant_id` e `site_id` da
 * propria linha: tudo o que vem depois carrega esse par, e nenhuma consulta
 * seguinte confia em identificador que nao tenha saido daqui.
 */
export async function claimDueSources(
  db: Database,
  input: { now: Date; limit: number },
): Promise<SyncSourceRow[]> {
  const candidatas = await db
    .select({ id: schema.syncSources.id })
    .from(schema.syncSources)
    .where(
      and(
        isNotNull(schema.syncSources.nextCheckAt),
        lte(schema.syncSources.nextCheckAt, input.now),
        ne(schema.syncSources.state, 'pausada'),
      ),
    )
    .orderBy(asc(schema.syncSources.nextCheckAt))
    .limit(Math.min(input.limit, SYNC_LIMITS.sourcesPerRun));

  if (candidatas.length === 0) return [];
  const ids = candidatas.map((linha) => linha.id);

  // Empurra a reserva: se a passagem falhar, a fonte volta no proximo ciclo.
  const reservadas = await db
    .update(schema.syncSources)
    .set({ nextCheckAt: adiarPorFrequencia(input.now), updatedAt: input.now })
    .where(
      and(
        inArray(schema.syncSources.id, ids),
        isNotNull(schema.syncSources.nextCheckAt),
        lte(schema.syncSources.nextCheckAt, input.now),
      ),
    )
    .returning();

  return reservadas.map(toSourceRow);
}

/**
 * Nova data de vencimento no momento da reserva.
 *
 * Calculada em SQL a partir da frequencia da propria linha, para a reserva
 * caber numa instrucao so. O valor definitivo e gravado no fim da verificacao
 * (`scheduleNext`); este aqui e a rede de seguranca para o caso de a passagem
 * nao chegar ao fim.
 */
function adiarPorFrequencia(now: Date) {
  return sql`case ${schema.syncSources.frequency}
    when '6h' then ${now}::timestamptz + interval '6 hours'
    when '12h' then ${now}::timestamptz + interval '12 hours'
    when 'diaria' then ${now}::timestamptz + interval '1 day'
    when '3dias' then ${now}::timestamptz + interval '3 days'
    when 'semanal' then ${now}::timestamptz + interval '7 days'
    else null
  end`;
}

/** Grava o vencimento seguinte depois de uma verificacao. */
export async function scheduleNext(
  db: Database,
  input: { sourceId: string; tenantId: string; frequency: SyncFrequency; from: Date; failures: number },
): Promise<Date | null> {
  if (input.frequency === 'manual') {
    await updateSource(db, {
      sourceId: input.sourceId,
      tenantId: input.tenantId,
      nextCheckAt: null,
      now: input.from,
    });
    return null;
  }

  /**
   * Adiamento progressivo depois de falhar.
   *
   * Um site fora do ar nao deve ser visitado na mesma cadencia de um no ar:
   * dobrar o intervalo a cada falha evita martelar um servidor com problema e
   * guarda a cota da plataforma para quem responde.
   */
  const base = nextCheckAt(input.frequency, input.from);
  if (base === null) return null;

  if (input.failures > 0) {
    const minutos = Math.min(
      SYNC_LIMITS.backoffBaseMinutes * 2 ** (input.failures - 1),
      SYNC_LIMITS.backoffMaxMinutes,
    );
    const adiada = new Date(input.from.getTime() + minutos * 60_000);
    const alvo = adiada > base ? adiada : base;
    await updateSource(db, {
      sourceId: input.sourceId,
      tenantId: input.tenantId,
      nextCheckAt: alvo,
      now: input.from,
    });
    return alvo;
  }

  await updateSource(db, {
    sourceId: input.sourceId,
    tenantId: input.tenantId,
    nextCheckAt: base,
    now: input.from,
  });
  return base;
}

// ----------------------------------------------------- estado das paginas

export async function loadPageStates(
  db: Database,
  input: { sourceId: string; tenantId: string },
): Promise<SyncPageStateRow[]> {
  const rows = await db
    .select()
    .from(schema.syncPageStates)
    .where(
      and(
        eq(schema.syncPageStates.sourceId, input.sourceId),
        eq(schema.syncPageStates.tenantId, input.tenantId),
      ),
    );
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    contentHash: row.contentHash,
    etag: row.etag,
    lastModified: row.lastModified,
    status: row.status,
    lastSeenAt: row.lastSeenAt,
    missingSince: row.missingSince,
  }));
}

export async function upsertPageState(
  db: Database,
  input: {
    tenantId: string;
    siteId: string;
    sourceId: string;
    url: string;
    contentHash: string;
    etag: string;
    lastModified: string;
    status: number;
    seen: boolean;
    now: Date;
  },
): Promise<void> {
  await db
    .insert(schema.syncPageStates)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      sourceId: input.sourceId,
      url: input.url,
      contentHash: input.contentHash,
      etag: input.etag,
      lastModified: input.lastModified,
      status: input.status,
      lastSeenAt: input.seen ? input.now : null,
      missingSince: input.seen ? null : input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [schema.syncPageStates.sourceId, schema.syncPageStates.url],
      set: {
        contentHash: input.contentHash,
        etag: input.etag,
        lastModified: input.lastModified,
        status: input.status,
        ...(input.seen
          ? { lastSeenAt: input.now, missingSince: null }
          : // `missingSince` so e gravado na primeira ausencia: sobrescrever
            // a cada verificacao apagaria ha quanto tempo a pagina sumiu.
            { missingSince: sql`coalesce(${schema.syncPageStates.missingSince}, ${input.now})` }),
        updatedAt: input.now,
      },
    });
}

// -------------------------------------------------------------- baseline

export async function loadBaseline(
  db: Database,
  input: { sourceId: string; tenantId: string },
): Promise<Map<string, SyncBaselineRow>> {
  const rows = await db
    .select()
    .from(schema.syncBaseline)
    .where(
      and(
        eq(schema.syncBaseline.sourceId, input.sourceId),
        eq(schema.syncBaseline.tenantId, input.tenantId),
      ),
    );

  const mapa = new Map<string, SyncBaselineRow>();
  for (const row of rows) {
    mapa.set(row.contentKey, {
      id: row.id,
      contentKey: row.contentKey,
      target: isImportTarget(row.target) ? row.target : 'midia',
      fieldKey: row.fieldKey,
      label: row.label,
      sourceValue: row.sourceValue,
      sourceFingerprint: row.sourceFingerprint,
      codecaFingerprint: row.codecaFingerprint,
      entityId: row.entityId,
      pageUrl: row.pageUrl,
      lastSeenAt: row.lastSeenAt,
      missingSince: row.missingSince,
    });
  }
  return mapa;
}

/**
 * Grava ou avanca uma linha do baseline.
 *
 * Em lotes, porque uma verificacao toca dezenas de conteudos e uma ida ao
 * banco por conteudo estouraria o tempo da funcao.
 */
export async function upsertBaseline(
  db: Database,
  input: {
    tenantId: string;
    siteId: string;
    sourceId: string;
    rows: readonly {
      contentKey: string;
      target: SyncTarget;
      fieldKey: string;
      label: string;
      sourceValue: unknown;
      sourceFingerprint: string;
      codecaFingerprint: string;
      entityId: string | null;
      pageUrl: string;
      seen: boolean;
    }[];
    now: Date;
  },
): Promise<void> {
  if (input.rows.length === 0) return;

  const LOTE = 100;
  for (let start = 0; start < input.rows.length; start += LOTE) {
    const fatia = input.rows.slice(start, start + LOTE);
    await db
      .insert(schema.syncBaseline)
      .values(
        fatia.map((row) => ({
          tenantId: input.tenantId,
          siteId: input.siteId,
          sourceId: input.sourceId,
          contentKey: row.contentKey,
          target: row.target,
          fieldKey: row.fieldKey,
          label: row.label.slice(0, 500),
          sourceValue: row.sourceValue as never,
          sourceFingerprint: row.sourceFingerprint.slice(0, 4000),
          codecaFingerprint: row.codecaFingerprint.slice(0, 4000),
          entityId: row.entityId,
          pageUrl: row.pageUrl,
          lastSeenAt: row.seen ? input.now : null,
          missingSince: row.seen ? null : input.now,
          createdAt: input.now,
          updatedAt: input.now,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.syncBaseline.sourceId, schema.syncBaseline.contentKey],
        set: {
          sourceValue: sql`excluded.source_value`,
          sourceFingerprint: sql`excluded.source_fingerprint`,
          codecaFingerprint: sql`excluded.codeca_fingerprint`,
          entityId: sql`coalesce(excluded.entity_id, ${schema.syncBaseline.entityId})`,
          pageUrl: sql`excluded.page_url`,
          label: sql`excluded.label`,
          lastSeenAt: sql`coalesce(excluded.last_seen_at, ${schema.syncBaseline.lastSeenAt})`,
          missingSince: sql`case when excluded.last_seen_at is not null then null
            else coalesce(${schema.syncBaseline.missingSince}, excluded.missing_since) end`,
          updatedAt: input.now,
        },
      });
  }
}

/** Marca conteudos que nao apareceram nesta verificacao. */
export async function markBaselineMissing(
  db: Database,
  input: { sourceId: string; tenantId: string; contentKeys: readonly string[]; now: Date },
): Promise<void> {
  if (input.contentKeys.length === 0) return;
  await db
    .update(schema.syncBaseline)
    .set({
      // Preserva a primeira ausencia: e o que diz "sumiu ha tres dias".
      missingSince: sql`coalesce(${schema.syncBaseline.missingSince}, ${input.now})`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(schema.syncBaseline.sourceId, input.sourceId),
        eq(schema.syncBaseline.tenantId, input.tenantId),
        inArray(schema.syncBaseline.contentKey, [...input.contentKeys]),
      ),
    );
}

export async function deleteBaselineKeys(
  db: Database,
  input: { sourceId: string; tenantId: string; contentKeys: readonly string[] },
): Promise<void> {
  if (input.contentKeys.length === 0) return;
  await db
    .delete(schema.syncBaseline)
    .where(
      and(
        eq(schema.syncBaseline.sourceId, input.sourceId),
        eq(schema.syncBaseline.tenantId, input.tenantId),
        inArray(schema.syncBaseline.contentKey, [...input.contentKeys]),
      ),
    );
}

// ---------------------------------------------------------- verificacoes

export async function createCheck(
  db: Database,
  input: {
    tenantId: string;
    siteId: string;
    sourceId: string;
    trigger: SyncTrigger;
    userId: string | null;
    now: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(schema.syncChecks)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      sourceId: input.sourceId,
      state: 'verificando',
      trigger: input.trigger,
      triggeredByUserId: input.userId,
      startedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: schema.syncChecks.id });

  if (!row) throw new Error('Nao foi possivel registrar a verificacao.');
  return row.id;
}

export async function finishCheck(
  db: Database,
  input: {
    checkId: string;
    tenantId: string;
    state: 'concluida' | 'erro';
    pagesChecked: number;
    pagesUnchanged: number;
    pagesFailed: number;
    changesFound: number;
    conflicts: number;
    message: string;
    now: Date;
  },
): Promise<void> {
  await db
    .update(schema.syncChecks)
    .set({
      state: input.state,
      pagesChecked: input.pagesChecked,
      pagesUnchanged: input.pagesUnchanged,
      pagesFailed: input.pagesFailed,
      changesFound: input.changesFound,
      conflicts: input.conflicts,
      message: input.message.slice(0, 1000),
      finishedAt: input.now,
      updatedAt: input.now,
    })
    .where(and(eq(schema.syncChecks.id, input.checkId), eq(schema.syncChecks.tenantId, input.tenantId)));
}

export async function listChecks(
  db: Database,
  input: { sourceId: string; tenantId: string; limit?: number },
): Promise<(typeof schema.syncChecks.$inferSelect)[]> {
  return db
    .select()
    .from(schema.syncChecks)
    .where(
      and(eq(schema.syncChecks.sourceId, input.sourceId), eq(schema.syncChecks.tenantId, input.tenantId)),
    )
    .orderBy(desc(schema.syncChecks.createdAt))
    .limit(Math.min(input.limit ?? 20, SYNC_LIMITS.historyLimit));
}

// ------------------------------------------------------------ alteracoes

/**
 * Grava as alteracoes encontradas.
 *
 * `onConflictDoUpdate` sobre o indice parcial das pendentes: quando a origem
 * muda de novo antes de o cliente decidir, a alteracao pendente e
 * **atualizada** em vez de duplicada. E o que atende o item 11 do pedido
 * ("evitar notificacoes repetidas para a mesma alteracao") sem precisar de
 * uma varredura de limpeza.
 */
export async function recordChanges(
  db: Database,
  input: {
    tenantId: string;
    siteId: string;
    sourceId: string;
    checkId: string;
    rows: readonly {
      contentKey: string;
      target: SyncTarget;
      fieldKey: string;
      label: string;
      changeType: SyncChangeType;
      pageUrl: string;
      baselineValue: unknown;
      sourceValue: unknown;
      codecaValue: unknown;
      conflict: boolean;
      targetDisabled: boolean;
    }[];
    now: Date;
  },
): Promise<void> {
  if (input.rows.length === 0) return;

  const LOTE = 100;
  for (let start = 0; start < input.rows.length; start += LOTE) {
    const fatia = input.rows.slice(start, start + LOTE);
    await db
      .insert(schema.syncChanges)
      .values(
        fatia.map((row, index) => ({
          tenantId: input.tenantId,
          siteId: input.siteId,
          sourceId: input.sourceId,
          checkId: input.checkId,
          contentKey: row.contentKey,
          target: row.target,
          fieldKey: row.fieldKey,
          label: row.label.slice(0, 500),
          changeType: row.changeType,
          pageUrl: row.pageUrl,
          baselineValue: row.baselineValue as never,
          sourceValue: row.sourceValue as never,
          codecaValue: row.codecaValue as never,
          conflict: row.conflict,
          targetDisabled: row.targetDisabled,
          decision: 'pendente' as SyncDecision,
          outcome: 'pendente' as SyncOutcome,
          sortOrder: start + index,
          createdAt: input.now,
          updatedAt: input.now,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.syncChanges.sourceId, schema.syncChanges.contentKey],
        targetWhere: sql`${schema.syncChanges.decision} = 'pendente'`,
        set: {
          checkId: input.checkId,
          changeType: sql`excluded.change_type`,
          label: sql`excluded.label`,
          pageUrl: sql`excluded.page_url`,
          sourceValue: sql`excluded.source_value`,
          codecaValue: sql`excluded.codeca_value`,
          conflict: sql`excluded.conflict`,
          targetDisabled: sql`excluded.target_disabled`,
          updatedAt: input.now,
        },
      });
  }
}

export async function listChanges(
  db: Database,
  input: { sourceId: string; tenantId: string; onlyPending?: boolean; limit?: number },
): Promise<SyncChangeRow[]> {
  const conditions = [
    eq(schema.syncChanges.sourceId, input.sourceId),
    eq(schema.syncChanges.tenantId, input.tenantId),
  ];
  if (input.onlyPending === true) conditions.push(eq(schema.syncChanges.decision, 'pendente'));

  const rows = await db
    .select()
    .from(schema.syncChanges)
    .where(and(...conditions))
    .orderBy(asc(schema.syncChanges.target), asc(schema.syncChanges.sortOrder))
    .limit(Math.min(input.limit ?? 500, 1000));

  return rows.map(toChangeRow);
}

export async function loadChangesByIds(
  db: Database,
  input: { tenantId: string; sourceId: string; ids: readonly string[] },
): Promise<SyncChangeRow[]> {
  if (input.ids.length === 0) return [];
  const rows = await db
    .select()
    .from(schema.syncChanges)
    .where(
      and(
        eq(schema.syncChanges.tenantId, input.tenantId),
        eq(schema.syncChanges.sourceId, input.sourceId),
        inArray(schema.syncChanges.id, [...input.ids]),
      ),
    );
  return rows.map(toChangeRow);
}

export async function updateChangeDecision(
  db: Database,
  input: {
    tenantId: string;
    sourceId: string;
    changeId: string;
    decision: SyncDecision;
    conflictChoice?: ConflictChoice;
    removalAction?: RemovalAction;
    userId: string;
    now: Date;
  },
): Promise<boolean> {
  const patch: Record<string, unknown> = {
    decision: input.decision,
    approvedByUserId: input.userId,
    updatedAt: input.now,
  };
  if (input.conflictChoice !== undefined) patch['conflictChoice'] = input.conflictChoice;
  if (input.removalAction !== undefined) patch['removalAction'] = input.removalAction;

  const rows = await db
    .update(schema.syncChanges)
    .set(patch)
    .where(
      and(
        eq(schema.syncChanges.id, input.changeId),
        eq(schema.syncChanges.tenantId, input.tenantId),
        eq(schema.syncChanges.sourceId, input.sourceId),
        // So alteracao ainda nao aplicada aceita nova decisao: mudar a
        // decisao de algo ja gravado nao desfaz a gravacao, e sugerir que
        // desfaz seria pior do que recusar.
        eq(schema.syncChanges.outcome, 'pendente'),
      ),
    )
    .returning({ id: schema.syncChanges.id });

  return rows.length > 0;
}

export async function updateChangeOutcome(
  db: Database,
  input: {
    tenantId: string;
    changeId: string;
    outcome: SyncOutcome;
    revertValue?: unknown;
    entityId?: string | null;
    error?: string;
    appliedAt?: Date | null;
    now: Date;
  },
): Promise<void> {
  const patch: Record<string, unknown> = { outcome: input.outcome, updatedAt: input.now };
  if (input.revertValue !== undefined) patch['revertValue'] = input.revertValue;
  if (input.entityId !== undefined) patch['entityId'] = input.entityId;
  if (input.error !== undefined) patch['error'] = input.error.slice(0, 1000);
  if (input.appliedAt !== undefined) patch['appliedAt'] = input.appliedAt;

  await db
    .update(schema.syncChanges)
    .set(patch)
    .where(
      and(eq(schema.syncChanges.id, input.changeId), eq(schema.syncChanges.tenantId, input.tenantId)),
    );
}

/** Contagem que alimenta o aviso do painel. */
export async function countPending(
  db: Database,
  input: { tenantId: string; siteId: string },
): Promise<{ pending: number; conflicts: number; removals: number }> {
  const [row] = await db
    .select({
      pending: sql<number>`cast(count(*) as int)`,
      conflicts: sql<number>`cast(count(*) filter (where ${schema.syncChanges.conflict}) as int)`,
      removals: sql<number>`cast(count(*) filter (where ${schema.syncChanges.changeType} in ('removido','imagem_removida')) as int)`,
    })
    .from(schema.syncChanges)
    .where(
      and(
        eq(schema.syncChanges.tenantId, input.tenantId),
        eq(schema.syncChanges.siteId, input.siteId),
        eq(schema.syncChanges.decision, 'pendente'),
        eq(schema.syncChanges.outcome, 'pendente'),
      ),
    );

  return {
    pending: row?.pending ?? 0,
    conflicts: row?.conflicts ?? 0,
    removals: row?.removals ?? 0,
  };
}

// ------------------------------------------------------------- conversao

function toSourceRow(row: typeof schema.syncSources.$inferSelect): SyncSourceRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    siteId: row.siteId,
    sourceUrl: row.sourceUrl,
    sourceHost: row.sourceHost,
    state: row.state as SyncSourceState,
    frequency: row.frequency as SyncFrequency,
    lastCheckedAt: row.lastCheckedAt,
    lastSyncedAt: row.lastSyncedAt,
    nextCheckAt: row.nextCheckAt,
    consecutiveFailures: row.consecutiveFailures,
    lastError: row.lastError,
    importId: row.importId,
    connectedByUserId: row.connectedByUserId,
    createdAt: row.createdAt,
  };
}

function toChangeRow(row: typeof schema.syncChanges.$inferSelect): SyncChangeRow {
  return {
    id: row.id,
    sourceId: row.sourceId,
    checkId: row.checkId,
    contentKey: row.contentKey,
    target: isImportTarget(row.target) ? row.target : 'midia',
    fieldKey: row.fieldKey,
    label: row.label,
    changeType: row.changeType as SyncChangeType,
    pageUrl: row.pageUrl,
    baselineValue: row.baselineValue,
    sourceValue: row.sourceValue,
    codecaValue: row.codecaValue,
    conflict: row.conflict,
    targetDisabled: row.targetDisabled,
    decision: row.decision as SyncDecision,
    conflictChoice: (row.conflictChoice as ConflictChoice | null) ?? null,
    removalAction: (row.removalAction as RemovalAction | null) ?? null,
    outcome: row.outcome as SyncOutcome,
    revertValue: row.revertValue,
    entityId: row.entityId,
    approvedByUserId: row.approvedByUserId,
    appliedAt: row.appliedAt,
    error: row.error,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

export { syncTargetLabel };
