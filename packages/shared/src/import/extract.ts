import { BRAZIL_STATES, SOCIAL_NETWORKS, type SocialNetwork } from '../constants.js';
import {
  attr,
  findAll,
  findFirst,
  inlineTextOf,
  isInside,
  normalizeSpace,
  parseHtml,
  isHidden,
  textOf,
  walk,
  type HtmlElement,
} from './html.js';
import { canonicalPageUrl, resolveInternalLink, stripWww } from './url.js';
import { extractEmbeddedState, harvestEmbedded } from './embedded.js';
import { PAGE_ROLES, type PageRole } from './types.js';

/**
 * Leitura de uma pagina: o que esta escrito nela, e de onde.
 *
 * Esta camada **nao decide** de que modulo cada coisa e -- isso e
 * `mapping.ts`. Aqui so se recolhe o que a pagina declara, em bruto e com a
 * origem anotada. A separacao importa porque a regra do produto e nao inventar
 * dado: se a extracao ja adivinhasse o destino, nao haveria como auditar de
 * onde um valor veio.
 */

export interface ExtractedImage {
  url: string;
  alt: string;
  /** Dimensao declarada no HTML, quando houver. A real so se sabe ao baixar. */
  width: number | null;
  height: number | null;
  /** Onde a imagem apareceu: decide se e banner, logo ou foto de conteudo. */
  placement: 'logo' | 'banner' | 'conteudo' | 'equipe' | 'galeria' | 'icone';
  /** Texto proximo da imagem, usado como legenda candidata. */
  caption: string;
}

export interface ExtractedLink {
  url: string;
  text: string;
}

export interface ExtractedHeading {
  level: number;
  text: string;
}

/** Bloco de texto com o cabecalho que o antecede. */
export interface ExtractedBlock {
  heading: string;
  headingLevel: number;
  paragraphs: string[];
  items: string[];
}

export interface ExtractedContact {
  emails: string[];
  phones: string[];
  whatsapp: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  businessHours: string;
  mapUrl: string;
  social: Partial<Record<SocialNetwork, string>>;
}

export interface ExtractedFaq {
  question: string;
  answer: string;
}

export interface PageExtract {
  url: string;
  lang: string;
  title: string;
  metaDescription: string;
  canonical: string;
  og: { title: string; description: string; image: string; siteName: string; type: string };
  /** Objetos JSON-LD achados na pagina, ja analisados. */
  jsonLd: Record<string, unknown>[];
  headings: ExtractedHeading[];
  blocks: ExtractedBlock[];
  paragraphs: string[];
  images: ExtractedImage[];
  links: ExtractedLink[];
  contact: ExtractedContact;
  faqs: ExtractedFaq[];
  quotes: { text: string; author: string; role: string }[];
  people: { name: string; role: string; photo: string; bio: string }[];
  role: PageRole;
  textLength: number;
  /** HTML quase sem texto: o conteudo provavelmente entra por JavaScript. */
  renderedByScript: boolean;
  /**
   * Conteudo veio do estado serializado que o framework deixou no HTML.
   *
   * Importa para a tela: um resultado vindo daqui e legitimo, mas costuma vir
   * sem a estrutura de titulos e secoes que a leitura normal da -- e por isso
   * merece revisao mais atenta de quem confirma.
   */
  fromEmbeddedState?: boolean;
  /** Pagina lida depois de um navegador montar o conteudo. */
  renderedWithBrowser?: boolean;
  /** Ano de fundacao, so quando a pagina diz explicitamente. */
  foundedYear: number | null;
}

// ------------------------------------------------------------- utilitarios

const MAX_PARAGRAPHS = 60;
const MAX_IMAGES_PER_PAGE = 60;
const MAX_LINKS = 200;

/**
 * `true` quando o texto parece conteudo e nao rotulo de interface.
 *
 * Frases de uma palavra ("Enviar", "Menu", "Saiba mais") sao botao, nao
 * conteudo. O limite baixo e deliberado: perder um texto curto de verdade
 * custa um campo vazio que a pessoa preenche; aceitar rotulo de botao como
 * descricao da empresa custa um painel cheio de lixo.
 */
function looksLikeContent(text: string, minLength = 40): boolean {
  const clean = text.trim();
  if (clean.length < minLength) return false;
  // Precisa de pelo menos um espaco e uma vogal: descarta hash e identificador.
  if (!/\s/.test(clean)) return false;
  if (!/[aeiouáéíóúâêôãõà]/i.test(clean)) return false;
  return true;
}

/** Tags que nunca carregam conteudo da empresa. */
const CHROME_TAGS = ['nav', 'header', 'footer', 'aside', 'form', 'button', 'select'] as const;

// ------------------------------------------------------------- JSON-LD

/**
 * Le os blocos `application/ld+json`.
 *
 * E a melhor fonte quando existe: o site declarou os dados em vez de a gente
 * deduzir do texto. Tolerante a JSON invalido porque gerador de site publica
 * JSON-LD quebrado com frequencia, e um bloco ruim nao deve derrubar a leitura
 * da pagina inteira.
 */
function extractJsonLd(root: HtmlElement): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (const script of findAll(root, 'script')) {
    const type = attr(script, 'type').toLowerCase();
    if (!type.includes('ld+json')) continue;
    const raw = script.children
      .map((child) => (child.type === 'text' ? child.value : ''))
      .join('')
      .trim();
    if (raw === '' || raw.length > 512 * 1024) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    collectJsonLd(parsed, found, 0);
  }
  return found.slice(0, 50);
}

/** Achata `@graph` e arrays, que e como a maioria dos sites publica. */
function collectJsonLd(value: unknown, target: Record<string, unknown>[], depth: number): void {
  if (depth > 6 || target.length >= 50) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLd(item, target, depth + 1);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record['@graph'])) {
    collectJsonLd(record['@graph'], target, depth + 1);
    return;
  }
  target.push(record);
}

/** `true` quando o objeto JSON-LD e de um dos tipos informados. */
export function jsonLdIsType(node: Record<string, unknown>, ...types: string[]): boolean {
  const raw = node['@type'];
  const list = Array.isArray(raw) ? raw : [raw];
  const wanted = types.map((type) => type.toLowerCase());
  return list.some(
    (item) => typeof item === 'string' && wanted.includes(item.toLowerCase()),
  );
}

export function jsonLdString(node: Record<string, unknown>, key: string): string {
  const value = node[key];
  if (typeof value === 'string') return normalizeSpace(value);
  if (typeof value === 'number') return String(value);
  // `{ "@value": "..." }` e `{ "name": "..." }` aparecem em campos aninhados.
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const inner = value as Record<string, unknown>;
    for (const candidate of ['@value', 'name', 'url', 'text']) {
      const nested = inner[candidate];
      if (typeof nested === 'string') return normalizeSpace(nested);
    }
  }
  return '';
}

// ------------------------------------------------------------- contato

/**
 * Telefones brasileiros no texto.
 *
 * Reconhece com e sem DDI, com e sem parenteses, fixo e celular, e 0800. A
 * conferencia final e pela quantidade de digitos -- 10 ou 11 com DDD, 11 com
 * DDI, 11 para 0800 -- porque formato e o que mais varia entre sites.
 */
export function extractPhones(text: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?(?:9?\d{4})[\s.-]?\d{4}/g;
  const matches = text.match(pattern) ?? [];
  for (const raw of matches) {
    const digits = raw.replace(/\D+/g, '');
    const semDdi = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
    if (semDdi.length !== 10 && semDdi.length !== 11) continue;
    // DDD brasileiro vai de 11 a 99; nenhum comeca com 0 ou 1 no segundo digito
    // alem de 11..19, e nenhum e 10, 20, 23, 25, 26, 29...
    const ddd = Number(semDdi.slice(0, 2));
    if (ddd < 11 || ddd > 99) continue;
    // Celular tem 9 no comeco do numero; fixo comeca de 2 a 5.
    const primeiro = semDdi[2];
    if (semDdi.length === 11 && primeiro !== '9') continue;
    if (semDdi.length === 10 && !/[2-5]/.test(primeiro ?? '')) continue;
    found.add(formatPhone(semDdi));
    if (found.size >= 8) break;
  }

  // 0800 nao tem DDD e nao casa com o padrao acima.
  for (const raw of text.match(/0800[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? []) {
    const digits = raw.replace(/\D+/g, '');
    if (digits.length === 11) found.add(`0800 ${digits.slice(4, 7)} ${digits.slice(7)}`);
  }

  return [...found];
}

function formatPhone(digits: string): string {
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const split = rest.length === 9 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/**
 * E-mails no texto.
 *
 * Filtra o que parece e-mail mas nao e contato: endereco de exemplo, chave de
 * monitoramento (`...@sentry.io`) e nome de arquivo com `@2x`.
 */
export function extractEmails(text: string): string[] {
  const found = new Set<string>();
  const pattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
  for (const raw of text.match(pattern) ?? []) {
    const email = raw.toLowerCase();
    if (email.length > 254) continue;
    if (/@(sentry\.io|example\.(com|org)|dominio\.com|seudominio|email\.com)$/.test(email)) continue;
    if (/^(info|email|seu-?email|nome)@(email|exemplo|example|dominio)/.test(email)) continue;
    if (/@\d+x\./.test(email)) continue;
    // Extensao plausivel: descarta `arquivo@2x.png` e `fonte@font.woff2`.
    if (!/\.[a-z]{2,24}$/.test(email)) continue;
    if (/\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ttf|eot)$/.test(email)) continue;
    found.add(email);
    if (found.size >= 8) break;
  }
  return [...found];
}

/** CEP no formato brasileiro. */
export function extractPostalCode(text: string): string {
  const match = /\b(\d{5})-?(\d{3})\b/.exec(text);
  if (!match) return '';
  return `${match[1]}-${match[2]}`;
}

/**
 * Cidade e estado a partir de "Cidade - UF" ou "Cidade/UF".
 *
 * So aceita sigla que existe (`BRAZIL_STATES`): sem isso, "Atendimento - 24h"
 * entraria como cidade "Atendimento", estado "24".
 */
export function extractCityState(text: string): { city: string; state: string } {
  /**
   * A cidade e a sequencia de palavras capitalizadas imediatamente antes da
   * sigla, com as preposicoes que nomes de cidade de fato usam ("Sao Jose dos
   * Campos", "Santa Barbara d'Oeste").
   *
   * Aceitar qualquer palavra antes da sigla transformaria "Atendemos em
   * Curitiba - PR" na cidade "Atendemos em Curitiba": a frase do site entraria
   * no campo de cidade do painel.
   */
  const inicial = '[A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ]';
  const palavra = `${inicial}[\\p{L}'.-]*`;
  const ligacao = "(?:de|do|da|dos|das|e|d')";
  const pattern = new RegExp(
    `(${palavra}(?:\\s+(?:${ligacao}\\s+)?${palavra}){0,4})\\s*[-/–]\\s*([A-Z]{2})\\b`,
    'gu',
  );
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const uf = (match[2] ?? '').toUpperCase();
    if (!(BRAZIL_STATES as readonly string[]).includes(uf)) continue;
    const city = normalizeSpace(match[1] ?? '').replace(/[,;.]+$/, '');
    if (city.length < 2 || city.length > 60) continue;
    // Palavra que nao e nome de cidade e aparece antes de sigla em rodape.
    if (/^(cep|fone|tel|whatsapp|endereco|endereço|rua|av|avenida|nº|n°)$/i.test(city)) continue;
    return { city, state: uf };
  }
  return { city: '', state: '' };
}

/**
 * Logradouro com numero.
 *
 * Exige o tipo de via no comeco e numero depois: "Rua das Flores, 123". Sem a
 * exigencia do numero, qualquer frase que comece com "Rua" entraria.
 */
export function extractAddressLine(text: string): string {
  const pattern = /((?:rua|avenida|av\.?|alameda|al\.?|travessa|rodovia|rod\.?|estrada|praça|praca|largo|quadra|via|viela|servidão|servidao)\s+[\p{L}0-9'.ºª\s-]{3,70}?,?\s*(?:n[ºo°.]?\s*)?\d{1,6}[^\n,;]{0,40})/giu;
  const match = pattern.exec(text);
  if (!match?.[1]) return '';
  return normalizeSpace(match[1]).replace(/[,;.\s]+$/, '').slice(0, 240);
}

/**
 * Horario de atendimento.
 *
 * Procura a linha que junta um dia da semana e uma hora. Devolve a frase
 * inteira, nao os pedacos: "Seg a sex, 8h as 18h" e informacao util do jeito
 * que o site escreveu, e normalizar isso seria reescrever o que a empresa diz.
 */
export function extractBusinessHours(text: string): string {
  const linhas = text.split('\n');
  const dia = /(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo|seg\b|ter\b|qua\b|qui\b|sex\b|sáb\b|sab\b|dom\b|dias? úteis|dias? uteis)/i;
  const hora = /(\d{1,2}\s*[h:]\s*\d{0,2})/;
  for (const linha of linhas) {
    const clean = normalizeSpace(linha);
    if (clean.length < 8 || clean.length > 240) continue;
    if (!dia.test(clean) || !hora.test(clean)) continue;
    return clean;
  }
  return '';
}

/** Rede social a que um endereco pertence. */
export function socialNetworkOf(url: string): SocialNetwork | null {
  let host: string;
  try {
    host = stripWww(new URL(url).hostname);
  } catch {
    return null;
  }
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 'facebook.com' || host === 'fb.com' || host.endsWith('.facebook.com')) return 'facebook';
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin';
  if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) return 'youtube';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'x';
  return null;
}

/** Numero de WhatsApp a partir de um link `wa.me` ou `api.whatsapp.com`. */
export function whatsappFromHref(href: string): string {
  const digits = /(?:wa\.me\/|whatsapp\.com\/send\/?\?phone=|phone=)(\+?\d{10,15})/i.exec(href);
  if (digits?.[1]) {
    const only = digits[1].replace(/\D+/g, '');
    const semDdi = only.startsWith('55') && only.length >= 12 ? only.slice(2) : only;
    if (semDdi.length === 10 || semDdi.length === 11) return formatPhone(semDdi);
  }
  if (/^whatsapp:/i.test(href)) {
    const only = href.replace(/\D+/g, '');
    const semDdi = only.startsWith('55') && only.length >= 12 ? only.slice(2) : only;
    if (semDdi.length === 10 || semDdi.length === 11) return formatPhone(semDdi);
  }
  return '';
}

// ------------------------------------------------------------- imagens

/**
 * Escolhe a maior imagem declarada num `srcset`.
 *
 * O site publica varias larguras da mesma foto; trazer a de 320 px para a
 * biblioteca jogaria fora a qualidade que o cliente ja tem -- e a exigencia e
 * preservar a qualidade original sempre que possivel.
 */
export function pickFromSrcset(srcset: string, base: string): string {
  const candidatos: { url: string; weight: number }[] = [];
  for (const parte of srcset.split(',')) {
    const trimmed = parte.trim();
    if (trimmed === '') continue;
    const [url, descriptor] = trimmed.split(/\s+/, 2);
    if (!url) continue;
    let weight = 1;
    if (descriptor) {
      const largura = /^(\d+(?:\.\d+)?)w$/.exec(descriptor);
      const densidade = /^(\d+(?:\.\d+)?)x$/.exec(descriptor);
      if (largura?.[1]) weight = Number(largura[1]);
      else if (densidade?.[1]) weight = Number(densidade[1]) * 1000;
    }
    try {
      candidatos.push({ url: new URL(url, base).toString(), weight });
    } catch {
      continue;
    }
  }
  if (candidatos.length === 0) return '';
  candidatos.sort((a, b) => b.weight - a.weight);
  return candidatos[0]?.url ?? '';
}

/** Para que serve a imagem, pelo lugar em que ela aparece. */
function placementOf(image: HtmlElement, url: string, alt: string): ExtractedImage['placement'] {
  const classes = `${attr(image, 'class')} ${attr(image, 'id')}`.toLowerCase();
  const caminho = url.toLowerCase();
  const texto = `${classes} ${caminho} ${alt.toLowerCase()}`;

  if (/\b(logo|logotipo|brand|marca)\b/.test(texto)) return 'logo';
  if (/\b(icon|icone|ícone|favicon|sprite|arrow|seta|bullet)\b/.test(texto)) return 'icone';
  if (isInside(image, ['header']) && /logo|marca/.test(texto)) return 'logo';
  if (/\b(banner|hero|slide|slider|carousel|carrossel|destaque|capa|cover)\b/.test(texto)) return 'banner';
  if (/\b(equipe|team|staff|socio|sócio|medico|médico|profissional|colaborador)\b/.test(texto)) return 'equipe';
  if (/\b(galeria|gallery|portfolio|portfólio|album|álbum|obra)\b/.test(texto)) return 'galeria';
  return 'conteudo';
}

/** Dimensao declarada no atributo, quando e um numero plausivel. */
function declaredSize(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 20_000) return null;
  return parsed;
}

/**
 * Imagens da pagina, com o endereco ja absoluto.
 *
 * Le `src`, `srcset`, e os atributos de carregamento preguicoso
 * (`data-src`, `data-lazy-src`): num site com lazy loading o `src` real so
 * aparece nesses, e sem eles a importacao traria a imagem de espera.
 */
function extractImages(root: HtmlElement, pageUrl: string): ExtractedImage[] {
  const found: ExtractedImage[] = [];
  const seen = new Set<string>();

  const register = (url: string, alt: string, placement: ExtractedImage['placement'], element: HtmlElement | null): void => {
    if (url === '' || seen.has(url)) return;
    // Imagem de modal fechado ou de aba inativa nao esta no site que o
    // visitante ve, e nao deve entrar na biblioteca do cliente.
    if (element !== null && isHidden(element)) return;
    // `data:` nao e arquivo no site do cliente, e nao vale importar.
    if (/^data:/i.test(url)) return;
    seen.add(url);
    found.push({
      url,
      alt: normalizeSpace(alt).slice(0, 240),
      width: element ? declaredSize(attr(element, 'width')) : null,
      height: element ? declaredSize(attr(element, 'height')) : null,
      placement,
      caption: element ? captionNear(element) : '',
    });
  };

  for (const image of findAll(root, 'img')) {
    if (found.length >= MAX_IMAGES_PER_PAGE) break;
    const srcset = attr(image, 'srcset') || attr(image, 'data-srcset');
    const direto =
      attr(image, 'src')
      || attr(image, 'data-src')
      || attr(image, 'data-lazy-src')
      || attr(image, 'data-original')
      || attr(image, 'data-image');

    let url = '';
    if (srcset !== '') url = pickFromSrcset(srcset, pageUrl);
    if (url === '' && direto !== '') {
      try {
        url = new URL(direto, pageUrl).toString();
      } catch {
        url = '';
      }
    }
    const alt = attr(image, 'alt');
    register(url, alt, placementOf(image, url, alt), image);
  }

  // `<source>` dentro de `<picture>`: traz formatos melhores (avif, webp).
  for (const source of findAll(root, 'source')) {
    if (found.length >= MAX_IMAGES_PER_PAGE) break;
    const srcset = attr(source, 'srcset');
    if (srcset === '') continue;
    const url = pickFromSrcset(srcset, pageUrl);
    register(url, '', placementOf(source, url, ''), source);
  }

  return found;
}

/** Legenda proxima a imagem: `figcaption`, ou o `alt`/`title` quando nao houver. */
function captionNear(image: HtmlElement): string {
  let node = image.parent;
  let depth = 0;
  while (node !== null && depth < 3) {
    if (node.tag === 'figure') {
      const caption = findFirst(node, 'figcaption');
      if (caption) return inlineTextOf(caption).slice(0, 240);
    }
    node = node.parent;
    depth += 1;
  }
  return normalizeSpace(attr(image, 'title')).slice(0, 240);
}

// ------------------------------------------------------------- estrutura

/**
 * Blocos de conteudo: um cabecalho e o texto que vem sob ele.
 *
 * E a estrutura que permite separar titulo de descricao sem adivinhar. Um
 * `<h2>Instalacao eletrica</h2><p>Projeto e execucao...</p>` e um servico com
 * titulo e resumo; a mesma informacao num paragrafo solto nao e.
 */
function extractBlocks(root: HtmlElement): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  let current: ExtractedBlock | null = null;

  for (const element of walk(root)) {
    // Texto que ninguem ve nao e conteudo do site. Ver `isHidden`.
    if (isHidden(element)) continue;

    const heading = /^h([1-6])$/.exec(element.tag);
    if (heading?.[1]) {
      // Cabecalho de menu ou rodape nao abre secao de conteudo.
      if (isInside(element, CHROME_TAGS)) continue;
      const text = inlineTextOf(element);
      if (text === '' || text.length > 200) continue;
      current = { heading: text, headingLevel: Number(heading[1]), paragraphs: [], items: [] };
      blocks.push(current);
      continue;
    }

    if (element.tag === 'p' || element.tag === 'blockquote') {
      if (isInside(element, CHROME_TAGS)) continue;
      const text = inlineTextOf(element);
      if (!looksLikeContent(text, 25)) continue;
      if (current) {
        if (current.paragraphs.length < 12) current.paragraphs.push(text.slice(0, 5000));
      }
      continue;
    }

    if (element.tag === 'li') {
      if (isInside(element, CHROME_TAGS)) continue;
      // `li` com link e so link e item de menu, nao conteudo.
      const links = findAll(element, 'a');
      const text = inlineTextOf(element);
      if (text === '' || text.length > 400) continue;
      if (links.length > 0 && inlineTextOf(links[0]!).length >= text.length - 2) continue;
      if (current && current.items.length < 40) current.items.push(text);
      continue;
    }
  }

  return blocks.filter((block) => block.paragraphs.length > 0 || block.items.length > 0 || block.heading !== '');
}

/**
 * Perguntas e respostas.
 *
 * Duas fontes, na ordem de confianca: o `FAQPage` do Schema.org, que o site
 * declarou, e o padrao visual `<details><summary>`, que e um acordeao de
 * perguntas. Deduzir FAQ de "texto que termina com ?" produziria pergunta sem
 * resposta, que nao serve para nada no painel.
 */
function extractFaqs(root: HtmlElement, jsonLd: Record<string, unknown>[]): ExtractedFaq[] {
  const found: ExtractedFaq[] = [];

  for (const node of jsonLd) {
    if (!jsonLdIsType(node, 'FAQPage')) continue;
    const entities = node['mainEntity'];
    const list = Array.isArray(entities) ? entities : [entities];
    for (const item of list) {
      if (item === null || typeof item !== 'object') continue;
      const question = jsonLdString(item as Record<string, unknown>, 'name');
      const answerRaw = (item as Record<string, unknown>)['acceptedAnswer'];
      const answer =
        answerRaw !== null && typeof answerRaw === 'object'
          ? jsonLdString(answerRaw as Record<string, unknown>, 'text')
          : '';
      if (question === '' || answer === '') continue;
      found.push({ question: question.slice(0, 300), answer: stripTags(answer).slice(0, 5000) });
    }
  }

  for (const details of findAll(root, 'details')) {
    if (found.length >= 40) break;
    const summary = findFirst(details, 'summary');
    if (!summary) continue;
    const question = inlineTextOf(summary);
    // Texto do `details` menos o do `summary`: o que sobra e a resposta.
    const full = textOf(details);
    const answer = normalizeSpace(full.startsWith(question) ? full.slice(question.length) : full);
    if (question.length < 5 || answer.length < 5) continue;
    found.push({ question: question.slice(0, 300), answer: answer.slice(0, 5000) });
  }

  return dedupeBy(found, (faq) => faq.question.toLowerCase()).slice(0, 40);
}

/** Remove marcacao de um texto que veio dentro de JSON. */
function stripTags(input: string): string {
  return normalizeSpace(input.replace(/<[^>]*>/g, ' '));
}

/**
 * Depoimentos.
 *
 * `Review` do Schema.org primeiro. Depois `<blockquote>` com autor, e o padrao
 * de classe (`testimonial`, `depoimento`) que quase todo tema usa. Um texto
 * entre aspas sem autor nao vira depoimento: o modulo exige o nome de quem
 * disse, e inventar autor seria atribuir fala a alguem.
 */
function extractQuotes(
  root: HtmlElement,
  jsonLd: Record<string, unknown>[],
): { text: string; author: string; role: string }[] {
  const found: { text: string; author: string; role: string }[] = [];

  for (const node of jsonLd) {
    if (!jsonLdIsType(node, 'Review')) continue;
    const text = jsonLdString(node, 'reviewBody') || jsonLdString(node, 'description');
    const authorRaw = node['author'];
    const author =
      authorRaw !== null && typeof authorRaw === 'object'
        ? jsonLdString(authorRaw as Record<string, unknown>, 'name')
        : jsonLdString(node, 'author');
    if (text.length < 20 || author === '') continue;
    found.push({ text: text.slice(0, 3000), author: author.slice(0, 120), role: '' });
  }

  for (const quote of findAll(root, 'blockquote')) {
    if (found.length >= 30) break;
    const cite = findFirst(quote, 'cite') ?? findFirst(quote, 'footer');
    const full = textOf(quote);
    const author = cite ? inlineTextOf(cite) : '';
    const text = normalizeSpace(author !== '' ? full.replace(author, '') : full);
    if (text.length < 20 || author === '') continue;
    found.push({ text: text.slice(0, 3000), author: author.replace(/^[—–-]\s*/, '').slice(0, 120), role: '' });
  }

  for (const element of walk(root)) {
    if (found.length >= 30) break;
    const marker = `${attr(element, 'class')} ${attr(element, 'id')}`.toLowerCase();
    if (!/\b(testimonial|depoimento|avaliacao|avaliação|review)\b/.test(marker)) continue;
    if (findFirst(element, 'blockquote')) continue;
    const paragraphs = findAll(element, 'p').map((p) => inlineTextOf(p)).filter((t) => t !== '');
    if (paragraphs.length < 2) continue;
    const [first, ...rest] = paragraphs;
    // O texto mais longo e o depoimento; o mais curto, o nome.
    const corpo = [first, ...rest].reduce((a, b) => (a.length >= b.length ? a : b), '');
    const autor = [first, ...rest].filter((t) => t !== corpo).reduce((a, b) => (a.length <= b.length ? a : b), '');
    if (corpo.length < 20 || autor === '' || autor.length > 120) continue;
    found.push({ text: corpo.slice(0, 3000), author: autor, role: '' });
  }

  return dedupeBy(found, (quote) => quote.text.slice(0, 120).toLowerCase()).slice(0, 30);
}

/**
 * Pessoas da equipe.
 *
 * `Person` do Schema.org, e o padrao visual de cartao: foto, nome em
 * cabecalho, cargo logo abaixo. Exige nome **e** (cargo ou foto) para nao
 * transformar qualquer nome proprio da pagina em membro da equipe.
 */
function extractPeople(
  root: HtmlElement,
  pageUrl: string,
  jsonLd: Record<string, unknown>[],
): { name: string; role: string; photo: string; bio: string }[] {
  const found: { name: string; role: string; photo: string; bio: string }[] = [];

  for (const node of jsonLd) {
    if (!jsonLdIsType(node, 'Person')) continue;
    const name = jsonLdString(node, 'name');
    if (name === '' || name.length > 120) continue;
    const image = jsonLdString(node, 'image');
    let photo = '';
    if (image !== '') {
      try {
        photo = new URL(image, pageUrl).toString();
      } catch {
        photo = '';
      }
    }
    found.push({
      name,
      role: jsonLdString(node, 'jobTitle').slice(0, 120),
      photo,
      bio: jsonLdString(node, 'description').slice(0, 2000),
    });
  }

  for (const element of walk(root)) {
    if (found.length >= 30) break;
    const marker = `${attr(element, 'class')} ${attr(element, 'id')}`.toLowerCase();
    if (!/\b(team|equipe|member|membro|staff|profissional|socio|sócio)\b/.test(marker)) continue;

    const image = findFirst(element, 'img');
    const heading = ['h2', 'h3', 'h4', 'h5', 'h6']
      .map((tag) => findFirst(element, tag))
      .find((node) => node !== null);
    const name = heading ? inlineTextOf(heading) : '';
    if (name === '' || name.length > 120) continue;
    if (!/\p{Lu}/u.test(name)) continue;

    const paragraphs = findAll(element, 'p').map((p) => inlineTextOf(p)).filter((t) => t !== '');
    const role = paragraphs.find((t) => t.length <= 80) ?? '';
    const bio = paragraphs.find((t) => t.length > 80) ?? '';
    let photo = '';
    if (image) {
      const src = attr(image, 'src') || attr(image, 'data-src');
      if (src !== '') {
        try {
          photo = new URL(src, pageUrl).toString();
        } catch {
          photo = '';
        }
      }
    }
    if (role === '' && photo === '') continue;
    found.push({ name, role: role.slice(0, 120), photo, bio: bio.slice(0, 2000) });
  }

  return dedupeBy(found, (person) => person.name.toLowerCase()).slice(0, 30);
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result;
}

// ------------------------------------------------------------- papel

/**
 * Palavras que identificam o proposito de uma pagina, por endereco e titulo.
 *
 * A ordem importa: `/nossos-servicos` casa com `servicos`, e se `sobre`
 * viesse primeiro `/sobre-nossos-servicos` iria para o lugar errado. As
 * entradas mais especificas vem antes.
 */
const ROLE_HINTS: readonly { role: PageRole; words: readonly string[] }[] = [
  { role: 'faq', words: ['faq', 'perguntas-frequentes', 'perguntas frequentes', 'duvidas', 'dúvidas', 'perguntas'] },
  { role: 'depoimentos', words: ['depoimentos', 'testimonials', 'avaliacoes', 'avaliações', 'o-que-dizem'] },
  { role: 'equipe', words: ['equipe', 'team', 'nossa-equipe', 'nossos-profissionais', 'corpo-clinico', 'quem-faz', 'socios', 'sócios'] },
  { role: 'imoveis', words: ['imoveis', 'imóveis', 'imovel', 'imóvel', 'aluguel', 'venda-de-imoveis', 'lancamentos', 'lançamentos'] },
  { role: 'portfolio', words: ['portfolio', 'portfólio', 'obras', 'projetos', 'cases', 'trabalhos', 'empreendimentos'] },
  { role: 'galeria', words: ['galeria', 'gallery', 'fotos', 'album', 'álbum', 'antes-e-depois'] },
  { role: 'produtos', words: ['produtos', 'produto', 'loja', 'catalogo', 'catálogo', 'cardapio', 'cardápio', 'menu-do-dia', 'shop'] },
  { role: 'servicos', words: ['servicos', 'serviços', 'servico', 'serviço', 'especialidades', 'tratamentos', 'procedimentos', 'solucoes', 'soluções', 'o-que-fazemos'] },
  { role: 'contato', words: ['contato', 'contact', 'fale-conosco', 'onde-estamos', 'localizacao', 'localização', 'atendimento', 'agende', 'orcamento', 'orçamento'] },
  { role: 'sobre', words: ['sobre', 'about', 'quem-somos', 'quem somos', 'a-empresa', 'institucional', 'nossa-historia', 'nossa história', 'historia', 'história', 'missao', 'missão'] },
];

/**
 * Para que serve a pagina.
 *
 * Decide pelo endereco primeiro -- `/quem-somos` e uma declaracao do proprio
 * site -- e cai no titulo e nos cabecalhos quando o endereco nao diz nada
 * (`/pagina-2`, `/p/37`). Quando nenhum dos tres indica, devolve `outra`, e o
 * texto daquela pagina nao e atribuido a modulo nenhum.
 */
export function classifyPage(input: {
  url: string;
  homeUrl: string;
  title: string;
  headings: readonly string[];
}): PageRole {
  const canonical = canonicalPageUrl(input.url);
  const home = canonicalPageUrl(input.homeUrl);
  if (canonical === home) return 'inicial';

  let path = '';
  try {
    const parsed = new URL(canonical);
    path = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if (path === '/' || path === '') return 'inicial';
    if (/^\/(index|home|inicio|início)(\.\w+)?\/?$/.test(path)) return 'inicial';
  } catch {
    path = '';
  }

  const slug = path.replace(/\.\w+$/, '').replace(/[_+]/g, '-');
  for (const hint of ROLE_HINTS) {
    if (hint.words.some((word) => slug.includes(word.replace(/\s+/g, '-')))) return hint.role;
  }

  const texto = `${input.title} ${input.headings.slice(0, 3).join(' ')}`.toLowerCase();
  for (const hint of ROLE_HINTS) {
    if (hint.words.some((word) => texto.includes(word.replace(/-/g, ' ')))) return hint.role;
  }

  return 'outra';
}

export function isPageRole(value: string): value is PageRole {
  return (PAGE_ROLES as readonly string[]).includes(value);
}

// ------------------------------------------------------------- fundacao

/**
 * Ano de fundacao, so quando a pagina afirma.
 *
 * Exige a frase ("desde 1998", "fundada em 2005"): um ano solto no texto pode
 * ser data de noticia, de copyright ou de qualquer outra coisa, e gravar isso
 * como fundacao seria inventar a historia da empresa.
 */
export function extractFoundedYear(text: string): number | null {
  const pattern = /(?:fundad[ao]\s+em|funda[cç][aã]o\s+em|atuando\s+desde|no\s+mercado\s+desde|criad[ao]\s+em|nasceu\s+em|inaugurad[ao]\s+em|come[cç]ou\s+em|desde)\s*(?:o\s+ano\s+de\s*)?(\d{4})/i;
  const match = pattern.exec(text);
  if (!match?.[1]) return null;
  const year = Number(match[1]);
  const currentYear = new Date().getUTCFullYear();
  if (year < 1800 || year > currentYear) return null;
  return year;
}

// ------------------------------------------------------------- entrada

/**
 * Le uma pagina inteira.
 *
 * `homeUrl` entra para a classificacao saber qual pagina e a inicial: um site
 * pode ter sido informado como `exemplo.com/br/` e ali a inicial nao e `/`.
 */
export function extractPage(input: { html: string; url: string; homeUrl: string }): PageExtract {
  const root = parseHtml(input.html);
  const pageUrl = input.url;

  const titleElement = findFirst(root, 'title');
  const title = titleElement ? inlineTextOf(titleElement).slice(0, 300) : '';

  let lang = '';
  let metaDescription = '';
  let canonical = '';
  const og = { title: '', description: '', image: '', siteName: '', type: '' };

  const htmlElement = findFirst(root, 'html');
  if (htmlElement) lang = attr(htmlElement, 'lang').slice(0, 20);

  for (const meta of findAll(root, 'meta')) {
    const name = attr(meta, 'name').toLowerCase();
    const property = attr(meta, 'property').toLowerCase();
    const content = normalizeSpace(attr(meta, 'content'));
    if (content === '') continue;
    if (name === 'description' && metaDescription === '') metaDescription = content.slice(0, 1000);
    if (property === 'og:title' || name === 'og:title') og.title ||= content.slice(0, 300);
    if (property === 'og:description' || name === 'og:description') og.description ||= content.slice(0, 1000);
    if (property === 'og:site_name' || name === 'og:site_name') og.siteName ||= content.slice(0, 200);
    if (property === 'og:type' || name === 'og:type') og.type ||= content.slice(0, 60);
    if ((property === 'og:image' || name === 'og:image' || property === 'og:image:secure_url') && og.image === '') {
      try {
        og.image = new URL(content, pageUrl).toString();
      } catch {
        og.image = '';
      }
    }
    // Twitter cards repetem a mesma informacao e aparecem onde OG falta.
    if (name === 'twitter:description') og.description ||= content.slice(0, 1000);
    if (name === 'twitter:title') og.title ||= content.slice(0, 300);
  }

  for (const link of findAll(root, 'link')) {
    const rel = attr(link, 'rel').toLowerCase();
    const href = attr(link, 'href');
    if (href === '') continue;
    if (rel.includes('canonical') && canonical === '') {
      try {
        canonical = new URL(href, pageUrl).toString();
      } catch {
        canonical = '';
      }
    }
  }

  const jsonLd = extractJsonLd(root);
  const body = findFirst(root, 'body') ?? root;
  const visibleText = textOf(body);

  const headings: ExtractedHeading[] = [];
  for (const element of walk(body)) {
    const match = /^h([1-6])$/.exec(element.tag);
    if (!match?.[1]) continue;
    if (isHidden(element)) continue;
    const text = inlineTextOf(element);
    if (text === '' || text.length > 200) continue;
    headings.push({ level: Number(match[1]), text });
    if (headings.length >= 60) break;
  }

  const blocks = extractBlocks(body);
  const paragraphs: string[] = [];
  for (const element of findAll(body, 'p')) {
    if (paragraphs.length >= MAX_PARAGRAPHS) break;
    if (isInside(element, CHROME_TAGS)) continue;
    if (isHidden(element)) continue;
    const text = inlineTextOf(element);
    if (!looksLikeContent(text, 25)) continue;
    paragraphs.push(text.slice(0, 5000));
  }

  const links: ExtractedLink[] = [];
  const social: Partial<Record<SocialNetwork, string>> = {};
  let whatsapp = '';
  let mapUrl = '';
  const hrefEmails = new Set<string>();
  const hrefPhones = new Set<string>();

  for (const anchor of findAll(root, 'a')) {
    const href = attr(anchor, 'href').trim();
    if (href === '') continue;

    if (/^mailto:/i.test(href)) {
      const email = href.replace(/^mailto:/i, '').split('?')[0]?.trim().toLowerCase() ?? '';
      if (email !== '' && email.includes('@')) hrefEmails.add(email);
      continue;
    }
    if (/^tel:/i.test(href)) {
      const digits = href.replace(/^tel:/i, '').replace(/\D+/g, '');
      const semDdi = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
      if (semDdi.length === 10 || semDdi.length === 11) hrefPhones.add(formatPhone(semDdi));
      continue;
    }

    const zap = whatsappFromHref(href);
    if (zap !== '' && whatsapp === '') whatsapp = zap;

    // Endereco absoluto para rede social e mapa.
    let absolute = '';
    try {
      absolute = new URL(href, pageUrl).toString();
    } catch {
      absolute = '';
    }
    if (absolute !== '') {
      const network = socialNetworkOf(absolute);
      // So o primeiro de cada rede: o rodape repete os mesmos links.
      if (network && !social[network]) social[network] = absolute;
      if (mapUrl === '' && /(?:google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|waze\.com)/i.test(absolute)) {
        mapUrl = absolute;
      }
    }

    const internal = resolveInternalLink(href, pageUrl);
    if (internal === null) continue;
    if (links.length >= MAX_LINKS) continue;
    links.push({ url: internal, text: inlineTextOf(anchor).slice(0, 200) });
  }

  // `iframe` do Google Maps carrega o endereco quando nao ha link.
  if (mapUrl === '') {
    for (const frame of findAll(root, 'iframe')) {
      const src = attr(frame, 'src');
      if (/google\.[a-z.]+\/maps/i.test(src)) {
        try {
          mapUrl = new URL(src, pageUrl).toString();
        } catch {
          mapUrl = '';
        }
        if (mapUrl !== '') break;
      }
    }
  }

  const textoParaContato = visibleText;
  const emails = dedupeBy([...hrefEmails, ...extractEmails(textoParaContato)], (email) => email);
  const phones = dedupeBy([...hrefPhones, ...extractPhones(textoParaContato)], (phone) => phone.replace(/\D+/g, ''));
  const { city, state } = extractCityState(textoParaContato);

  const contact: ExtractedContact = {
    emails: emails.slice(0, 5),
    phones: phones.slice(0, 5),
    whatsapp,
    addressLine: extractAddressLine(textoParaContato),
    city,
    state,
    postalCode: extractPostalCode(textoParaContato),
    businessHours: extractBusinessHours(textoParaContato),
    mapUrl,
    social,
  };

  const images = extractImages(root, pageUrl);
  if (og.image !== '' && !images.some((image) => image.url === og.image)) {
    // A imagem do Open Graph e a que o site escolheu para se representar:
    // candidata natural a banner mesmo quando nao esta no corpo da pagina.
    images.unshift({ url: og.image, alt: og.title, width: null, height: null, placement: 'banner', caption: '' });
  }

  const role = classifyPage({
    url: pageUrl,
    homeUrl: input.homeUrl,
    title,
    headings: headings.map((heading) => heading.text),
  });

  /**
   * HTML praticamente sem texto e o sinal de site montado no navegador.
   *
   * 240 caracteres e o ponto em que um site institucional de verdade ja
   * passou: menos que isso no HTML inteiro, com meta e OG inclusos, significa
   * que o conteudo nao esta aqui. Nao e um erro -- e o que a tela precisa
   * dizer a quem revisa, em vez de entregar campos vazios sem explicacao.
   */
  const renderedByScript =
    visibleText.length < 240 && paragraphs.length === 0 && headings.length <= 1;

  /**
   * Ultimo recurso sem navegador: o estado que o framework serializou.
   *
   * So entra quando a leitura normal nao achou nada. Num site comum, o HTML
   * ja tem o conteudo, e misturar o JSON interno traria duplicata e lixo de
   * configuracao -- o remedio seria pior que a doenca. Ver `embedded.ts`.
   */
  let fromEmbeddedState = false;
  if (renderedByScript) {
    const colhido = harvestEmbedded(extractEmbeddedState(input.html));
    if (colhido.texts.length > 0 || colhido.images.length > 0) {
      fromEmbeddedState = true;

      for (const texto of colhido.texts) {
        if (paragraphs.length >= MAX_PARAGRAPHS) break;
        paragraphs.push(texto);
      }

      const jaTem = new Set(images.map((imagem) => imagem.url));
      for (const bruto of colhido.images) {
        if (images.length >= MAX_IMAGES_PER_PAGE) break;
        let absoluto: string;
        try {
          absoluto = new URL(bruto, pageUrl).toString();
        } catch {
          continue;
        }
        if (jaTem.has(absoluto)) continue;
        jaTem.add(absoluto);
        images.push({
          url: absoluto,
          // Sem alt: o JSON nao diz. Inventar legenda seria inventar dado.
          alt: '',
          width: null,
          height: null,
          placement: 'conteudo',
          caption: '',
        });
      }
    }
  }

  return {
    url: pageUrl,
    lang,
    title,
    metaDescription,
    canonical,
    og,
    jsonLd,
    headings,
    blocks,
    paragraphs,
    images,
    links,
    contact,
    faqs: extractFaqs(body, jsonLd),
    quotes: extractQuotes(body, jsonLd),
    people: extractPeople(body, pageUrl, jsonLd),
    role,
    textLength: visibleText.length,
    renderedByScript,
    ...(fromEmbeddedState ? { fromEmbeddedState: true } : {}),
    foundedYear: extractFoundedYear(visibleText),
  };
}

/**
 * Enderecos de pagina declarados num sitemap.
 *
 * Le `<loc>` de `urlset` e de `sitemapindex` -- o segundo aponta para outros
 * sitemaps, e e assim que site grande se organiza. Sem dependencia de XML: um
 * sitemap e `<loc>` dentro de `<url>`, e o tokenizador de HTML da conta.
 */
export function extractSitemapUrls(xml: string, baseUrl: string): { pages: string[]; sitemaps: string[] } {
  const root = parseHtml(xml);
  const pages: string[] = [];
  const sitemaps: string[] = [];

  const isIndex = findFirst(root, 'sitemapindex') !== null;

  for (const loc of findAll(root, 'loc')) {
    const raw = inlineTextOf(loc);
    if (raw === '') continue;
    let absolute: string;
    try {
      absolute = new URL(raw, baseUrl).toString();
    } catch {
      continue;
    }
    // Dentro de `<sitemap>` o `<loc>` e outro sitemap, nao uma pagina.
    const dentroDeSitemap = loc.parent?.tag === 'sitemap';
    if (isIndex || dentroDeSitemap) {
      if (sitemaps.length < 20) sitemaps.push(absolute);
      continue;
    }
    if (pages.length < 500) pages.push(absolute);
  }

  return { pages, sitemaps };
}

/** Caminhos de sitemap declarados no `robots.txt`. */
export function extractSitemapFromRobots(robots: string, baseUrl: string): string[] {
  const found: string[] = [];
  for (const line of robots.split('\n').slice(0, 500)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (!match?.[1]) continue;
    try {
      found.push(new URL(match[1], baseUrl).toString());
    } catch {
      continue;
    }
    if (found.length >= 10) break;
  }
  return found;
}

export { SOCIAL_NETWORKS };
