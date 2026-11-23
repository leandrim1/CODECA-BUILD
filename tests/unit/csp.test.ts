import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A politica de seguranca de conteudo nao pode envelhecer em silencio.
 *
 * O painel e um SPA servido como arquivo estatico pela Vercel: nao ha servidor
 * para gerar um `nonce` por resposta, entao os dois roteiros embutidos no
 * `index.html` sao autorizados por **hash**. E uma troca consciente -- o hash
 * nao custa nada em tempo de execucao --, com um defeito obvio: mexer no HTML
 * muda o hash, e a politica passa a bloquear o proprio painel.
 *
 * Em producao isso apareceria como tela branca. Aqui aparece como teste
 * vermelho, que e onde deve aparecer.
 */

const html = readFileSync('apps/web/index.html', 'utf-8');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf-8')) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

/** Hash no formato que o CSP entende, calculado sobre o conteudo do script. */
function hashesDosScriptsEmbutidos(): string[] {
  const achados: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const digest = createHash('sha256').update(m[1]!, 'utf-8').digest('base64');
    achados.push(`'sha256-${digest}'`);
  }
  return achados;
}

const regraGeral = vercel.headers.find((h) => h.source === '/(.*)');
const cabecalho = (chave: string) =>
  regraGeral?.headers.find((h) => h.key.toLowerCase() === chave)?.value ?? null;

const csp = cabecalho('content-security-policy') ?? cabecalho('content-security-policy-report-only');

describe('politica de seguranca de conteudo', () => {
  it('existe uma politica declarada para o documento', () => {
    expect(csp, 'nenhum CSP em vercel.json').toBeTruthy();
  });

  it('todo roteiro embutido no index.html esta autorizado por hash', () => {
    const hashes = hashesDosScriptsEmbutidos();
    // Se um dia nao houver mais roteiro embutido, o teste nao deve passar
    // vazio: isso esconderia a remocao acidental da propria protecao.
    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) {
      expect(csp, `roteiro embutido sem hash no CSP: ${hash}`).toContain(hash);
    }
  });

  it('o CSP nao tem hash sobrando de roteiro que nao existe mais', () => {
    const hashes = new Set(hashesDosScriptsEmbutidos());
    for (const m of (csp ?? '').matchAll(/'sha256-[A-Za-z0-9+/=]+'/g)) {
      expect(hashes, `hash sem roteiro correspondente: ${m[0]}`).toContain(m[0]);
    }
  });

  it('script-src nao afrouxa com unsafe-inline nem unsafe-eval', () => {
    const scriptSrc = /script-src ([^;]+)/.exec(csp ?? '')?.[1] ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('fecha as diretivas que nao caem no default-src', () => {
    for (const diretiva of ['base-uri', 'object-src', 'frame-ancestors', 'form-action']) {
      expect(csp, `falta ${diretiva}`).toContain(diretiva);
    }
  });
});

describe('cabecalhos do documento', () => {
  /*
    Estes valem para o HTML servido pela Vercel. A API tem os seus proprios
    (`middleware/security.ts`), e um nao cobre o outro: o painel e um arquivo
    estatico que nunca passa pela funcao.
  */
  it('o documento recebe os mesmos cuidados que a API', () => {
    expect(cabecalho('x-content-type-options')).toBe('nosniff');
    expect(cabecalho('x-frame-options')).toBe('DENY');
    expect(cabecalho('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(cabecalho('cross-origin-opener-policy')).toBe('same-origin');
    expect(cabecalho('strict-transport-security')).toContain('max-age=31536000');
    expect(cabecalho('permissions-policy')).toContain('geolocation=()');
  });
});
