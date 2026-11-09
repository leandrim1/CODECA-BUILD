import {
  IMPORT_LIMITS,
  canonicalPageUrl,
  extractPage,
  extractSitemapFromRobots,
  extractSitemapUrls,
  resolveInternalLink,
  stripWww,
  type AnalyzedPage,
  type PageExtract,
  type PageRole,
} from '@codeca/shared';
import { SiteFetchError, type SiteFetcher } from './fetcher.js';
import { createNullRenderer, type PageRenderer } from './renderer.js';

/**
 * Rastreamento do site, em fatias.
 *
 * ## Por que em fatias
 *
 * A funcao da Vercel para em 60 s (`maxDuration` em `vercel.json`), e o plano
 * permite **um** cron diario, ja usado pela reconciliacao de cobranca. Logo:
 * nao existe fila, e ler 25 paginas numa requisicao nao cabe.
 *
 * A solucao usa o que a tela ja precisa fazer. O painel mostra progresso,
 * portanto consulta o estado de tempo em tempo; cada consulta **avanca** um
 * pedaco do trabalho, dentro de um orcamento de tempo, grava onde parou e
 * devolve o progresso. Sem servico novo, sem cron, sem fila -- e uma analise
 * interrompida no meio nao perde nada, porque a fila mora no banco.
 *
 * ## Ordem das paginas
 *
 * A inicial primeiro, depois o que o sitemap declarar, depois os links
 * internos por profundidade. As paginas com papel conhecido (`sobre`,
 * `servicos`, `contato`...) tem prioridade sobre as demais: com um limite de
 * 25 paginas, gastar o limite em paginas de noticia deixaria a importacao sem
 * o institucional.
 */

/** Fila e historico guardados entre fatias, na coluna `cursor`. */
export interface CrawlCursor {
  /** Endereco inicial, normalizado. */
  homeUrl: string;
  /** Enderecos a visitar, com a profundidade de cada um. */
  queue: { url: string; depth: number; priority: number }[];
  /** Enderecos ja visitados, na forma canonica. */
  visited: string[];
  /** `true` depois de consultar sitemap e robots -- so acontece uma vez. */
  sitemapChecked: boolean;
  /** Paginas que ja passaram pelo navegador nesta analise. */
  rendered: number;
  /** Paginas lidas, com o resumo de cada uma. */
  pages: AnalyzedPage[];
  /**
   * Conteudo extraido de cada pagina.
   *
   * Guardado no cursor porque o mapeamento precisa de **todas** as paginas ao
   * mesmo tempo: o nome da empresa pode estar na inicial e a historia na
   * pagina Sobre, e decidir modulo por modulo pagina a pagina perderia essa
   * visao. Sai do cursor quando a analise termina.
   */
  extracts: PageExtract[];
}

export function createCursor(homeUrl: string): CrawlCursor {
  const canonical = canonicalPageUrl(homeUrl);
  return {
    homeUrl: canonical,
    queue: [{ url: canonical, depth: 0, priority: 0 }],
    visited: [],
    sitemapChecked: false,
    rendered: 0,
    pages: [],
    extracts: [],
  };
}

/**
 * Prioridade de uma pagina na fila. Menor vem primeiro.
 *
 * O endereco declara o proposito antes de a pagina ser lida, e e isso que
 * permite gastar o limite de paginas no que importa: institucional, servicos e
 * contato valem mais que uma pagina de noticia.
 */
const PRIORITY_BY_PATTERN: readonly { pattern: RegExp; priority: number }[] = [
  { pattern: /\/(sobre|quem-somos|institucional|a-empresa|nossa-historia)/i, priority: 1 },
  { pattern: /\/(servicos|serviços|especialidades|tratamentos|procedimentos|solucoes|soluções)/i, priority: 1 },
  { pattern: /\/(contato|fale-conosco|onde-estamos|localizacao|localização)/i, priority: 1 },
  { pattern: /\/(produtos|catalogo|catálogo|cardapio|cardápio|loja)/i, priority: 2 },
  { pattern: /\/(equipe|time|nossos-profissionais|corpo-clinico)/i, priority: 2 },
  { pattern: /\/(depoimentos|avaliacoes|avaliações)/i, priority: 2 },
  { pattern: /\/(faq|perguntas|duvidas|dúvidas)/i, priority: 2 },
  { pattern: /\/(galeria|fotos|portfolio|portfólio|obras|projetos)/i, priority: 3 },
  { pattern: /\/(imoveis|imóveis)/i, priority: 3 },
  // Noticia e artigo entram por ultimo: raramente viram conteudo de modulo e
  // sao o que mais existe num site.
  { pattern: /\/(blog|noticias|notícias|artigos|post|categoria|tag|author)/i, priority: 9 },
];

export function priorityOf(url: string): number {
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    return 5;
  }
  if (path === '/' || path === '') return 0;
  for (const entry of PRIORITY_BY_PATTERN) {
    if (entry.pattern.test(path)) return entry.priority;
  }
  // Caminho raso tem mais chance de ser pagina de secao que um caminho fundo.
  const segments = path.split('/').filter((segment) => segment !== '').length;
  return segments <= 1 ? 4 : 6;
}

export interface SliceResult {
  cursor: CrawlCursor;
  /** `true` quando nao ha mais nada a visitar. */
  done: boolean;
  /** Paginas lidas nesta fatia. */
  read: number;
}

/**
 * Avanca o rastreamento por um pedaco.
 *
 * Para quando: a fila esvazia, o limite de paginas e alcancado, ou o orcamento
 * de tempo da fatia acaba. Nos tres casos o cursor devolvido e consistente --
 * a fatia seguinte continua de onde esta, mesmo em outra instancia.
 */
export async function crawlSlice(input: {
  fetcher: SiteFetcher;
  /** Navegador, quando quem opera configurou um. Ver `renderer.ts`. */
  renderer?: PageRenderer;
  cursor: CrawlCursor;
  now: () => Date;
  budgetMs?: number;
  maxPages?: number;
}): Promise<SliceResult> {
  const cursor: CrawlCursor = {
    ...input.cursor,
    // Cursor gravado por uma versao anterior nao tem o contador.
    rendered: input.cursor.rendered ?? 0,
    queue: [...input.cursor.queue],
    visited: [...input.cursor.visited],
    pages: [...input.cursor.pages],
    extracts: [...input.cursor.extracts],
  };
  const renderer = input.renderer ?? createNullRenderer();
  const budgetMs = input.budgetMs ?? IMPORT_LIMITS.sliceBudgetMs;
  const maxPages = input.maxPages ?? IMPORT_LIMITS.maxPages;
  const startedAt = input.now().getTime();
  const expirou = () => input.now().getTime() - startedAt >= budgetMs;

  let read = 0;
  const visited = new Set(cursor.visited);

  // Sitemap, uma vez por analise. Falha nao interrompe: a maioria dos sites
  // nao tem sitemap, e os links internos resolvem igual.
  if (!cursor.sitemapChecked) {
    cursor.sitemapChecked = true;
    try {
      const descobertas = await discoverFromSitemap(input.fetcher, cursor.homeUrl);
      for (const url of descobertas) {
        enqueue(cursor, visited, url, 1);
      }
    } catch {
      // Sem sitemap, segue pelos links.
    }
  }

  while (cursor.queue.length > 0 && cursor.pages.length < maxPages) {
    if (expirou()) break;

    // Ordena a cada passo: links novos de prioridade alta devem furar a fila
    // antes de o limite de paginas acabar.
    cursor.queue.sort((a, b) => a.priority - b.priority || a.depth - b.depth);
    const next = cursor.queue.shift();
    if (!next) break;

    const canonical = canonicalPageUrl(next.url);
    if (visited.has(canonical)) continue;
    visited.add(canonical);
    cursor.visited = [...visited];

    try {
      const resource = await input.fetcher.fetch(next.url, { accept: 'html' });
      read += 1;

      if (resource.status >= 400 || resource.body === '') {
        cursor.pages.push({
          url: canonical,
          status: resource.status,
          title: '',
          role: 'outra',
          textLength: 0,
          imageCount: 0,
          error:
            resource.status >= 400
              ? `A página respondeu ${resource.status}.`
              : 'A página não devolveu conteúdo.',
        });
        continue;
      }

      let extract = extractPage({ html: resource.body, url: resource.url, homeUrl: cursor.homeUrl });

      /**
       * Terceira tentativa, e so entao: o navegador.
       *
       * A ordem e deliberada. Primeiro o HTML, que nao executa nada. Depois o
       * estado serializado que o framework deixou no proprio HTML (dentro de
       * `extractPage`), que tambem nao executa nada e resolve Next e Nuxt. So
       * quando as duas falham -- pagina sem texto e sem estado embutido -- e
       * que vale pagar o preco de rodar JavaScript de terceiros, e ainda
       * assim apenas se quem opera tiver configurado um renderizador.
       *
       * O teto de paginas renderizadas por analise e baixo pelo mesmo
       * motivo: cada renderizacao e uma execucao de codigo que nao e nosso.
       */
      const precisaRenderizar = extract.renderedByScript && extract.fromEmbeddedState !== true;

      if (
        precisaRenderizar
        && renderer.kind !== 'nenhum'
        && cursor.rendered < IMPORT_LIMITS.maxRenderedPages
      ) {
        cursor.rendered += 1;
        const renderizada = await renderer.render(resource.url);
        if (renderizada !== null) {
          const comNavegador = extractPage({
            html: renderizada.html,
            url: renderizada.finalUrl,
            homeUrl: cursor.homeUrl,
          });
          /**
           * So troca se rendeu mais.
           *
           * Um navegador que devolve a mesma casca vazia -- site fora do ar,
           * bloqueio por bot, erro de script -- nao pode piorar o que a
           * leitura simples ja tinha conseguido.
           */
          if (
            comNavegador.textLength > extract.textLength
            || comNavegador.images.length > extract.images.length
          ) {
            extract = { ...comNavegador, renderedWithBrowser: true };
          }
        }
      }

      cursor.extracts.push(extract);
      cursor.pages.push({
        url: canonical,
        status: resource.status,
        title: extract.title,
        role: extract.role,
        textLength: extract.textLength,
        imageCount: extract.images.length,
        ...(extract.renderedByScript ? { renderedByScript: true } : {}),
        ...(extract.fromEmbeddedState === true ? { fromEmbeddedState: true } : {}),
        ...(extract.renderedWithBrowser === true ? { renderedWithBrowser: true } : {}),
      });

      // Links internos, enquanto houver profundidade.
      if (next.depth < IMPORT_LIMITS.maxDepth) {
        for (const link of extract.links) {
          const internal = resolveInternalLink(link.url, resource.url);
          if (internal === null) continue;
          if (stripWww(new URL(internal).hostname) !== stripWww(new URL(cursor.homeUrl).hostname)) continue;
          enqueue(cursor, visited, internal, next.depth + 1);
        }
      }
    } catch (error) {
      const mensagem =
        error instanceof SiteFetchError ? error.message : 'Não foi possível ler esta página.';
      cursor.pages.push({
        url: canonical,
        status: error instanceof SiteFetchError ? error.status : 0,
        title: '',
        role: 'outra',
        textLength: 0,
        imageCount: 0,
        error: mensagem,
      });
      read += 1;
    }
  }

  const done = cursor.queue.length === 0 || cursor.pages.length >= maxPages;
  return { cursor, done, read };
}

/**
 * Acrescenta a fila, se ainda couber.
 *
 * O teto da fila e generoso em relacao ao limite de paginas porque a ordem por
 * prioridade so funciona se houver de onde escolher: uma fila limitada a 25
 * seria preenchida pelos primeiros links do menu, e uma pagina "Sobre" linkada
 * no rodape nunca entraria.
 */
function enqueue(cursor: CrawlCursor, visited: Set<string>, url: string, depth: number): void {
  if (cursor.queue.length >= IMPORT_LIMITS.maxPages * 8) return;
  const canonical = canonicalPageUrl(url);
  if (visited.has(canonical)) return;
  if (cursor.queue.some((item) => canonicalPageUrl(item.url) === canonical)) return;
  cursor.queue.push({ url: canonical, depth, priority: priorityOf(canonical) });
}

/**
 * Enderecos declarados pelo proprio site.
 *
 * Tenta `robots.txt` primeiro, que e onde o sitemap costuma estar anunciado, e
 * depois os dois caminhos convencionais. Um indice de sitemaps e seguido um
 * nivel -- o suficiente para site grande, sem virar um rastreador de sitemap.
 */
async function discoverFromSitemap(fetcher: SiteFetcher, homeUrl: string): Promise<string[]> {
  const base = new URL(homeUrl);
  const candidatos: string[] = [];

  try {
    const robots = await fetcher.fetch(new URL('/robots.txt', base).toString(), { accept: 'xml' });
    if (robots.status === 200 && robots.body !== '') {
      candidatos.push(...extractSitemapFromRobots(robots.body, homeUrl));
    }
  } catch {
    // Sem robots.txt: segue para os caminhos convencionais.
  }

  if (candidatos.length === 0) {
    candidatos.push(
      new URL('/sitemap.xml', base).toString(),
      new URL('/sitemap_index.xml', base).toString(),
    );
  }

  const encontradas: string[] = [];
  const porVisitar = candidatos.slice(0, 3);
  let seguiuIndice = false;

  for (const sitemapUrl of porVisitar) {
    if (encontradas.length >= IMPORT_LIMITS.maxPages * 4) break;
    try {
      const resource = await fetcher.fetch(sitemapUrl, { accept: 'xml' });
      if (resource.status !== 200 || resource.body === '') continue;
      const { pages, sitemaps } = extractSitemapUrls(resource.body, homeUrl);
      encontradas.push(...pages);

      // Um nivel de indice, e so o primeiro arquivo dele.
      if (pages.length === 0 && sitemaps.length > 0 && !seguiuIndice) {
        seguiuIndice = true;
        const primeiro = sitemaps[0];
        if (primeiro !== undefined) porVisitar.push(primeiro);
      }
    } catch {
      continue;
    }
  }

  // So paginas do mesmo site: um sitemap pode listar outro dominio.
  const host = stripWww(base.hostname);
  return encontradas.filter((url) => {
    try {
      return stripWww(new URL(url).hostname) === host;
    } catch {
      return false;
    }
  });
}

/** Papeis de pagina que a analise soube identificar. */
export function rolesFound(pages: readonly AnalyzedPage[]): PageRole[] {
  const roles = new Set<PageRole>();
  for (const page of pages) {
    if (page.error !== undefined) continue;
    roles.add(page.role);
  }
  return [...roles];
}
