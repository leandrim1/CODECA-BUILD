import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSiteFetcher, SiteFetchError } from '@codeca/api';
import { IMPORT_LIMITS } from '@codeca/shared';
import {
  emPedacos,
  html,
  redirect,
  silencio,
  startTestServer,
  type TestHttpServer,
} from '../helpers/http-server.js';

/**
 * A busca de paginas contra um servidor HTTP de VERDADE.
 *
 * ## Por que este arquivo existe
 *
 * Todo o resto da suite de importacao fala com `createMemorySiteFetcher`, que
 * substitui a rede. Isso cobre rastreamento, extracao e gravacao -- e deixa
 * sem cobertura exatamente a camada que abre conexao. O defeito que manteve a
 * importacao quebrada em producao (`addressLookup` devolvendo a forma errada
 * ao `options.lookup` do Node) vivia ali: nenhum teste chegava a abrir um
 * soquete, e 1.400 testes passavam com o recurso principal do produto
 * inoperante.
 *
 * Aqui o `createSiteFetcher` de PRODUCAO fala com um servidor Node real. O que
 * passa por este arquivo e soquete, redirecionamento, prazo, limite de bytes,
 * codificacao e 304 -- de verdade.
 *
 * ## A barreira continua de pe
 *
 * `testOrigins` dispensa das barreiras **apenas** as origens listadas, e a
 * dispensa e avaliada por salto. Por isso este arquivo consegue provar, sobre
 * HTTP real, o que o dublê nunca poderia: que um site que redireciona para
 * `169.254.169.254` e recusado.
 */

const servidores: TestHttpServer[] = [];

async function servidor(routes: Parameters<typeof startTestServer>[0]): Promise<TestHttpServer> {
  const instancia = await startTestServer(routes);
  servidores.push(instancia);
  return instancia;
}

afterEach(async () => {
  await Promise.all(servidores.splice(0).map((s) => s.close()));
});

const PAGINA = '<!doctype html><html lang="pt-BR"><head><title>Clínica Sorriso</title>'
  + '<meta name="description" content="Odontologia em Porto Alegre"></head>'
  + '<body><h1>Clínica Sorriso</h1><p>Atendimento de segunda a sexta.</p></body></html>';

describe('busca uma pagina por HTTP de verdade', () => {
  it('abre o soquete, le o corpo e devolve os validadores', async () => {
    const site = await servidor({
      '/': html(PAGINA, { etag: '"v1"', lastModified: 'Mon, 02 Nov 2026 10:00:00 GMT' }),
    });
    const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });

    const resultado = await fetcher.fetch(site.url('/'));

    expect(resultado.status).toBe(200);
    expect(resultado.contentType).toBe('text/html');
    expect(resultado.body).toContain('Clínica Sorriso');
    expect(resultado.etag).toBe('"v1"');
    expect(resultado.lastModified).toBe('Mon, 02 Nov 2026 10:00:00 GMT');
    expect(resultado.truncated).toBe(false);
    expect(resultado.notModified).toBe(false);

    // O pedido chegou ao servidor com o que a plataforma promete enviar.
    const pedido = site.requests.at(-1)!;
    expect(pedido.method).toBe('GET');
    expect(String(pedido.headers['user-agent'])).toContain('CodecaBuildImporter');
    // Sem compressao: o limite de bytes e aplicado sobre o que chega no fio.
    expect(pedido.headers['accept-encoding']).toBe('identity');
  });

  it('le resposta em pedacos, sem content-length', async () => {
    const site = await servidor({
      '/': emPedacos(['<!doctype html><html><body><h1>Parte um</h1>', '<p>Parte dois</p></body></html>']),
    });
    const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });

    const resultado = await fetcher.fetch(site.url('/'));
    expect(resultado.body).toContain('Parte um');
    expect(resultado.body).toContain('Parte dois');
  });

  it('decodifica latin-1 declarado no cabecalho', async () => {
    const site = await servidor({
      '/': html('<html><body><h1>Construção e Manutenção</h1></body></html>', { charset: 'iso-8859-1' }),
    });
    const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });

    const resultado = await fetcher.fetch(site.url('/'));
    expect(resultado.body).toContain('Construção e Manutenção');
  });

  it('404 nao e excecao: devolve o status, sem corpo', async () => {
    const site = await servidor({});
    const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });

    const resultado = await fetcher.fetch(site.url('/pagina-que-nao-existe'));
    expect(resultado.status).toBe(404);
    expect(resultado.body).toBe('');
  });

  it('requisicao condicional devolve 304, sem baixar o corpo', async () => {
    const site = await servidor({ '/': html(PAGINA, { etag: '"v1"' }) });
    const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });

    const primeira = await fetcher.fetch(site.url('/'));
    expect(primeira.notModified).toBe(false);

    const segunda = await fetcher.fetch(site.url('/'), { ifNoneMatch: primeira.etag });
    expect(segunda.notModified).toBe(true);
    expect(segunda.status).toBe(304);
    expect(segunda.body).toBe('');
    // O validador foi mesmo enviado no fio.
    expect(site.requests.at(-1)!.headers['if-none-match']).toBe('"v1"');
  });
});

describe('redirecionamento: cada salto e validado de novo', () => {
  it('segue o redirecionamento e registra os saltos', async () => {
    const destino = await servidor({ '/final': html(PAGINA) });
    const origem = await servidor({ '/': redirect(destino.url('/final')) });
    const fetcher = createSiteFetcher({ testOrigins: { [origem.origin]: origem.origin, [destino.origin]: destino.origin } });

    const resultado = await fetcher.fetch(origem.url('/'));
    expect(resultado.status).toBe(200);
    expect(resultado.body).toContain('Clínica Sorriso');
    expect(resultado.redirects).toEqual([destino.url('/final')]);
  });

  it('redirecionamento para o servico de metadados da nuvem e RECUSADO', async () => {
    // O ataque classico: o site responde 302 para 169.254.169.254, de onde
    // sairiam credenciais da maquina. O primeiro salto e um servidor de teste
    // permitido; o segundo nao esta na lista e enfrenta as barreiras inteiras.
    const origem = await servidor({ '/': redirect('http://169.254.169.254/latest/meta-data/') });
    const fetcher = createSiteFetcher({ testOrigins: { [origem.origin]: origem.origin } });

    const erro = await fetcher.fetch(origem.url('/')).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(SiteFetchError);
    expect((erro as SiteFetchError).reason).toBe('endereco_recusado');
  });

  it('redirecionamento para a rede interna e RECUSADO', async () => {
    const origem = await servidor({ '/': redirect('http://10.0.0.5/admin') });
    const fetcher = createSiteFetcher({ testOrigins: { [origem.origin]: origem.origin } });

    const erro = await fetcher.fetch(origem.url('/')).catch((e: unknown) => e);
    expect((erro as SiteFetchError).reason).toBe('endereco_recusado');
  });

  it('redirecionamento para OUTRA porta local, fora da lista, e RECUSADO', async () => {
    // Prova que a dispensa vale por origem exata, e nao por "e 127.0.0.1".
    const outro = await servidor({ '/': html(PAGINA) });
    const origem = await servidor({ '/': redirect(outro.url('/')) });
    // Somente a origem e dispensada; o destino nao entra na lista.
    const fetcher = createSiteFetcher({ testOrigins: { [origem.origin]: origem.origin } });

    const erro = await fetcher.fetch(origem.url('/')).catch((e: unknown) => e);
    expect((erro as SiteFetchError).reason).toBe('endereco_recusado');
  });

  it('corrente longa demais para de ser seguida', async () => {
    const site = await servidor({});
    // Cada salto aponta para o proximo caminho do mesmo servidor.
    const rotas: Record<string, ReturnType<typeof redirect>> = {};
    for (let i = 0; i <= IMPORT_LIMITS.maxRedirects + 2; i += 1) {
      rotas[`/salto-${i}`] = redirect(site.url(`/salto-${i + 1}`));
    }
    site.setRoutes(rotas);
    const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });

    const erro = await fetcher.fetch(site.url('/salto-0')).catch((e: unknown) => e);
    expect((erro as SiteFetchError).reason).toBe('muitos_redirecionamentos');
  });
});

describe('limites aplicados sobre a conexao', () => {
  it('servidor que nao responde esgota o prazo, em vez de pendurar a analise', async () => {
    const site = await servidor({ '/': silencio() });
    const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });

    const inicio = Date.now();
    const erro = await fetcher.fetch(site.url('/'), { timeoutMs: 600 }).catch((e: unknown) => e);
    const decorrido = Date.now() - inicio;

    expect((erro as SiteFetchError).reason).toBe('tempo_esgotado');
    // O prazo foi mesmo respeitado: nao esperou os 10 s do padrao.
    expect(decorrido).toBeLessThan(5_000);
  });

  it('content-length acima do limite: nem comeca a baixar', async () => {
    const site = await servidor({
      '/': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html', 'content-length': '999999' });
        res.end('x'.repeat(999_999));
      },
    });
    const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });

    const erro = await fetcher.fetch(site.url('/'), { maxBytes: 1_000 }).catch((e: unknown) => e);
    expect((erro as SiteFetchError).reason).toBe('grande_demais');
  });

  it('resposta sem content-length e cortada no limite, e a conexao encerrada', async () => {
    const site = await servidor({
      '/': emPedacos(Array.from({ length: 40 }, (_, i) => `<p>bloco ${i} ${'y'.repeat(200)}</p>`)),
    });
    const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });

    const resultado = await fetcher.fetch(site.url('/'), { maxBytes: 500 });
    expect(resultado.truncated).toBe(true);
    expect(Buffer.byteLength(resultado.body, 'utf8')).toBeLessThanOrEqual(500);
  });

  it('tipo de conteudo inesperado e recusado sem baixar o corpo', async () => {
    const site = await servidor({
      '/arquivo': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end('%PDF-1.4');
      },
    });
    const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });

    const erro = await fetcher.fetch(site.url('/arquivo')).catch((e: unknown) => e);
    expect((erro as SiteFetchError).reason).toBe('tipo_recusado');
  });

  it('imagem de verdade volta como bytes', async () => {
    // PNG 1x1 valido.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const site = await servidor({
      '/logo.png': (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.byteLength) });
        res.end(png);
      },
    });
    const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });

    const resultado = await fetcher.fetch(site.url('/logo.png'), { accept: 'image', wantBytes: true });
    expect(resultado.contentType).toBe('image/png');
    expect(resultado.bytes).not.toBeNull();
    expect(Buffer.from(resultado.bytes!).equals(png)).toBe(true);
  });
});

describe('a porta de teste nao existe fora do teste', () => {
  it('sem a lista, o mesmo servidor local e recusado', async () => {
    const site = await servidor({ '/': html(PAGINA) });
    const fetcher = createSiteFetcher();

    const erro = await fetcher.fetch(site.url('/')).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(SiteFetchError);
    // Porta fora de 80/443 ja basta para recusar.
    expect((erro as SiteFetchError).reason).toBe('endereco_recusado');
  });

  it('em producao a lista e descartada, mesmo se alguem a preencher', async () => {
    const site = await servidor({ '/': html(PAGINA) });
    const anterior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const fetcher = createSiteFetcher({ testOrigins: { [site.origin]: site.origin } });
      const erro = await fetcher.fetch(site.url('/')).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(SiteFetchError);
      expect((erro as SiteFetchError).reason).toBe('endereco_recusado');
    } finally {
      process.env.NODE_ENV = anterior;
    }
  });

  it('a aplicacao nunca liga a porta: nenhum arquivo de `apps/` passa testOrigins', () => {
    /*
     * Le o codigo-fonte, e nao a funcao compilada: depois de transpilar, a
     * chamada vira `fetcher_js_1.createSiteFetcher()` e a conferencia sobre o
     * texto perderia o sentido.
     *
     * Se um dia alguem ligar a porta na aplicacao, este teste quebra -- e e
     * para quebrar.
     */
    const raiz = fileURLToPath(new URL('../../apps/', import.meta.url));
    // Os dois unicos lugares onde a palavra pode aparecer: onde a opcao e
    // declarada, e o `index.ts` que a reexporta e a documenta.
    const permitidos = ['api/src/lib/import/fetcher.ts', 'api/src/index.ts'];
    const culpados = listarTs(raiz)
      .filter((caminho) => readFileSync(caminho, 'utf8').includes('testOrigins'))
      .map((caminho) => caminho.slice(raiz.length).replaceAll('\\', '/'))
      .filter((relativo) => !permitidos.includes(relativo));
    expect(culpados).toEqual([]);

    // E o contexto monta o fetcher sem argumento nenhum.
    const contexto = readFileSync(fileURLToPath(new URL('../../apps/api/src/context.ts', import.meta.url)), 'utf8');
    expect(contexto).toContain('createSiteFetcher()');
  });
});

/** Todo `.ts`/`.tsx` sob um diretorio, ignorando o que e gerado. */
function listarTs(diretorio: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(diretorio)) {
    if (nome === 'node_modules' || nome === 'dist' || nome === '.tsbuild') continue;
    const caminho = join(diretorio, nome);
    if (statSync(caminho).isDirectory()) achados.push(...listarTs(caminho));
    else if (caminho.endsWith('.ts') || caminho.endsWith('.tsx')) achados.push(caminho);
  }
  return achados;
}
