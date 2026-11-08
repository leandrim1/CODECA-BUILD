/**
 * Servidor local para CONFERIR A TELA "Importar site" num navegador de verdade.
 *
 * Mesma montagem do alvo de carga (`server.ts`): a API real sobre um
 * PostgreSQL 16 local, porque o driver do Neon fala HTTP e nao conversa com um
 * Postgres local. A diferenca e que aqui o objetivo nao e medir -- e **ver a
 * tela funcionando**, com a analise avancando de verdade.
 *
 * O site analisado e servido de memoria (`createMemorySiteFetcher`). Nao e
 * atalho: a busca de verdade recusa `localhost` e IP privado de proposito, que
 * e a protecao contra SSRF; um site de exemplo em `127.0.0.1` seria recusado
 * por ela. As barreiras de rede tem testes proprios.
 *
 * Nao faz parte da aplicacao: fica junto das ferramentas de carga, nao entra no
 * build e nao e referenciado por nada em `apps/`.
 */
import { serve } from '../../apps/web/node_modules/@hono/node-server/dist/index.mjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from './node_modules/pg/lib/index.js';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  createApp,
  createContext,
  createMemoryBillingProvider,
  createMemoryBlobStorage,
  createMemoryMailer,
  createMemorySiteFetcher,
  createUnconfiguredDomainProvider,
  parseEnv,
  type SiteFetcher,
} from '@codeca/api';
import {
  provisionSiteModules,
  runMigrations,
  schema,
  seedDatabase,
  type Database,
} from '@codeca/database';
import { MODULE_KEYS } from '@codeca/shared';
import { hashPassword } from '@codeca/shared/server';
import { createCompanyForUser } from '../../apps/api/src/lib/company.js';
import { createSession } from '../../apps/api/src/lib/session.js';

const URL_DB = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/codeca_ui';
const PORT = Number(process.env.UI_PORT ?? 4010);
const DIST = new URL('../../apps/web/dist/', import.meta.url).pathname;

// ----------------------------------------------- site externo de exemplo

const HOME = `<!doctype html>
<html lang="pt-BR">
<head>
  <title>Clínica Sorriso | Odontologia em Curitiba</title>
  <meta name="description" content="Clínica odontológica com atendimento humanizado em Curitiba.">
  <meta property="og:site_name" content="Clínica Sorriso">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Dentist","name":"Clínica Sorriso",
   "telephone":"(41) 3333-4444","email":"contato@clinicasorriso.com.br",
   "address":{"@type":"PostalAddress","streetAddress":"Rua das Flores, 123","addressLocality":"Curitiba","addressRegion":"PR","postalCode":"80010-100"}}
  </script>
</head>
<body>
  <header><img src="/img/logo.png" alt="Logo Clínica Sorriso"></header>
  <nav>
    <a href="/quem-somos">Quem somos</a><a href="/servicos">Serviços</a>
    <a href="/equipe">Equipe</a><a href="/perguntas-frequentes">Perguntas frequentes</a>
  </nav>
  <main>
    <h1>Seu sorriso em boas mãos</h1>
    <img src="/img/hero-banner.jpg" alt="Recepção da clínica" width="1600" height="900">
  </main>
  <footer>
    <p>Rua das Flores, 123 - Centro, Curitiba - PR. CEP 80010-100</p>
    <p>Telefone (41) 3333-4444 | contato@clinicasorriso.com.br</p>
    <p>Segunda a sexta, 8h às 18h</p>
    <a href="https://instagram.com/clinicasorriso">Instagram</a>
    <a href="https://wa.me/5541999887766">WhatsApp</a>
  </footer>
</body></html>`;

const SOBRE = `<html><head><title>Quem somos</title></head><body><main>
  <h1>Quem somos</h1>
  <h2>Nossa história</h2>
  <p>A clínica nasceu em 1998 no bairro Centro, com um consultório e dois profissionais. Hoje são seis salas e uma equipe de doze pessoas, mantendo o mesmo cuidado do primeiro dia com cada paciente que chega até a recepção.</p>
  <h2>Missão</h2>
  <p>Oferecer tratamento odontológico de qualidade com acolhimento, tornando a visita ao dentista uma experiência tranquila para toda a família.</p>
  <h2>Valores</h2>
  <ul><li>Cuidado</li><li>Transparência</li><li>Pontualidade</li></ul>
</main></body></html>`;

const SERVICOS = `<html><head><title>Serviços</title></head><body><main>
  <h1>Nossos serviços</h1>
  <h2>Clareamento dental</h2>
  <p>Procedimento feito em consultório, com acompanhamento do dentista e resultado visível já na primeira sessão de atendimento.</p>
  <h2>Implante dentário</h2>
  <p>Reposição de dentes perdidos com pino de titânio, planejada por tomografia antes de qualquer intervenção cirúrgica.</p>
  <h2>Ortodontia</h2>
  <p>Aparelhos fixos e alinhadores transparentes, com acompanhamento mensal e plano de tratamento definido na primeira consulta.</p>
</main></body></html>`;

const EQUIPE = `<html><head><title>Equipe</title></head><body><main>
  <h1>Nossa equipe</h1>
  <div class="team-member"><img src="/img/ana.jpg" alt="Ana"><h3>Dra. Ana Souza</h3><p>Ortodontista</p><p>Formada pela UFPR, atende na clínica desde 2005 e coordena a área de ortodontia da equipe inteira.</p></div>
  <div class="team-member"><img src="/img/bruno.jpg" alt="Bruno"><h3>Dr. Bruno Lima</h3><p>Implantodontista</p><p>Especialista em implantes, atua com reabilitação oral e cirurgia desde a abertura da segunda unidade.</p></div>
</main></body></html>`;

const FAQ = `<html><head><title>Perguntas frequentes</title>
<script type="application/ld+json">
{"@type":"FAQPage","mainEntity":[
  {"@type":"Question","name":"Atendem convênio?","acceptedAnswer":{"@type":"Answer","text":"Atendemos os principais convênios odontológicos. Consulte a recepção."}},
  {"@type":"Question","name":"Precisa de encaminhamento?","acceptedAnswer":{"@type":"Answer","text":"Não. O atendimento pode ser agendado diretamente pelo telefone ou WhatsApp."}}
]}
</script>
</head><body><main>
  <h1>Perguntas frequentes</h1>
  <blockquote>Fui muito bem atendida desde a recepção, e o tratamento resolveu um problema que eu tinha havia anos.<cite>Maria Silva</cite></blockquote>
</main></body></html>`;

/** PNG 2x2 com peso suficiente para passar pelo minimo da importacao. */
const PNG = Buffer.concat([
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNk+M/AwMDAxMDAwAAABicBAp9rjKkAAAAASUVORK5CYII=',
    'base64',
  ),
  Buffer.alloc(3072, 9),
]);

/**
 * O site de origem, em duas versoes.
 *
 * `/__mudar` troca de uma para a outra: e assim que a conferencia visual da
 * sincronizacao simula o cliente editando o site antigo, sem precisar de um
 * servidor externo.
 */
let versaoAlterada = false;

const PAGINAS_V1: Record<string, { body?: string; status?: number; contentType?: string; bytes?: Uint8Array }> = {
  'https://clinicasorriso.com.br/': { body: HOME },
  'https://clinicasorriso.com.br/quem-somos': { body: SOBRE },
  'https://clinicasorriso.com.br/servicos': { body: SERVICOS },
  'https://clinicasorriso.com.br/equipe': { body: EQUIPE },
  'https://clinicasorriso.com.br/perguntas-frequentes': { body: FAQ },
  'https://clinicasorriso.com.br/img/logo.png': { contentType: 'image/png', bytes: new Uint8Array(PNG) },
  'https://clinicasorriso.com.br/img/hero-banner.jpg': { contentType: 'image/png', bytes: new Uint8Array(PNG) },
  'https://clinicasorriso.com.br/img/ana.jpg': { contentType: 'image/png', bytes: new Uint8Array(PNG) },
  'https://clinicasorriso.com.br/img/bruno.jpg': { contentType: 'image/png', bytes: new Uint8Array(PNG) },
};

/** Segunda versao: telefone, descricao e um servico a mais. */
const PAGINAS_V2: typeof PAGINAS_V1 = {
  ...PAGINAS_V1,
  'https://clinicasorriso.com.br/': {
    body: HOME.replace('(41) 3333-4444', '(41) 98888-2222').replace(
      'Clínica odontológica com atendimento humanizado em Curitiba.',
      'Agora com três unidades e atendimento em horário estendido.',
    ),
  },
  'https://clinicasorriso.com.br/servicos': {
    body: SERVICOS.replace(
      '</main></body></html>',
      '<h2>Facetas de porcelana</h2><p>Procedimento estético feito em duas sessões, com planejamento digital prévio do sorriso.</p></main></body></html>',
    ),
  },
};

const siteFetcher: SiteFetcher = {
  fetch: async (url, options) =>
    createMemorySiteFetcher(versaoAlterada ? PAGINAS_V2 : PAGINAS_V1).fetch(url, options),
};

// ------------------------------------------------------------- aplicacao

const pool = new pg.Pool({ connectionString: URL_DB, max: 10, connectionTimeoutMillis: 10_000 });
const db = drizzle(pool, { schema, casing: 'snake_case' }) as unknown as Database;

const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: URL_DB,
  AUTH_SECRET: 'segredo-da-conferencia-visual-com-mais-de-32-chars',
  APP_URL: `http://localhost:${PORT}`,
  PLATFORM_HOSTS: 'localhost',
  COOKIE_SECURE: 'false',
});

const context = createContext({
  env,
  db,
  mailer: createMemoryMailer(),
  blob: createMemoryBlobStorage(),
  domains: createUnconfiguredDomainProvider(),
  billing: createMemoryBillingProvider(),
  siteFetcher,
});

const app = createApp({ context });

async function semear(): Promise<{ sessionToken: string; csrfToken: string }> {
  await pool.query(
    'drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;',
  );
  await runMigrations(db);
  await seedDatabase(db);

  const [plano] = await db.select().from(schema.plans).where(eq(schema.plans.code, 'profissional'));
  const senha = await hashPassword('senhaSegura123');
  const [user] = await db
    .insert(schema.users)
    .values({
      email: 'contato@clinicasorriso.com.br',
      name: 'Ana Souza',
      passwordHash: senha,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: schema.users.id });

  const company = await db.transaction((tx) =>
    createCompanyForUser(tx as unknown as Database, {
      userId: user!.id,
      contactEmail: 'contato@clinicasorriso.com.br',
      companyName: 'Clínica Sorriso',
      phone: '',
      slug: 'clinica-sorriso',
      trialPlanId: plano!.id,
      now: new Date(),
    }),
  );

  await db
    .update(schema.subscriptions)
    .set({
      status: 'active',
      providerStatus: 'ACTIVE',
      accessUntil: new Date(Date.now() + 365 * 86_400_000),
    })
    .where(eq(schema.subscriptions.tenantId, company.tenantId));

  // Todos os modulos, para a tela mostrar a revisao completa.
  await provisionSiteModules(db, {
    tenantId: company.tenantId,
    siteId: company.siteId,
    moduleKeys: [...MODULE_KEYS],
  });

  const session = await createSession(db, env, {
    userId: user!.id,
    rememberMe: true,
    ip: '127.0.0.1',
    userAgent: 'conferencia-visual',
  });

  console.log(`[ui] empresa ${company.tenantId} pronta, com todos os modulos.`);
  return { sessionToken: session.sessionToken, csrfToken: session.csrfToken };
}

const sessao = await semear();

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

serve({
  port: PORT,
  fetch: async (req: Request) => {
    const url = new URL(req.url);

    /**
     * Entrega os dois cookies da sessao, para o navegador cair direto no
     * painel.
     *
     * Os **dois**: o de sessao e `HttpOnly`, e o anti-CSRF precisa ser legivel
     * pelo JavaScript -- e o cliente da API que le ele e devolve no cabecalho
     * `x-csrf-token`. Entregar so o primeiro faz toda escrita do painel ser
     * recusada, que e exatamente o que a protecao deve fazer.
     */
    if (url.pathname === '/__entrar') {
      const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
      headers.append(
        'set-cookie',
        `codeca_session=${sessao.sessionToken}; Path=/; HttpOnly; SameSite=Lax`,
      );
      headers.append('set-cookie', `codeca_csrf=${sessao.csrfToken}; Path=/; SameSite=Lax`);
      return new Response('<meta http-equiv="refresh" content="0;url=/painel/importar">', {
        status: 200,
        headers,
      });
    }

    /** Troca a versao do site de origem, para a conferencia da sincronizacao. */
    if (url.pathname === '/__mudar') {
      versaoAlterada = !versaoAlterada;
      return new Response(`versao alterada: ${versaoAlterada}`, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (url.pathname.startsWith('/api/')) return app.fetch(req);

    // Estaticos do painel; qualquer outra rota cai no index (SPA).
    const relativo = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\//, '');
    const arquivo = relativo === '' ? 'index.html' : relativo;
    const caminho = join(DIST, arquivo);
    if (existsSync(caminho) && !caminho.endsWith('/')) {
      const tipo = TIPOS[extname(caminho)] ?? 'application/octet-stream';
      return new Response(new Uint8Array(readFileSync(caminho)), { headers: { 'content-type': tipo } });
    }
    return new Response(readFileSync(join(DIST, 'index.html'), 'utf-8'), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
});

console.log(`[ui] painel em http://localhost:${PORT}/__entrar`);
console.log(`[ui] csrf: ${sessao.csrfToken}`);
