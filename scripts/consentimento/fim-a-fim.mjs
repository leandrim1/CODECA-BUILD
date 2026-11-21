/**
 * Prova do caminho inteiro: painel -> API -> navegador -> banco.
 *
 * O outro script (`provar.mjs`) exercita o mecanismo isolado. Este exercita a
 * ligacao: configura os cookies de um site pelo painel mestre, emite a chave,
 * abre o site do cliente NOUTRA origem e confere que a configuracao chega ao
 * banner e que a escolha volta para a plataforma.
 *
 * Foi aqui que apareceu o defeito do `sendBeacon`: oito conferencias passavam,
 * o banner funcionava, e o registro simplesmente nao aparecia no banco --
 * porque o navegador descartava a requisicao em silencio por causa do modo de
 * credenciais. Nenhum teste de unidade pega isso.
 *
 * Exige o servidor local do painel no ar:
 *
 *   node <vite-node> --config vitest.config.ts scripts/loadtest/ui-import-server.ts
 *   node scripts/consentimento/fim-a-fim.mjs
 *
 * O painel precisa estar em `http://localhost:4010` -- e o `APP_URL` que
 * aquele servidor usa, e por `127.0.0.1` toda escrita autenticada falha na
 * conferencia de origem.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIST = join(AQUI, '..', '..', 'packages', 'sdk', 'dist');
const API = process.env.API ?? 'http://localhost:4010';

if (!existsSync(join(DIST, 'consent-entry.js'))) {
  console.error('Falta o SDK compilado. Rode: pnpm --filter @codeca/sdk build');
  process.exit(1);
}

const pw = await import(process.env.PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright/index.js');
const { chromium } = pw.default ?? pw;

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.map': 'application/json' };

createServer((req, res) => {
  const bruto = req.url.split('?')[0];
  const pedido = bruto === '/' ? '/site-do-cliente.html' : bruto;
  const caminho = pedido.startsWith('/sdk/') ? join(DIST, pedido.slice(5)) : join(AQUI, pedido);
  if (!existsSync(caminho) || !statSync(caminho).isFile()) { res.writeHead(404); return res.end('nao'); }
  res.writeHead(200, { 'content-type': TIPOS[extname(caminho)] ?? 'text/plain' });
  res.end(readFileSync(caminho));
}).listen(4101, '127.0.0.1');

let ok = 0; const falhas = [];
const conferir = (n, c, extra = '') => {
  if (c) { ok++; console.log('  ok   ' + n); }
  else { falhas.push(n); console.log('  FALHA ' + n + (extra ? ' -- ' + extra : '')); }
};

const nav = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await nav.newContext({ viewport: { width: 1280, height: 860 } });
const admin = await ctx.newPage();
await admin.goto(`${API}/__entrar?plataforma=1`, { waitUntil: 'networkidle' });

// Descobre o site e prepara chave, origem e configuracao, pela API real.
const api = async (metodo, caminho, corpo) =>
  admin.evaluate(async ([m, p, b]) => {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('codeca_csrf='))?.slice('codeca_csrf='.length) ?? '';
    const r = await fetch(p, {
      method: m,
      headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf) },
      body: b ? JSON.stringify(b) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [metodo, caminho, corpo ?? null]);

const sites = await api('GET', '/api/platform/sites');
const siteId = sites.body.data.items[0].id;

await api('PUT', `/api/platform/sites/${siteId}/origins`, {
  origins: [{ origin: 'http://localhost:4101', note: 'prova' }],
});
const conf = await api('PUT', `/api/platform/sites/${siteId}/cookies`, {
  controllerName: 'Clínica Sorriso Ltda.',
  controllerDocument: '',
  controllerContact: '',
  privacyPolicyUrl: 'https://sorriso.test/privacidade',
  cookiePolicyUrl: 'https://sorriso.test/cookies',
  policyVersion: '9',
  bannerEnabled: true,
  recordConsent: true,
  tools: [{ key: 'ga', name: 'Google Analytics', provider: 'Google', category: 'estatisticas', purpose: 'medir', cookies: ['_ga'], privacyUrl: '' }],
});
conferir('painel aceitou a configuracao', conf.status === 200, JSON.stringify(conf.body).slice(0, 200));

// Quantos registros ja existem: o servidor local guarda estado entre
// execucoes, e comparar com zero daria falso negativo na segunda rodada.
const antes = (await api('GET', `/api/platform/sites/${siteId}/cookies/records`)).body?.data?.total ?? 0;

const chave = await api('POST', `/api/platform/sites/${siteId}/keys`, { kind: 'publishable', name: 'prova' });
const token = chave.body.data.key.token;
conferir('chave publicavel emitida', typeof token === 'string' && token.startsWith('cb_pub_'));

// Agora o site do cliente, noutra origem.
const visitante = await nav.newContext({ viewport: { width: 1280, height: 860 } });
const page = await visitante.newPage();
const externas = [];
// O console do navegador e onde a recusa de CORS aparece -- e a unica pista
// quando o registro nao chega.
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text()); });
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith('http://localhost:4101') && !u.startsWith('http://localhost:4010') && !u.startsWith('data:')) externas.push(u);
});
await page.goto(`http://localhost:4101/?k=${encodeURIComponent(token)}`, { waitUntil: 'networkidle' });
await page.evaluate(() => window.__pronto);
await page.waitForTimeout(800);

const texto = await page.locator('.codeca-consent').innerText().catch(() => '');
conferir('banner apareceu', texto.length > 0);
conferir('o controlador do painel chegou ao banner', texto.includes('Clínica Sorriso Ltda.'), texto.slice(0, 160));
conferir('a versao do painel venceu a do codigo',
  await page.evaluate(() => window.__r?.settings?.policyVersion) === '9');
conferir('nenhuma requisicao externa antes do consentimento', externas.length === 0, externas.join(', '));

// Recusa: o registro tem de chegar na plataforma, e o script continuar fora.
await page.getByRole('button', { name: /Rejeitar opcionais/i }).click();
await page.waitForTimeout(2500);
conferir('o gtag continua fora da pagina', externas.length === 0, externas.join(', '));

const registros = await api('GET', `/api/platform/sites/${siteId}/cookies/records`);
const itens = registros.body?.data?.items ?? [];
conferir(
  'a plataforma recebeu o registro',
  (registros.body?.data?.total ?? 0) === antes + 1,
  `antes ${antes}, agora ${registros.body?.data?.total}`,
);
if (itens[0]) {
  conferir('o registro traz so o necessario', itens[0].granted.join() === 'necessarios' && itens[0].domain === 'localhost');
  conferir('a versao gravada e a do painel', itens[0].policyVersion === '9');
}

// Aceitar depois: o script entra.
await page.evaluate(() => window.__r.manager.aceitarTudo());
await page.waitForTimeout(1500);
conferir('o gtag so entra depois do sim', externas.some((u) => u.includes('googletagmanager')), externas.join(', '));

console.log(`\n=== ${ok} conferencias ok, ${falhas.length} falhas ===`);
await nav.close();
process.exit(falhas.length ? 1 : 0);
