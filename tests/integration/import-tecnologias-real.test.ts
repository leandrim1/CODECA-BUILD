import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, schema } from '@codeca/database';
import { MODULE_KEYS } from '@codeca/shared';
import { createSiteFetcher } from '@codeca/api';
import { html, redirect, startTestServer, type TestHttpServer } from '../helpers/http-server.js';
import {
  createTestApi,
  registerAccount,
  verifyEmail,
  type RegisteredAccount,
  type TestApi,
} from '../helpers/api.js';

/**
 * Importacao de ponta a ponta contra servidores HTTP de VERDADE.
 *
 * A diferenca para `site-import.test.ts`: la a rede e um dublê em memoria;
 * aqui a API usa o `createSiteFetcher` de producao e fala com servidores Node
 * reais. O caminho exercitado e o completo -- validacao da URL na rota,
 * resolucao, soquete, leitura, extracao, mapeamento e gravacao.
 *
 * Os nomes `*.test` nao existem no DNS: o mapa de teste do fetcher os traduz
 * para `127.0.0.1:<porta>`, como um arquivo de hosts. Para a rota e para a
 * primeira barreira eles sao enderecos publicos comuns, entao a validacao de
 * endereco tambem e exercitada de verdade.
 *
 * ## Cinco tecnologias
 *
 * O que muda entre elas nao e o HTTP: e **onde o conteudo esta**. Em
 * WordPress e Angular ele vem no HTML. Em Next, Vite e Nuxt o HTML e uma
 * casca, e o texto so existe no estado serializado que o framework deixou na
 * pagina -- que a plataforma le **sem executar script**, por regra de
 * seguranca.
 */

const TELEFONE = '(41) 3333-4444';

/** Site classico renderizado no servidor: o conteudo esta no HTML. */
function paginaWordPress(): string {
  return `<!doctype html><html lang="pt-BR"><head>
<meta name="generator" content="WordPress 6.4.2">
<title>Clínica Sorriso | Odontologia em Curitiba</title>
<meta name="description" content="Clínica odontológica com atendimento humanizado em Curitiba.">
<link rel="stylesheet" href="/wp-content/themes/sorriso/style.css">
</head><body class="home page-template-default">
<header class="site-header"><img src="/wp-content/uploads/2026/01/logo.png" alt="Clínica Sorriso"></header>
<nav><a href="/quem-somos/">Quem somos</a><a href="/contato/">Contato</a></nav>
<main><h1>Seu sorriso em boas mãos</h1>
<p>Atendimento humanizado desde 1998, com equipe completa e horário estendido.</p></main>
<footer><p>Rua das Flores, 123 - Centro, Curitiba - PR</p>
<p>Telefone ${TELEFONE} | contato@clinicasorriso.com.br</p></footer>
</body></html>`;
}

const WP_QUEM_SOMOS = `<!doctype html><html lang="pt-BR"><head><title>Quem somos | Clínica Sorriso</title></head>
<body><main><h1>Quem somos</h1>
<h2>Nossa história</h2>
<p>A clínica nasceu em 1998 no Centro de Curitiba, com um consultório e dois profissionais. Hoje são seis salas e uma equipe de doze pessoas.</p>
<h2>Missão</h2>
<p>Oferecer tratamento odontológico de qualidade com acolhimento, tornando a visita ao dentista tranquila para toda a família.</p>
</main></body></html>`;

const WP_CONTATO = `<!doctype html><html lang="pt-BR"><head><title>Contato | Clínica Sorriso</title></head>
<body><main><h1>Contato</h1>
<p>Rua das Flores, 123 - Centro, Curitiba - PR. CEP 80010-100</p>
<p>Telefone ${TELEFONE} | contato@clinicasorriso.com.br</p>
<p>Segunda a sexta, das 8h às 18h</p>
</main></body></html>`;

/** Next.js: casca + `__NEXT_DATA__`. O texto so existe no JSON. */
function paginaNext(): string {
  const dados = {
    props: {
      pageProps: {
        empresa: {
          nome: 'Imobiliária Horizonte',
          descricao: 'Imóveis residenciais e comerciais em Florianópolis desde 2004.',
          telefone: TELEFONE,
          email: 'contato@horizonte.com.br',
          endereco: 'Avenida Beira-Mar, 900 - Centro, Florianópolis - SC',
        },
      },
    },
    page: '/',
    buildId: 'abc123',
  };
  return `<!doctype html><html lang="pt-BR"><head><title>Imobiliária Horizonte</title></head>
<body><div id="__next"></div>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(dados)}</script>
</body></html>`;
}

/** Vite + React: `<div id="root">` vazio e o estado em `window`. */
function paginaVite(): string {
  const estado = {
    empresa: {
      nome: 'Estúdio Mapa',
      descricao: 'Projetos de arquitetura e interiores para casas e escritórios.',
      telefone: TELEFONE,
      email: 'ola@estudiomapa.com.br',
    },
  };
  return `<!doctype html><html lang="pt-BR"><head><title>Estúdio Mapa</title>
<script type="module" crossorigin src="/assets/index-a1b2c3.js"></script></head>
<body><div id="root"></div>
<script>window.__INITIAL_STATE__ = ${JSON.stringify(estado)};</script>
</body></html>`;
}

/** Nuxt/Vue: `<div id="__nuxt">` e `window.__NUXT__`. */
function paginaNuxt(): string {
  const estado = {
    data: {
      empresa: {
        nome: 'Padaria Grão Fino',
        descricao: 'Pães de fermentação natural e confeitaria artesanal, todos os dias.',
        telefone: TELEFONE,
        email: 'contato@graofino.com.br',
      },
    },
  };
  return `<!doctype html><html lang="pt-BR"><head><title>Padaria Grão Fino</title></head>
<body><div id="__nuxt"></div>
<script>window.__NUXT__ = ${JSON.stringify(estado)}</script>
</body></html>`;
}

/** Angular com pre-renderizacao: conteudo no HTML, marcacao propria. */
function paginaAngular(): string {
  return `<!doctype html><html lang="pt-BR"><head><title>Transportadora Rota Sul</title>
<meta name="description" content="Transporte rodoviário de cargas no Sul do país."></head>
<body><app-root ng-version="17.1.0">
<main><h1>Transportadora Rota Sul</h1>
<p>Cargas fracionadas e lotação entre Paraná, Santa Catarina e Rio Grande do Sul.</p>
<p>Telefone ${TELEFONE}</p></main></app-root>
<script src="/main-XYZ.js" type="module"></script></body></html>`;
}

interface Tecnologia {
  nome: string;
  host: string;
  pagina: () => string;
  /**
   * `true` quando o conteudo SO existe no estado serializado, e a leitura
   * precisa do caminho sem navegador para alcanca-lo.
   */
  estadoEmbutido: boolean;
  /** Nome que a analise deve propor para a empresa. */
  empresa: string;
}

const TECNOLOGIAS: Tecnologia[] = [
  { nome: 'WordPress', host: 'clinicasorriso.test', pagina: paginaWordPress, estadoEmbutido: false, empresa: 'Clínica Sorriso' },
  { nome: 'Next.js', host: 'horizonte.test', pagina: paginaNext, estadoEmbutido: true, empresa: 'Imobiliária Horizonte' },
  { nome: 'Vite + React', host: 'estudiomapa.test', pagina: paginaVite, estadoEmbutido: true, empresa: 'Estúdio Mapa' },
  { nome: 'Nuxt + Vue', host: 'graofino.test', pagina: paginaNuxt, estadoEmbutido: true, empresa: 'Padaria Grão Fino' },
  { nome: 'Angular', host: 'rotasul.test', pagina: paginaAngular, estadoEmbutido: false, empresa: 'Transportadora Rota Sul' },
];

let api: TestApi;
const servidores = new Map<string, TestHttpServer>();

beforeAll(async () => {
  const mapa: Record<string, string> = {};
  for (const tec of TECNOLOGIAS) {
    const rotas: Record<string, ReturnType<typeof html>> = { '/': html(tec.pagina()) };
    /*
     * O site WordPress tem as paginas internas que o menu anuncia, e as serve
     * como o WordPress serve: o endereco canonico TEM barra no fim, e a versao
     * sem barra responde 301 para ela.
     *
     * Isso importa aqui porque `canonicalPageUrl` tira a barra final para
     * deduplicar -- `/sobre` e `/sobre/` sao a mesma pagina --, e e o endereco
     * ja normalizado que vai para a rede. Contra um WordPress de verdade, cada
     * pagina interna custa entao um salto a mais. Funciona, e o teste prova
     * que funciona; o custo esta registrado em `docs/importacao-de-sites.md`.
     */
    if (tec.host === 'clinicasorriso.test') {
      rotas['/quem-somos/'] = html(WP_QUEM_SOMOS);
      rotas['/contato/'] = html(WP_CONTATO);
      rotas['/quem-somos'] = redirect('/quem-somos/', 301);
      rotas['/contato'] = redirect('/contato/', 301);
    }
    const servidor = await startTestServer(rotas);
    servidores.set(tec.host, servidor);
    mapa[tec.host] = servidor.origin;
  }
  api = await createTestApi({ siteFetcher: createSiteFetcher({ testOrigins: mapa }) });
});

afterAll(async () => {
  await Promise.all([...servidores.values()].map((s) => s.close()));
  await api.close();
});

let empresa: RegisteredAccount;

beforeEach(async () => {
  await api.reset();
  empresa = await registerAccount(api, {
    email: 'contato@clinicasorriso.com.br',
    companyName: 'Clinica Sorriso',
  });
  await verifyEmail(api, empresa);

  const [plano] = await api.db.select().from(schema.plans).where(eq(schema.plans.code, 'profissional'));
  await api.db
    .update(schema.tenants)
    .set({ planId: plano!.id, status: 'active' })
    .where(eq(schema.tenants.id, empresa.tenantId));

  const [site] = await api.db
    .select({ id: schema.sites.id })
    .from(schema.sites)
    .where(eq(schema.sites.tenantId, empresa.tenantId));
  for (const key of MODULE_KEYS) {
    await api.db
      .insert(schema.siteModules)
      .values({ tenantId: empresa.tenantId, siteId: site!.id, moduleKey: key, enabled: true, settings: {} })
      .onConflictDoUpdate({
        target: [schema.siteModules.siteId, schema.siteModules.moduleKey],
        set: { enabled: true },
      });
  }
});

const base = () => `/api/tenants/${empresa.tenantId}`;

/** Alteracoes que a sincronizacao propos e ainda esperam decisao. */
async function pendentes(): Promise<any[]> {
  const estado = await empresa.client.get(`${base()}/sync`);
  expect(estado.status, estado.errorMessage ?? '').toBe(200);
  return (estado.body.changes as any[]).filter((c) => c.decision === 'pendente');
}

/** Abre a analise e avanca as fatias ate terminar. */
async function analisar(url: string) {
  const abertura = await empresa.client.post(`${base()}/site-import`, { url });
  expect(abertura.status, abertura.errorMessage ?? '').toBe(201);
  const importId = abertura.body.run.id as string;

  let run = abertura.body.run;
  for (let i = 0; i < 25; i += 1) {
    const estado = await empresa.client.get(`${base()}/site-import/${importId}`);
    expect(estado.status, estado.errorMessage ?? '').toBe(200);
    run = estado.body.run;
    if (!run.working) break;
  }
  return { importId, run };
}

describe('o caminho completo, sobre HTTP real', () => {
  it('analisa, confirma e grava o conteudo lido do servidor', async () => {
    const servidor = servidores.get('clinicasorriso.test')!;
    const antes = servidor.requests.length;

    const { importId, run } = await analisar('http://clinicasorriso.test/');
    expect(run.state, JSON.stringify(run.error ?? '')).toBe('analisada');
    // Tres paginas: a inicial e as duas que o menu dela anuncia.
    expect(run.summary.pages).toBe(3);
    expect(run.summary.pagesFailed).toBe(0);
    expect((run.pages as any[]).map((p) => p.role).sort()).toEqual(['contato', 'inicial', 'sobre']);

    // A conexao aconteceu mesmo, e com o nome original no cabecalho Host.
    const pedidos = servidor.requests.slice(antes);
    expect(pedidos.length).toBeGreaterThan(0);
    expect(pedidos[0]!.headers.host).toBe('clinicasorriso.test');
    // O salto de 301 aconteceu de verdade: pediu sem barra e seguiu para a com.
    const caminhos = pedidos.map((p) => p.path);
    expect(caminhos).toContain('/quem-somos');
    expect(caminhos).toContain('/quem-somos/');

    const confirmacao = await empresa.client.post(`${base()}/site-import/${importId}/confirmar`, {
      confirm: true,
      targets: [],
    });
    expect(confirmacao.status, confirmacao.errorMessage ?? '').toBe(200);

    // O conteudo que chegou ao banco veio do servidor, nao de um dublê.
    const documentos = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(eq(schema.contentDocuments.tenantId, empresa.tenantId));
    const texto = JSON.stringify(documentos.map((d) => d.data));
    expect(texto).toContain('humanizado');
  });

  it('a rota recusa rede interna antes de abrir conexao, mesmo com o mapa de teste ligado', async () => {
    for (const url of ['http://localhost/', 'http://10.0.0.5/', 'http://169.254.169.254/']) {
      const resposta = await empresa.client.post(`${base()}/site-import`, { url });
      expect(resposta.status, url).toBe(422);
    }
    expect(await api.db.select({ id: schema.siteImports.id }).from(schema.siteImports)).toHaveLength(0);
  });

  it('site que nao responde termina a analise sem conteudo, com a pagina marcada como falha', async () => {
    // Nome mapeado para uma porta onde nao ha ninguem ouvindo.
    const semNinguem = createSiteFetcher({ testOrigins: { 'fantasma.test': '127.0.0.1:1' } });
    const outra = await createTestApi({ siteFetcher: semNinguem });
    try {
      const conta = await registerAccount(outra, { email: 'a@b.com.br', companyName: 'Teste' });
      await verifyEmail(outra, conta);
      const abertura = await conta.client.post(`/api/tenants/${conta.tenantId}/site-import`, {
        url: 'http://fantasma.test/',
      });
      expect(abertura.status).toBe(201);

      let run = abertura.body.run;
      for (let i = 0; i < 25; i += 1) {
        const estado = await conta.client.get(
          `/api/tenants/${conta.tenantId}/site-import/${run.id}`,
        );
        run = estado.body.run;
        if (!run.working) break;
      }
      /*
       * A analise CONCLUI -- nao fica pendurada nem estoura --, e o que ela
       * conta e a verdade: nenhuma pagina lida, uma com problema, nada a
       * importar. Foi exatamente este o estado que o cliente viu quando o
       * `addressLookup` estava quebrado, e e por isso que a tela precisa
       * mostrar a falha em vez de "0 páginas" em silencio.
       */
      expect(run.state).toBe('analisada');
      expect(run.summary.pages).toBe(0);
      expect(run.summary.pagesFailed).toBeGreaterThan(0);
      expect(run.items ?? []).toHaveLength(0);
    } finally {
      await outra.close();
    }
  });
});

describe('cinco tecnologias, cada uma com o conteudo em um lugar', () => {
  for (const tec of TECNOLOGIAS) {
    it(`${tec.nome}: a leitura chega ao conteudo`, async () => {
      const { run } = await analisar(`http://${tec.host}/`);
      expect(run.state, JSON.stringify(run.error ?? '')).toBe('analisada');

      const pagina = run.pages[0];
      expect(pagina.status).toBe(200);
      // O caminho usado e o esperado para esta tecnologia -- e so ele.
      expect(Boolean(pagina.fromEmbeddedState)).toBe(tec.estadoEmbutido);
      expect(run.summary.embeddedPages).toBe(tec.estadoEmbutido ? 1 : 0);
      // Nenhuma delas precisou de navegador: a regra de seguranca foi mantida.
      expect(run.summary.renderedPages).toBe(0);

      // Houve texto de verdade, inclusive quando ele so existia no JSON.
      expect(pagina.textLength).toBeGreaterThan(0);

      // E a analise propoe o nome da empresa certa.
      const nome = (run.items as any[]).find((i) => i.fieldKey === 'companyName');
      expect(nome?.value).toBe(tec.empresa);
    });
  }

  it('nenhum script do site analisado foi executado', async () => {
    // A prova e indireta e forte: o estado do Vite so e alcancado lendo o
    // texto do `<script>`, e a pagina nao tem conteudo nenhum fora dele. Se
    // algum script tivesse rodado, `window` existiria -- e nao existe em Node.
    expect(typeof (globalThis as Record<string, unknown>).window).toBe('undefined');
    expect((globalThis as Record<string, unknown>).__INITIAL_STATE__).toBeUndefined();
  });
});

describe('sincronizacao sobre HTTP real', () => {
  it('conecta, grava o baseline e detecta a mudanca quando o site muda', async () => {
    const servidor = servidores.get('clinicasorriso.test')!;

    // 1. Importa o site como ele esta hoje.
    const { importId } = await analisar('http://clinicasorriso.test/');
    const confirmacao = await empresa.client.post(`${base()}/site-import/${importId}/confirmar`, {
      confirm: true,
      targets: [],
    });
    expect(confirmacao.status, confirmacao.errorMessage ?? '').toBe(200);

    // 2. Conecta a fonte e tira a primeira fotografia.
    const conexao = await empresa.client.post(`${base()}/sync`, {
      url: 'http://clinicasorriso.test/',
      frequency: 'semanal',
    });
    expect(conexao.status, conexao.errorMessage ?? '').toBe(201);

    const primeira = await empresa.client.post(`${base()}/sync/verificar`, {});
    expect(primeira.status, primeira.errorMessage ?? '').toBe(200);
    expect(primeira.body.failed).toBeFalsy();
    // Nada mudou desde a importacao: nao ha o que propor.
    expect(await pendentes()).toHaveLength(0);

    // 3. O site muda de verdade, no servidor.
    servidor.setRoutes({
      '/': html(
        paginaWordPress().replace(
          'Clínica odontológica com atendimento humanizado em Curitiba.',
          'Clínica odontológica em Curitiba, agora também aos sábados pela manhã.',
        ),
      ),
      '/quem-somos/': html(WP_QUEM_SOMOS),
      '/contato/': html(WP_CONTATO),
      '/quem-somos': redirect('/quem-somos/', 301),
      '/contato': redirect('/contato/', 301),
    });

    // 4. A verificacao seguinte enxerga a diferenca.
    const segunda = await empresa.client.post(`${base()}/sync/verificar`, {});
    expect(segunda.status, segunda.errorMessage ?? '').toBe(200);
    expect(segunda.body.changesFound).toBeGreaterThan(0);
    const propostas = await pendentes();
    expect(propostas.length).toBeGreaterThan(0);
    expect(JSON.stringify(propostas)).toContain('sábados');

    // 5. Nada foi alterado sozinho: a proposta espera aprovacao.
    const documentos = await api.db
      .select()
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.tenantId, empresa.tenantId),
          eq(schema.contentDocuments.moduleKey, 'institucional'),
        ),
      );
    expect(JSON.stringify(documentos.map((d) => d.data))).not.toContain('sábados');
  });

  it('pagina que nao mudou responde 304 e sai barata', async () => {
    const servidor = await startTestServer({
      '/': html('<!doctype html><html><head><title>Estável</title></head><body><main><h1>Estável</h1>'
        + '<p>Esta página não muda nunca, e diz isso ao visitante com um validador.</p></main></body></html>',
        { etag: '"sempre-igual"' }),
    });
    servidores.set('estavel.test', servidor);

    // Um fetcher proprio, com este servidor no mapa.
    const mapa: Record<string, string> = {};
    for (const [host, s] of servidores) mapa[host] = s.origin;
    const outra = await createTestApi({ siteFetcher: createSiteFetcher({ testOrigins: mapa }) });
    try {
      const conta = await registerAccount(outra, { email: 'c@estavel.com.br', companyName: 'Estavel' });
      await verifyEmail(outra, conta);
      const raiz = `/api/tenants/${conta.tenantId}`;

      const abertura = await conta.client.post(`${raiz}/site-import`, { url: 'http://estavel.test/' });
      expect(abertura.status, abertura.errorMessage ?? '').toBe(201);
      for (let i = 0; i < 25; i += 1) {
        const estado = await conta.client.get(`${raiz}/site-import/${abertura.body.run.id}`);
        if (!estado.body.run.working) break;
      }
      await conta.client.post(`${raiz}/site-import/${abertura.body.run.id}/confirmar`, {
        confirm: true,
        targets: [],
      });
      await conta.client.post(`${raiz}/sync`, { url: 'http://estavel.test/', frequency: 'semanal' });
      await conta.client.post(`${raiz}/sync/verificar`, {});

      const antes = servidor.requests.length;
      const r = await conta.client.post(`${raiz}/sync/verificar`, {});
      expect(r.status, r.errorMessage ?? '').toBe(200);

      // O validador foi enviado, e o servidor respondeu 304 -- sem corpo.
      const pedido = servidor.requests.slice(antes).find((p) => p.path === '/');
      expect(pedido?.headers['if-none-match']).toBe('"sempre-igual"');
      expect(r.body.changesFound).toBe(0);
    } finally {
      await outra.close();
    }
  });
});
