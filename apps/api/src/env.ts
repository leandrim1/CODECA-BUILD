import { z } from 'zod';

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

  DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria.'),

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
  VERCEL_PROJECT_ID: z.string().optional(),
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
    super(`Configuracao de ambiente invalida:\n- ${issues.join('\n- ')}`);
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
}

export function featureFlags(env: Env): FeatureFlags {
  return {
    blobStorage: Boolean(env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID),
    vercelDomains: Boolean(env.VERCEL_API_TOKEN && env.VERCEL_PROJECT_ID),
    transactionalEmail: Boolean(env.RESEND_API_KEY),
    billing: Boolean(env.VALIDAPAY_CLIENT_ID && env.VALIDAPAY_CLIENT_SECRET),
    billingWebhooks: Boolean(env.VALIDAPAY_WEBHOOK_SECRET),
    billingReconciliation: Boolean(env.BILLING_RECONCILIATION_SECRET),
  };
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
