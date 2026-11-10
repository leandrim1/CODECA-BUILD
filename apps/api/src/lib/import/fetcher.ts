import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import {
  IMPORT_LIMITS,
  checkImportHostname,
  isPrivateAddress,
} from '@codeca/shared';

/**
 * Busca de uma pagina de site externo.
 *
 * Segunda das duas barreiras contra SSRF. A primeira olha a forma do endereco
 * (`@codeca/shared`, `checkImportUrl`) e nao precisa de rede; esta confere o
 * **IP de destino**, que e a unica forma de pegar `interno.exemplo.com`
 * apontando para `10.0.0.5`.
 *
 * ## Por que `node:https` e nao `fetch`
 *
 * Validar o IP e depois chamar `fetch(hostname)` deixa uma janela: entre a
 * conferencia e a conexao o DNS pode responder outra coisa (DNS rebinding), e
 * o `fetch` global nao aceita indicar qual IP usar. O `node:https` aceita --
 * `options.lookup` e chamado pela conexao, e e por ele que **devolvemos o IP
 * que acabamos de validar**. A conexao vai para aquele endereco, nao para o
 * que o DNS disser depois. O nome continua indo no SNI e no cabecalho `Host`,
 * entao hospedagem compartilhada e certificado seguem funcionando.
 *
 * Isso tambem resolve dois outros requisitos de forma natural: o limite de
 * bytes e aplicado enquanto a resposta chega (e nao depois de baixar tudo), e
 * o redirecionamento nunca e seguido sozinho -- `fetch` seguiria sem avisar, e
 * cada salto precisa passar pelas duas barreiras de novo.
 *
 * ## O que esta camada NAO faz
 *
 * Nao interpreta nada. Devolve bytes e cabecalhos. Quem le HTML e o
 * tokenizador em `@codeca/shared`, que nao executa script.
 */

export interface FetchedResource {
  url: string;
  status: number;
  contentType: string;
  /** Corpo como texto. Vazio em recurso binario. */
  body: string;
  /** Corpo como bytes. Preenchido somente quando pedido. */
  bytes: Uint8Array | null;
  /** `true` quando o corpo foi cortado no limite de tamanho. */
  truncated: boolean;
  /** Saltos de redirecionamento percorridos, todos validados. */
  redirects: string[];
  /** Validadores que o servidor de origem ofereceu, para a proxima visita. */
  etag: string;
  lastModified: string;
  /**
   * `true` quando o servidor respondeu 304 a uma requisicao condicional.
   *
   * Nao e erro nem resposta vazia: e a origem dizendo "nao mudou desde a sua
   * ultima visita". A sincronizacao pula a pagina inteira nesse caso -- sem
   * baixar corpo, sem extrair, sem comparar.
   */
  notModified: boolean;
}

export type FetchRejection =
  | 'endereco_recusado'
  | 'ip_privado'
  | 'dns'
  | 'tempo_esgotado'
  | 'rede'
  | 'tipo_recusado'
  | 'grande_demais'
  | 'muitos_redirecionamentos';

export class SiteFetchError extends Error {
  constructor(
    readonly reason: FetchRejection,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'SiteFetchError';
  }
}

export interface FetchOptions {
  /** Tipos aceitos. Outro tipo e recusado sem baixar o corpo. */
  accept?: 'html' | 'xml' | 'image';
  /** Devolve tambem os bytes (imagem). */
  wantBytes?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
  /**
   * Validadores da visita anterior, para a requisicao condicional.
   *
   * Com eles o servidor pode responder 304 sem corpo. E o que torna uma
   * verificacao semanal de 25 paginas barata -- para a plataforma e,
   * sobretudo, para o site do cliente, que sera visitado para sempre.
   */
  ifNoneMatch?: string;
  ifModifiedSince?: string;
}

/**
 * Contrato da busca, para as rotas nao dependerem de rede.
 *
 * Mesma ideia do armazenamento e do provedor de cobranca: os testes trocam a
 * peca inteira. E necessario aqui porque a implementacao de verdade **recusa**
 * localhost -- um teste de ponta a ponta com servidor local seria recusado pela
 * propria protecao que a gente quer ter.
 */
export interface SiteFetcher {
  fetch: (url: string, options?: FetchOptions) => Promise<FetchedResource>;
}

/** Nome do cliente. Identifica a plataforma sem expor dado de ninguem. */
const USER_AGENT = 'CodecaBuildImporter/1.0 (+https://codecabuild.com)';

const ACCEPT_HEADERS: Record<NonNullable<FetchOptions['accept']>, string> = {
  html: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  xml: 'application/xml,text/xml;q=0.9,*/*;q=0.5',
  image: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8,*/*;q=0.5',
};

/** Tipos de conteudo aceitos por categoria. */
const ALLOWED_TYPES: Record<NonNullable<FetchOptions['accept']>, readonly string[]> = {
  html: ['text/html', 'application/xhtml+xml', 'text/plain'],
  xml: ['application/xml', 'text/xml', 'text/plain', 'application/rss+xml', 'text/html'],
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml'],
};

/**
 * Resolve o nome e devolve apenas enderecos publicos.
 *
 * Confere **todos** os registros, nao o primeiro: um nome com dois A, um
 * publico e um privado, entregaria o privado em metade das tentativas se so o
 * primeiro fosse conferido.
 */
async function resolvePublicAddresses(hostname: string): Promise<{ address: string; family: number }[]> {
  // Endereco literal nao vai ao DNS; a primeira barreira ja o avaliou.
  const literal = hostname.replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(literal) || literal.includes(':')) {
    if (isPrivateAddress(literal)) {
      throw new SiteFetchError('ip_privado', 'Esse endereço aponta para uma rede privada.');
    }
    return [{ address: literal, family: literal.includes(':') ? 6 : 4 }];
  }

  const records = await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        reject(new SiteFetchError('dns', 'Não foi possível encontrar esse endereço na internet.'));
        return;
      }
      resolve(addresses.map((item) => ({ address: item.address, family: item.family })));
    });
  });

  if (records.length === 0) {
    throw new SiteFetchError('dns', 'Não foi possível encontrar esse endereço na internet.');
  }

  const privados = records.filter((record) => isPrivateAddress(record.address));
  if (privados.length > 0) {
    // Um unico registro privado reprova o nome inteiro. Aceitar os publicos e
    // descartar os privados deixaria o destino a sorte de qual o sistema usa.
    throw new SiteFetchError(
      'ip_privado',
      'Esse endereço aponta para uma rede interna, não para um site público.',
    );
  }

  return records;
}

/** Tipo de conteudo sem parametros (`text/html; charset=utf-8` -> `text/html`). */
function baseContentType(header: string): string {
  return (header.split(';')[0] ?? '').trim().toLowerCase();
}

/** Codificacao declarada no cabecalho, para decodificar o corpo certo. */
function charsetOf(header: string): string {
  const match = /charset\s*=\s*"?([\w-]+)"?/i.exec(header);
  const found = (match?.[1] ?? '').toLowerCase();
  // `latin1` ainda aparece em site antigo; o resto cai em utf-8.
  if (found === 'iso-8859-1' || found === 'latin1' || found === 'windows-1252') return 'latin1';
  return 'utf-8';
}

/**
 * Le a resposta ate o limite de bytes.
 *
 * Interrompe a conexao ao estourar, em vez de baixar tudo e cortar depois: o
 * objetivo do limite e nao gastar memoria nem tempo com resposta enorme, e
 * cortar no fim nao evitaria nenhum dos dois.
 */
async function readCapped(
  response: IncomingMessage,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;

  for await (const chunk of response as unknown as Readable) {
    const buffer = chunk as Buffer;
    if (total + buffer.byteLength > maxBytes) {
      chunks.push(buffer.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      response.destroy();
      break;
    }
    chunks.push(buffer);
    total += buffer.byteLength;
  }

  return { bytes: new Uint8Array(Buffer.concat(chunks)), truncated };
}

/** Um endereco de destino ja validado como publico. */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/**
 * O `lookup` que entregamos a conexao, com os enderecos ja validados.
 *
 * ## O contrato que nos derrubou
 *
 * Node chama esta funcao com `options.all`, e o formato da resposta **muda
 * conforme esse sinalizador**: com `all: false` espera `(erro, endereco,
 * familia)`; com `all: true` espera `(erro, [{ address, family }])`. A partir
 * do Node 20 o `autoSelectFamily` (Happy Eyeballs) vem ligado por padrao, e
 * com ele a conexao sempre pede `all: true`. Responder a string nesse caso
 * nao conecta em lugar nenhum: o soquete morre com `ERR_INVALID_IP_ADDRESS`
 * antes de qualquer pacote sair -- toda busca falhava com "Nao foi possivel
 * acessar o site", em qualquer site.
 *
 * Por isso aqui se responde nos **dois** formatos, conforme o que foi pedido.
 *
 * ## Por que todos os enderecos, e nao o primeiro
 *
 * `resolvePublicAddresses` ja reprovou o nome inteiro se **qualquer** registro
 * for privado, entao todos os que chegam aqui sao publicos. Entregar a lista
 * toda nao afrouxa a barreira -- a conexao continua presa aos enderecos que
 * nos validamos, nunca ao que um segundo DNS devolveria -- e ganha de graca a
 * tentativa no endereco seguinte quando o primeiro nao responde. Um nome com
 * dois A, como `codecabuild.vercel.app`, deixa de depender da sorte da ordem.
 */
export function addressLookup(addresses: readonly ResolvedAddress[]) {
  return ((_hostname: string, options: { all?: boolean }, callback: unknown) => {
    const first = addresses[0];
    if (!first) {
      (callback as (error: NodeJS.ErrnoException) => void)(
        Object.assign(new Error('sem endereço validado'), { code: 'ENOTFOUND' }),
      );
      return;
    }
    if (options.all === true) {
      (callback as (error: null, result: ResolvedAddress[]) => void)(null, [...addresses]);
      return;
    }
    (callback as (error: null, address: string, family: number) => void)(
      null,
      first.address,
      first.family,
    );
  }) as never;
}

/** Uma requisicao, sem seguir redirecionamento. */
function requestOnce(input: {
  url: URL;
  addresses: readonly ResolvedAddress[];
  accept: NonNullable<FetchOptions['accept']>;
  timeoutMs: number;
  ifNoneMatch?: string;
  ifModifiedSince?: string;
  /** Porta real do destino, so no mapa de teste. O `Host` nao muda. */
  portOverride?: string;
}): Promise<{ response: IncomingMessage }> {
  const isHttps = input.url.protocol === 'https:';
  const send = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = send(
      {
        protocol: input.url.protocol,
        hostname: input.url.hostname,
        port: input.portOverride ?? (input.url.port !== '' ? input.url.port : isHttps ? 443 : 80),
        path: `${input.url.pathname}${input.url.search}`,
        method: 'GET',
        headers: {
          host: input.url.host,
          'user-agent': USER_AGENT,
          accept: ACCEPT_HEADERS[input.accept],
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
          // Sem compressao: o ganho nao paga o custo de descomprimir com
          // limite de bytes, e algumas respostas vem com codificacao errada.
          'accept-encoding': 'identity',
          connection: 'close',
          ...(input.ifNoneMatch ? { 'if-none-match': input.ifNoneMatch } : {}),
          ...(input.ifModifiedSince ? { 'if-modified-since': input.ifModifiedSince } : {}),
        },
        // Nome no SNI, mesmo conectando por IP: certificado e host virtual
        // dependem dele.
        ...(isHttps ? { servername: input.url.hostname } : {}),
        /**
         * Os IPs ja validados, entregues a conexao.
         *
         * E aqui que a protecao se fecha: a conexao usa estes enderecos, e nao
         * o que uma segunda consulta ao DNS devolveria. Sem isto, validar o IP
         * seria um aviso, nao uma barreira. Ver `addressLookup` para o
         * contrato dos dois formatos de resposta.
         */
        lookup: addressLookup(input.addresses),
        timeout: input.timeoutMs,
      },
      (response) => resolve({ response }),
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new SiteFetchError('tempo_esgotado', 'O site demorou demais para responder.'));
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error instanceof SiteFetchError) {
        reject(error);
        return;
      }
      reject(new SiteFetchError('rede', mensagemDeRede(error)));
    });
    req.end();
  });
}

/**
 * Mensagem para quem operou, a partir do erro de rede.
 *
 * O codigo do sistema (`ENOTFOUND`, `ECONNREFUSED`) nao diz nada a quem
 * digitou um endereco, e o texto original pode conter detalhe de
 * infraestrutura. Traduzido para o que a pessoa pode fazer.
 */
function mensagemDeRede(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Não foi possível encontrar esse endereço na internet.';
    case 'ECONNREFUSED':
      return 'O site recusou a conexão.';
    case 'ECONNRESET':
      return 'A conexão com o site foi interrompida.';
    case 'ETIMEDOUT':
      return 'O site demorou demais para responder.';
    case 'CERT_HAS_EXPIRED':
      return 'O certificado de segurança do site está expirado.';
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return 'O certificado de segurança do site não pôde ser verificado.';
    default:
      return 'Não foi possível acessar o site.';
  }
}

export interface SiteFetcherOptions {
  /**
   * Um arquivo de hosts so para teste: `host da URL` -> `ip:porta` real.
   *
   * **Existe para teste, e nada mais.** Um servidor HTTP de verdade em
   * `127.0.0.1` e a unica forma de exercitar o transporte -- soquete,
   * redirecionamento, prazo, limite de bytes, 304 -- contra a implementacao que
   * roda em producao. Sem isto, todo teste de importacao fala com um dublê em
   * memoria e o codigo que de fato abre conexao fica sem cobertura. Foi
   * exatamente ali que morou o defeito que deixou a importacao sem funcionar em
   * producao (ver `addressLookup`).
   *
   * Mapear o NOME, e nao so dispensar o endereco, e o que permite exercitar o
   * caminho inteiro: `http://clinicasorriso.test/` passa pela validacao da rota
   * como um endereco publico qualquer, e so aqui vira `127.0.0.1:41234`. O
   * cabecalho `Host` e o SNI continuam levando o nome original.
   *
   * Tres coisas tornam isto seguro:
   *
   * 1. **E um mapa fechado, nao um interruptor.** Quem nao esta nele -- inclusive
   *    o destino de um redirecionamento vindo de quem esta -- continua passando
   *    pelas duas barreiras. Por isso um teste consegue provar, sobre HTTP real,
   *    que um redirecionamento para `169.254.169.254` e recusado.
   * 2. **E ignorado em producao.** `NODE_ENV === 'production'` descarta o mapa,
   *    mesmo que alguem o preencha por engano.
   * 3. **Nao ha caminho ate ele a partir da aplicacao.** `createContext` nunca
   *    passa esta opcao, e ha teste que percorre `apps/` para provar isso.
   */
  testOrigins?: Readonly<Record<string, string>>;
}

/**
 * Busca de verdade, com as duas barreiras e os limites.
 *
 * Cada salto de redirecionamento recomeca do zero: confere a forma do novo
 * endereco, resolve o novo nome e valida o novo IP. Um site que responde 302
 * para `http://169.254.169.254/` e exatamente o ataque que isso impede, e
 * seguir redirecionamento sem revalidar seria ter as duas barreiras e deixar a
 * porta dos fundos aberta.
 */
export function createSiteFetcher(config: SiteFetcherOptions = {}): SiteFetcher {
  // Em producao o mapa nao existe, qualquer que seja o valor recebido.
  const origens = new Map<string, { address: string; port: string }>();
  if (process.env.NODE_ENV !== 'production') {
    for (const [nome, destino] of Object.entries(config.testOrigins ?? {})) {
      const [address = '', port = ''] = destino.split(':');
      origens.set(nome.trim().toLowerCase(), { address, port });
    }
  }

  return {
    async fetch(rawUrl, options = {}) {
      const accept = options.accept ?? 'html';
      const maxBytes = options.maxBytes ?? IMPORT_LIMITS.maxHtmlBytes;
      const timeoutMs = options.timeoutMs ?? IMPORT_LIMITS.requestTimeoutMs;
      const redirects: string[] = [];

      let current = rawUrl;
      for (let hop = 0; ; hop += 1) {
        if (hop > IMPORT_LIMITS.maxRedirects) {
          throw new SiteFetchError(
            'muitos_redirecionamentos',
            'O site redirecionou muitas vezes seguidas.',
          );
        }

        let url: URL;
        try {
          url = new URL(current);
        } catch {
          throw new SiteFetchError('endereco_recusado', 'Endereço inválido.');
        }

        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new SiteFetchError('endereco_recusado', 'Aceitamos apenas endereços http e https.');
        }

        /*
         * A dispensa vale por SALTO, nao pela requisicao.
         *
         * Quem entra pela lista de teste nao leva consigo um salvo-conduto: o
         * destino de um redirecionamento e avaliado de novo, e so passa se ele
         * proprio estiver na lista. E o que mantem o teste de SSRF honesto.
         */
        const destinoDeTeste = origens.get(url.host.toLowerCase());

        if (!destinoDeTeste) {
          if (url.port !== '' && url.port !== '80' && url.port !== '443') {
            throw new SiteFetchError('endereco_recusado', 'Porta não permitida.');
          }
          // Primeira barreira, aplicada tambem em cada salto.
          const forma = checkImportHostname(url.hostname);
          if (!forma.ok) throw new SiteFetchError('endereco_recusado', forma.message);
        }

        // Segunda barreira: resolve e valida o IP deste salto.
        const addresses = destinoDeTeste
          ? [{ address: destinoDeTeste.address, family: 4 }]
          : await resolvePublicAddresses(url.hostname);
        if (addresses.length === 0) {
          throw new SiteFetchError('dns', 'Não foi possível encontrar esse endereço.');
        }

        const { response } = await requestOnce({
          url,
          addresses,
          accept,
          timeoutMs,
          ...(destinoDeTeste?.port ? { portOverride: destinoDeTeste.port } : {}),
          ...(options.ifNoneMatch ? { ifNoneMatch: options.ifNoneMatch } : {}),
          ...(options.ifModifiedSince ? { ifModifiedSince: options.ifModifiedSince } : {}),
        });

        const status = response.statusCode ?? 0;
        const location = response.headers['location'];
        const etag = String(response.headers['etag'] ?? '').slice(0, 300);
        const lastModified = String(response.headers['last-modified'] ?? '').slice(0, 120);

        /**
         * 304: a origem diz que nada mudou desde a visita anterior.
         *
         * Vem antes da checagem de redirecionamento porque 304 esta na faixa
         * 3xx mas nao e um salto -- nao tem `location`, nao tem corpo, e
         * trata-lo como qualquer outro 3xx faria a resposta cair no caminho
         * errado. E o resultado que a sincronizacao mais quer receber.
         */
        if (status === 304) {
          response.resume();
          response.destroy();
          return {
            url: url.toString(),
            status,
            contentType: '',
            body: '',
            bytes: null,
            truncated: false,
            redirects,
            etag: etag || (options.ifNoneMatch ?? ''),
            lastModified: lastModified || (options.ifModifiedSince ?? ''),
            notModified: true,
          };
        }

        if (status >= 300 && status < 400 && typeof location === 'string' && location !== '') {
          response.resume();
          response.destroy();
          let next: string;
          try {
            next = new URL(location, url).toString();
          } catch {
            throw new SiteFetchError('endereco_recusado', 'O site redirecionou para um endereço inválido.');
          }
          redirects.push(next);
          current = next;
          continue;
        }

        const contentTypeHeader = String(response.headers['content-type'] ?? '');
        const contentType = baseContentType(contentTypeHeader);

        if (status >= 400) {
          response.resume();
          response.destroy();
          return {
            url: url.toString(),
            status,
            contentType,
            body: '',
            bytes: null,
            truncated: false,
            redirects,
            etag,
            lastModified,
            notModified: false,
          };
        }

        // Tipo recusado: encerra sem baixar o corpo.
        const permitidos = ALLOWED_TYPES[accept];
        if (contentType !== '' && !permitidos.includes(contentType)) {
          response.resume();
          response.destroy();
          throw new SiteFetchError(
            'tipo_recusado',
            `O endereço devolveu ${contentType}, que não é o conteúdo esperado aqui.`,
            status,
          );
        }

        // `content-length` declarado acima do limite: nem comeca a baixar.
        const declarado = Number(response.headers['content-length'] ?? NaN);
        if (Number.isFinite(declarado) && declarado > maxBytes) {
          response.resume();
          response.destroy();
          throw new SiteFetchError(
            'grande_demais',
            'O arquivo é maior do que o limite aceito pela plataforma.',
            status,
          );
        }

        const { bytes, truncated } = await readCapped(response, maxBytes);

        return {
          url: url.toString(),
          status,
          contentType,
          body: accept === 'image' ? '' : Buffer.from(bytes).toString(charsetOf(contentTypeHeader) as BufferEncoding),
          bytes: options.wantBytes ? bytes : null,
          truncated,
          redirects,
          etag,
          lastModified,
          notModified: false,
        };
      }
    },
  };
}

/**
 * Busca sobre um conjunto de paginas em memoria, para os testes.
 *
 * Nao e um atalho: a implementacao de verdade recusa `localhost` de proposito,
 * entao um teste de ponta a ponta contra um servidor local seria recusado pela
 * protecao que se quer ter. Com isto, os testes exercitam o rastreamento, a
 * extracao e a gravacao de verdade, e as barreiras de rede tem testes
 * proprios.
 */
export function createMemorySiteFetcher(
  pages: Record<
    string,
    {
      body?: string;
      status?: number;
      contentType?: string;
      bytes?: Uint8Array;
      location?: string;
      /** Validadores que esta pagina oferece; com eles o teste exercita o 304. */
      etag?: string;
      lastModified?: string;
    }
  >,
): SiteFetcher {
  return {
    async fetch(rawUrl, options = {}) {
      const redirects: string[] = [];
      let current = rawUrl;

      for (let hop = 0; hop <= IMPORT_LIMITS.maxRedirects; hop += 1) {
        const normalized = current.replace(/#.*$/, '');
        const page = pages[normalized] ?? pages[normalized.replace(/\/$/, '')] ?? pages[`${normalized}/`];

        if (!page) {
          return {
            url: normalized,
            status: 404,
            contentType: 'text/html',
            body: '',
            bytes: null,
            truncated: false,
            redirects,
            etag: '',
            lastModified: '',
            notModified: false,
          };
        }

        /**
         * Responde 304 quando o validador enviado bate com o da pagina.
         *
         * E o mesmo contrato do servidor de verdade, para os testes
         * exercitarem o caminho condicional -- que e o que evita baixar 25
         * paginas toda semana.
         */
        const condicionalBate =
          (options.ifNoneMatch !== undefined
            && options.ifNoneMatch !== ''
            && options.ifNoneMatch === page.etag)
          || (options.ifModifiedSince !== undefined
            && options.ifModifiedSince !== ''
            && options.ifModifiedSince === page.lastModified);

        if (condicionalBate) {
          return {
            url: normalized,
            status: 304,
            contentType: '',
            body: '',
            bytes: null,
            truncated: false,
            redirects,
            etag: page.etag ?? '',
            lastModified: page.lastModified ?? '',
            notModified: true,
          };
        }

        if (page.location !== undefined) {
          const next = new URL(page.location, normalized).toString();
          // O mesmo que a implementacao real faz: revalida a forma do destino.
          const forma = checkImportHostname(new URL(next).hostname);
          if (!forma.ok) throw new SiteFetchError('endereco_recusado', forma.message);
          redirects.push(next);
          current = next;
          continue;
        }

        const status = page.status ?? 200;
        const contentType = page.contentType ?? (options.accept === 'image' ? 'image/png' : 'text/html');

        return {
          url: normalized,
          status,
          contentType: baseContentType(contentType),
          body: page.body ?? '',
          bytes: options.wantBytes ? (page.bytes ?? new Uint8Array()) : null,
          truncated: false,
          redirects,
          etag: page.etag ?? '',
          lastModified: page.lastModified ?? '',
          notModified: false,
        };
      }

      throw new SiteFetchError('muitos_redirecionamentos', 'O site redirecionou muitas vezes seguidas.');
    },
  };
}
