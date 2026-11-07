/**
 * Enderecos que a analise aceita visitar.
 *
 * Primeira das duas barreiras contra SSRF. Esta olha a **forma** do endereco e
 * roda nos dois lados -- o painel usa para avisar antes de enviar, o servidor
 * usa para recusar. A segunda barreira esta na API (`lib/import/fetcher.ts`):
 * resolve o nome e confere o **IP** de destino, porque um nome publico pode
 * apontar para 127.0.0.1 e so a resolucao revela isso.
 *
 * Uma barreira nao substitui a outra. Esta pega `http://192.168.0.1` sem
 * consultar DNS; a outra pega `interno.exemplo.com` que resolve para a rede
 * privada. Separadas tambem porque esta precisa rodar no navegador, onde nao
 * existe resolucao de nomes.
 */

/** Esquemas aceitos. Qualquer outro (`file:`, `ftp:`, `gopher:`, `data:`) e recusado. */
export const ALLOWED_IMPORT_PROTOCOLS = ['http:', 'https:'] as const;

/**
 * Nomes que nunca pertencem a um site publico.
 *
 * `localhost` e as reservas de RFC 6761/6762: um nome destes resolve para a
 * propria maquina ou para a rede local de quem consulta.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
]);

/**
 * Sufixos de uso interno, reservados justamente para nao serem publicos.
 *
 * `.local` e mDNS; `.internal` e o que a Google Cloud usa para a rede interna
 * -- e e onde vive `metadata.google.internal`, o servico de metadados que
 * entrega credenciais da instancia a quem conseguir fazer o servidor acessa-lo.
 */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

/**
 * Enderecos de metadados das nuvens.
 *
 * Nao e uma lista de cortesia: `169.254.169.254` responde, sem autenticacao
 * nenhuma, com as credenciais temporarias da maquina na AWS, GCP, Azure e
 * Oracle. Fazer o servidor buscar essa URL e o objetivo classico de um SSRF, e
 * por isso ela aparece aqui **e** na conferencia por IP.
 */
const METADATA_HOSTS = new Set([
  '169.254.169.254',
  '[fd00:ec2::254]',
  'fd00:ec2::254',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

export type UrlRejection =
  | 'vazio'
  | 'formato'
  | 'protocolo'
  | 'credenciais'
  | 'porta'
  | 'host_interno'
  | 'ip_privado'
  | 'metadados';

export interface UrlCheckFailure {
  ok: false;
  reason: UrlRejection;
  message: string;
}

export interface UrlCheckSuccess {
  ok: true;
  /** Endereco normalizado: minusculas no host, sem fragmento, caminho garantido. */
  url: string;
  hostname: string;
  origin: string;
}

export type UrlCheck = UrlCheckSuccess | UrlCheckFailure;

const MESSAGES: Record<UrlRejection, string> = {
  vazio: 'Informe o endereco do site.',
  formato: 'Esse endereco não é válido. Use algo como https://seusite.com.br.',
  protocolo: 'Aceitamos apenas endereços que começam com http:// ou https://.',
  credenciais: 'Remova o usuário e a senha do endereço.',
  porta: 'Use o endereço do site sem indicar uma porta diferente de 80 ou 443.',
  host_interno: 'Esse endereço é de uso interno e não aponta para um site público.',
  ip_privado: 'Esse endereço aponta para uma rede privada, não para um site público.',
  metadados: 'Esse endereço é de um serviço interno de infraestrutura.',
};

function fail(reason: UrlRejection): UrlCheckFailure {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/**
 * `true` quando o texto e um IPv4 em rede que nao e roteavel na internet.
 *
 * Cobre as faixas da RFC 1918 (10/8, 172.16/12, 192.168/16), loopback
 * (127/8), link-local (169.254/16), `0.0.0.0/8`, compartilhada da RFC 6598
 * (100.64/10), teste (192.0.2/24, 198.51.100/24, 203.0.113/24), benchmark
 * (198.18/15), multicast e reservada (224/4 e acima).
 */
export function isPrivateIPv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => {
    // `Number('')` e 0 e `Number('01')` e 1: exigir digitos puros evita que
    // `10.0.0.01` ou `10..0.1` passem como outro endereco.
    if (!/^\d{1,3}$/.test(part)) return -1;
    return Number(part);
  });
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  const [a, b] = octets as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8 -- "este host"
  if (a === 10) return true; // privada
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, inclui metadados
  if (a === 172 && b >= 16 && b <= 31) return true; // privada
  if (a === 192 && b === 168) return true; // privada
  if (a === 192 && b === 0) return true; // 192.0.0/24 e 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51) return true; // documentacao
  if (a === 203 && b === 0) return true; // documentacao
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast e reservada
  return false;
}

/**
 * `true` quando o texto e um IPv6 que nao e roteavel na internet.
 *
 * Inclui o caso que mais engana: `::ffff:127.0.0.1` e um IPv4 embutido em
 * IPv6, e sem este desvio passaria por um endereco v6 qualquer.
 */
export function isPrivateIPv6(value: string): boolean {
  const raw = value.replace(/^\[|\]$/g, '').toLowerCase();
  if (raw === '::' || raw === '::1') return true;

  // IPv4 mapeado ou traduzido: a decisao e a do endereco v4 que ele carrega.
  const embedded = /(?:::ffff:|::)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (embedded?.[1]) return isPrivateIPv4(embedded[1]);

  /**
   * O mesmo endereco, na forma hexadecimal.
   *
   * `new URL('http://[::ffff:127.0.0.1]/')` normaliza o host para
   * `[::ffff:7f00:1]` -- a notacao decimal desaparece antes de chegar aqui, e
   * sem este desvio `::ffff:7f00:1` passaria por um IPv6 publico qualquer.
   * E loopback escrito de outro jeito.
   */
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(raw);
  if (hexMapped?.[1] && hexMapped[2]) {
    const high = Number.parseInt(hexMapped[1], 16);
    const low = Number.parseInt(hexMapped[2], 16);
    const quad = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    return isPrivateIPv4(quad);
  }

  if (raw.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(raw)) return true; // unica local (fc00::/7), inclui fd00:ec2::254
  if (raw.startsWith('ff')) return true; // multicast
  if (raw.startsWith('2001:db8')) return true; // documentacao
  if (raw.startsWith('64:ff9b')) return true; // NAT64
  return false;
}

/** `true` para IPv4 ou IPv6 fora da internet publica. */
export function isPrivateAddress(value: string): boolean {
  if (value.includes(':')) return isPrivateIPv6(value);
  return isPrivateIPv4(value);
}

/**
 * Confere se um nome de host pode pertencer a um site publico.
 *
 * Separada de `checkImportUrl` porque a conferencia dos redirecionamentos usa
 * so esta parte: um salto chega com host novo e nenhum outro campo muda.
 */
export function checkImportHostname(hostname: string): UrlCheck {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === '') return fail('formato');

  if (METADATA_HOSTS.has(host)) return fail('metadados');
  if (BLOCKED_HOSTNAMES.has(host)) return fail('host_interno');
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return fail('host_interno');

  // Nome sem ponto nenhum: `servidor`, `router`, `intranet`. Nao existe na
  // internet publica, e um deles costuma ser o host interno de quem hospeda.
  const bareName = !host.includes('.') && !host.includes(':');
  if (bareName) return fail('host_interno');

  if (isPrivateAddress(host)) {
    return fail(host.startsWith('169.254') || host.includes('fd00:ec2') ? 'metadados' : 'ip_privado');
  }

  return { ok: true, url: host, hostname: host, origin: host };
}

/**
 * Confere e normaliza o endereco que o cliente informou.
 *
 * Aceita `seusite.com.br` sem esquema -- e o que a pessoa digita -- e completa
 * com `https://`. Recusa porta diferente de 80/443 porque um site publico nao
 * usa outra, e porque varrer portas da rede interna e exatamente o que um SSRF
 * tenta fazer com esse campo.
 */
export function checkImportUrl(input: string): UrlCheck {
  const texto = input.trim();
  if (texto === '') return fail('vazio');
  if (texto.length > 2048) return fail('formato');

  // Sem esquema a pessoa quis dizer https. Com um esquema que nao serve,
  // dizer "use http ou https" e mais util que "endereco invalido".
  const comEsquema = /^[a-z][a-z0-9+.-]*:/i.test(texto);
  const candidato = comEsquema ? texto : `https://${texto}`;

  let url: URL;
  try {
    url = new URL(candidato);
  } catch {
    return fail('formato');
  }

  if (!(ALLOWED_IMPORT_PROTOCOLS as readonly string[]).includes(url.protocol)) {
    return fail('protocolo');
  }

  // `https://usuario:senha@host` guardaria credencial de alguem num registro
  // que a equipe le depois. Nao ha motivo legitimo num site publico.
  if (url.username !== '' || url.password !== '') return fail('credenciais');

  if (url.port !== '' && url.port !== '80' && url.port !== '443') return fail('porta');

  const host = checkImportHostname(url.hostname);
  if (!host.ok) return host;

  url.hash = '';
  url.hostname = host.hostname;
  if (url.pathname === '') url.pathname = '/';

  return { ok: true, url: url.toString(), hostname: host.hostname, origin: url.origin };
}

/**
 * Resolve um link encontrado na pagina contra o endereco dela.
 *
 * Devolve `null` para tudo que nao seja uma pagina do mesmo site: outro
 * dominio, `mailto:`, `tel:`, `javascript:`, ancora da mesma pagina e arquivo
 * para download. Sair do dominio informado seria analisar o site de outra
 * pessoa, que ninguem autorizou.
 */
export function resolveInternalLink(href: string, pageUrl: string): string | null {
  const bruto = href.trim();
  if (bruto === '' || bruto.startsWith('#')) return null;

  // Estes carregam acao, nao endereco de pagina.
  if (/^(mailto|tel|sms|javascript|data|blob|file|ftp|whatsapp):/i.test(bruto)) return null;

  let url: URL;
  try {
    url = new URL(bruto, pageUrl);
  } catch {
    return null;
  }

  if (!(ALLOWED_IMPORT_PROTOCOLS as readonly string[]).includes(url.protocol)) return null;

  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return null;
  }

  // `www.exemplo.com` e `exemplo.com` sao o mesmo site na pratica.
  if (stripWww(url.hostname) !== stripWww(base.hostname)) return null;

  // Arquivo, nao pagina: entra pela extracao de imagens, nao pelo rastreamento.
  if (/\.(pdf|zip|rar|docx?|xlsx?|pptx?|csv|mp4|mp3|avi|mov|webm|svg|png|jpe?g|gif|webp|avif|ico)$/i.test(url.pathname)) {
    return null;
  }

  url.hash = '';
  if (url.pathname === '') url.pathname = '/';
  return url.toString();
}

export function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * Forma canonica de uma pagina, para nao analisar a mesma duas vezes.
 *
 * `/sobre`, `/sobre/` e `/sobre?utm_source=x` sao a mesma pagina. Os
 * parametros de campanha sao removidos porque mudam o endereco sem mudar o
 * conteudo -- e um site cheio de links com `utm_` gastaria todo o limite de
 * paginas relendo a inicial.
 */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|gbraid$|wbraid$|msclkid$|mc_[ce]id$|_ga$|ref$|igshid$|si$)/i;

export function canonicalPageUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  // Ordem estavel: `?a=1&b=2` e `?b=2&a=1` sao a mesma pagina.
  url.searchParams.sort();

  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  if (url.pathname === '') url.pathname = '/';
  return url.toString();
}
