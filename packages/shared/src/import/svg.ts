/**
 * Higienizacao de SVG vindo de site de terceiro.
 *
 * ## Por que SVG e diferente de JPEG
 *
 * Um JPEG e um retangulo de pixels: o pior que um arquivo corrompido faz e
 * nao abrir. Um SVG e **um documento XML que o navegador executa**. Ele pode
 * conter `<script>`, manipuladores de evento (`onload`, `onclick`),
 * `<foreignObject>` com HTML dentro, `<use href="http://...">` que busca
 * conteudo de fora, e `<image>` apontando para qualquer lugar.
 *
 * Servir um SVG de origem desconhecida a partir do dominio do cliente e
 * publicar codigo de terceiro no proprio site -- um XSS armazenado, com a
 * confianca do dominio dele.
 *
 * ## A escolha: recusar tudo ou limpar
 *
 * Recusar e seguro e foi o que valia ate aqui, mas custa caro no caso mais
 * comum e mais inocente: **o logotipo**. Boa parte dos sites tem o logo em
 * SVG, e e exatamente a imagem que o cliente mais quer trazer.
 *
 * Entao limpa-se, por **lista de permissao**: o que nao estiver explicitamente
 * autorizado sai. Lista de bloqueio seria o caminho errado -- bastaria um
 * elemento novo no padrao, ou uma grafia que o filtro nao previu, para abrir
 * o buraco de volta.
 *
 * Quando a limpeza nao deixa desenho nenhum, ou o arquivo nem parece SVG, o
 * resultado e recusa, com o pedido de envio manual. Melhor nenhuma imagem do
 * que uma imagem que executa.
 */

/** Elementos de desenho que podem ficar. Tudo o mais e removido. */
const ELEMENTOS_PERMITIDOS = new Set([
  'svg', 'g', 'defs', 'symbol', 'title', 'desc', 'metadata',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath',
  'lineargradient', 'radialgradient', 'stop', 'pattern', 'clippath', 'mask',
  'filter', 'fegaussianblur', 'feoffset', 'feblend', 'femerge', 'femergenode',
  'fecolormatrix', 'fecomposite', 'feflood', 'fedropshadow',
  'marker', 'switch', 'style',
]);

/**
 * Elementos que saem **com o conteudo**, nao so com a tag.
 *
 * Em `<script>alert(1)</script>`, apagar so as tags deixaria `alert(1)` como
 * texto solto -- inofensivo num SVG, mas sujo. Em `<foreignObject>`, o
 * conteudo e HTML inteiro e precisa sumir junto.
 */
const ELEMENTOS_COM_CONTEUDO = new Set(['script', 'foreignobject', 'animate', 'set', 'handler']);

/** Atributos de apresentacao e geometria que podem ficar. */
const ATRIBUTOS_PERMITIDOS = new Set([
  'id', 'class', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'viewbox', 'points', 'transform', 'fill', 'fill-rule',
  'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'stroke-miterlimit',
  'opacity', 'style', 'offset', 'stop-color', 'stop-opacity', 'gradientunits',
  'gradienttransform', 'spreadmethod', 'patternunits', 'clip-path', 'clip-rule',
  'mask', 'filter', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'letter-spacing', 'xmlns', 'version',
  'preserveaspectratio', 'color', 'display', 'visibility', 'vector-effect',
  'stddeviation', 'in', 'in2', 'result', 'mode', 'type', 'values', 'dx', 'dy',
  'flood-color', 'flood-opacity', 'opacity',
]);

/**
 * Grafia canonica de nomes que o SVG exige com maiusculas.
 *
 * XML e sensivel a maiusculas, e SVG herda isso. A comparacao com a lista de
 * permissao e feita em minusculas -- para `viewBox` e `VIEWBOX` caírem no
 * mesmo lugar --, mas a **saida** precisa da grafia exata: um `viewbox`
 * minusculo nao e reconhecido pelo navegador, e a imagem perde o viewport e
 * renderiza no tamanho errado. Sem este mapa, toda imagem importada sairia
 * torta.
 */
const GRAFIA_CANONICA: Record<string, string> = {
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  spreadmethod: 'spreadMethod',
  patternunits: 'patternUnits',
  patterntransform: 'patternTransform',
  patterncontentunits: 'patternContentUnits',
  clippath: 'clipPath',
  clippathunits: 'clipPathUnits',
  maskunits: 'maskUnits',
  maskcontentunits: 'maskContentUnits',
  markerwidth: 'markerWidth',
  markerheight: 'markerHeight',
  markerunits: 'markerUnits',
  refx: 'refX',
  refy: 'refY',
  stddeviation: 'stdDeviation',
  filterunits: 'filterUnits',
  primitiveunits: 'primitiveUnits',
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  textpath: 'textPath',
  fegaussianblur: 'feGaussianBlur',
  feoffset: 'feOffset',
  feblend: 'feBlend',
  femerge: 'feMerge',
  femergenode: 'feMergeNode',
  fecolormatrix: 'feColorMatrix',
  fecomposite: 'feComposite',
  feflood: 'feFlood',
  fedropshadow: 'feDropShadow',
  textlength: 'textLength',
  lengthadjust: 'lengthAdjust',
  startoffset: 'startOffset',
};

/** Devolve a grafia que o SVG espera para um nome ja em minusculas. */
function canonico(nome: string): string {
  return GRAFIA_CANONICA[nome] ?? nome;
}

export type SvgRejection = 'nao_e_svg' | 'vazio_apos_limpeza' | 'grande_demais';

export type SvgSanitizeResult =
  | { ok: true; svg: string; removed: string[] }
  | { ok: false; reason: SvgRejection; message: string };

/** Teto do arquivo. SVG de logotipo tem alguns KB; megabytes sao outra coisa. */
const MAX_BYTES = 512 * 1024;

/**
 * Limpa um SVG, ou recusa.
 *
 * Trabalha sobre o texto, sem montar DOM: nao ha DOM aqui, e trazer um
 * analisador de XML completo para isto seria uma dependencia nova com
 * superficie propria. A varredura cobre as formas que importam -- tag,
 * atributo, URL embutida -- e tudo o que nao for reconhecido e removido.
 */
export function sanitizeSvg(texto: string): SvgSanitizeResult {
  if (texto.length > MAX_BYTES) {
    return {
      ok: false,
      reason: 'grande_demais',
      message: 'Esse arquivo SVG é maior do que o limite aceito para limpeza automática.',
    };
  }

  if (!/<svg[\s>]/i.test(texto)) {
    return { ok: false, reason: 'nao_e_svg', message: 'O arquivo não é um SVG válido.' };
  }

  const removidos = new Set<string>();
  let limpo = texto;

  // Comentarios e instrucoes de processamento: nunca sao desenho.
  limpo = limpo.replace(/<!--[\s\S]*?-->/g, '');
  limpo = limpo.replace(/<\?[\s\S]*?\?>/g, '');
  limpo = limpo.replace(/<!DOCTYPE[\s\S]*?>/gi, (achado) => {
    // DOCTYPE pode declarar entidades -- a porta para o ataque de expansao.
    removidos.add('doctype');
    void achado;
    return '';
  });

  // Elementos que saem com o conteudo junto.
  for (const nome of ELEMENTOS_COM_CONTEUDO) {
    const comConteudo = new RegExp(`<${nome}\\b[\\s\\S]*?<\\/${nome}\\s*>`, 'gi');
    limpo = limpo.replace(comConteudo, () => {
      removidos.add(nome);
      return '';
    });
    const sozinho = new RegExp(`<${nome}\\b[^>]*\\/?>`, 'gi');
    limpo = limpo.replace(sozinho, () => {
      removidos.add(nome);
      return '';
    });
  }

  /**
   * Varredura das tags restantes.
   *
   * Cada tag e reconstruida do zero com o que sobrou da lista de permissao --
   * em vez de recortar o que incomoda. Reconstruir e o que garante que nada
   * nao previsto atravesse: o que nao for copiado, nao existe na saida.
   */
  limpo = limpo.replace(/<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (todo, nomeBruto: string, atributosBrutos: string) => {
    const nome = nomeBruto.toLowerCase().replace(/^svg:/, '');
    if (!ELEMENTOS_PERMITIDOS.has(nome)) {
      removidos.add(nome);
      return '';
    }
    if (todo.startsWith('</')) return `</${canonico(nome)}>`;

    const mantidos: string[] = [];
    for (const atributo of atributosBrutos.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      const chave = (atributo[1] ?? '').toLowerCase().replace(/^svg:/, '');
      const valor = atributo[3] ?? atributo[4] ?? '';

      // Manipulador de evento: a forma mais direta de executar codigo.
      if (chave.startsWith('on')) {
        removidos.add(chave);
        continue;
      }
      if (!ATRIBUTOS_PERMITIDOS.has(chave)) {
        removidos.add(chave);
        continue;
      }
      // `style` pode esconder `url(javascript:...)` e `@import`.
      if (chave === 'style' && /url\s*\(|expression|@import|javascript:/i.test(valor)) {
        removidos.add('style');
        continue;
      }
      if (/javascript:|data:text\/html|&#/i.test(valor)) {
        removidos.add(chave);
        continue;
      }
      /**
       * `url(...)` so pode apontar para dentro do proprio arquivo.
       *
       * `fill="url(#gradiente)"` e desenho e fica. `fill="url(https://...)"`
       * faz o navegador de quem visita o site buscar um recurso de fora --
       * entrega o IP do visitante a um terceiro e serve de canal para
       * rastreamento. A regra vale para qualquer atributo, nao so `style`.
       */
      if (/url\s*\(/i.test(valor) && !/^[^(]*url\s*\(\s*['"]?#/i.test(valor)) {
        removidos.add(chave);
        continue;
      }

      mantidos.push(`${canonico(chave)}="${escaparAtributo(valor)}"`);
    }

    const fecha = todo.endsWith('/>') ? ' /' : '';
    return `<${canonico(nome)}${mantidos.length > 0 ? ` ${mantidos.join(' ')}` : ''}${fecha}>`;
  });

  // `<style>` sobrevive como elemento, mas o conteudo dele passa pelo mesmo crivo.
  limpo = limpo.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_todo, css: string) => {
    if (/@import|javascript:|expression|url\s*\(\s*["']?\s*(?!#)/i.test(css)) {
      removidos.add('style');
      return '';
    }
    return `<style>${css}</style>`;
  });

  const temDesenho = /<(path|rect|circle|ellipse|line|polyline|polygon|text|use|image|g)\b/i.test(limpo);
  if (!temDesenho) {
    return {
      ok: false,
      reason: 'vazio_apos_limpeza',
      message:
        'Esse SVG não pôde ser importado com segurança: depois de remover o conteúdo ativo, '
        + 'não sobrou desenho. Envie o arquivo pela Biblioteca de imagens.',
    };
  }

  return { ok: true, svg: limpo.trim(), removed: [...removidos].sort() };
}

function escaparAtributo(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
