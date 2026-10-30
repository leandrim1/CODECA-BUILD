import { getDatabase, type Database } from '@codeca/database';
import { featureFlags, parseEnv, type Env, type FeatureFlags } from './env.js';
import { createBlobStorage, type BlobStorage } from './lib/blob.js';
import { createDomainProvider, type DomainProvider } from './lib/vercel-domains.js';
import { createMailer, type Mailer } from './lib/mailer.js';
import { createBillingProvider, type BillingProvider } from './lib/validapay/provider.js';

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
  /**
   * Cliente HTTP para os webhooks de saida.
   *
   * Substituivel nos testes: um teste que precisasse de um servidor de
   * verdade para conferir a assinatura nao verificaria a assinatura, e sim a
   * rede. Em producao e o `fetch` global.
   */
  fetch: typeof globalThis.fetch;
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
}

export function createContext(options: CreateContextOptions = {}): AppContext {
  const env = options.env ?? parseEnv();
  return {
    env,
    features: featureFlags(env),
    db: options.db ?? getDatabase(env.DATABASE_URL),
    blob: options.blob ?? createBlobStorage(env),
    domains: options.domains ?? createDomainProvider(env),
    mailer: options.mailer ?? createMailer(env),
    billing: options.billing ?? createBillingProvider(env),
    now: options.now ?? (() => new Date()),
    fetch: options.fetch ?? ((...args) => globalThis.fetch(...args)),
  };
}
