import { and, desc, eq, gte, schema, sql, type Database } from '@codeca/database';
import {
  IMPORT_LIMITS,
  candidatePreview,
  emptySummary,
  importTargetLabel,
  isFinalState,
  isImportTarget,
  isWorkingState,
  type AnalyzedPage,
  type ConflictResolution,
  type ImportCandidate,
  type ImportDecision,
  type ImportDetailView,
  type ImportEvidence,
  type ImportItemView,
  type ImportOutcome,
  type ImportRunView,
  type ImportState,
  type ImportSummary,
  type ImportTarget,
} from '@codeca/shared';
import type { CrawlCursor } from './crawler.js';

/**
 * Leitura e escrita das analises de importacao.
 *
 * Toda consulta aqui filtra por `tenantId` **e** `siteId`, vindos da sessao e
 * nunca de parametro da requisicao. A chave estrangeira composta
 * `(site_id, tenant_id)` cobre o resto no banco: uma linha de analise de uma
 * empresa nao consegue apontar para o site de outra.
 */

export interface ImportRunRow {
  id: string;
  tenantId: string;
  siteId: string;
  sourceUrl: string;
  sourceHost: string;
  state: ImportState;
  message: string;
  pages: AnalyzedPage[];
  summary: ImportSummary;
  cursor: CrawlCursor | null;
  requestedByUserId: string | null;
  startedAt: Date;
  analyzedAt: Date | null;
  importedAt: Date | null;
  finishedAt: Date | null;
}

export interface ImportItemRow {
  id: string;
  kind: string;
  target: ImportTarget;
  fieldKey: string;
  label: string;
  value: unknown;
  previousValue: unknown;
  evidence: ImportEvidence;
  decision: ImportDecision;
  resolution: ConflictResolution;
  outcome: ImportOutcome;
  conflict: boolean;
  duplicate: boolean;
  targetDisabled: boolean;
  createdEntityId: string | null;
  error: string;
  sortOrder: number;
}

/** Cria a analise no estado inicial. */
export async function createRun(
  db: Database,
  input: {
    tenantId: string;
    siteId: string;
    sourceUrl: string;
    sourceHost: string;
    userId: string;
    cursor: CrawlCursor;
    now: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(schema.siteImports)
    .values({
      tenantId: input.tenantId,
      siteId: input.siteId,
      sourceUrl: input.sourceUrl,
      sourceHost: input.sourceHost,
      state: 'validando',
      message: 'Validando o endereço informado.',
      pages: [],
      summary: emptySummary() as unknown as Record<string, unknown>,
      cursor: input.cursor as unknown as Record<string, unknown>,
      requestedByUserId: input.userId,
      startedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: schema.siteImports.id });

  if (!row) throw new Error('Nao foi possivel registrar a analise.');
  return row.id;
}

/** Carrega uma analise do site da sessao. Devolve `null` quando nao e dela. */
export async function loadRun(
  db: Database,
  input: { tenantId: string; siteId: string; importId: string },
): Promise<ImportRunRow | null> {
  const [row] = await db
    .select()
    .from(schema.siteImports)
    .where(
      and(
        eq(schema.siteImports.id, input.importId),
        eq(schema.siteImports.tenantId, input.tenantId),
        eq(schema.siteImports.siteId, input.siteId),
      ),
    );
  return row ? toRunRow(row) : null;
}

/** A analise mais recente do site, em qualquer estado. */
export async function loadLatestRun(
  db: Database,
  input: { tenantId: string; siteId: string },
): Promise<ImportRunRow | null> {
  const [row] = await db
    .select()
    .from(schema.siteImports)
    .where(
      and(eq(schema.siteImports.tenantId, input.tenantId), eq(schema.siteImports.siteId, input.siteId)),
    )
    .orderBy(desc(schema.siteImports.createdAt))
    .limit(1);
  return row ? toRunRow(row) : null;
}

/** Historico do site, da mais recente para a mais antiga. */
export async function listRuns(
  db: Database,
  input: { tenantId: string; siteId: string; limit?: number },
): Promise<ImportRunRow[]> {
  const rows = await db
    .select()
    .from(schema.siteImports)
    .where(
      and(eq(schema.siteImports.tenantId, input.tenantId), eq(schema.siteImports.siteId, input.siteId)),
    )
    .orderBy(desc(schema.siteImports.createdAt))
    .limit(Math.min(input.limit ?? 20, 50));
  return rows.map(toRunRow);
}

/**
 * Analises iniciadas na ultima hora por esta empresa.
 *
 * Alimenta o limite de analises: cada uma gasta requisicoes contra o site de
 * um terceiro, e um laco de "analisar" no painel transformaria a plataforma
 * numa ferramenta de inundacao.
 */
export async function countRecentRuns(
  db: Database,
  input: { tenantId: string; since: Date },
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(schema.siteImports)
    .where(
      and(
        eq(schema.siteImports.tenantId, input.tenantId),
        gte(schema.siteImports.createdAt, input.since),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Analise do site que ainda tem trabalho pendente.
 *
 * Usada para nao abrir duas analises do mesmo site ao mesmo tempo: duas filas
 * sobre o mesmo conteudo gerariam candidatos em duplicidade, e a revisao ficaria
 * com duas listas concorrentes do mesmo site.
 */
export async function loadRunningRun(
  db: Database,
  input: { tenantId: string; siteId: string },
): Promise<ImportRunRow | null> {
  const latest = await loadLatestRun(db, input);
  if (!latest) return null;
  return isWorkingState(latest.state) ? latest : null;
}

export async function updateRun(
  db: Database,
  input: {
    tenantId: string;
    siteId: string;
    importId: string;
    state?: ImportState;
    message?: string;
    pages?: AnalyzedPage[];
    summary?: ImportSummary;
    cursor?: CrawlCursor | null;
    analyzedAt?: Date | null;
    importedAt?: Date | null;
    finishedAt?: Date | null;
    now: Date;
  },
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: input.now };
  if (input.state !== undefined) patch['state'] = input.state;
  if (input.message !== undefined) patch['message'] = input.message;
  if (input.pages !== undefined) patch['pages'] = input.pages;
  if (input.summary !== undefined) patch['summary'] = input.summary;
  // `cursor` nulo limpa a fila: a analise terminou e guardar o conteudo bruto
  // de 25 paginas depois disso seria carregar peso sem uso.
  if (input.cursor !== undefined) patch['cursor'] = input.cursor ?? {};
  if (input.analyzedAt !== undefined) patch['analyzedAt'] = input.analyzedAt;
  if (input.importedAt !== undefined) patch['importedAt'] = input.importedAt;
  if (input.finishedAt !== undefined) patch['finishedAt'] = input.finishedAt;

  await db
    .update(schema.siteImports)
    .set(patch)
    .where(
      and(
        eq(schema.siteImports.id, input.importId),
        eq(schema.siteImports.tenantId, input.tenantId),
        eq(schema.siteImports.siteId, input.siteId),
      ),
    );
}

/**
 * Grava os candidatos da analise.
 *
 * Numa unica instrucao, e nao uma por candidato: a analise pode produzir
 * centenas, e uma ida ao banco por item e o caminho mais curto para a rota
 * estourar o tempo da funcao.
 */
export async function insertItems(
  db: Database,
  input: {
    tenantId: string;
    siteId: string;
    importId: string;
    candidates: readonly {
      candidate: ImportCandidate;
      conflict: boolean;
      duplicate: boolean;
      targetDisabled: boolean;
      decision: ImportDecision;
      /**
       * Valor que esta no painel agora, quando ha conflito.
       *
       * Guardado ja na analise porque e o que a tela de revisao mostra do lado
       * do valor proposto -- sem ele, "manter ou substituir" seria uma escolha
       * as cegas. Na gravacao este campo e reescrito com o valor do **momento
       * da gravacao**, que e o que a reversao precisa devolver: entre analisar
       * e confirmar a pessoa pode ter editado o campo.
       */
      currentValue?: unknown;
    }[];
    now: Date;
  },
): Promise<void> {
  if (input.candidates.length === 0) return;

  const values = input.candidates.map((entry, index) => {
    const { candidate } = entry;

    let value: unknown;
    if (candidate.kind === 'imagem') {
      value = { url: candidate.url, alt: candidate.alt, tag: candidate.tag };
    } else if (candidate.kind === 'colecao_registro') {
      /**
       * A imagem do registro entra em `__imageUrl`, dentro do valor.
       *
       * Ela chega ao mapeamento como campo proprio do candidato, mas o banco
       * guarda um JSON so. O prefixo `__` marca o que nao e campo de modulo:
       * a gravacao troca esses enderecos por identificadores da biblioteca e
       * remove as chaves antes de validar pelo schema, que recusaria chave
       * desconhecida.
       */
      value =
        candidate.imageUrl !== undefined
          ? { ...candidate.value, __imageUrl: candidate.imageUrl }
          : candidate.value;
    } else {
      value = candidate.value;
    }

    return {
      tenantId: input.tenantId,
      siteId: input.siteId,
      importId: input.importId,
      kind: candidate.kind,
      target: candidate.target,
      fieldKey: candidate.kind === 'documento_campo' ? candidate.fieldKey : '',
      label: candidate.label.slice(0, 500),
      value: value as unknown,
      previousValue: entry.currentValue ?? null,
      evidence: candidate.evidence as unknown as Record<string, unknown>,
      decision: entry.decision,
      resolution: 'manter' as ConflictResolution,
      outcome: 'pendente' as ImportOutcome,
      conflict: entry.conflict,
      duplicate: entry.duplicate,
      targetDisabled: entry.targetDisabled,
      error: '',
      sortOrder: index,
      createdAt: input.now,
      updatedAt: input.now,
    };
  });

  // Em lotes: uma instrucao com milhares de parametros estoura o limite do
  // driver antes de chegar ao banco.
  const LOTE = 100;
  for (let start = 0; start < values.length; start += LOTE) {
    await db.insert(schema.siteImportItems).values(values.slice(start, start + LOTE));
  }
}

export async function loadItems(
  db: Database,
  input: { tenantId: string; siteId: string; importId: string },
): Promise<ImportItemRow[]> {
  const rows = await db
    .select()
    .from(schema.siteImportItems)
    .where(
      and(
        eq(schema.siteImportItems.importId, input.importId),
        eq(schema.siteImportItems.tenantId, input.tenantId),
        eq(schema.siteImportItems.siteId, input.siteId),
      ),
    )
    .orderBy(schema.siteImportItems.sortOrder);

  return rows.map(toItemRow);
}

/** Aplica a decisao de quem revisou a um candidato. */
export async function updateItemDecision(
  db: Database,
  input: {
    tenantId: string;
    siteId: string;
    importId: string;
    itemId: string;
    decision: ImportDecision;
    resolution?: ConflictResolution;
    now: Date;
  },
): Promise<boolean> {
  const patch: Record<string, unknown> = { decision: input.decision, updatedAt: input.now };
  if (input.resolution !== undefined) patch['resolution'] = input.resolution;

  const rows = await db
    .update(schema.siteImportItems)
    .set(patch)
    .where(
      and(
        eq(schema.siteImportItems.id, input.itemId),
        eq(schema.siteImportItems.importId, input.importId),
        eq(schema.siteImportItems.tenantId, input.tenantId),
        eq(schema.siteImportItems.siteId, input.siteId),
      ),
    )
    .returning({ id: schema.siteImportItems.id });

  return rows.length > 0;
}

/** Registra o que aconteceu com o candidato na gravacao. */
export async function updateItemOutcome(
  db: Database,
  input: {
    tenantId: string;
    itemId: string;
    outcome: ImportOutcome;
    previousValue?: unknown;
    createdEntityId?: string | null;
    error?: string;
    now: Date;
  },
): Promise<void> {
  const patch: Record<string, unknown> = { outcome: input.outcome, updatedAt: input.now };
  if (input.previousValue !== undefined) patch['previousValue'] = input.previousValue;
  if (input.createdEntityId !== undefined) patch['createdEntityId'] = input.createdEntityId;
  if (input.error !== undefined) patch['error'] = input.error.slice(0, 1000);

  await db
    .update(schema.siteImportItems)
    .set(patch)
    .where(
      and(
        eq(schema.siteImportItems.id, input.itemId),
        eq(schema.siteImportItems.tenantId, input.tenantId),
      ),
    );
}

// ------------------------------------------------------------- conversao

function toRunRow(row: typeof schema.siteImports.$inferSelect): ImportRunRow {
  const cursor = row.cursor as unknown as CrawlCursor | null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    siteId: row.siteId,
    sourceUrl: row.sourceUrl,
    sourceHost: row.sourceHost,
    state: row.state as ImportState,
    message: row.message,
    pages: (row.pages as unknown as AnalyzedPage[]) ?? [],
    summary: { ...emptySummary(), ...(row.summary as unknown as ImportSummary) },
    // Objeto vazio significa "sem fila": a analise terminou e o cursor foi limpo.
    cursor: cursor !== null && typeof cursor === 'object' && 'queue' in cursor ? cursor : null,
    requestedByUserId: row.requestedByUserId,
    startedAt: row.startedAt,
    analyzedAt: row.analyzedAt,
    importedAt: row.importedAt,
    finishedAt: row.finishedAt,
  };
}

function toItemRow(row: typeof schema.siteImportItems.$inferSelect): ImportItemRow {
  return {
    id: row.id,
    kind: row.kind,
    // Um destino que saiu do registro fica visivel como `midia` em vez de
    // derrubar a tela: o dado esta no banco e precisa aparecer na revisao.
    target: isImportTarget(row.target) ? row.target : 'midia',
    fieldKey: row.fieldKey,
    label: row.label,
    value: row.value,
    previousValue: row.previousValue,
    evidence: (row.evidence as unknown as ImportEvidence) ?? { pageUrl: '', source: 'texto', excerpt: '' },
    decision: row.decision as ImportDecision,
    resolution: row.resolution as ConflictResolution,
    outcome: row.outcome as ImportOutcome,
    conflict: row.conflict,
    duplicate: row.duplicate,
    targetDisabled: row.targetDisabled,
    createdEntityId: row.createdEntityId,
    error: row.error,
    sortOrder: row.sortOrder,
  };
}

/** Converte a analise no formato que a tela consome. */
export function toRunView(run: ImportRunRow, createdByName = ''): ImportRunView {
  const lidas = run.pages.filter((page) => page.error === undefined);
  return {
    id: run.id,
    sourceUrl: run.sourceUrl,
    state: run.state,
    summary: run.summary,
    pages: run.pages,
    message: run.message,
    working: isWorkingState(run.state),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    analyzedAt: run.analyzedAt?.toISOString() ?? null,
    importedAt: run.importedAt?.toISOString() ?? null,
    createdByName,
    /**
     * Site que provavelmente monta o conteudo no navegador.
     *
     * A analise nao executa JavaScript, entao quando a maioria das paginas
     * lidas veio sem texto o aviso na tela e o unico jeito honesto de explicar
     * um resultado magro. Exige ao menos uma pagina lida para nao avisar sobre
     * um site que simplesmente nao respondeu.
     */
    likelyClientRendered:
      lidas.length > 0 && lidas.filter((page) => page.renderedByScript === true).length > lidas.length / 2,
  };
}

export function toItemView(item: ImportItemRow): ImportItemView {
  const label =
    item.kind === 'documento_campo'
      ? `${importTargetLabel(item.target)} · ${item.label}`
      : item.label;

  return {
    id: item.id,
    kind: item.kind as ImportItemView['kind'],
    target: item.target,
    fieldKey: item.fieldKey,
    label,
    value: item.value,
    preview: candidatePreview(item.value),
    ...(item.previousValue !== null && item.previousValue !== undefined
      ? { currentValue: item.previousValue, currentPreview: candidatePreview(item.previousValue) }
      : {}),
    decision: item.decision,
    resolution: item.resolution,
    outcome: item.outcome,
    conflict: item.conflict,
    duplicate: item.duplicate,
    targetDisabled: item.targetDisabled,
    evidence: item.evidence,
    ...(item.error !== '' ? { error: item.error } : {}),
    ...(item.createdEntityId !== null ? { createdId: item.createdEntityId } : {}),
  };
}

export function toDetailView(
  run: ImportRunRow,
  items: readonly ImportItemRow[],
  createdByName = '',
): ImportDetailView {
  return { ...toRunView(run, createdByName), items: items.map(toItemView) };
}

/** Analises vencidas, para a limpeza periodica. */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - IMPORT_LIMITS.retentionDays * 24 * 60 * 60 * 1000);
}

export { isFinalState };
