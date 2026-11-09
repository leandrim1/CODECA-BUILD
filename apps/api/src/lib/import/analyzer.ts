import {
  IMPORT_LIMITS,
  MEDIA_TARGET,
  candidateKey,
  emptySummary,
  importTargetLabel,
  isModuleKey,
  mapToModules,
  type DocumentModuleKey,
  type ImportCandidate,
  type ImportSummary,
  type ImportTarget,
} from '@codeca/shared';
import type { Database } from '@codeca/database';
import { enabledModuleKeys, loadSiteModules } from '../modules.js';
import { crawlSlice, type CrawlCursor } from './crawler.js';
import type { PageRenderer } from './renderer.js';
import type { SiteFetcher } from './fetcher.js';
import { hasContent, loadDocument, canApplyCollection } from './apply.js';
import {
  insertItems,
  loadRun,
  updateRun,
  type ImportRunRow,
} from './store.js';

/**
 * Conducao de uma analise, de fatia em fatia.
 *
 * ## O ciclo
 *
 * `validando` -> `analisando` (le paginas, varias fatias) -> `identificando`
 * (mapeia tudo de uma vez) -> `analisada` (espera a revisao).
 *
 * O mapeamento acontece **uma vez, no fim**, e nao pagina por pagina: o nome da
 * empresa pode estar na inicial e a historia na pagina Sobre, e decidir modulo
 * a modulo durante o rastreamento perderia essa visao de conjunto. E tambem o
 * que permite marcar duplicidade -- so da para saber que dois blocos propoem o
 * mesmo servico olhando os dois.
 *
 * `processando_imagens` nao aparece aqui: as imagens so sao baixadas na
 * confirmacao. Baixar 40 arquivos de uma analise que o cliente pode descartar
 * gastaria o armazenamento do plano dele por nada.
 */

export interface AnalyzeContext {
  db: Database;
  fetcher: SiteFetcher;
  /** Navegador, quando configurado. Ver `renderer.ts`. */
  renderer?: PageRenderer;
  now: () => Date;
  tenantId: string;
  siteId: string;
}

export interface AdvanceResult {
  run: ImportRunRow;
  /** `true` quando a analise terminou nesta fatia. */
  finished: boolean;
  /** Paginas lidas nesta fatia. */
  read: number;
}

/**
 * Avanca a analise um pedaco.
 *
 * Chamada pela rota de estado: cada consulta do painel empurra o trabalho e
 * devolve o progresso. Uma analise interrompida no meio (funcao reiniciada,
 * aba fechada) nao perde nada, porque a fila esta no banco -- a chamada
 * seguinte continua de onde parou.
 */
export async function advanceAnalysis(
  ctx: AnalyzeContext,
  run: ImportRunRow,
  options: { budgetMs?: number } = {},
): Promise<AdvanceResult> {
  // Capturado aqui: o reatribuicao de `run` mais abaixo apagaria o
  // estreitamento de tipo que esta conferencia estabelece.
  const cursor = run.cursor;
  if (cursor === null) {
    return { run, finished: true, read: 0 };
  }

  const agora = ctx.now();

  if (run.state === 'validando') {
    await updateRun(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      importId: run.id,
      state: 'analisando',
      message: 'Analisando o site.',
      now: agora,
    });
    run = { ...run, state: 'analisando' };
  }

  const slice = await crawlSlice({
    fetcher: ctx.fetcher,
    ...(ctx.renderer !== undefined ? { renderer: ctx.renderer } : {}),
    cursor,
    now: ctx.now,
    ...(options.budgetMs !== undefined ? { budgetMs: options.budgetMs } : {}),
  });

  const lidas = slice.cursor.pages.filter((page) => page.error === undefined).length;

  if (!slice.done) {
    await updateRun(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      importId: run.id,
      state: 'analisando',
      message:
        lidas === 0
          ? 'Analisando o site.'
          : `Analisando o site: ${lidas} ${lidas === 1 ? 'página lida' : 'páginas lidas'}.`,
      pages: slice.cursor.pages,
      cursor: slice.cursor,
      now: ctx.now(),
    });
    const atualizada = await loadRun(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      importId: run.id,
    });
    return { run: atualizada ?? run, finished: false, read: slice.read };
  }

  // Rastreamento concluido: passa a identificar o conteudo.
  await updateRun(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    importId: run.id,
    state: 'identificando',
    message: 'Identificando os conteúdos encontrados.',
    pages: slice.cursor.pages,
    cursor: slice.cursor,
    now: ctx.now(),
  });

  const resultado = await identifyAndPersist(ctx, run.id, slice.cursor);
  return { run: resultado, finished: true, read: slice.read };
}

/**
 * Transforma as paginas lidas em candidatos e grava a revisao.
 *
 * Aqui entram as tres marcas que a tela de revisao exibe: conflito (o campo ja
 * tem conteudo), duplicidade (dois candidatos propoem o mesmo) e modulo
 * desabilitado. As tres sao calculadas uma vez, na gravacao, para a revisao nao
 * depender de consultar o estado do painel a cada abertura da tela.
 */
async function identifyAndPersist(
  ctx: AnalyzeContext,
  importId: string,
  cursor: CrawlCursor,
): Promise<ImportRunRow> {
  const agora = ctx.now();

  const { candidates, unmapped } = mapToModules(cursor.extracts);

  // Modulos habilitados para este site: o painel do cliente so tem o que foi
  // configurado para o projeto dele.
  const estado = await loadSiteModules(ctx.db, ctx.siteId);
  const habilitados = new Set<ImportTarget>(enabledModuleKeys(estado));
  // A biblioteca de imagens nao e modulo: todo site a tem.
  habilitados.add(MEDIA_TARGET);

  // Conteudo atual dos documentos, para achar os conflitos campo a campo.
  const documentos = new Map<DocumentModuleKey, Record<string, unknown>>();
  for (const moduleKey of ['institucional', 'contato'] as DocumentModuleKey[]) {
    const atual = await loadDocument(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      moduleKey,
    });
    documentos.set(moduleKey, atual?.data ?? {});
  }

  const vistos = new Set<string>();
  const summary: ImportSummary = { ...emptySummary() };
  summary.pages = cursor.pages.filter((page) => page.error === undefined).length;
  summary.pagesFailed = cursor.pages.filter((page) => page.error !== undefined).length;
  summary.unmapped = unmapped.length;

  const linhas: {
    candidate: ImportCandidate;
    conflict: boolean;
    duplicate: boolean;
    targetDisabled: boolean;
    decision: 'selecionado' | 'ignorado';
    currentValue?: unknown;
  }[] = [];

  for (const candidate of candidates) {
    const chave = candidateKey(candidate);
    const duplicate = vistos.has(chave);
    vistos.add(chave);
    if (duplicate) summary.duplicates += 1;

    /**
     * Modulo nao habilitado, ou modulo que a importacao nao sabe gravar.
     *
     * Os dois aparecem na revisao marcados e desmarcados, em vez de serem
     * escondidos: o cliente precisa saber que o site antigo tinha aquilo e que
     * a plataforma nao vai trazer -- sumir com o achado seria a analise
     * fingindo que nao encontrou nada.
     */
    const disabled =
      !habilitados.has(candidate.target)
      || (candidate.kind === 'colecao_registro' && !canApplyCollection(candidate.target));
    if (disabled) summary.skippedByModule += 1;

    let conflict = false;
    let currentValue: unknown;
    if (candidate.kind === 'documento_campo') {
      const atual = documentos.get(candidate.target) ?? {};
      const valorAtual = atual[candidate.fieldKey];
      conflict = hasContent(valorAtual);
      // Guardado para a tela de revisao mostrar os dois lados da escolha.
      if (conflict) {
        currentValue = valorAtual;
        summary.conflicts += 1;
      }
      if (!disabled) summary.documentFields += 1;
    } else if (candidate.kind === 'imagem') {
      summary.images += 1;
    } else if (!disabled) {
      const atual = summary.collectionRecords[candidate.target] ?? 0;
      summary.collectionRecords[candidate.target] = atual + 1;
    }

    /**
     * Decisao inicial.
     *
     * Vem `selecionado` no caso comum, porque o normal e querer o que a
     * analise achou. Vem `ignorado` quando ha conflito, duplicidade ou modulo
     * indisponivel -- nos tres o acerto depende de alguem olhar, e um padrao
     * que marcasse tudo transformaria "confirmar" num botao que sobrescreve
     * conteudo cadastrado.
     */
    const decision = conflict || duplicate || disabled ? 'ignorado' : 'selecionado';

    linhas.push({
      candidate,
      conflict,
      duplicate,
      targetDisabled: disabled,
      decision,
      ...(currentValue !== undefined ? { currentValue } : {}),
    });
  }

  await insertItems(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    importId,
    candidates: linhas,
    now: agora,
  });

  await updateRun(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    importId,
    state: 'analisada',
    message: summaryMessage(summary),
    pages: cursor.pages,
    summary,
    // Fila e conteudo bruto das paginas nao servem mais; o que importa virou
    // candidato. Guardar 25 paginas de HTML extraido por 30 dias seria peso
    // morto no banco.
    cursor: null,
    analyzedAt: agora,
    finishedAt: agora,
    now: agora,
  });

  const atualizada = await loadRun(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    importId,
  });
  if (!atualizada) throw new Error('A analise desapareceu durante a identificacao.');
  return atualizada;
}

/**
 * Resumo em uma frase, com os numeros reais da analise.
 *
 * Nunca um exemplo: os numeros vem da contagem do que foi encontrado, e quando
 * nada foi encontrado a frase diz isso em vez de mostrar zeros.
 */
export function summaryMessage(summary: ImportSummary): string {
  const partes: string[] = [];

  partes.push(`${summary.pages} ${summary.pages === 1 ? 'página' : 'páginas'}`);
  if (summary.images > 0) {
    partes.push(`${summary.images} ${summary.images === 1 ? 'imagem' : 'imagens'}`);
  }
  if (summary.documentFields > 0) {
    partes.push(
      `${summary.documentFields} ${summary.documentFields === 1 ? 'informação institucional' : 'informações institucionais'}`,
    );
  }

  for (const [target, total] of Object.entries(summary.collectionRecords)) {
    if (total === undefined || total === 0) continue;
    const nome = importTargetLabel(target as ImportTarget).toLowerCase();
    partes.push(`${total} em ${nome}`);
  }

  if (partes.length === 1 && summary.pages === 0) {
    return 'Não conseguimos ler nenhuma página desse endereço.';
  }
  if (partes.length === 1) {
    return `Encontramos ${partes[0]}, mas nenhum conteúdo que corresponda aos módulos do seu painel.`;
  }

  const lista =
    partes.length === 2
      ? partes.join(' e ')
      : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;

  return `Encontramos ${lista}. Revise os dados antes de importar.`;
}

/** Limite de analises por hora alcancado? */
export function runLimitReached(recentRuns: number): boolean {
  return recentRuns >= IMPORT_LIMITS.maxRunsPerHour;
}

export { isModuleKey };
