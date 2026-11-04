import { z } from 'zod';
import { parseEncryptionKey } from './lib/secret-box.js';

/**
 * Configuracao lida do ambiente.
 *
 * Nenhum segredo e exposto ao navegador: este modulo so e importado por codigo
 * que roda no servidor. Variaveis opcionais desligam recursos de forma
 * explicita em vez de falhar silenciosamente (ver `featureFlags`).
 */

const commaList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória.'),

  /** Segredo usado para derivar hashes de tokens de sessao e de IP. */
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET deve ter ao menos 32 caracteres.'),

  /** URL publica do painel da plataforma, usada em links de e-mail e CORS. */
  APP_URL: z.string().min(1).default('http://localhost:5173'),

  /** Hosts que pertencem a plataforma e nunca resolvem para um site de cliente. */
  PLATFORM_HOSTS: commaList,

  PLATFORM_NAME: z.string().min(1).default('Codeca Build'),
  PLATFORM_URL: z.string().min(1).default('https://codecabuild.com'),

  /**
   * Restringe quem pode assumir o papel de administrador no primeiro cadastro.
   * Sem ela, a primeira conta criada assume. Guarda um e-mail, nunca uma senha.
   */
  PLATFORM_ADMIN_EMAIL: z.string().optional(),

  /** Token do Vercel Blob. Sem ele, o upload de arquivos fica indisponivel. */
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // Definida pela Vercel ao conectar um Blob store. Stores criados hoje
  // autenticam por OIDC e nao emitem token de escrita nenhum.
  BLOB_STORE_ID: z.string().optional(),

  /** Credenciais da API da Vercel para registrar dominios dos clientes. */
  VERCEL_API_TOKEN: z.string().optional(),
  VERCEL_TEAM_ID: z.string().optional(),

  /** Alvos de DNS exibidos ao cliente nas instrucoes de dominio. */
  DOMAIN_A_RECORD_IP: z.string().default('76.76.21.21'),
  DOMAIN_CNAME_TARGET: z.string().default('cname.vercel-dns.com'),

  /** Envio de e-mail transacional. Sem chave, os links vao para o log. */
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Codeca Build <nao-responda@localhost>'),

  /**
   * Credenciais da ValidaPay (OAuth2 client_credentials). Sem elas, a
   * contratacao de planos e recusada de forma explicita.
   */
  VALIDAPAY_CLIENT_ID: z.string().optional(),
  VALIDAPAY_CLIENT_SECRET: z.string().optional(),
  /** Segredo usado para validar a assinatura HMAC dos webhooks. */
  VALIDAPAY_WEBHOOK_SECRET: z.string().optional(),
  /** Token estatico opcional, se configurado no cadastro do webhook. */
  VALIDAPAY_WEBHOOK_ACCESS_TOKEN: z.string().optional(),
  /** Host da API. Producao por padrao; use o de sandbox para testar. */
  VALIDAPAY_BASE_URL: z.string().default('https://api.validapay.com.br'),
  /** Host do OAuth2. Derivado do host da API quando ausente. */
  VALIDAPAY_AUTH_URL: z.string().optional(),
  /** Tolerancia do timestamp do webhook, em segundos. */
  VALIDAPAY_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

  /**
   * Login com Google (OAuth 2.0, fluxo de codigo com PKCE).
   *
   * O segredo fica so no servidor: o navegador nunca o ve. Sem o par
   * ID + segredo o botao "Continuar com Google" nao aparece e a rota recusa.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /**
   * URL de retorno cadastrada no Google. Opcional: sem ela vale
   * `<APP_URL>/api/auth/google/callback`, que e a rota real da API.
   */
  GOOGLE_REDIRECT_URI: z.string().optional(),

  /**
   * Exige a verificacao por e-mail em todo login.
   *
   * Com `RESEND_API_KEY` a verificacao e sempre aplicada (senha, depois codigo).
   * Sem ela nao ha como enviar o codigo; por padrao o login por senha segue
   * funcionando sem a segunda etapa -- senao uma instalacao sem e-mail
   * configurado ficaria trancada para fora. Com `LOGIN_CODE_REQUIRED=true` o
   * comportamento e outro: sem provedor de e-mail, **ninguem** entra (o login
   * responde 501), em vez de entrar sem a segunda etapa.
   */
  LOGIN_CODE_REQUIRED: z
    .string()
    .optional()
    // Tolerante de proposito: variavel vazia ou com outro texto vale "nao exigido".
    .transform((value) => value?.trim().toLowerCase() === 'true'),

  /**
   * Validade, em segundos, dos caches de autenticacao e autorizacao (sessao,
   * vinculo com a empresa, plano, assinatura, chave de integracao). `0`
   * desliga. Padrao 10 s; em teste, 0. Veja `lib/caches.ts`.
   */
  AUTH_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(300).optional(),
  /** Validade, em segundos, do cache das respostas da API publica. `0` desliga. Padrao 5 s; em teste, 0. */
  PUBLIC_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(300).optional(),
  /**
   * Maximo de requisicoes em andamento por instancia antes de recusar com 503
   * (protecao contra sobrecarga). `0` desliga. Padrao 0 -- ver `middleware/load-shedding.ts`.
   */
  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(0).max(10_000).default(0),
  /** Requisicoes mais lentas que isto (ms) vao para o log como `slow_request`. */
  SLOW_REQUEST_MS: z.coerce.number().int().min(50).max(60_000).default(1000),
  /** `true` registra TODA requisicao no log (diagnostico; em producao custa I/O). */
  LOG_ALL_REQUESTS: z
    .string()
    .optional()
    .transform((value) => value?.trim().toLowerCase() === 'true'),
  /** Segredo do endpoint `/api/metrics`. Sem ele, a rota responde 404. */
  METRICS_SECRET: z.string().min(16).optional(),
  /** Consultas acima deste tempo (ms) vao para o log como `slow_query`. */
  SLOW_QUERY_MS: z.coerce.number().int().min(10).max(60_000).default(500),
  /** Maximo de conexoes WebSocket (transacoes) por instancia ao Neon. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

  /**
   * Google Analytics 4 (integracao dos clientes). Usa o MESMO GOOGLE_CLIENT_ID e
   * GOOGLE_CLIENT_SECRET do login, com fluxo, `state` e callback proprios.
   *
   * URL de retorno do Analytics. Opcional: sem ela vale
   * `<APP_URL>/api/integrations/google-analytics/callback`. NAO reaproveita
   * GOOGLE_REDIRECT_URI, que e a do login.
   */
  GOOGLE_ANALYTICS_REDIRECT_URI: z.string().optional(),
  /**
   * Chave que cifra os tokens do Google Analytics no banco: 32 bytes em base64
   * (`openssl rand -base64 32`) ou 64 caracteres hexadecimais. Sem uma chave
   * valida a integracao fica desligada -- nunca se grava token sem cifra.
   */
  INTEGRATIONS_ENCRYPTION_KEY: z.string().optional(),
  /** Validade (s) do cache dos relatorios do Analytics. `0` desliga. Padrao 300; em teste, 0. */
  ANALYTICS_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).optional(),

  /** Segredo exigido pelo job de reconciliacao. */
  BILLING_RECONCILIATION_SECRET: z.string().optional(),
  /** Dias de tolerancia entre o vencimento e a suspensao do site. */
  BILLING_GRACE_PERIOD_DAYS: z.coerce.number().int().min(0).max(60).default(5),

  /** Define se os cookies exigem HTTPS. Ligado automaticamente em producao. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),

  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(12),
  SESSION_REMEMBER_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 365).default(24 * 30),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Configuração de ambiente inválida:\n- ${issues.join('\n- ')}`);
    this.name = 'EnvError';
  }
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvError(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  return result.data;
}

export interface FeatureFlags {
  /** Upload para o Vercel Blob disponivel. */
  blobStorage: boolean;
  /** Registro e verificacao de dominios na Vercel disponiveis. */
  vercelDomains: boolean;
  /** Envio real de e-mail disponivel. */
  transactionalEmail: boolean;
  /** Contratacao de planos na ValidaPay disponivel. */
  billing: boolean;
  /** Recebimento de webhooks de pagamento habilitado. */
  billingWebhooks: boolean;
  /** Job de reconciliacao habilitado. */
  billingReconciliation: boolean;
  /** Login com Google configurado (ID e segredo presentes). */
  googleAuth: boolean;
  /**
   * Verificacao por codigo enviado por e-mail (2a etapa de todo login). Depende
   * do provedor de e-mail: sem ele o codigo nunca chegaria.
   */
  emailCodeAuth: boolean;
  /**
   * Integracao com o Google Analytics 4: credenciais Google + chave de cifra
   * valida. Independente de `googleAuth` ser usado para login, mas reaproveita as
   * mesmas credenciais.
   */
  googleAnalytics: boolean;
}

export function featureFlags(env: Env): FeatureFlags {
  return {
    blobStorage: Boolean(env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID),
    vercelDomains: Boolean(env.VERCEL_API_TOKEN),
    transactionalEmail: Boolean(env.RESEND_API_KEY),
    billing: Boolean(env.VALIDAPAY_CLIENT_ID && env.VALIDAPAY_CLIENT_SECRET),
    billingWebhooks: Boolean(env.VALIDAPAY_WEBHOOK_SECRET),
    billingReconciliation: Boolean(env.BILLING_RECONCILIATION_SECRET),
    googleAuth: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    emailCodeAuth: Boolean(env.RESEND_API_KEY),
    googleAnalytics: Boolean(
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && parseEncryptionKey(env.INTEGRATIONS_ENCRYPTION_KEY),
    ),
  };
}

/**
 * URL de retorno do login com Google.
 *
 * Tem que ser IGUAL, caractere por caractere, a uma das cadastradas no Google
 * Cloud: o Google recusa qualquer diferenca (inclusive barra no fim e http x
 * https).
 */
export function googleRedirectUri(env: Env): string {
  const explicit = env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${env.APP_URL.replace(/\/$/, '')}/api/auth/google/callback`;
}

/**
 * URL de retorno do Google Analytics. Distinta da do login: cada fluxo tem o seu
 * callback, e as duas precisam estar cadastradas no Google Cloud.
 */
export function analyticsRedirectUri(env: Env): string {
  const explicit = env.GOOGLE_ANALYTICS_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${env.APP_URL.replace(/\/$/, '')}/api/integrations/google-analytics/callback`;
}

/** Validade efetiva do cache dos relatorios do Analytics. */
export function analyticsCacheTtl(env: Env): number {
  return env.ANALYTICS_CACHE_TTL_SECONDS ?? (env.NODE_ENV === 'test' ? 0 : 300);
}

/** Validade efetiva do cache de autenticacao: 10 s, e 0 em teste a menos que se diga o contrario. */
export function authCacheTtl(env: Env): number {
  return env.AUTH_CACHE_TTL_SECONDS ?? (env.NODE_ENV === 'test' ? 0 : 10);
}

/** Validade efetiva do cache de respostas publicas: 5 s, e 0 em teste a menos que se diga o contrario. */
export function publicCacheTtl(env: Env): number {
  return env.PUBLIC_CACHE_TTL_SECONDS ?? (env.NODE_ENV === 'test' ? 0 : 5);
}

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

export function cookieSecure(env: Env): boolean {
  return env.COOKIE_SECURE ?? isProduction(env);
}

/** Hosts da plataforma, sempre incluindo o host de `APP_URL`. */
export function platformHosts(env: Env): string[] {
  const hosts = new Set(env.PLATFORM_HOSTS);
  try {
    hosts.add(new URL(env.APP_URL).hostname.toLowerCase());
  } catch {
    // APP_URL pode ser apenas um host em ambientes simples.
    hosts.add(env.APP_URL.replace(/^https?:\/\//, '').split('/')[0]?.toLowerCase() ?? '');
  }
  // Deploys de preview da Vercel pertencem a plataforma.
  hosts.add('*.vercel.app');
  hosts.delete('');
  return [...hosts];
}

/** Origens aceitas pelo CORS do painel. */
export function allowedOrigins(env: Env): string[] {
  const origins = new Set<string>();
  origins.add(env.APP_URL.replace(/\/$/, ''));
  if (!isProduction(env)) {
    origins.add('http://localhost:5173');
    origins.add('http://127.0.0.1:5173');
    origins.add('http://app.localhost:5173');
  }
  return [...origins];
}
