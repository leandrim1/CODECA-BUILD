/**
 * Alvo dos testes de carga: a API REAL (`createApp`) sobre um PostgreSQL real.
 *
 * ## O que isto mede, e o que nao mede
 *
 * Mede o que o NOSSO codigo faz sob concorrencia: quantas consultas cada rota
 * dispara, como o pool de conexoes se comporta, onde ha fila, escrita
 * desnecessaria, corrida entre usuarios e acesso cruzado entre empresas.
 *
 * **Nao** mede: a latencia de rede ate o Neon, o driver HTTP/WebSocket do Neon,
 * o PgBouncer do Neon, partida a frio nem o escalonamento horizontal da Vercel.
 * O banco aqui e um Postgres 16 local; o servidor Node e o gerador de carga
 * dividem a mesma maquina. Os numeros sao de UMA instancia, em condicoes mais
 * favoraveis que a producao no quesito rede e mais duras no quesito CPU
 * compartilhada. Leia-os como comparacao ANTES x DEPOIS e como prova de
 * integridade, nao como previsao de capacidade em producao.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
// `@hono/node-server` ja e dependencia do painel (apps/web); reaproveitada, sem dependencia nova.
import { serve } from '../../apps/web/node_modules/@hono/node-server/dist/index.mjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from './node_modules/pg/lib/index.js';
import {
  createMemoryBlobStorage,
  createMemoryMailer,
  createUnconfiguredDomainProvider,
  createMemoryBillingProvider,
  createApp,
  createContext,
  parseEnv,
} from '@codeca/api';
import {
  instrumentQueryable,
  provisionSiteModules,
  queryTotals,
  runMigrations,
  schema,
  seedDatabase,
  type Database,
} from '@codeca/database';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { hashPassword } from '@codeca/shared/server';
import { createCompanyForUser } from '../../apps/api/src/lib/company.js';
import { createSession } from '../../apps/api/src/lib/session.js';
import { issueApiKey } from '../../apps/api/src/lib/integration/keys.js';

const URL_DB = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/codeca_load';
const PORT = Number(process.env.LT_PORT ?? 3999);
const TENANTS = Number(process.env.LT_TENANTS ?? 60);
const PROPERTIES_PER_TENANT = Number(process.env.LT_PROPERTIES ?? 30);
const POOL_MAX = Number(process.env.DB_POOL_MAX ?? 10);
const PASSWORD = 'senhaSegura123';

const pool = new pg.Pool({ connectionString: URL_DB, max: POOL_MAX, connectionTimeoutMillis: 10_000 });
// Cada conexao nova e instrumentada na criacao; `pool.query` e transacoes passam
// todas por `client.query`, entao cada consulta e contada UMA vez.
pool.on('connect', (client) => {
  instrumentQueryable(client as unknown as { query: (...args: never[]) => unknown });
});

const db = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Database;

async function resetDatabase(): Promise<void> {
  await pool.query('drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;');
}

const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: URL_DB,
  AUTH_SECRET: 'segredo-de-carga-com-mais-de-32-caracteres-ok',
  APP_URL: 'http://localhost:3999',
  PLATFORM_HOSTS: 'localhost',
  COOKIE_SECURE: 'false',
  METRICS_SECRET: 'segredo-de-metricas-da-carga',
  ...(process.env.LT_ENV_JSON ? (JSON.parse(process.env.LT_ENV_JSON) as Record<string, string>) : {}),
});

const blob = createMemoryBlobStorage();
const context = createContext({
  env,
  db,
  mailer: createMemoryMailer(),
  blob,
  domains: createUnconfiguredDomainProvider(),
  billing: createMemoryBillingProvider(),
});
const app = createApp({ context });

async function seed() {
  const t0 = Date.now();
  await resetDatabase();
  await runMigrations(db);
  await seedDatabase(db);
  const [plan] = await db.select().from(schema.plans).where(eq(schema.plans.code, 'profissional'));
  const [segment] = await db.select().from(schema.segments).where(eq(schema.segments.code, 'construtora'));
  const hash = await hashPassword(PASSWORD);
  const rows: Array<Record<string, unknown>> = [];

  for (let i = 1; i <= TENANTS; i += 1) {
    const email = `vu${i}@load.test`;
    const [user] = await db
      .insert(schema.users)
      .values({ email, name: `Usuario ${i}`, passwordHash: hash, emailVerifiedAt: new Date() })
      .returning({ id: schema.users.id });
    const company = await db.transaction((tx) =>
      createCompanyForUser(tx as unknown as Database, {
        userId: user!.id,
        contactEmail: email,
        companyName: `Empresa ${i}`,
        phone: '',
        slug: `empresa-${i}`,
        trialPlanId: plan!.id,
        now: new Date(),
      }),
    );
    await db.update(schema.subscriptions).set({ status: 'active', providerStatus: 'ACTIVE', accessUntil: new Date(Date.now() + 365 * 86400_000) }).where(eq(schema.subscriptions.tenantId, company.tenantId));
    await db.update(schema.sites).set({ segmentId: segment!.id }).where(eq(schema.sites.id, company.siteId));
    await provisionSiteModules(db, { tenantId: company.tenantId, siteId: company.siteId, moduleKeys: segment!.defaultModules as string[] });

    // Conteudo: marcado com o numero da empresa, para o teste detectar acesso cruzado.
    const propertyIds: string[] = [];
    for (let p = 1; p <= PROPERTIES_PER_TENANT; p += 1) {
      const [inserted] = await db.insert(schema.properties).values({
        tenantId: company.tenantId,
        siteId: company.siteId,
        slug: `t${i}-imovel-${p}`,
        title: `T${i} Imovel ${p}`,
        type: 'apartamento',
        purpose: 'venda',
        price: String(100000 + p),
        publicationStatus: p % 5 === 0 ? 'draft' : 'published',
        commercialStatus: 'disponivel',
        address: { street: 'Rua A', number: '1', complement: '', neighborhood: 'Centro', city: 'Campinas', state: 'SP', postalCode: '13000000', showFullAddress: true },
      } as never).returning({ id: schema.properties.id });
      propertyIds.push(inserted!.id);
    }
    const session = await createSession(db, env, { userId: user!.id, rememberMe: true, ip: '10.0.0.1', userAgent: 'seed' });
    const key = await issueApiKey(db, { tenantId: company.tenantId, siteId: company.siteId, kind: 'secret' });
    rows.push({ i, email, propertyIds, tenantId: company.tenantId, siteId: company.siteId, sessionToken: session.sessionToken, csrfToken: session.csrfToken, apiKey: key.token });
  }
  writeFileSync(process.env.LT_OUT ?? '/tmp/loadtest-tenants.json', JSON.stringify({ password: PASSWORD, tenants: rows }));
  console.log(`[loadtest] semeado: ${TENANTS} empresas x ${PROPERTIES_PER_TENANT} imoveis em ${Date.now() - t0} ms`);
}

await seed();

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
const counters = { requests: 0, queries: 0, queryMs: 0, byRoute: new Map<string, { n: number; q: number; ms: number }>() };
const peak = { waiting: 0, total: 0, rss: 0 };
setInterval(() => {
  peak.waiting = Math.max(peak.waiting, pool.waitingCount);
  peak.total = Math.max(peak.total, pool.totalCount);
  peak.rss = Math.max(peak.rss, process.memoryUsage().rss);
}, 100).unref();

const routeKey = (method: string, path: string) =>
  `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').replace(/\/(imovel|t\d+)[^/?]*/g, '/:slug').replace(/\?.*/, '')}`;

serve({
  port: PORT,
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/__stats') {
      return Response.json({
        requests: counters.requests,
        queries: queryTotals.count,
        queryMs: Math.round(queryTotals.ms),
        pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: POOL_MAX, peakTotal: peak.total, peakWaiting: peak.waiting },
        memoryMb: { rss: Math.round(process.memoryUsage().rss / 1048576), peakRss: Math.round(peak.rss / 1048576) },
        eventLoopMs: { p50: loop.percentile(50) / 1e6, p99: loop.percentile(99) / 1e6, max: loop.max / 1e6 },
        routes: [...counters.byRoute.entries()].map(([k, v]) => ({ route: k, n: v.n, queriesPerReq: +(v.q / v.n).toFixed(1), dbMsPerReq: +(v.ms / v.n).toFixed(1) })).sort((a, b) => b.queriesPerReq - a.queriesPerReq),
      });
    }
    if (url.pathname === '/__reset-stats') {
      counters.requests = 0; counters.queries = 0; counters.queryMs = 0; counters.byRoute.clear(); queryTotals.count = 0; queryTotals.ms = 0;
      peak.waiting = 0; peak.total = 0; peak.rss = 0; loop.reset();
      return Response.json({ ok: true });
    }
    if (url.pathname === '/__db') {
      // Verificacoes de integridade do runner.
      const q = url.searchParams.get('q') ?? '';
      if (q === 'properties-by-tenant') {
        const r = await pool.query('select tenant_id, count(*)::int as n, count(distinct slug)::int as slugs from properties group by tenant_id');
        return Response.json(r.rows);
      }
      if (q === 'title') {
        const r = await pool.query('select title from properties where id = $1', [url.searchParams.get('id')]);
        return Response.json(r.rows);
      }
      return Response.json({ error: 'q desconhecido' }, { status: 400 });
    }
    counters.requests += 1;
    // A aplicacao ja mede cada requisicao (middleware `requestLog`) e devolve o
    // resultado em `Server-Timing`; le-se de la em vez de medir duas vezes.
    const res = await app.fetch(req);
    const timing = res.headers.get('server-timing') ?? '';
    const m = /db;dur=([\d.]+);desc="(\d+) queries"/.exec(timing);
    const k = routeKey(req.method, url.pathname);
    const r = counters.byRoute.get(k) ?? { n: 0, q: 0, ms: 0 };
    r.n += 1; r.q += m ? Number(m[2]) : 0; r.ms += m ? Number(m[1]) : 0;
    counters.byRoute.set(k, r);
    return res;
  },
});
console.log(`[loadtest] API em http://localhost:${PORT} (pool max=${POOL_MAX})`);

// Saida limpa ao receber SIGTERM: permite gravar o perfil de CPU (`--cpu-prof`).
process.on('SIGTERM', () => process.exit(0));
