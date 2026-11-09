import { attr, findAll, parseHtml, type HtmlElement } from './html.js';

/**
 * Conteudo que o site deixa escrito no HTML, mesmo sem renderizar nada.
 *
 * ## O problema que isto resolve
 *
 * Um site feito em React, Next, Nuxt ou Vue entrega um HTML quase vazio e
 * monta a pagina no navegador. A analise nao executa script -- e regra de
 * seguranca, nao limitacao preguicosa -- entao, lendo so as tags, esses sites
 * rendem quase nada.
 *
 * So que **boa parte deles nao esconde o conteudo**: para a pagina aparecer
 * rapido e para o Google indexar, o framework serializa os dados dentro do
 * proprio HTML, num bloco de JSON. Next.js escreve `__NEXT_DATA__`; Nuxt
 * escreve `window.__NUXT__`; Apollo, Redux e afins escrevem
 * `window.__INITIAL_STATE__`. Esse JSON costuma trazer os textos e os
 * enderecos de imagem que a tela vai mostrar.
 *
 * Ler esse bloco e **leitura de dados, nao execucao**: o JSON e analisado
 * como texto, nunca avaliado. A regra de nao executar script continua
 * inteira, e muitos sites "modernos" passam a render conteudo de verdade sem
 * precisar de navegador nenhum.
 *
 * ## O que isto NAO faz
 *
 * Nao entende a estrutura de dados de cada framework -- seria um jogo de
 * perseguicao sem fim, com uma versao nova a cada release. Faz o que da para
 * fazer com seguranca: percorre o JSON e recolhe **textos que parecem frases
 * escritas por uma pessoa** e **enderecos que parecem imagem**. O resto da
 * analise trata esse material como trata o de qualquer pagina.
 *
 * Um site cujo conteudo so existe depois que o JavaScript roda -- um Vite
 * puro, por exemplo -- continua fora do alcance daqui. Para esses, so um
 * navegador de verdade resolve (ver `renderer.ts`).
 */

/** Um bloco de dados achado no HTML, com a origem para a evidencia. */
export interface EmbeddedState {
  /** De onde veio: ajuda a explicar na tela e a depurar. */
  source: 'next_data' | 'nuxt' | 'initial_state' | 'json_script' | 'rsc_payload';
  data: unknown;
}

/** O que foi colhido de um conjunto de blocos. */
export interface EmbeddedHarvest {
  /** Frases que parecem conteudo escrito para uma pessoa ler. */
  texts: string[];
  /** Enderecos que parecem arquivo de imagem. */
  images: string[];
  /** `true` quando algum bloco foi encontrado, mesmo sem render nada. */
  found: boolean;
}

/** Tamanho maximo de um bloco que vale a pena analisar. */
const MAX_BLOCK_BYTES = 2 * 1024 * 1024;
/** Teto de nos visitados: JSON de framework pode ser enorme e circular. */
const MAX_NODES = 50_000;
const MAX_DEPTH = 40;
const MAX_TEXTS = 400;
const MAX_IMAGES = 200;

/**
 * Chaves cujo valor quase nunca e conteudo para uma pessoa.
 *
 * Sem este filtro, o JSON de um framework enche a importacao de hash de
 * build, caminho de arquivo e identificador -- lixo que depois alguem teria
 * de limpar a mao no painel.
 */
const CHAVES_IGNORADAS = new Set([
  'buildid', 'builtat', 'hash', 'etag', 'nonce', 'csrf', 'token', 'jwt',
  'id', 'uuid', 'key', 'slug', 'path', 'pathname', 'href', 'route', 'routes',
  'query', 'params', 'locale', 'locales', 'version', 'env', 'config',
  'script', 'scripts', 'style', 'styles', 'css', 'js', 'chunk', 'chunks',
  'gssp', 'gip', 'appgip', 'ssr', 'csp', 'sentry', 'gtm', 'ga',
  'password', 'secret', 'apikey', 'authorization',
]);

/** Extensoes que caracterizam arquivo de imagem. */
const EXT_IMAGEM = /\.(jpe?g|png|webp|avif|gif|svg)(\?[^\s"']*)?$/i;

/**
 * Localiza os blocos de dados que o HTML carrega.
 *
 * Nada aqui e avaliado como codigo: cada bloco e recortado como texto e
 * passado por `JSON.parse`, que so entende dados. Um bloco que nao for JSON
 * valido e simplesmente descartado.
 */
export function extractEmbeddedState(html: string): EmbeddedState[] {
  const blocos: EmbeddedState[] = [];
  let root: HtmlElement;
  try {
    root = parseHtml(html);
  } catch {
    return blocos;
  }

  for (const script of findAll(root, 'script')) {
    if (blocos.length >= 12) break;

    const tipo = attr(script, 'type').toLowerCase();
    const id = attr(script, 'id').toLowerCase();
    const bruto = script.children
      .filter((filho) => filho.type === 'text')
      .map((filho) => (filho as { value: string }).value)
      .join('');

    if (bruto.length === 0 || bruto.length > MAX_BLOCK_BYTES) continue;

    // Next.js: `<script id="__NEXT_DATA__" type="application/json">`.
    if (id === '__next_data__') {
      const dados = tentarJson(bruto);
      if (dados !== undefined) blocos.push({ source: 'next_data', data: dados });
      continue;
    }

    // Blocos declarados como JSON. O JSON-LD ja tem leitura propria, com
    // significado conhecido; aqui interessa o resto.
    if (tipo === 'application/json' || tipo === 'importmap+json') {
      const dados = tentarJson(bruto);
      if (dados !== undefined) blocos.push({ source: 'json_script', data: dados });
      continue;
    }

    if (tipo !== '' && tipo !== 'text/javascript' && tipo !== 'module') continue;

    /**
     * Estado escrito como atribuicao em script inline.
     *
     * `window.__NUXT__={...}` e parentes. O recorte vai do primeiro `{` ate o
     * fechamento equilibrado -- nunca por regex ganancioso, que num JSON
     * grande pega metade de outra coisa.
     */
    for (const marcador of ['__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__', '__PRELOADED_STATE__']) {
      const posicao = bruto.indexOf(marcador);
      if (posicao === -1) continue;
      const abertura = bruto.indexOf('{', posicao);
      if (abertura === -1) continue;
      const recorte = recortarObjeto(bruto, abertura);
      if (recorte === null) continue;
      const dados = tentarJson(recorte);
      if (dados !== undefined) {
        blocos.push({
          source: marcador === '__NUXT__' ? 'nuxt' : 'initial_state',
          data: dados,
        });
      }
      break;
    }

    /**
     * Payload de React Server Components (`self.__next_f.push([1,"..."])`).
     *
     * Vem como string com JSON escapado dentro. Recolhe-se o texto das
     * strings; a estrutura em si nao e documentada nem estavel.
     */
    if (bruto.includes('__next_f')) {
      const pedacos: string[] = [];
      for (const trecho of bruto.matchAll(/"((?:[^"\\]|\\.){20,})"/g)) {
        const valor = trecho[1];
        if (valor !== undefined) pedacos.push(desescapar(valor));
      }
      if (pedacos.length > 0) blocos.push({ source: 'rsc_payload', data: pedacos });
    }
  }

  return blocos;
}

/**
 * Recolhe frases e imagens dos blocos.
 *
 * A travessia e iterativa e com tetos: JSON de framework chega a dezenas de
 * milhares de nos, e uma recursao ingenua estouraria a pilha num site grande.
 */
export function harvestEmbedded(blocos: readonly EmbeddedState[]): EmbeddedHarvest {
  const texts: string[] = [];
  const images: string[] = [];
  const vistos = new Set<string>();
  const vistasImagens = new Set<string>();
  let nos = 0;

  const fila: { valor: unknown; chave: string; profundidade: number }[] = blocos.map((bloco) => ({
    valor: bloco.data,
    chave: '',
    profundidade: 0,
  }));

  while (fila.length > 0) {
    if (nos >= MAX_NODES) break;
    const atual = fila.shift();
    if (!atual) break;
    nos += 1;

    const { valor, chave, profundidade } = atual;
    if (profundidade > MAX_DEPTH) continue;

    if (typeof valor === 'string') {
      const texto = valor.trim();
      if (texto === '') continue;

      if (pareceImagem(texto)) {
        if (!vistasImagens.has(texto) && images.length < MAX_IMAGES) {
          vistasImagens.add(texto);
          images.push(texto);
        }
        continue;
      }

      if (CHAVES_IGNORADAS.has(chave)) continue;
      if (!pareceFrase(texto)) continue;

      const normalizado = texto.toLowerCase();
      if (vistos.has(normalizado)) continue;
      if (texts.length >= MAX_TEXTS) continue;
      vistos.add(normalizado);
      texts.push(texto.slice(0, 5000));
      continue;
    }

    if (Array.isArray(valor)) {
      for (const item of valor) fila.push({ valor: item, chave, profundidade: profundidade + 1 });
      continue;
    }

    if (valor !== null && typeof valor === 'object') {
      for (const [nome, item] of Object.entries(valor as Record<string, unknown>)) {
        fila.push({ valor: item, chave: nome.toLowerCase(), profundidade: profundidade + 1 });
      }
    }
  }

  return { texts, images, found: blocos.length > 0 };
}

/**
 * `true` quando o texto parece uma frase escrita para uma pessoa.
 *
 * O criterio e deliberadamente severo. Um JSON de framework e quase todo
 * identificador, caminho e configuracao; deixar passar o que nao e frase
 * encheria o painel do cliente de lixo que ele teria de apagar a mao -- pior
 * do que nao ter importado nada.
 */
export function pareceFrase(texto: string): boolean {
  if (texto.length < 25 || texto.length > 5000) return false;
  // Precisa de espacos: `produtoDestaqueHomePagePrincipal` nao e frase.
  const espacos = (texto.match(/\s/g) ?? []).length;
  if (espacos < 3) return false;
  // Endereco, caminho de arquivo, seletor, codigo.
  if (/^(https?:|\/|\.{1,2}\/|data:|#|@)/i.test(texto)) return false;
  if (/[{}<>]|=>|\(\)|;\s*$/.test(texto)) return false;
  if (texto.includes('://')) return false;
  // Precisa de letras de verdade, e nao so simbolo e numero.
  const letras = (texto.match(/\p{L}/gu) ?? []).length;
  if (letras < texto.length * 0.6) return false;
  // Sequencia longa sem espaco e hash ou identificador.
  if (/\S{40,}/.test(texto)) return false;
  return true;
}

/** `true` quando o texto parece o endereco de um arquivo de imagem. */
export function pareceImagem(texto: string): boolean {
  if (texto.length > 2048) return false;
  if (!/^(https?:\/\/|\/)/i.test(texto)) return false;
  return EXT_IMAGEM.test(texto);
}

/** `JSON.parse` que devolve `undefined` em vez de lancar. */
function tentarJson(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Recorta o objeto que comeca em `inicio`, contando chaves equilibradas.
 *
 * Respeita string e escape: um `}` dentro de `"texto}"` nao fecha nada. Sem
 * isso, o recorte termina cedo e o JSON sai invalido justamente nos sites com
 * mais conteudo.
 */
function recortarObjeto(texto: string, inicio: number): string | null {
  let profundidade = 0;
  let emString = false;
  let escapado = false;

  for (let i = inicio; i < texto.length && i - inicio < MAX_BLOCK_BYTES; i += 1) {
    const c = texto[i];
    if (escapado) {
      escapado = false;
      continue;
    }
    if (c === '\\') {
      escapado = true;
      continue;
    }
    if (c === '"') {
      emString = !emString;
      continue;
    }
    if (emString) continue;
    if (c === '{') profundidade += 1;
    else if (c === '}') {
      profundidade -= 1;
      if (profundidade === 0) return texto.slice(inicio, i + 1);
    }
  }
  return null;
}

/** Desfaz os escapes de uma string JSON recortada a mao. */
function desescapar(texto: string): string {
  return texto
    .replace(/\\u([0-9a-fA-F]{4})/g, (_todo, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}
