import { createHash } from 'node:crypto';
import type { Database } from '@codeca/database';
import {
  MEDIA_TARGET,
  MISSING,
  SYNC_LIMITS,
  canonicalPageUrl,
  compareThreeWay,
  extractPage,
  fingerprint,
  keyOfCandidate,
  mapToModules,
  resolveInternalLink,
  sideOf,
  stripWww,
  syncKey,
  valueOfCandidate,
  type DocumentModuleKey,
  type ImportCandidate,
  type PageExtract,
  type SyncChangeType,
  type SyncTarget,
} from '@codeca/shared';
import { enabledModuleKeys, loadSiteModules } from '../modules.js';
import { SiteFetchError, type SiteFetcher } from '../import/fetcher.js';
import {
  canCompare,
  comparedFieldsOf,
  findImportedMedia,
  imageFieldOf,
  isDocumentTarget,
  loadCollection,
  loadDocuments,
  loadMediaUrls,
  type CollectionIndex,
} from './codeca-side.js';
import {
  loadBaseline,
  loadPageStates,
  markBaselineMissing,
  recordChanges,
  upsertBaseline,
  upsertPageState,
  type SyncBaselineRow,
  type SyncSourceRow,
} from './store.js';

/**
 * Uma verificacao do site de origem.
 *
 * ## O que ela faz, em ordem
 *
 * 1. Revisita as paginas que ja conhece, com requisicao condicional. Pagina
 *    que responde 304 e pulada inteira -- sem corpo, sem extracao, sem
 *    comparacao.
 * 2. Procura paginas novas a partir dos links das que mudaram.
 * 3. Extrai e mapeia o que achou, com as mesmas pecas da importacao.
 * 4. Compara cada conteudo contra o **baseline** e contra o que esta na
 *    CODECA, pelas tres pontas.
 * 5. Grava as alteracoes encontradas e avanca o baseline do que nao e
 *    alteracao.
 *
 * ## O que ela nunca faz
 *
 * Gravar conteudo. Uma verificacao e leitura da origem e escrita **apenas**
 * nas tabelas da sincronizacao. Quem toca o conteudo do cliente e o
 * `applier`, e so depois de ele aprovar.
 */

export interface CheckContext {
  db: Database;
  fetcher: SiteFetcher;
  now: () => Date;
}

export interface CheckResult {
  pagesChecked: number;
  pagesUnchanged: number;
  pagesFailed: number;
  changesFound: number;
  conflicts: number;
  message: string;
}

/** Resumo de um texto. */
export function hashContent(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Resumo de uma pagina, para detectar alteracao quando nao ha ETag.
 *
 * Cobre **tudo o que o mapeamento consome**, e nao um recorte dele. A versao
 * anterior resumia so titulo, cabecalhos e paragrafos, e isso deixava passar
 * exatamente o caso mais comum do produto: trocar o telefone. O numero vive no
 * JSON-LD e no rodape -- que nao entra em `paragraphs`, porque rodape nao e
 * conteudo -- e `(34) 99999-1111` e `(34) 98888-2222` tem o mesmo tamanho.
 * Resultado: resumo identico, pagina tratada como inalterada, alteracao
 * invisivel.
 *
 * Serializar o extrato inteiro resolve pela raiz: se qualquer sinal que vira
 * conteudo mudou, o resumo muda; se so a marcacao mudou, o extrato e o mesmo e
 * o resumo tambem -- que era a razao de nao resumir o HTML cru.
 *
 * Ficam de fora `url` (nao e conteudo) e `links` (servem para descobrir
 * paginas; um menu reordenado nao e alteracao de conteudo).
 */
export function hashExtract(extract: PageExtract): string {
  const { url: _url, links: _links, ...conteudo } = extract;
  return hashContent(JSON.stringify(conteudo));
}

/**
 * Percorre a origem e devolve as paginas lidas.
 *
 * Diferente do rastreamento da importacao: aqui a lista de partida e o que a
 * fonte ja conhece, e nao so a pagina inicial. Uma pagina que o cliente
 * publicou depois da importacao entra pelos links das que mudaram.
 */
async function visitPages(
  ctx: CheckContext,
  input: {
    source: SyncSourceRow;
    known: { url: string; etag: string; lastModified: string; contentHash: string }[];
    budgetMs: number;
  },
): Promise<{
  extracts: PageExtract[];
  unchangedUrls: string[];
  seenUrls: Set<string>;
  failedUrls: { url: string; error: string }[];
  checked: number;
}> {
  const inicio = ctx.now().getTime();
  const expirou = () => ctx.now().getTime() - inicio >= input.budgetMs;

  const home = canonicalPageUrl(input.source.sourceUrl);
  const hostDaFonte = stripWww(new URL(home).hostname);

  const porUrl = new Map(input.known.map((page) => [page.url, page]));
  // A inicial sempre entra: e por ela que paginas novas sao descobertas.
  const fila: string[] = [home, ...input.known.map((page) => page.url).filter((url) => url !== home)];

  const visitadas = new Set<string>();
  const extracts: PageExtract[] = [];
  const unchangedUrls: string[] = [];
  const failedUrls: { url: string; error: string }[] = [];
  const seenUrls = new Set<string>();
  let checked = 0;
  let descobertas = 0;

  while (fila.length > 0 && checked < SYNC_LIMITS.maxChangesPerCheck) {
    if (expirou()) break;
    const url = fila.shift();
    if (url === undefined) continue;

    const canonical = canonicalPageUrl(url);
    if (visitadas.has(canonical)) continue;
    visitadas.add(canonical);

    const anterior = porUrl.get(canonical);

    try {
      const resource = await ctx.fetcher.fetch(canonical, {
        accept: 'html',
        ...(anterior?.etag ? { ifNoneMatch: anterior.etag } : {}),
        ...(anterior?.lastModified ? { ifModifiedSince: anterior.lastModified } : {}),
      });
      checked += 1;

      if (resource.notModified) {
        /**
         * A origem garantiu que nada mudou.
         *
         * Nao extraimos e nao comparamos: o conteudo desta pagina continua
         * valendo o que o baseline ja diz. E o caminho barato que torna
         * aceitavel visitar o site de um cliente toda semana, para sempre.
         */
        unchangedUrls.push(canonical);
        seenUrls.add(canonical);
        await upsertPageState(ctx.db, {
          tenantId: input.source.tenantId,
          siteId: input.source.siteId,
          sourceId: input.source.id,
          url: canonical,
          contentHash: anterior?.contentHash ?? '',
          etag: resource.etag,
          lastModified: resource.lastModified,
          status: 304,
          seen: true,
          now: ctx.now(),
        });
        continue;
      }

      if (resource.status >= 400 || resource.body === '') {
        failedUrls.push({
          url: canonical,
          error:
            resource.status >= 400
              ? `A página respondeu ${resource.status}.`
              : 'A página não devolveu conteúdo.',
        });
        await upsertPageState(ctx.db, {
          tenantId: input.source.tenantId,
          siteId: input.source.siteId,
          sourceId: input.source.id,
          url: canonical,
          contentHash: anterior?.contentHash ?? '',
          etag: '',
          lastModified: '',
          status: resource.status,
          seen: false,
          now: ctx.now(),
        });
        continue;
      }

      const extract = extractPage({ html: resource.body, url: resource.url, homeUrl: home });
      const hash = hashExtract(extract);
      seenUrls.add(canonical);

      /**
       * Sem ETag, o resumo do texto decide.
       *
       * Muitos servidores nao oferecem validador nenhum, e varios oferecem um
       * que muda a cada resposta (data no rodape, contador de visitas). Por
       * isso o resumo e do **texto extraido**, nao do HTML: mudanca de
       * marcacao que nao muda o que esta escrito nao conta como alteracao.
       */
      const mesmoConteudo = anterior !== undefined && anterior.contentHash === hash;
      if (mesmoConteudo) {
        unchangedUrls.push(canonical);
      } else {
        extracts.push(extract);
      }

      await upsertPageState(ctx.db, {
        tenantId: input.source.tenantId,
        siteId: input.source.siteId,
        sourceId: input.source.id,
        url: canonical,
        contentHash: hash,
        etag: resource.etag,
        lastModified: resource.lastModified,
        status: resource.status,
        seen: true,
        now: ctx.now(),
      });

      // Paginas novas, descobertas pelos links de quem mudou.
      if (!mesmoConteudo && descobertas < SYNC_LIMITS.sourcesPerRun) {
        for (const link of extract.links) {
          const interno = resolveInternalLink(link.url, resource.url);
          if (interno === null) continue;
          const alvo = canonicalPageUrl(interno);
          if (visitadas.has(alvo) || fila.includes(alvo)) continue;
          if (stripWww(new URL(alvo).hostname) !== hostDaFonte) continue;
          if (porUrl.has(alvo)) continue;
          fila.push(alvo);
          descobertas += 1;
          if (descobertas >= SYNC_LIMITS.sourcesPerRun) break;
        }
      }
    } catch (error) {
      checked += 1;
      failedUrls.push({
        url: canonical,
        error: error instanceof SiteFetchError ? error.message : 'Não foi possível ler esta página.',
      });
    }
  }

  return { extracts, unchangedUrls, seenUrls, failedUrls, checked };
}

/**
 * Executa uma verificacao completa de uma fonte.
 *
 * Nao lanca por falha da origem: um site fora do ar e um resultado possivel
 * da verificacao, nao um defeito da plataforma. Quem lanca e so o que indica
 * problema nosso -- e o agendador isola isso por fonte, para a falha de um
 * cliente nao parar a fila dos outros.
 */
export async function runCheck(
  ctx: CheckContext,
  input: { source: SyncSourceRow; checkId: string; budgetMs?: number },
): Promise<CheckResult> {
  const { source } = input;
  const agora = ctx.now();
  const orcamento = input.budgetMs ?? SYNC_LIMITS.sourceBudgetMs;

  const estadoPaginas = await loadPageStates(ctx.db, {
    sourceId: source.id,
    tenantId: source.tenantId,
  });

  const visita = await visitPages(ctx, {
    source,
    known: estadoPaginas.map((page) => ({
      url: page.url,
      etag: page.etag,
      lastModified: page.lastModified,
      contentHash: page.contentHash,
    })),
    budgetMs: orcamento,
  });

  /**
   * Todas as paginas responderam 304 ou vieram iguais.
   *
   * Nada a comparar. Importante tratar antes do mapeamento: com `extracts`
   * vazio, o comparador veria o site inteiro como "sumiu" e proporia apagar
   * tudo -- o pior resultado possivel para uma verificacao de rotina.
   */
  if (visita.extracts.length === 0) {
    const todasFalharam = visita.checked > 0 && visita.failedUrls.length === visita.checked;
    return {
      pagesChecked: visita.checked,
      pagesUnchanged: visita.unchangedUrls.length,
      pagesFailed: visita.failedUrls.length,
      changesFound: 0,
      conflicts: 0,
      message: todasFalharam
        ? (visita.failedUrls[0]?.error ?? 'Não foi possível acessar o site de origem.')
        : 'Nenhuma alteração encontrada no site de origem.',
    };
  }

  return detectChanges(ctx, {
    source,
    checkId: input.checkId,
    extracts: visita.extracts,
    unchangedUrls: visita.unchangedUrls,
    seenUrls: visita.seenUrls,
    failedUrls: visita.failedUrls,
    checked: visita.checked,
    now: agora,
  });
}

/**
 * Compara o que a origem diz agora com o baseline e com a CODECA.
 *
 * Separado de `runCheck` porque e aqui que mora a regra do produto, e porque
 * um teste pode exercita-la com paginas em memoria, sem rede nenhuma.
 */
export async function detectChanges(
  ctx: CheckContext,
  input: {
    source: SyncSourceRow;
    checkId: string;
    extracts: readonly PageExtract[];
    unchangedUrls: readonly string[];
    seenUrls: ReadonlySet<string>;
    failedUrls: readonly { url: string; error: string }[];
    checked: number;
    now: Date;
  },
): Promise<CheckResult> {
  const { source } = input;
  const agora = input.now;

  const { candidates } = mapToModules(input.extracts);
  const baseline = await loadBaseline(ctx.db, { sourceId: source.id, tenantId: source.tenantId });

  /**
   * A primeira verificacao depois de conectar **nao propoe nada**.
   *
   * Sem baseline nao da para distinguir "a origem mudou" de "sempre foi
   * assim": toda diferenca entre a origem e o painel apareceria como conteudo
   * novo, inclusive as que o cliente ja resolveu na importacao, quando
   * escolheu manter o que estava no painel. Reabrir essas decisoes no momento
   * em que ele liga a sincronizacao seria perguntar de novo o que ele ja
   * respondeu.
   *
   * Entao conectar **estabelece o ponto de partida**: grava o que a origem diz
   * hoje e o que o painel tem hoje, em silencio. Da proxima verificacao em
   * diante, tudo o que aparecer e mudanca de verdade -- que e a promessa da
   * funcionalidade.
   */
  const primeiraVerificacao = baseline.size === 0;

  const estado = await loadSiteModules(ctx.db, source.siteId);
  const habilitados = new Set<SyncTarget>(enabledModuleKeys(estado));
  habilitados.add(MEDIA_TARGET);

  const documentos = await loadDocuments(ctx.db, {
    tenantId: source.tenantId,
    siteId: source.siteId,
  });

  // Indice dos registros de colecao, um carregamento por modulo tocado.
  const colecoes = new Map<SyncTarget, CollectionIndex>();
  for (const candidate of candidates) {
    if (candidate.kind !== 'colecao_registro') continue;
    if (colecoes.has(candidate.target)) continue;
    colecoes.set(
      candidate.target,
      await loadCollection(ctx.db, {
        tenantId: source.tenantId,
        siteId: source.siteId,
        target: candidate.target,
      }),
    );
  }

  // Imagens da origem que ja viraram arquivo da biblioteca.
  const urlsDeImagem = candidates
    .filter((item) => item.kind === 'imagem')
    .map((item) => (item.kind === 'imagem' ? item.url : ''));
  const importadas = await findImportedMedia(ctx.db, {
    tenantId: source.tenantId,
    sourceUrls: urlsDeImagem,
  });

  type LinhaDeMudanca = Parameters<typeof recordChanges>[1]['rows'][number];
  type LinhaDeBaseline = Parameters<typeof upsertBaseline>[1]['rows'][number];

  const mudancas: LinhaDeMudanca[] = [];
  const avancos: LinhaDeBaseline[] = [];
  const vistos = new Set<string>();
  let conflitos = 0;

  for (const candidate of candidates) {
    const chave = keyOfCandidate(candidate);
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const anterior = baseline.get(chave);
    const valorOrigem = valueOfCandidate(candidate);
    const ehImagem = candidate.kind === 'imagem';

    const ladoCodeca = codecaSideOf({
      candidate,
      documentos,
      colecoes,
      importadas,
      baseline: anterior,
    });

    const ladoOrigem = sideOf(
      ehImagem && candidate.kind === 'imagem'
        ? { url: candidate.url, alt: candidate.alt, hash: importadas.get(candidate.url)?.hash ?? '' }
        : valorOrigem,
    );

    const ladoBaseline = anterior
      ? { value: anterior.sourceValue, fingerprint: anterior.sourceFingerprint, missing: anterior.sourceFingerprint === '' }
      : MISSING;

    const veredito = compareThreeWay({
      baseline: ladoBaseline,
      source: ladoOrigem,
      codeca: ladoCodeca.side,
      ...(anterior ? { codecaAtBaseline: anterior.codecaFingerprint } : {}),
      image: ehImagem,
    });

    const linhaBase = {
      contentKey: chave,
      target: candidate.target,
      fieldKey: candidate.kind === 'documento_campo' ? candidate.fieldKey : '',
      label: candidate.label,
      sourceValue: ladoOrigem.value,
      sourceFingerprint: ladoOrigem.fingerprint,
      codecaFingerprint: ladoCodeca.side.fingerprint,
      entityId: ladoCodeca.entityId,
      pageUrl: candidate.evidence.pageUrl,
      seen: true,
    };

    if (primeiraVerificacao || veredito.kind === 'sem_alteracao' || veredito.kind === 'apenas_local') {
      /**
       * Avanca o baseline mesmo sem alteracao a propor.
       *
       * Em `apenas_local` isso e essencial: grava a impressao atual da CODECA
       * para que a edicao do cliente deixe de contar como divergencia na
       * proxima verificacao. Sem isso o mesmo campo apareceria como conflito
       * para sempre.
       */
      avancos.push(linhaBase);
      continue;
    }

    if (mudancas.length >= SYNC_LIMITS.maxChangesPerCheck) continue;
    if (veredito.conflict) conflitos += 1;

    mudancas.push({
      contentKey: chave,
      target: candidate.target,
      fieldKey: candidate.kind === 'documento_campo' ? candidate.fieldKey : '',
      label: candidate.label,
      changeType: veredito.type,
      pageUrl: candidate.evidence.pageUrl,
      baselineValue: ladoBaseline.value,
      sourceValue: ladoOrigem.value,
      codecaValue: ladoCodeca.side.value,
      conflict: veredito.conflict,
      targetDisabled: !habilitados.has(candidate.target) || !canCompare(candidate.target),
      /**
       * O registro da CODECA que esta alteracao toca.
       *
       * Sem ele a aplicacao nao sabe **o que** atualizar: um servico alterado
       * viraria registro novo, e uma remocao nao teria o que arquivar.
       */
      entityId: ladoCodeca.entityId ?? anterior?.entityId ?? null,
    });

    /**
     * O baseline **nao** avanca aqui.
     *
     * Enquanto o cliente nao decidir, o que a origem dizia antes continua
     * sendo a referencia. Avancar agora faria a alteracao desaparecer da
     * proxima verificacao como se tivesse sido tratada.
     */
  }

  // ------------------------------------------------ conteudo que sumiu
  // Na primeira verificacao o baseline esta vazio: nao ha o que ter sumido.
  const sumidos = primeiraVerificacao
    ? []
    : detectRemovals({
        baseline,
        vistos,
        unchangedUrls: input.unchangedUrls,
        seenUrls: input.seenUrls,
        habilitados,
      });

  for (const row of sumidos) {
    if (mudancas.length >= SYNC_LIMITS.maxChangesPerCheck) break;
    mudancas.push(row);
  }

  // --------------------------------------------------------- gravacao
  if (avancos.length > 0) {
    await upsertBaseline(ctx.db, {
      tenantId: source.tenantId,
      siteId: source.siteId,
      sourceId: source.id,
      rows: avancos,
      now: agora,
    });
  }

  if (sumidos.length > 0) {
    await markBaselineMissing(ctx.db, {
      sourceId: source.id,
      tenantId: source.tenantId,
      contentKeys: sumidos.map((row) => row.contentKey),
      now: agora,
    });
  }

  if (mudancas.length > 0) {
    await recordChanges(ctx.db, {
      tenantId: source.tenantId,
      siteId: source.siteId,
      sourceId: source.id,
      checkId: input.checkId,
      rows: mudancas,
      now: agora,
    });
  }

  return {
    pagesChecked: input.checked,
    pagesUnchanged: input.unchangedUrls.length,
    pagesFailed: input.failedUrls.length,
    changesFound: mudancas.length,
    conflicts: conflitos,
    message: primeiraVerificacao
      ? `Acompanhamento iniciado: ${avancos.length} ${avancos.length === 1 ? 'conteúdo registrado' : 'conteúdos registrados'} como ponto de partida. A partir daqui avisamos o que mudar no site de origem.`
      : checkMessage(mudancas.length, conflitos, sumidos.length),
  };
}

/**
 * Conteudo que estava no baseline e nao apareceu nesta verificacao.
 *
 * O cuidado central: **so conta como sumido o que vinha de uma pagina que
 * respondeu**. Se a pagina de servicos deu tempo esgotado, os servicos dela
 * nao sumiram -- a plataforma simplesmente nao olhou. Tratar os dois casos
 * igual proporia apagar a carteira inteira de um cliente por causa de uma
 * instabilidade de dez minutos.
 */
/** Uma alteracao de remocao, antes de ir para o banco. */
interface RemovalRow {
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
  entityId: string | null;
}

function detectRemovals(input: {
  baseline: Map<string, SyncBaselineRow>;
  vistos: ReadonlySet<string>;
  unchangedUrls: readonly string[];
  seenUrls: ReadonlySet<string>;
  habilitados: ReadonlySet<SyncTarget>;
}): RemovalRow[] {
  const inalteradas = new Set(input.unchangedUrls);
  const removidos: RemovalRow[] = [];

  for (const [chave, linha] of input.baseline) {
    if (input.vistos.has(chave)) continue;
    // Veio de pagina que respondeu 304: o conteudo continua la, intacto.
    if (inalteradas.has(linha.pageUrl)) continue;
    // Veio de pagina que nem foi visitada nesta passagem: silencio nao e
    // ausencia.
    if (linha.pageUrl !== '' && !input.seenUrls.has(linha.pageUrl)) continue;
    // Ja estava marcado como sumido numa verificacao anterior: a alteracao
    // pendente correspondente ja existe.
    if (linha.missingSince !== null) continue;

    const ehImagem = linha.target === MEDIA_TARGET;
    removidos.push({
      contentKey: chave,
      target: linha.target,
      fieldKey: linha.fieldKey,
      label: linha.label,
      changeType: ehImagem ? 'imagem_removida' : 'removido',
      pageUrl: linha.pageUrl,
      baselineValue: linha.sourceValue,
      sourceValue: null,
      codecaValue: null,
      conflict: false,
      targetDisabled: !input.habilitados.has(linha.target),
      entityId: linha.entityId,
    });
  }

  return removidos;
}

/** O lado da CODECA para um candidato, e o registro a que ele corresponde. */
function codecaSideOf(input: {
  candidate: ImportCandidate;
  documentos: Map<DocumentModuleKey, Record<string, unknown>>;
  colecoes: Map<SyncTarget, CollectionIndex>;
  importadas: Map<string, { mediaId: string; url: string; hash: string }>;
  baseline: SyncBaselineRow | undefined;
}): { side: ReturnType<typeof sideOf>; entityId: string | null } {
  const { candidate } = input;

  if (candidate.kind === 'documento_campo') {
    if (!isDocumentTarget(candidate.target)) return { side: MISSING, entityId: null };
    const documento = input.documentos.get(candidate.target) ?? {};
    return { side: sideOf(documento[candidate.fieldKey]), entityId: null };
  }

  if (candidate.kind === 'imagem') {
    const arquivo = input.importadas.get(candidate.url);
    if (!arquivo) return { side: MISSING, entityId: null };
    /**
     * O lado da CODECA de uma imagem e o resumo do arquivo que ela gerou.
     *
     * Comparar enderecos nao serviria: o arquivo da biblioteca tem endereco
     * do Blob, nao da origem. O que identifica "e a mesma imagem" e o resumo
     * criptografico, guardado quando ela foi importada.
     */
    return {
      side: sideOf({ url: candidate.url, alt: '', hash: arquivo.hash }),
      entityId: arquivo.mediaId,
    };
  }

  // Registro de colecao: pelo identificador do baseline, com o titulo como
  // segunda via para fontes conectadas depois de uma importacao antiga.
  const indice = input.colecoes.get(candidate.target);
  if (!indice) return { side: MISSING, entityId: null };

  const porId = input.baseline?.entityId ? indice.byId.get(input.baseline.entityId) : undefined;
  const registro = porId ?? indice.byLabel.get(chaveDoRotulo(candidate.label));
  if (!registro) return { side: MISSING, entityId: null };

  // So os campos comparados: o registro inteiro traria colunas que a origem
  // nunca preenche e tudo apareceria como alterado.
  const campos = comparedFieldsOf(candidate.target);
  const recorte: Record<string, unknown> = {};
  const proposto = candidate.value as Record<string, unknown>;
  for (const campo of campos) {
    // Campo que a origem nao trouxe fica de fora dos dois lados: a origem nao
    // tem opiniao sobre ele, e marca-lo como divergencia seria ruido.
    if (proposto[campo] === undefined) continue;
    recorte[campo] = registro.value[campo];
  }

  return { side: sideOf(recorte), entityId: registro.id };
}

function chaveDoRotulo(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Frase do resultado, com os numeros reais. */
export function checkMessage(changes: number, conflicts: number, removals: number): string {
  if (changes === 0) return 'Nenhuma alteração encontrada no site de origem.';

  const base =
    changes === 1
      ? 'Encontramos 1 atualização no seu site de origem.'
      : `Encontramos ${changes} atualizações no seu site de origem.`;

  const extras: string[] = [];
  if (conflicts > 0) {
    extras.push(
      conflicts === 1
        ? '1 delas conflita com uma edição feita no painel'
        : `${conflicts} delas conflitam com edições feitas no painel`,
    );
  }
  if (removals > 0) {
    extras.push(
      removals === 1 ? '1 conteúdo saiu do ar na origem' : `${removals} conteúdos saíram do ar na origem`,
    );
  }

  return extras.length > 0 ? `${base} ${extras.join(' e ')}.` : base;
}

export { fingerprint, syncKey };
