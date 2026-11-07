/**
 * Leitor de HTML sem dependencia.
 *
 * Escrito aqui em vez de trazer um pacote por tres razoes, nesta ordem:
 *
 * 1. **Seguranca.** Um tokenizador le texto e devolve texto. Nao resolve
 *    `<script>`, nao busca recurso, nao monta DOM e nao tem como executar nada
 *    do site analisado -- a exigencia "nao executar scripts encontrados no
 *    site" passa a ser verdade por construcao, nao por configuracao.
 * 2. **Tamanho da funcao.** O backend roda em funcao serverless; cada
 *    dependencia entra no pacote publicado.
 * 3. **Coerencia com o projeto.** O repositorio ja escreve o que e pequeno e
 *    especifico: cache com validade, cifra autenticada, assinatura de webhook,
 *    slug.
 *
 * O que ele **nao** e: um parser conforme a especificacao do HTML. Nao
 * reabre tag mal fechada como o navegador faz, nao implementa a tabela de
 * insercao implicita. Para extrair titulo, meta, cabecalho, texto, link e
 * imagem de um site publico isso nao e necessario -- e o custo de errar aqui e
 * um campo vazio na revisao, que a pessoa ve antes de importar.
 */

/** Tamanho maximo de HTML que vale a pena ler. Acima disso, corta. */
export const MAX_HTML_BYTES = 2 * 1024 * 1024;

export interface HtmlElement {
  type: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlElement | null;
}

export interface HtmlText {
  type: 'text';
  value: string;
  parent: HtmlElement | null;
}

export type HtmlNode = HtmlElement | HtmlText;

/** Tags que nunca tem filho: fecham sozinhas por definicao. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Tags cujo conteudo e texto bruto, e nao marcacao.
 *
 * Decisivo para `script` e `style`: dentro deles um `<` nao abre tag. Tratar o
 * conteudo como marcacao faria o parser interpretar JavaScript do site como
 * estrutura da pagina.
 */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title', 'noscript']);

/**
 * Tags que o navegador fecha sozinho quando outra do mesmo grupo abre.
 *
 * Sem isto, `<p>um<p>dois` viraria um paragrafo dentro do outro e o texto
 * sairia concatenado. `<li>` em lista e o caso que mais aparece em menu e em
 * lista de servicos.
 */
const AUTO_CLOSE: Record<string, ReadonlySet<string>> = {
  p: new Set(['p', 'div', 'section', 'article', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'form', 'header', 'footer', 'main', 'nav', 'aside', 'blockquote', 'pre', 'figure']),
  li: new Set(['li']),
  dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']),
  tr: new Set(['tr']),
  td: new Set(['td', 'th', 'tr']),
  th: new Set(['td', 'th', 'tr']),
  option: new Set(['option']),
  thead: new Set(['tbody', 'tfoot']),
  tbody: new Set(['tbody', 'tfoot']),
};

/** Entidades que de fato aparecem em texto de site brasileiro. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', agrave: 'à', atilde: 'ã', acirc: 'â', auml: 'ä',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  iacute: 'í', icirc: 'î', iuml: 'ï',
  oacute: 'ó', otilde: 'õ', ocirc: 'ô', ouml: 'ö', ograve: 'ò',
  uacute: 'ú', ucirc: 'û', uuml: 'ü', ugrave: 'ù',
  ccedil: 'ç', ntilde: 'ñ',
  Aacute: 'Á', Agrave: 'À', Atilde: 'Ã', Acirc: 'Â',
  Eacute: 'É', Ecirc: 'Ê', Iacute: 'Í',
  Oacute: 'Ó', Otilde: 'Õ', Ocirc: 'Ô',
  Uacute: 'Ú', Ccedil: 'Ç',
  ordf: 'ª', ordm: 'º', deg: '°', middot: '·', bull: '•',
  hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  euro: '€', pound: '£', yen: '¥', cent: '¢', copy: '©', reg: '®', trade: '™',
  times: '×', divide: '÷', frac12: '½', frac14: '¼', sup2: '²', sup3: '³',
  shy: '', zwj: '', zwnj: '', ensp: ' ', emsp: ' ', thinsp: ' ',
};

/**
 * Troca entidades pelo caractere que representam.
 *
 * Tolerante de proposito: `&` solto e comum em HTML escrito a mao e nao e
 * motivo para perder o resto do texto.
 */
export function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});?/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // Fora do plano Unicode, ou surrogate solto: devolve como veio.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : match;
  });
}

function createElement(tag: string, attrs: Record<string, string>, parent: HtmlElement | null): HtmlElement {
  return { type: 'element', tag, attrs, children: [], parent };
}

/**
 * Le os atributos de uma tag.
 *
 * Aceita valor com aspas duplas, simples e sem aspas, porque os tres aparecem.
 * Nome repetido mantem o primeiro, como o navegador faz.
 */
function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    if (name in attrs) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/**
 * Monta a arvore do documento.
 *
 * Devolve sempre um elemento raiz, mesmo para HTML quebrado: a extracao nunca
 * precisa checar se o parser desistiu.
 */
export function parseHtml(input: string): HtmlElement {
  const html = input.length > MAX_HTML_BYTES ? input.slice(0, MAX_HTML_BYTES) : input;
  const root = createElement('#root', {}, null);
  let current = root;
  let index = 0;

  const pushText = (value: string): void => {
    if (value === '') return;
    current.children.push({ type: 'text', value, parent: current });
  };

  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      pushText(decodeEntities(html.slice(index)));
      break;
    }
    if (lt > index) pushText(decodeEntities(html.slice(index, lt)));

    // Comentario. Pode conter `<` e `>`, entao termina so no fechamento certo.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    // CDATA e doctype: nao sao conteudo nem estrutura que interesse.
    if (html.startsWith('<![', lt)) {
      const end = html.indexOf(']]>', lt + 3);
      index = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt + 2);
      index = end === -1 ? html.length : end + 1;
      continue;
    }

    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) {
      // `<` solto no fim do documento: texto, nao tag.
      pushText(decodeEntities(html.slice(lt)));
      break;
    }

    const inner = html.slice(lt + 1, gt);

    // Fechamento.
    if (inner.startsWith('/')) {
      const tag = inner.slice(1).trim().toLowerCase();
      if (tag !== '') {
        // Sobe ate a tag correspondente, se ela estiver aberta. Se nao
        // estiver, ignora: fechamento sem abertura nao deve esvaziar a pilha.
        let node: HtmlElement | null = current;
        while (node !== null && node.tag !== tag) node = node.parent;
        if (node?.parent) current = node.parent;
        else if (node === root) current = root;
      }
      index = gt + 1;
      continue;
    }

    const nameMatch = /^([a-zA-Z][a-zA-Z0-9:_-]*)/.exec(inner);
    if (!nameMatch?.[1]) {
      // `<` que nao comeca nome de tag (`a < b`): texto.
      pushText(decodeEntities(html.slice(lt, gt + 1)));
      index = gt + 1;
      continue;
    }

    const tag = nameMatch[1].toLowerCase();
    const selfClosing = inner.trimEnd().endsWith('/');
    const attrs = parseAttributes(inner.slice(nameMatch[1].length));

    // Fechamento implicito: `<p>um<p>dois`, `<li>a<li>b`.
    const closes = AUTO_CLOSE[current.tag];
    if (closes?.has(tag) && current.parent) current = current.parent;

    const element = createElement(tag, attrs, current);
    current.children.push(element);
    index = gt + 1;

    if (VOID_TAGS.has(tag) || selfClosing) continue;

    if (RAW_TEXT_TAGS.has(tag)) {
      // Conteudo bruto: procura so o fechamento desta tag, sem interpretar
      // nada no meio. E o que impede JavaScript do site de virar estrutura.
      const closePattern = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = html.slice(index);
      const close = closePattern.exec(rest);
      const raw = close ? rest.slice(0, close.index) : rest;
      if (raw !== '') {
        // Em `script` e `style` o texto nao e conteudo da pagina; mesmo assim
        // fica guardado porque JSON-LD vive dentro de `script`.
        element.children.push({ type: 'text', value: raw, parent: element });
      }
      index = close ? index + close.index + close[0].length : html.length;
      continue;
    }

    current = element;
  }

  return root;
}

// --------------------------------------------------------------- navegacao

export function isElement(node: HtmlNode): node is HtmlElement {
  return node.type === 'element';
}

/** Todos os elementos da arvore, em ordem de documento. */
export function* walk(node: HtmlElement): Generator<HtmlElement> {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    yield child;
    yield* walk(child);
  }
}

export function findAll(root: HtmlElement, tag: string): HtmlElement[] {
  const wanted = tag.toLowerCase();
  const found: HtmlElement[] = [];
  for (const element of walk(root)) {
    if (element.tag === wanted) found.push(element);
  }
  return found;
}

export function findFirst(root: HtmlElement, tag: string): HtmlElement | null {
  const wanted = tag.toLowerCase();
  for (const element of walk(root)) {
    if (element.tag === wanted) return element;
  }
  return null;
}

/** Tags cujo texto nao e conteudo que o leitor da pagina ve. */
const NON_CONTENT_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object']);

/**
 * Texto visivel de um elemento, com espacos colapsados.
 *
 * Insere espaco entre blocos para `<p>Um</p><p>Dois</p>` nao virar "UmDois" --
 * que depois seria extraido como uma frase que ninguem escreveu.
 */
export function textOf(node: HtmlNode): string {
  const parts: string[] = [];
  const collect = (current: HtmlNode): void => {
    if (current.type === 'text') {
      parts.push(current.value);
      return;
    }
    if (NON_CONTENT_TAGS.has(current.tag)) return;
    if (current.tag === 'br') {
      parts.push('\n');
      return;
    }
    const block = BLOCK_TAGS.has(current.tag);
    if (block) parts.push('\n');
    for (const child of current.children) collect(child);
    if (block) parts.push('\n');
  };
  collect(node);
  return normalizeSpace(parts.join(''));
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'tr', 'td', 'th', 'blockquote', 'pre', 'figure', 'figcaption',
  'form', 'fieldset', 'address', 'hr', 'details', 'summary',
]);

/**
 * Colapsa espacos sem juntar paragrafos.
 *
 * Quebra de linha sobrevive: e o unico sinal que separa um paragrafo do
 * seguinte depois que a marcacao sai.
 */
export function normalizeSpace(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Texto de um elemento numa linha so, para titulo e rotulo. */
export function inlineTextOf(node: HtmlNode): string {
  return textOf(node).replace(/\n+/g, ' ').trim();
}

/**
 * `true` quando o elemento esta dentro de uma das tags informadas.
 *
 * Usado para nao confundir o menu com o conteudo: um `<h2>` dentro de `<nav>`
 * e rotulo de navegacao, nao titulo de secao.
 */
export function isInside(element: HtmlElement, tags: readonly string[]): boolean {
  const wanted = new Set(tags.map((tag) => tag.toLowerCase()));
  let node = element.parent;
  while (node !== null) {
    if (wanted.has(node.tag)) return true;
    node = node.parent;
  }
  return false;
}

export function attr(element: HtmlElement, name: string): string {
  return element.attrs[name.toLowerCase()] ?? '';
}
