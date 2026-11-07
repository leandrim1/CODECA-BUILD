import { getDatabase, setSlowQueryThreshold, type Database } from '@codeca/database';
import { analyticsCacheTtl, authCacheTtl, featureFlags, parseEnv, publicCacheTtl, type Env, type FeatureFlags } from './env.js';
import { createCaches, type Caches } from './lib/caches.js';
import { createBlobStorage, type BlobStorage } from './lib/blob.js';
import { createDomainProvider, type DomainProvider } from './lib/vercel-domains.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { createBillingProvider, type BillingProvider } from './lib/validapay/provider.js';
import { createSiteFetcher, type SiteFetcher } from './lib/import/fetcher.js';

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
}

export function createContext(options: CreateContextOptions = {}): AppContext {
  const env = options.env ?? parseEnv();
  setSlowQueryThreshold(env.SLOW_QUERY_MS);
  const now = options.now ?? (() => new Date());
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
    db: options.db ?? getDatabase(env.DATABASE_URL, { poolMax: env.DB_POOL_MAX }),
    blob: options.blob ?? createBlobStorage(env),
    domains: options.domains ?? createDomainProvider(env),
    mailer: options.mailer ?? createMailer(env),
    billing: options.billing ?? createBillingProvider(env),
    now,
    fetch: options.fetch ?? ((...args) => globalThis.fetch(...args)),
    siteFetcher: options.siteFetcher ?? createSiteFetcher(),
  };
}
