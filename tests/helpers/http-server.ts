import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Um servidor HTTP de VERDADE, em `127.0.0.1`, para os testes de importacao.
 *
 * ## Por que isto existe
 *
 * O dublê em memoria (`createMemorySiteFetcher`) substitui a rede inteira.
 * Ele serve bem aos testes de fluxo -- rastreamento, extracao, gravacao --,
 * mas deixa sem cobertura justamente a camada que abre conexao: soquete,
 * redirecionamento, prazo, limite de bytes, codificacao do corpo, 304. Foi ali
 * que morou o defeito que deixou a importacao sem funcionar em producao por
 * semanas, com a suite inteira verde.
 *
 * Aqui o `createSiteFetcher` de producao fala com um servidor Node real. O que
 * o teste exercita e o mesmo codigo que roda na Vercel.
 */

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export interface TestHttpServer {
  /** `127.0.0.1:<porta>`, no formato que `testOrigins` espera. */
  origin: string;
  /** URL absoluta de um caminho neste servidor. */
  url: (path: string) => string;
  /** Caminhos pedidos, na ordem, com os cabecalhos de cada pedido. */
  requests: Array<{ method: string; path: string; headers: NodeJS.Dict<string | string[]> }>;
  /** Troca as rotas no meio do teste (usado pela sincronizacao). */
  setRoutes: (routes: Record<string, Handler>) => void;
  close: () => Promise<void>;
}

/**
 * Sobe o servidor e espera ele estar ouvindo.
 *
 * `routes` mapeia caminho -> tratador. Um caminho ausente responde 404, como
 * um servidor de verdade -- e nao com erro de teste, porque a importacao
 * encontra 404 o tempo todo e precisa lidar com ele.
 */
export async function startTestServer(routes: Record<string, Handler>): Promise<TestHttpServer> {
  let atuais = routes;
  const requests: TestHttpServer['requests'] = [];

  const server = createServer((req, res) => {
    const caminho = (req.url ?? '/').split('?')[0] ?? '/';
    requests.push({ method: req.method ?? 'GET', path: caminho, headers: req.headers });
    const handler = atuais[caminho];
    if (!handler) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><h1>Não encontrado</h1></body></html>');
      return;
    }
    handler(req, res);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `127.0.0.1:${port}`,
    url: (path) => `http://127.0.0.1:${port}${path.startsWith('/') ? path : `/${path}`}`,
    requests,
    setRoutes: (novas) => {
      atuais = novas;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** Resposta HTML simples, com `content-length` e os validadores pedidos. */
export function html(
  body: string,
  options: { status?: number; etag?: string; lastModified?: string; charset?: string } = {},
): Handler {
  return (req, res) => {
    // Requisicao condicional: devolve 304 quando o validador bate, como faz um
    // servidor de verdade. E o caminho que torna a sincronizacao barata.
    if (options.etag && req.headers['if-none-match'] === options.etag) {
      res.writeHead(304, { etag: options.etag });
      res.end();
      return;
    }
    const charset = options.charset ?? 'utf-8';
    const bytes = Buffer.from(body, charset === 'iso-8859-1' ? 'latin1' : 'utf8');
    res.writeHead(options.status ?? 200, {
      'content-type': `text/html; charset=${charset}`,
      'content-length': String(bytes.byteLength),
      ...(options.etag ? { etag: options.etag } : {}),
      ...(options.lastModified ? { 'last-modified': options.lastModified } : {}),
    });
    res.end(bytes);
  };
}

/** Redirecionamento para um endereco qualquer. */
export function redirect(location: string, status = 302): Handler {
  return (_req, res) => {
    res.writeHead(status, { location });
    res.end();
  };
}

/** Nunca responde: exercita o prazo do cliente. */
export function silencio(): Handler {
  return () => undefined;
}

/** Envia em pedacos, sem `content-length` (transfer-encoding: chunked). */
export function emPedacos(pedacos: string[], contentType = 'text/html; charset=utf-8'): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': contentType });
    let i = 0;
    const proximo = () => {
      if (i >= pedacos.length) {
        res.end();
        return;
      }
      res.write(pedacos[i]!);
      i += 1;
      setTimeout(proximo, 5);
    };
    proximo();
  };
}
