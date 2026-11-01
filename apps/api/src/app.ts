import { Hono } from 'hono';
import { createContext, type AppContext, type CreateContextOptions } from './context.js';
import { probeDatabase } from './lib/db-probe.js';
import { deploymentInfo } from './lib/deployment.js';
import { ok } from './lib/http.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { cors, securityHeaders } from './middleware/security.js';
import { authRoutes } from './routes/auth.js';
import { bannerRoutes } from './routes/banners.js';
import { billingRoutes } from './routes/billing.js';
import { billingJobRoutes } from './routes/billing-jobs.js';
import { catalogRoutes } from './routes/catalog.js';
import { contentRoutes } from './routes/content.js';
import { domainRoutes } from './routes/domains.js';
import { leadRoutes } from './routes/leads.js';
import { mediaRoutes } from './routes/media.js';
import { moduleRoutes } from './routes/modules.js';
import { customModuleRoutes } from './routes/custom-modules.js';
import { memberRoutes } from './routes/members.js';
import { platformRoutes } from './routes/platform.js';
import { platformBillingRoutes } from './routes/platform-billing.js';
import { platformSegmentRoutes } from './routes/platform-segments.js';
import { platformSiteRoutes } from './routes/platform-sites.js';
import { projectRoutes } from './routes/projects.js';
import { publicApiRoutes } from './routes/public-api.js';
import { propertyRoutes } from './routes/properties.js';
import { tenantRoutes } from './routes/tenants.js';
import { webhookRoutes } from './routes/webhooks.js';
import { sessionMiddleware, tenantMiddleware } from './middleware/auth.js';
import { requirePanelPlan } from './middleware/plan-panel.js';
import { enforceSuspension } from './middleware/suspension.js';
import type { AppBindings } from './types.js';

/**
 * Aplicacao HTTP da plataforma.
 *
 * Montada sob `/api` e servida por uma funcao compativel com o ambiente da
 * Vercel. Todas as rotas recebem o `AppContext` com as dependencias externas,
 * o que permite testar a API inteira com um Postgres em processo.
 */

export interface CreateAppOptions extends CreateContextOptions {
  context?: AppContext;
  /** Prefixo das rotas. Padrao `/api`. */
  basePath?: string;
}

export function createApp(options: CreateAppOptions = {}) {
  const ctx = options.context ?? createContext(options);
  const app = new Hono<AppBindings>().basePath(options.basePath ?? '/api');

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.use('*', async (c, next) => {
    c.set('ctx', ctx);
    c.set('requestId', crypto.randomUUID());
    await next();
  });
  app.use('*', securityHeaders(ctx.env));
  app.use('*', cors(ctx.env));

  /**
   * Estado da aplicacao.
   *
   * **Nao toca no banco por padrao, de proposito.** Um health que consulta a
   * dependencia que ele monitora trava junto com ela -- e foi o que aconteceu
   * aqui: com o banco sem responder, o proprio health estourou o tempo da
   * funcao e perdemos o unico instrumento que tinhamos. Sem banco no caminho,
   * esta rota responde sempre, e separa duas perguntas que se confundiam:
   *
   * - `/api/health` responde? Entao a funcao sobe e o roteamento esta certo.
   * - `/api/health?db=1` responde? Entao o banco tambem esta de pe.
   *
   * Uma falha na primeira nao e problema de banco; e da funcao ou da
   * implantacao.
   */
  app.get('/health', async (c) => {
    const probeRequested = c.req.query('db') === '1';
    const database = probeRequested ? await probeDatabase(ctx.db) : null;
    const healthy = !database || (database.query === 'ok' && database.transaction === 'ok');
    return ok(
      c,
      {
        status: healthy ? 'ok' : 'degradado',
        platform: ctx.env.PLATFORM_NAME,
        features: ctx.features,
        // Qual codigo esta de fato no ar. E a unica resposta confiavel quando a
        // tela diverge do repositorio: se o commit aqui nao e o esperado, o
        // problema esta na implantacao, nao no codigo.
        deployment: deploymentInfo(),
        // `null` quando nao foi pedida: ausencia de sondagem nao e sinal de
        // saude. Use `?db=1` para sondar.
        database,
        time: ctx.now().toISOString(),
      },
      healthy ? 200 : 503,
    );
  });

  app.route('/auth', authRoutes());

  // Webhooks do provedor de pagamento: publicos, autenticados por assinatura
  // HMAC do corpo bruto -- nao por sessao nem CSRF.
  app.route('/webhooks', webhookRoutes());

  // API publica dos sites dos clientes: autenticada por chave de integracao,
  // nunca por sessao. Versionada desde a primeira rota.
  app.route('/v1', publicApiRoutes());

  // Job de reconciliacao, protegido por segredo proprio (Vercel Cron).
  app.route('/billing', billingJobRoutes());

  // Painel da construtora: sessao obrigatoria e empresa resolvida pela rota.
  //
  // Os tres middlewares ficam aqui, e nao em cada roteador, por duas razoes.
  // A ordem passa a ser visivel num lugar so -- a suspensao depende da
  // empresa ja resolvida -- e cada um roda **uma vez** por requisicao: como
  // `route('/', ...)` copia tambem os middlewares do roteador filho, um
  // `use('/:tenantId/*')` repetido em onze roteadores era executado onze
  // vezes, resolvendo o contexto da empresa de novo a cada volta.
  const tenantScoped = new Hono<AppBindings>();
  tenantScoped.use('*', sessionMiddleware());
  tenantScoped.use('/:tenantId/*', tenantMiddleware());
  /**
   * Duas camadas, na ordem em que as perguntas se fazem.
   *
   * Primeiro: **o plano inclui o painel?** O Essencial nao inclui, e nesse
   * caso nem faz sentido perguntar sobre a assinatura.
   *
   * Depois: **a assinatura esta em dia?** Essa e a politica de suspensao.
   *
   * As duas deixam `/billing` passar pela mesma razao -- bloquear quem precisa
   * pagar ou fazer upgrade e impedir a propria saida da limitacao.
   */
  tenantScoped.use(
    '/:tenantId/*',
    requirePanelPlan({ exempt: ['', '/contact', '/plan', '/billing', '/modules'] }),
  );
  tenantScoped.use('/:tenantId/*', enforceSuspension({ exempt: ['/billing'] }));
  tenantScoped.route('/', tenantRoutes());
  tenantScoped.route('/', memberRoutes());
  tenantScoped.route('/', propertyRoutes());
  tenantScoped.route('/', projectRoutes());
  tenantScoped.route('/', contentRoutes());
  tenantScoped.route('/', catalogRoutes());
  tenantScoped.route('/', moduleRoutes());
  tenantScoped.route('/', customModuleRoutes());
  tenantScoped.route('/', bannerRoutes());
  tenantScoped.route('/', mediaRoutes());
  tenantScoped.route('/', leadRoutes());
  tenantScoped.route('/', domainRoutes());
  tenantScoped.route('/', billingRoutes());
  app.route('/tenants', tenantScoped);

  // Painel mestre da plataforma.
  const platformScoped = new Hono<AppBindings>();
  platformScoped.use('*', sessionMiddleware());
  platformScoped.route('/', platformRoutes());
  platformScoped.route('/', platformSiteRoutes());
  platformScoped.route('/', platformSegmentRoutes());
  platformScoped.route('/', platformBillingRoutes());
  app.route('/platform', platformScoped);

  return app;
}

export type App = ReturnType<typeof createApp>;
