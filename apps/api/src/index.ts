export { createApp, type App, type CreateAppOptions } from './app.js';
export { createContext, type AppContext, type CreateContextOptions } from './context.js';
export {
  createConfigErrorApp,
  createSiteConfigErrorApp,
  configurationIssues,
} from './config-error.js';
export { parseEnv, envSchema, featureFlags, platformHosts, type Env, type FeatureFlags } from './env.js';
export { deploymentInfo, type DeploymentInfo } from './lib/deployment.js';
export { hashLoginCode } from './lib/login-code.js';
export { probeDatabase, type DatabaseProbe, type ProbeResult } from './lib/db-probe.js';
export {
  createMemoryMailer,
  createMailer,
  createResendMailer,
  probeMailProvider,
  senderDomain,
  type MailProviderProbe,
  type Mailer,
  type MailMessage,
} from './lib/mailer.js';
export {
  createMemoryBlobStorage,
  createBlobStorage,
  resolveBlobCredential,
  type BlobStorage,
  type BlobCredential,
} from './lib/blob.js';
export {
  createUnconfiguredDomainProvider,
  createVercelDomainProvider,
  createDomainProvider,
  type DomainProvider,
  type DomainProviderStatus,
} from './lib/vercel-domains.js';
export {
  createBillingProvider,
  createValidaPayProvider,
  createUnconfiguredBillingProvider,
  type BillingProvider,
  type SyncPlanInput,
  type SyncPlanResult,
} from './lib/validapay/provider.js';
export {
  createMemoryBillingProvider,
  type MemoryBillingProvider,
} from './lib/validapay/memory.js';
export {
  verifyWebhookSignature,
  signWebhookBody,
  parseSignatureHeader,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_ID_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_ATTEMPT_HEADER,
  type WebhookVerificationResult,
} from './lib/validapay/webhook.js';
export type {
  SubscriptionResponse,
  ChargeResponse,
  ChargeStatusResponse,
} from './lib/validapay/types.js';
export { AUDIT_ACTIONS } from './lib/audit.js';
// Exportado para teste: decide quem escapa das politicas do painel.
export { subPathAllowed, tenantSubPath } from './middleware/tenant-path.js';
export { SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER } from './lib/cookies.js';

/**
 * Importacao de sites externos.
 *
 * Duas formas de testar, com propositos diferentes:
 *
 * - `createMemorySiteFetcher` substitui a rede inteira. Serve aos testes de
 *   fluxo, que querem exercitar rastreamento, extracao e gravacao sem depender
 *   de soquete.
 * - `createSiteFetcher({ testOrigins })` usa a implementacao de producao contra
 *   um servidor HTTP de verdade em `127.0.0.1`. Serve ao que o dublê nao
 *   alcanca: soquete, redirecionamento revalidado, prazo, limite de bytes e
 *   304. Ver `SiteFetcherOptions` para por que isso nao afrouxa a protecao.
 */
export {
  createSiteFetcher,
  createMemorySiteFetcher,
  addressLookup,
  SiteFetchError,
  type SiteFetcher,
  type SiteFetcherOptions,
  type FetchedResource,
  type FetchOptions,
  type ResolvedAddress,
} from './lib/import/fetcher.js';
