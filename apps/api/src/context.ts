import { getDatabase, setSlowQueryThreshold, type Database } from '@codeca/database';
import { analyticsCacheTtl, authCacheTtl, featureFlags, parseEnv, publicCacheTtl, type Env, type FeatureFlags } from './env.js';
import { createCaches, type Caches } from './lib/caches.js';
import { createBlobStorage, type BlobStorage } from './lib/blob.js';
import { createDomainProvider, type DomainProvider } from './lib/vercel-domains.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { createMonitor, type Monitor } from './lib/ops/monitor.js';
import { createBillingProvider, type BillingProvider } from './lib/validapay/provider.js';
import { createSiteFetcher, type SiteFetcher } from './lib/import/fetcher.js';
import { createRendererFromEnv, type PageRenderer } from './lib/import/renderer.js';

/**
 * Dependencias da API reunidas em um unico objeto.
 *
 * Tudo que fala com o mundo externo (banco, armazenamento, provedor de
 * dominios, e-mail) entra por aqui, o que permite substituir cada peca nos
 * testes sem alterar as rotas.
 */
export interface AppContext {
  env: Env;
  features: FeatureFlags;
  db: Database;
  blob: BlobStorage;
  domains: DomainProvider;
  mailer: Mailer;
  /** Cobranca e assinaturas (ValidaPay). */
  billing: BillingProvider;
  /** Fonte de tempo, substituivel nos testes. */
  now: () => Date;
  /** Caches de memoria desta instancia. Ver `lib/caches.ts`. */
  caches: Caches;
  /**
   * Cliente HTTP para os webhooks de saida.
   *
   * Substituivel nos testes: um teste que precisasse de um servidor de
   * verdade para conferir a assinatura nao verificaria a assinatura, e sim a
   * rede. Em producao e o `fetch` global.
   */
  fetch: typeof globalThis.fetch;
  /**
   * Busca das paginas na importacao de site externo.
   *
   * Peca propria, e nao o `fetch` acima, porque ela carrega a protecao contra
   * SSRF: resolve o nome, confere o IP e conecta naquele endereco. Substituivel
   * nos testes por um motivo concreto -- a implementacao de verdade **recusa**
   * `localhost`, entao um teste de ponta a ponta contra um servidor local seria
   * barrado pela propria protecao que se quer ter.
   */
  siteFetcher: SiteFetcher;
  /**
   * Navegador para sites que montam o conteudo no cliente.
   *
   * Sem configuracao, e o que nao renderiza -- e o padrao, porque renderizar
   * executa o JavaScript do site analisado. Ver `lib/import/renderer.ts`.
   */
  renderer: PageRenderer;
  /** Registro de falhas operacionais e alertas. Ver `lib/ops/monitor.ts`. */
  monitor: Monitor;
  /**
   * Agenda trabalho que continua depois de a resposta sair.
   *
   * Em funcao serverless, uma promessa solta depois da resposta pode ser
   * congelada no meio. Na Vercel isto e `waitUntil`, que mantem a funcao viva
   * ate a promessa terminar (dentro do limite de duracao). Fora dela, a
   * promessa simplesmente segue -- o processo nao e congelado.
   *
   * Quem agenda cuida do proprio erro: uma falha aqui nao tem requisicao para
   * onde voltar.
   */
  background: (task: Promise<unknown>) => void;
}

export interface CreateContextOptions {
  env?: Env;
  db?: Database;
  blob?: BlobStorage;
  domains?: DomainProvider;
  mailer?: Mailer;
  billing?: BillingProvider;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  siteFetcher?: SiteFetcher;
  renderer?: PageRenderer;
  monitor?: Monitor;
  background?: (task: Promise<unknown>) => void;
}

export function createContext(options: CreateContextOptions = {}): AppContext {
  const env = options.env ?? parseEnv();
  setSlowQueryThreshold(env.SLOW_QUERY_MS);
  const now = options.now ?? (() => new Date());
  const db = options.db ?? getDatabase(env.DATABASE_URL, { poolMax: env.DB_POOL_MAX });
  const mailer = options.mailer ?? createMailer(env);
  const fetchImpl: typeof globalThis.fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const alertEmail = env.OPS_ALERT_EMAIL;
  const monitor =
    options.monitor ??
    createMonitor({
      alertWebhookUrl: env.OPS_ALERT_WEBHOOK_URL,
      sendAlertEmail:
        alertEmail && mailer.configured
          ? async (alert) => {
              const envio = await mailer.send({ to: alertEmail, kind: 'ops_alert', ...alert });
              if (!envio.delivered) throw new Error(envio.reason ?? 'alerta por e-mail não entregue');
            }
          : undefined,
      alertWindowSeconds: env.OPS_ALERT_WINDOW_MINUTES * 60,
      environment: env.NODE_ENV,
      fetch: fetchImpl,
      now,
      db,
    });
  return {
    env,
    features: featureFlags(env),
    caches: createCaches(
      {
        authTtlSeconds: authCacheTtl(env),
        publicTtlSeconds: publicCacheTtl(env),
        analyticsTtlSeconds: analyticsCacheTtl(env),
      },
      () => now().getTime(),
    ),
    db,
    blob: options.blob ?? createBlobStorage(env),
    domains: options.domains ?? createDomainProvider(env),
    mailer: monitoredMailer(mailer, monitor),
    billing: options.billing ?? createBillingProvider(env),
    now,
    fetch: fetchImpl,
    siteFetcher: options.siteFetcher ?? createSiteFetcher(),
    renderer: options.renderer ?? createRendererFromEnv(env),
    monitor,
    background:
      options.background ??
      ((task) => {
        // Sem plataforma que estenda a vida da funcao: a promessa segue por
        // conta propria. O erro e engolido aqui porque quem agendou ja o tratou.
        void task.catch(() => undefined);
      }),
  };
}

/**
 * Reporta ao monitor todo envio que o provedor nao aceitou.
 *
 * Fica aqui, em volta do mailer, e nao em cada rota que envia: sao seis
 * lugares hoje, e o setimo esqueceria. So observa -- o resultado devolvido a
 * quem chamou e exatamente o do mailer.
 *
 * O registro leva o tipo da mensagem e o motivo, nunca o destinatario nem o
 * conteudo (que, no codigo de acesso, e a propria credencial).
 */
function monitoredMailer(mailer: Mailer, monitor: Monitor): Mailer {
  if (!mailer.configured) return mailer;
  return {
    ...mailer,
    configured: mailer.configured,
    async send(message) {
      const resultado = await mailer.send(message);
      if (!resultado.delivered) {
        await monitor.report({
          kind: 'email_failed',
          severity: 'critical',
          message: 'O provedor de e-mail não aceitou uma mensagem.',
          context: { mailKind: message.kind, reason: resultado.reason ?? 'sem motivo informado' },
          alertKey: 'email_failed',
        });
      }
      return resultado;
    },
  };
}
