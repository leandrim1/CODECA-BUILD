import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SiteFetchError,
  addressLookup,
  createMemorySiteFetcher,
  createSiteFetcher,
} from '@codeca/api';
import { readDimensions, sniffImageType } from '../../apps/api/src/lib/import/images.js';

/**
 * Barreiras da busca de paginas externas.
 *
 * Aqui nao se testa extracao: testa-se **o que o servidor se recusa a
 * acessar**. Um falso negativo neste arquivo e uma falha de seguranca -- o
 * servidor buscando um endereco da rede interna a mando de quem digitou uma
 * URL no painel.
 *
 * O teste principal e o primeiro: um servidor de verdade escutando em
 * `127.0.0.1`, que responde a qualquer cliente HTTP, e que a busca **recusa**.
 * Ele prova a protecao de um jeito que uma asercao sobre uma string nao prova.
 */

let servidorLocal: Server;
let portaLocal = 0;

beforeAll(async () => {
  servidorLocal = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><h1>Serviço interno que ninguém deveria alcançar daqui</h1></body></html>');
  });
  await new Promise<void>((resolve) => {
    servidorLocal.listen(0, '127.0.0.1', () => resolve());
  });
  const address = servidorLocal.address();
  portaLocal = typeof address === 'object' && address !== null ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidorLocal.close(() => resolve()));
});

describe('a busca recusa o que nao e site publico', () => {
  const fetcher = createSiteFetcher();

  /**
   * O teste que importa.
   *
   * O servidor existe, responde 200 e qualquer `fetch` comum o alcancaria. A
   * busca da importacao nao alcanca -- e e assim que se sabe que a protecao
   * nao e so uma string bem escrita.
   */
  it('nao acessa um servidor que esta de fato escutando em 127.0.0.1', async () => {
    expect(portaLocal).toBeGreaterThan(0);

    // Confere que o servidor responde mesmo, para o teste nao passar por engano.
    const direto = await fetch(`http://127.0.0.1:${portaLocal}/`);
    expect(direto.status).toBe(200);
    expect(await direto.text()).toContain('Serviço interno');

    await expect(fetcher.fetch(`http://127.0.0.1:${portaLocal}/`)).rejects.toThrow(SiteFetchError);
  });

  it('recusa localhost pelo nome, sem nem consultar o DNS', async () => {
    await expect(fetcher.fetch('http://localhost/')).rejects.toMatchObject({
      reason: 'endereco_recusado',
    });
  });

  /**
   * `169.254.169.254` responde, sem autenticacao, com as credenciais da
   * maquina na AWS, GCP, Azure e Oracle. E o alvo classico de um SSRF.
   */
  it('recusa o endereco de metadados das nuvens', async () => {
    await expect(fetcher.fetch('http://169.254.169.254/latest/meta-data/')).rejects.toMatchObject({
      reason: 'endereco_recusado',
    });
    await expect(fetcher.fetch('http://metadata.google.internal/')).rejects.toMatchObject({
      reason: 'endereco_recusado',
    });
  });

  it.each([
    ['http://10.0.0.5/'],
    ['http://192.168.1.1/'],
    ['http://172.16.0.1/'],
    ['http://[::1]/'],
    ['http://[fd00::1]/'],
  ])('recusa %s', async (url) => {
    await expect(fetcher.fetch(url)).rejects.toThrow(SiteFetchError);
  });

  it('recusa protocolo que nao e http nem https', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://exemplo.com/', 'gopher://exemplo.com/']) {
      await expect(fetcher.fetch(url)).rejects.toMatchObject({ reason: 'endereco_recusado' });
    }
  });

  /**
   * Porta diferente de 80/443 nao e usada por site publico, e e o que um SSRF
   * usaria para varrer servicos internos (Redis em 6379, Postgres em 5432...).
   */
  it('recusa porta fora de 80 e 443', async () => {
    await expect(fetcher.fetch('http://exemplo.com:6379/')).rejects.toMatchObject({
      reason: 'endereco_recusado',
    });
  });

  it('recusa endereco com usuario e senha embutidos', async () => {
    await expect(fetcher.fetch('http://usuario:senha@exemplo.com/')).rejects.toThrow(SiteFetchError);
  });
});

describe('redirecionamento', () => {
  /**
   * Um salto e um endereco novo, e passa pelas mesmas barreiras.
   *
   * E o furo classico: o site responde 200 numa primeira conferencia e depois
   * devolve 302 para `http://169.254.169.254/`. Seguir sem revalidar seria ter
   * as duas barreiras e deixar a porta dos fundos aberta.
   */
  it('o destino do salto e conferido de novo', async () => {
    const fetcher = createMemorySiteFetcher({
      'https://exemplo.com/': { location: 'http://169.254.169.254/latest/meta-data/' },
    });
    await expect(fetcher.fetch('https://exemplo.com/')).rejects.toThrow(SiteFetchError);
  });

  it('segue redirecionamento para endereco publico', async () => {
    const fetcher = createMemorySiteFetcher({
      'https://exemplo.com/': { location: 'https://exemplo.com/inicio' },
      'https://exemplo.com/inicio': { body: '<html><body>ok</body></html>' },
    });
    const resource = await fetcher.fetch('https://exemplo.com/');
    expect(resource.status).toBe(200);
    expect(resource.body).toContain('ok');
    expect(resource.redirects).toEqual(['https://exemplo.com/inicio']);
  });

  it('para depois de saltos demais', async () => {
    const fetcher = createMemorySiteFetcher({
      'https://exemplo.com/a': { location: '/b' },
      'https://exemplo.com/b': { location: '/c' },
      'https://exemplo.com/c': { location: '/d' },
      'https://exemplo.com/d': { location: '/e' },
      'https://exemplo.com/e': { location: '/a' },
    });
    await expect(fetcher.fetch('https://exemplo.com/a')).rejects.toMatchObject({
      reason: 'muitos_redirecionamentos',
    });
  });
});

/**
 * O contrato do `lookup`, que derrubou a funcionalidade inteira em producao.
 *
 * A busca entrega a conexao o IP que acabou de validar, por `options.lookup`.
 * O formato da resposta **muda conforme o `options.all` que o Node pede**, e
 * esse detalhe nao aparece em nenhuma asercao sobre strings: a versao
 * anterior respondia sempre `(null, endereco, familia)`, o Node 20+ pede
 * `all: true` por causa do `autoSelectFamily`, e o soquete morria com
 * `ERR_INVALID_IP_ADDRESS` antes de qualquer pacote sair. Nenhum site era
 * lido, nem na importacao nem na sincronizacao.
 *
 * Nada disso era visivel nos testes porque os de ponta a ponta usam o
 * `createMemorySiteFetcher`, que nao toca a rede, e os de barreira recusam o
 * endereco **antes** de conectar. O caminho de conexao real nao tinha teste.
 *
 * Por isso estes testes conectam de verdade: um servidor local, o `lookup` da
 * busca, e uma resposta que so chega se a conexao acontecer.
 */
describe('o lookup entrega os enderecos validados a conexao', () => {
  it('responde em lista quando o Node pede `all` -- o caso que quebrou', async () => {
    const recebido = await new Promise<unknown>((resolve) => {
      addressLookup([{ address: '127.0.0.1', family: 4 }])(
        'exemplo.invalido',
        { all: true },
        (_erro: unknown, resultado: unknown) => resolve(resultado),
      );
    });
    expect(recebido).toEqual([{ address: '127.0.0.1', family: 4 }]);
  });

  it('responde em endereco solto quando o Node nao pede `all`', async () => {
    const recebido = await new Promise<unknown[]>((resolve) => {
      addressLookup([{ address: '127.0.0.1', family: 4 }])(
        'exemplo.invalido',
        { all: false },
        (_erro: unknown, endereco: unknown, familia: unknown) => resolve([endereco, familia]),
      );
    });
    expect(recebido).toEqual(['127.0.0.1', 4]);
  });

  it('uma requisicao de verdade chega ao servidor usando esse lookup', async () => {
    // Prova de ponta a ponta do contrato: o nome nao existe no DNS, entao a
    // resposta so chega se a conexao tiver usado o endereco que entregamos.
    const corpo = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: 'nome-que-nao-existe.invalido',
          port: portaLocal,
          path: '/',
          method: 'GET',
          headers: { host: 'nome-que-nao-existe.invalido' },
          lookup: addressLookup([{ address: '127.0.0.1', family: 4 }]),
          timeout: 5_000,
        },
        (res) => {
          let texto = '';
          res.setEncoding('utf-8');
          res.on('data', (parte) => {
            texto += parte;
          });
          res.on('end', () => resolve(texto));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('tempo esgotado'));
      });
      req.end();
    });

    expect(corpo).toContain('Serviço interno');
  });

  it('entrega todos os enderecos validados, para a conexao tentar o seguinte', async () => {
    // Um nome com varios A nao pode depender da ordem que o DNS devolveu: o
    // primeiro endereco aqui nao atende, e a resposta so chega pelo segundo.
    const recebido = await new Promise<unknown>((resolve) => {
      addressLookup([
        { address: '192.0.2.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ])('exemplo.invalido', { all: true }, (_erro: unknown, resultado: unknown) =>
        resolve(resultado),
      );
    });
    expect(recebido).toEqual([
      { address: '192.0.2.1', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
  });
});

describe('tipo real do arquivo', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNk+M/AwMDAxMDAwAAABicBAp9rjKkAAAAASUVORK5CYII=',
    'base64',
  );

  it('reconhece PNG, GIF e JPEG pelos bytes', () => {
    expect(sniffImageType(new Uint8Array(png))).toBe('image/png');

    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(16)]);
    expect(sniffImageType(new Uint8Array(gif))).toBe('image/gif');

    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
    expect(sniffImageType(new Uint8Array(jpeg))).toBe('image/jpeg');
  });

  it('reconhece WEBP e AVIF', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.alloc(4),
      Buffer.from('WEBPVP8 ', 'latin1'),
      Buffer.alloc(24),
    ]);
    expect(sniffImageType(new Uint8Array(webp))).toBe('image/webp');

    const avif = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif', 'latin1'), Buffer.alloc(16)]);
    expect(sniffImageType(new Uint8Array(avif))).toBe('image/avif');
  });

  /**
   * O `content-type` do servidor de origem nao decide nada. Um site hostil
   * declara `image/png` para um script; os bytes nao mentem.
   */
  it('nao aceita arquivo que apenas se diz imagem', () => {
    const php = Buffer.from('<?php system($_GET["c"]); ?>'.repeat(50));
    expect(sniffImageType(new Uint8Array(php))).toBeNull();

    const html = Buffer.from('<!doctype html><html><body>oi</body></html>');
    expect(sniffImageType(new Uint8Array(html))).toBeNull();

    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)]);
    expect(sniffImageType(new Uint8Array(zip))).toBeNull();
  });

  it('reconhece SVG, que a importacao depois recusa por ser documento', () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffImageType(new Uint8Array(svg))).toBe('image/svg+xml');
  });

  it('le a dimensao real do arquivo', () => {
    expect(readDimensions(new Uint8Array(png), 'image/png')).toEqual({ width: 2, height: 2 });

    // GIF: largura e altura em 16 bits, little-endian, nos bytes 6 a 9.
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(16)]);
    gif.writeUInt16LE(120, 6);
    gif.writeUInt16LE(80, 8);
    expect(readDimensions(new Uint8Array(gif), 'image/gif')).toEqual({ width: 120, height: 80 });
  });

  it('devolve nulo em arquivo truncado, sem lancar', () => {
    expect(readDimensions(new Uint8Array(Buffer.alloc(4)), 'image/png')).toBeNull();
    expect(readDimensions(new Uint8Array(Buffer.alloc(4)), 'image/jpeg')).toBeNull();
  });
});
