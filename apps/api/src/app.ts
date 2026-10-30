import { Hono } from 'hono';
import { createContext, type AppContext, type CreateContextOptions } from './context.js';
import { probeDatabase } from './lib/db-probe.js';
import { deploymentInfo } from './lib/deployment.js';
import { ok } from './lib/http.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { cors, securityHeaders } from './middleware/security.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { billingJobRoutes } from './routes/billing-jobs.js';
import { contentRoutes } from './routes/content.js';
import { domainRoutes } from './routes/domains.js';
import { leadRoutes } from './routes/leads.js';
import { mediaRoutes } from './routes/media.js';
import { memberRoutes } from './routes/members.js';
import { pageRoutes } from './routes/pages.js';
import { platformRoutes } from './routes/platform.js';
import { platformBillingRoutes } from './routes/platform-billing.js';
import { projectRoutes } from './routes/projects.js';
import { propertyRoutes } from './routes/properties.js';
import { publicRoutes } from './routes/public.js';
import { renderRoutes } from './routes/render.js';
import { tenantRoutes } from './routes/tenants.js';
import { webhookRoutes } from './routes/webhooks.js';
import { sessionMiddleware } from './middleware/auth.js';
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

  app.get('/health', async (c) => {
    // A sondagem do banco e o ponto do health: sem ela a resposta dizia "ok"
    // com o banco inalcancavel, e a tela ficava sem explicacao nenhuma.
    const database = await probeDatabase(ctx.db);
    const healthy = database.query === 'ok' && database.transaction === 'ok';
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

  // Job de reconciliacao, protegido por segredo proprio (Vercel Cron).
  app.route('/billing', billingJobRoutes());

  // Endpoints publicos dos sites: identificam a empresa pelo dominio.
  app.route('/public', publicRoutes());

  // Previa do site no dominio do painel, com a mesma renderizacao do site no ar.
  app.route('/render', renderRoutes());

  // Painel da construtora: sessao obrigatoria e empresa resolvida pela rota.
  const tenantScoped = new Hono<AppBindings>();
  tenantScoped.use('*', sessionMiddleware());
  tenantScoped.route('/', tenantRoutes());
  tenantScoped.route('/', memberRoutes());
  tenantScoped.route('/', pageRoutes());
  tenantScoped.route('/', propertyRoutes());
  tenantScoped.route('/', projectRoutes());
  tenantScoped.route('/', contentRoutes());
  tenantScoped.route('/', mediaRoutes());
  tenantScoped.route('/', leadRoutes());
  tenantScoped.route('/', domainRoutes());
  tenantScoped.route('/', billingRoutes());
  app.route('/tenants', tenantScoped);

  // Painel mestre da plataforma.
  const platformScoped = new Hono<AppBindings>();
  platformScoped.use('*', sessionMiddleware());
  platformScoped.route('/', platformRoutes());
  platformScoped.route('/', platformBillingRoutes());
  app.route('/platform', platformScoped);

  return app;
}

export type App = ReturnType<typeof createApp>;
