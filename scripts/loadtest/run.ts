/**
 * Gerador de carga: usuarios virtuais (VUs) que usam a plataforma de verdade.
 *
 *   pnpm exec vite-node --config vitest.config.ts scripts/loadtest/run.ts -- \
 *     --vus 100 --duration 30 --ramp 5 --panel 0.7
 *
 * Dois tipos de usuario, na proporcao `--panel` (padrao 70% painel, 30% visitantes):
 *
 * - **Painel**: faz login (scrypt de verdade), abre sessao, visao geral, lista de
 *   imoveis (paginada), detalhe, modulos, leads, EDITA um imovel, cria imoveis,
 *   envia imagem. Pensa 0,3-0,9 s entre passos.
 * - **Visitante do site de um cliente**: le a API publica com a chave secreta da
 *   empresa (site, lista de imoveis, detalhe, banners), sem pausa.
 *
 * Nao basta "ficou no ar". Ao final, o runner confere a INTEGRIDADE:
 *
 * - **isolamento**: toda linha devolvida a um usuario da empresa N tem a marca
 *   `T<N>`; uma so de outra empresa reprova o teste;
 * - **sem perda nem duplicacao**: o que o servidor confirmou (201) e exatamente o
 *   que esta no banco, e nenhum `slug` se repete dentro de uma empresa;
 * - **limite do plano**: nenhuma empresa passa do limite de conteudos mesmo com
 *   criacoes concorrentes;
 * - **edicoes**: o ultimo titulo confirmado de cada imovel editado e o que esta
 *   gravado.
 */
import { readFileSync } from 'node:fs';

interface TenantFixture {
  i: number;
  email: string;
  tenantId: string;
  siteId: string;
  apiKey: string;
  propertyIds: string[];
}

const args = new Map<string, string>();
const raw = process.argv.slice(2).filter((a) => a !== '--');
for (let n = 0; n < raw.length; n += 2) args.set(raw[n]!.replace(/^--/, ''), raw[n + 1] ?? '');
const VUS = Number(args.get('vus') ?? 50);
const DURATION = Number(args.get('duration') ?? 30);
const RAMP = Number(args.get('ramp') ?? Math.min(10, Math.ceil(VUS / 25)));
const PANEL_SHARE = Number(args.get('panel') ?? 0.7);
const BASE = args.get('base') ?? 'http://localhost:3999';
const FIXTURE = args.get('fixture') ?? '/tmp/loadtest-tenants.json';
const LABEL = args.get('label') ?? `${VUS}vus`;
const THINK_MS: [number, number] = [Number(args.get('think-min') ?? 300), Number(args.get('think-max') ?? 900)];

const VISITOR_THINK_MS: [number, number] = [Number(args.get('visitor-think-min') ?? 700), Number(args.get('visitor-think-max') ?? 1800)];

const { password, tenants } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { password: string; tenants: TenantFixture[] };

// ------------------------------------------------------------- metricas

const lat = new Map<string, number[]>();
const statusCount = new Map<string, number>();
const problems: string[] = [];
let totalRequests = 0;
let serverErrors = 0;
let networkErrors = 0;
let unexpected4xx = 0;
let rateLimited429 = 0;
let shed503 = 0;
const record = (op: string, ms: number, status: number) => {
  totalRequests += 1;
  (lat.get(op) ?? lat.set(op, []).get(op)!).push(ms);
  const key = `${op} ${status}`;
  statusCount.set(key, (statusCount.get(key) ?? 0) + 1);
};
const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
};

// ------------------------------------------------------- integridade

const crossTenantLeaks: string[] = [];
const created = new Map<string, Set<string>>(); // tenantId -> titulos confirmados (201)
const createdSlugsByTenant = new Map<string, number>();
const lastTitle = new Map<string, string>(); // propertyId -> ultimo titulo confirmado
const planLimit402 = { n: 0 };

// -------------------------------------------------------------- HTTP

interface Vu {
  id: number;
  tenant: TenantFixture;
  cookies: Map<string, string>;
  csrf: string;
  ip: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const deadline = Date.now() + (RAMP + DURATION) * 1000;
const running = () => Date.now() < deadline;

async function callOnce(
  vu: Vu | null,
  op: string,
  method: string,
  path: string,
  options: { body?: unknown; form?: FormData; headers?: Record<string, string>; okStatuses?: number[] } = {},
): Promise<{ status: number; json: any; ms: number } | null> {
  const headers: Record<string, string> = { origin: BASE, ...options.headers };
  if (vu) {
    headers['x-forwarded-for'] = vu.ip;
    if (vu.cookies.size > 0) headers.cookie = [...vu.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET' && vu.csrf) headers['x-csrf-token'] = vu.csrf;
  }
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, { method, headers, body, signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    const ms = performance.now() - t0;
    record(op, ms, res.status);
    if (vu) {
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(';');
        const idx = pair!.indexOf('=');
        if (idx > 0) {
          const name = pair!.slice(0, idx);
          const value = pair!.slice(idx + 1);
          if (/Max-Age=0/i.test(sc)) vu.cookies.delete(name);
          else vu.cookies.set(name, value);
          if (name === 'codeca_csrf') vu.csrf = decodeURIComponent(value);
        }
      }
    }
    if (res.status === 429) rateLimited429 += 1;
    if (res.status === 503 && /service_unavailable/.test(text)) {
      // Recusa controlada por sobrecarga: o servidor respondeu rapido e disse para
      // tentar de novo. NAO e erro de servidor, mas conta na taxa de falha vista pelo usuario.
      shed503 += 1;
    } else if (res.status >= 500) {
      serverErrors += 1;
      if (problems.length < 20) problems.push(`${op}: HTTP ${res.status} ${text.slice(0, 120)}`);
    } else if (res.status === 429 && (options.okStatuses ?? []).includes(429)) {
      // limite por chave: comportamento esperado do plano
    } else if (res.status >= 400 && !(options.okStatuses ?? []).includes(res.status)) {
      unexpected4xx += 1;
      if (problems.length < 20) problems.push(`${op}: HTTP ${res.status} ${text.slice(0, 120)}`);
    }
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // nao e JSON
    }
    return { status: res.status, json, ms };
  } catch (error) {
    networkErrors += 1;
    record(op, performance.now() - t0, 0);
    if (problems.length < 20) problems.push(`${op}: rede ${(error as Error).message}`);
    return null;
  }
}

/** Confere que toda linha devolvida e da empresa certa. */
function assertOwn(vu: Vu, op: string, titles: string[]) {
  const prefix = `T${vu.tenant.i} `;
  for (const t of titles) {
    if (!t.startsWith(prefix)) crossTenantLeaks.push(`${op}: VU ${vu.id} (empresa ${vu.tenant.i}) recebeu "${t}"`);
  }
}

/**
 * Como o painel de verdade: leituras recusadas por sobrecarga (503) ou por falha
 * de rede sao repetidas ate 2 vezes, esperando `Retry-After` + sorteio. Escritas
 * nunca. `finalFailures` conta o que o USUARIO viu depois das repeticoes.
 */
let finalFailures = 0;
let retriedReads = 0;
async function call(
  vu: Vu | null,
  op: string,
  method: string,
  path: string,
  options: { body?: unknown; form?: FormData; headers?: Record<string, string>; okStatuses?: number[] } = {},
) {
  const retries = method === 'GET' ? 2 : 0;
  for (let attempt = 0; ; attempt += 1) {
    const result = await callOnce(vu, op, method, path, options);
    const failed = !result || result.status === 503;
    if (!failed) return result;
    if (attempt >= retries) {
      finalFailures += 1;
      return result;
    }
    retriedReads += 1;
    await sleep(250 * 2 ** attempt + Math.random() * 400 + 1000 * Math.random());
  }
}

// ------------------------------------------------------------ cenarios

const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);

async function panelVu(vu: Vu, startDelay: number) {
  await sleep(startDelay);
  // 1. Login de verdade (scrypt no servidor).
  const login = await call(vu, 'login', 'POST', '/api/auth/login', { body: { email: vu.tenant.email, password, rememberMe: false } });
  if (!login || login.status !== 200 || login.json?.data?.status === 'code_required') return;
  const tid = vu.tenant.tenantId;
  // Cada VU edita UM imovel so dele (VUs da mesma empresa recebem imoveis diferentes):
  // dois VUs editando o mesmo registro e "ultimo grava", nao perda de dado.
  const myProperty: string | null = vu.tenant.propertyIds[Math.floor(vu.id / tenants.length) % vu.tenant.propertyIds.length] ?? null;
  let n = 0;
  while (running()) {
    n += 1;
    const s = await call(vu, 'GET sessao', 'GET', '/api/auth/session');
    if (s?.json?.data?.session?.user?.email !== vu.tenant.email && s?.status === 200) crossTenantLeaks.push(`sessao: VU ${vu.id} viu outro usuario`);
    await sleep(rand(...THINK_MS));
    await call(vu, 'GET visao-geral', 'GET', `/api/tenants/${tid}/overview`);
    await sleep(rand(...THINK_MS));
    const list = await call(vu, 'GET imoveis (lista)', 'GET', `/api/tenants/${tid}/properties?page=1&pageSize=20`);
    const items: Array<{ id: string; title: string }> = list?.json?.data?.items ?? [];
    assertOwn(vu, 'lista', items.map((x) => x.title));

    await sleep(rand(...THINK_MS));
    if (items[0]) {
      const d = await call(vu, 'GET imovel (detalhe)', 'GET', `/api/tenants/${tid}/properties/${items[Math.floor(Math.random() * items.length)]!.id}`);
      const t = d?.json?.data?.property?.title;
      if (t) assertOwn(vu, 'detalhe', [t]);
    }
    await call(vu, 'GET modulos', 'GET', `/api/tenants/${tid}/modules`);
    await sleep(rand(...THINK_MS));
    await call(vu, 'GET interessados', 'GET', `/api/tenants/${tid}/leads?page=1&pageSize=20`);

    // Edicao: o ultimo titulo confirmado de CADA imovel editado tem que ser o gravado.
    if (myProperty && n % 2 === 0) {
      const title = `T${vu.tenant.i} Imovel edit v${vu.id} n${n}`;
      const r = await call(vu, 'PATCH imovel (salvar)', 'PATCH', `/api/tenants/${tid}/properties/${myProperty}`, { body: { title } });
      if (r?.status === 200) lastTitle.set(myProperty, title);
    }
    // Criacao: o que o servidor confirma tem que estar no banco, sem duplicar.
    if (n % 4 === 0) {
      const title = `T${vu.tenant.i} Imovel novo v${vu.id} n${n}`;
      const r = await call(vu, 'POST imovel (criar)', 'POST', `/api/tenants/${tid}/properties`, {
        body: { title, type: 'apartamento', purpose: 'venda', price: 150000, publicationStatus: 'draft', commercialStatus: 'disponivel' },
        okStatuses: [402],
      });
      if (r?.status === 201) (created.get(tid) ?? created.set(tid, new Set()).get(tid)!).add(title);
      if (r?.status === 402) planLimit402.n += 1;
    }
    // Imagem pequena.
    if (n % 6 === 0) {
      const form = new FormData();
      form.set('file', new File([PNG], `vu${vu.id}-${n}.png`, { type: 'image/png' }));
      form.set('alt', 'Imagem de carga');
      form.set('width', '1');
      form.set('height', '1');
      await call(vu, 'POST midia (upload)', 'POST', `/api/tenants/${tid}/media`, { form, okStatuses: [402, 413] });
    }
    await sleep(rand(...THINK_MS));
  }
}

async function visitorVu(vu: Vu, startDelay: number) {
  await sleep(startDelay);
  const auth = { authorization: `Bearer ${vu.tenant.apiKey}` };
  let slug: string | null = null;
  while (running()) {
    await call(null, 'PUB site', 'GET', '/api/v1/site', { headers: auth, okStatuses: [429] });
    const l = await call(null, 'PUB imoveis (lista)', 'GET', '/api/v1/properties?limit=12', { headers: auth, okStatuses: [429] });
    const items: Array<{ title: string; slug: string }> = l?.json?.data?.items ?? l?.json?.data ?? [];
    if (Array.isArray(items)) assertOwn(vu, 'publica-lista', items.map((x) => x.title));
    slug = items[0]?.slug ?? slug;
    if (slug) {
      const d = await call(null, 'PUB imovel (detalhe)', 'GET', `/api/v1/properties/${slug}`, { headers: auth, okStatuses: [429] });
      const t = d?.json?.data?.title ?? d?.json?.data?.property?.title;
      if (t) assertOwn(vu, 'publica-detalhe', [t]);
    }
    await call(null, 'PUB banners', 'GET', '/api/v1/banners', { headers: auth, okStatuses: [429] });
    await sleep(rand(...VISITOR_THINK_MS));
  }
}

// --------------------------------------------------------------- main

async function serverStats() {
  return (await fetch(`${BASE}/__stats`)).json() as Promise<any>;
}

async function main() {
  await fetch(`${BASE}/__reset-stats`);
  const panelCount = Math.round(VUS * PANEL_SHARE);
  const vus: Array<Promise<void>> = [];
  for (let id = 0; id < VUS; id += 1) {
    const tenant = tenants[id % tenants.length]!;
    const vu: Vu = { id, tenant, cookies: new Map(), csrf: '', ip: `10.${(id >> 8) & 255}.${id & 255}.${(id % 200) + 1}` };
    const delay = rand(0, RAMP * 1000);
    vus.push(id < panelCount ? panelVu(vu, delay) : visitorVu(vu, delay));
  }
  const started = Date.now();
  await Promise.all(vus);
  const seconds = (Date.now() - started) / 1000;
  const stats = await serverStats();

  // ------------- integridade (depois de a carga terminar)
  const integrity: string[] = [];
  const rows = (await (await fetch(`${BASE}/__db?q=properties-by-tenant`)).json()) as Array<{ tenant_id: string; n: number; slugs: number }>;
  const byTenant = new Map(rows.map((r) => [r.tenant_id, r]));
  let overLimit = 0;
  let dupSlugs = 0;
  let missing = 0;
  for (const [tid, titles] of created) {
    const r = byTenant.get(tid);
    if (!r) continue;
    if (r.n > 100) overLimit += 1;
    if (r.slugs !== r.n) dupSlugs += 1;
    // Cada titulo confirmado existe no banco (contagem agregada: 30 iniciais + criados <= n).
    const confirmed = titles.size;
    if (r.n < 30 + confirmed) missing += 30 + confirmed - r.n;
  }
  for (const r of rows) {
    if (r.n > 100) overLimit += 1;
  }
  let wrongEdits = 0;
  for (const [id, title] of lastTitle) {
    const r = (await (await fetch(`${BASE}/__db?q=title&id=${id}`)).json()) as Array<{ title: string }>;
    if (r[0]?.title !== title) wrongEdits += 1;
  }
  if (crossTenantLeaks.length) integrity.push(`ACESSO CRUZADO: ${crossTenantLeaks.length} (ex.: ${crossTenantLeaks[0]})`);
  if (overLimit) integrity.push(`LIMITE DO PLANO ULTRAPASSADO em ${overLimit} empresa(s)`);
  if (dupSlugs) integrity.push(`SLUG DUPLICADO em ${dupSlugs} empresa(s)`);
  if (missing) integrity.push(`REGISTROS CONFIRMADOS QUE NAO ESTAO NO BANCO: ${missing}`);
  if (wrongEdits) integrity.push(`EDICOES PERDIDAS/SOBRESCRITAS: ${wrongEdits} de ${lastTitle.size}`);

  // ------------- relatorio
  const ops = [...lat.entries()].sort((a, b) => b[1].length - a[1].length);
  const allLat = ops.flatMap(([, v]) => v);
  const errRate = totalRequests ? ((serverErrors + networkErrors) / totalRequests) * 100 : 0;
  const lines: string[] = [];
  lines.push(`\n=== ${LABEL}: ${VUS} VUs (${panelCount} painel + ${VUS - panelCount} visitantes), ${DURATION}s + rampa ${RAMP}s ===`);
  lines.push(`requisicoes: ${totalRequests} em ${seconds.toFixed(1)}s = ${(totalRequests / seconds).toFixed(0)} req/s`);
  lines.push(`recusas por sobrecarga (503 controlado): ${shed503} | leituras repetidas pelo cliente: ${retriedReads} | falhas vistas pelo usuario apos repeticoes: ${finalFailures} | 429 (limite por chave, esperado): ${rateLimited429}`);
  lines.push(`erros 5xx: ${serverErrors}, rede: ${networkErrors}, 4xx inesperados: ${unexpected4xx} -> taxa ${errRate.toFixed(2)}%   (402 por limite de plano, esperado: ${planLimit402.n})`);
  lines.push(`geral: media ${(allLat.reduce((a, b) => a + b, 0) / (allLat.length || 1)).toFixed(0)} ms | p50 ${pct(allLat, 50).toFixed(0)} | p95 ${pct(allLat, 95).toFixed(0)} | p99 ${pct(allLat, 99).toFixed(0)} | max ${Math.max(0, ...allLat).toFixed(0)}`);
  lines.push('operacao'.padEnd(26) + 'n'.padStart(7) + 'media'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8));
  for (const [op, v] of ops) {
    lines.push(op.padEnd(26) + String(v.length).padStart(7) + (v.reduce((a, b) => a + b, 0) / v.length).toFixed(0).padStart(8) + pct(v, 95).toFixed(0).padStart(8) + pct(v, 99).toFixed(0).padStart(8));
  }
  lines.push(`servidor: ${stats.queries} consultas (${(stats.queries / Math.max(1, stats.requests)).toFixed(1)}/req) | pool pico ${stats.pool.peakTotal}/${stats.pool.max}, fila maxima ${stats.pool.peakWaiting} | RSS pico ${stats.memoryMb.peakRss} MB | laco de eventos p99 ${stats.eventLoopMs.p99.toFixed(0)} ms (max ${stats.eventLoopMs.max.toFixed(0)})`);
  lines.push('rotas por consultas/req: ' + stats.routes.slice(0, 8).map((r: any) => `${r.route} ${r.queriesPerReq}q`).join(' | '));
  lines.push(integrity.length ? `INTEGRIDADE: FALHOU\n  - ${integrity.join('\n  - ')}` : 'INTEGRIDADE: ok (sem acesso cruzado, sem perda/duplicacao, limite do plano respeitado, edicoes preservadas)');
  if (problems.length) lines.push('amostra de problemas:\n  ' + problems.slice(0, 8).join('\n  '));
  console.log(lines.join('\n'));
  if (args.get('json')) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(args.get('json')!, JSON.stringify({ label: LABEL, vus: VUS, seconds, totalRequests, rps: totalRequests / seconds, errRate, serverErrors, networkErrors, unexpected4xx, shed503, retriedReads, finalFailures, rateLimited429, p50: pct(allLat, 50), p95: pct(allLat, 95), p99: pct(allLat, 99), ops: Object.fromEntries(ops.map(([k, v]) => [k, { n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length, p95: pct(v, 95), p99: pct(v, 99) }])), stats, integrity }, null, 2));
  }
  process.exit(integrity.length ? 2 : 0);
}

await main();
