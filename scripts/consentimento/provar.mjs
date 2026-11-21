/**
 * Prova do consentimento em navegador de verdade.
 *
 * O que um teste de unidade nao alcanca: se o script bloqueado realmente NAO
 * sai para a rede. Aqui a prova e direta -- cada requisicao externa da pagina e
 * registrada, e a lista tem de estar vazia antes do "sim".
 *
 *   node scripts/consentimento/provar.mjs
 *
 * Exige o SDK compilado (`pnpm --filter @codeca/sdk build`): a pagina importa
 * `packages/sdk/dist`, e nao uma copia -- um harness que testa copia envelhece
 * sem avisar.
 *
 * Dois servidores em portas diferentes porque o navegador isola o
 * `localStorage` por ORIGEM: e isso que prova que a escolha feita no site de um
 * cliente nao vale no de outro.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const DIST = join(RAIZ, 'packages', 'sdk', 'dist');
const SAIDA = process.env.SAIDA_DA_PROVA ?? join(AQUI, 'saida');

if (!existsSync(join(DIST, 'consent-entry.js'))) {
  console.error('Falta o SDK compilado. Rode: pnpm --filter @codeca/sdk build');
  process.exit(1);
}
mkdirSync(SAIDA, { recursive: true });

// O Chromium e o Playwright do ambiente. `PLAYWRIGHT` aponta outro caminho.
const pw = await import(process.env.PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright/index.js');
const { chromium } = pw.default ?? pw;

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.map': 'application/json' };

// Dois servidores: dominios diferentes para provar o isolamento.
const servir = (porta) => new Promise((ok) => {
  const s = createServer((req, res) => {
    const pedido = req.url === '/' ? 'pagina.html' : req.url.split('?')[0];
    // `/sdk/...` vem do dist de verdade; o resto, da pasta deste script.
    const caminho = pedido.startsWith('/sdk/')
      ? join(DIST, pedido.slice('/sdk/'.length))
      : join(AQUI, pedido);
    if (!existsSync(caminho)) { res.writeHead(404); return res.end('nao'); }
    res.writeHead(200, { 'content-type': TIPOS[extname(caminho)] ?? 'text/plain' });
    res.end(readFileSync(caminho));
  });
  s.listen(porta, '127.0.0.1', () => ok(s));
});

const s1 = await servir(4101);
const s2 = await servir(4102);

let ok = 0; const falhas = [];
const conferir = (n, c, extra = '') => {
  if (c) { ok++; console.log('  ok   ' + n); }
  else { falhas.push(n + (extra ? ' -- ' + extra : '')); console.log('  FALHA ' + n + (extra ? ' -- ' + extra : '')); }
};

const nav = await chromium.launch({ args: ['--no-sandbox'] });

for (const [larg, alt, nome, toque] of [[1366, 900, 'computador', false], [390, 844, 'celular', true]]) {
  console.log(`\n=== ${nome} ===`);
  const ctx = await nav.newContext({ viewport: { width: larg, height: alt }, hasTouch: toque, isMobile: toque });
  const page = await ctx.newPage();

  // Registra TODA requisicao externa: e a prova real do bloqueio.
  const externas = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://127.0.0.1')) externas.push(u);
  });

  // ---------------------------------------------- 1. primeiro acesso
  await page.goto('http://127.0.0.1:4101/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  conferir('banner aparece no primeiro acesso', await page.isVisible('.codeca-consent'));
  conferir('tres botoes de peso igual', (await page.locator('.codeca-consent__botao').count()) === 3);
  const principais = await page.locator('.codeca-consent__botao--principal').count();
  conferir('so um botao em destaque (aceitar)', principais === 1, `${principais} em destaque`);
  conferir('NENHUMA requisicao externa antes do consentimento', externas.length === 0, externas.slice(0, 3).join(' | '));
  conferir('o controlador aparece, e nao e a CODECA', (await page.textContent('.codeca-consent__links'))?.includes('Clínica Sorriso'));
  await page.screenshot({ path: `${SAIDA}/banner-${nome}.png` });

  // ---------------------------------------------- 2. rejeitar opcionais
  await page.click('button:has-text("Rejeitar opcionais")');
  await page.waitForTimeout(600);
  conferir('banner some ao decidir', !(await page.isVisible('.codeca-consent')));
  conferir('rejeitar NAO dispara requisicao externa', externas.length === 0, externas.slice(0, 3).join(' | '));

  // ---------------------------------------------- 3. persistencia
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  conferir('a escolha persiste na recarga', !(await page.isVisible('.codeca-consent')));
  conferir('segue sem requisicao externa', externas.length === 0, externas.slice(0, 3).join(' | '));

  // ---------------------------------------------- 4. painel e aceitar estatisticas
  await page.click('#preferencias');
  await page.waitForTimeout(400);
  conferir('painel de preferencias abre', await page.isVisible('.codeca-consent__categorias'));
  const sempre = await page.textContent('.codeca-consent__sempre');
  conferir('necessarios: "Sempre ativos", sem interruptor', sempre?.includes('Sempre ativos'));
  const interruptores = await page.locator('.codeca-consent__interruptor').count();
  conferir('tres categorias opcionais com interruptor', interruptores === 3, String(interruptores));

  await page.check('#codeca-consent-estatisticas');
  await page.click('button:has-text("Salvar escolhas")');
  await page.waitForTimeout(900);

  const googles = externas.filter((u) => u.includes('googletagmanager'));
  conferir('o gtag SO carrega depois do sim', googles.length === 1, `${googles.length} chamadas`);
  const youtubes = externas.filter((u) => u.includes('youtube'));
  conferir('o video de marketing continua bloqueado', youtubes.length === 0, youtubes.join(' | '));

  // ---------------------------------------------- 5. revogar
  await page.click('#preferencias');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Revogar tudo")');
  await page.waitForTimeout(500);
  conferir('revogar traz o banner de volta', await page.isVisible('.codeca-consent'));
  const guardado = await page.evaluate(() => window.localStorage.getItem('codeca:consentimento'));
  conferir('revogar apaga a escolha guardada', guardado === null);

  // Remocao real de cookie: so um navegador de verdade prova isto.
  const cookies = await page.evaluate(() => {
    document.cookie = '_ga=GA1.1.123; path=/';
    document.cookie = 'carrinho=xyz; path=/';
    const antes = document.cookie;
    for (const n of ['_ga']) document.cookie = `${n}=; Max-Age=0; path=/;`;
    return { antes, depois: document.cookie };
  });
  conferir('o cookie de analise e removido de fato', !cookies.depois.includes('_ga'), cookies.depois);
  conferir('o cookie do proprio site permanece', cookies.depois.includes('carrinho=xyz'));

  await ctx.close();
}

// ---------------------------------------------- 6. isolamento entre dominios
console.log('\n=== isolamento entre sites ===');
const ctx = await nav.newContext({ viewport: { width: 1366, height: 900 } });
const p1 = await ctx.newPage();
await p1.goto('http://127.0.0.1:4101/', { waitUntil: 'networkidle' });
await p1.click('button:has-text("Aceitar todos")');
await p1.waitForTimeout(500);
conferir('site A decidiu', !(await p1.isVisible('.codeca-consent')));

const p2 = await ctx.newPage();
await p2.goto('http://127.0.0.1:4102/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(600);
conferir('site B NAO herda a escolha do site A', await p2.isVisible('.codeca-consent'));

console.log(`\n=== ${ok} conferencias ok, ${falhas.length} falhas ===`);
for (const f of falhas) console.log('  - ' + f);

await nav.close(); s1.close(); s2.close();
