import type { TenantContext } from './authz.js';
import type { ApiKeyContext } from './integration/keys.js';
import type { EffectivePlan } from './plan-limits.js';
import type { AuthenticatedSession } from './session.js';
import type { SiteBillingSituation } from './billing/suspension.js';
import { TtlCache } from './ttl-cache.js';

/**
 * Caches da aplicacao, um conjunto por instancia (`AppContext`).
 *
 * ## O problema que isto resolve
 *
 * Medido: uma requisicao do painel gastava de 10 a 13 consultas ao banco ANTES
 * de chegar ao codigo da rota (sessao, usuario, vinculos, empresa, site, plano,
 * assinatura). Em serverless cada consulta e uma ida de rede; a CPU da funcao
 * gasta quase tudo nisso. Estas perguntas tem respostas que mudam raramente e
 * sao repetidas por todos os cliques de todos os usuarios.
 *
 * ## O que cada validade custa (e por que e aceitavel)
 *
 * | Cache | Chave | Ate quando pode estar velho |
 * | --- | --- | --- |
 * | sessao | hash do token | logout/troca de senha **nesta** instancia: na hora; em outra: ate `AUTH_CACHE_TTL` |
 * | empresa+vinculo | empresa:usuario | remocao de membro **nesta** instancia: na hora; em outra: ate `AUTH_CACHE_TTL` |
 * | plano, assinatura | empresa / site | alteracao **nesta** instancia: na hora; em outra: ate `AUTH_CACHE_TTL` |
 * | chave de integracao | hash da chave | revogacao **nesta** instancia: na hora; em outra: ate `AUTH_CACHE_TTL` |
 * | resposta publica | site+rota+origem | edicao **nesta** instancia: na hora; em outra: ate `PUBLIC_CACHE_TTL` |
 *
 * O padrao e 10 s para autenticacao/autorizacao e 5 s para respostas publicas.
 * Nunca ha vazamento entre empresas: toda chave inclui o identificador de quem
 * a pediu (empresa, usuario, site), e o teste de isolamento cobre isso.
 *
 * Em teste o padrao e 0 (desligado): os testes alteram o banco direto, e um
 * cache esconderia essa mudanca. Os testes do proprio cache o ligam.
 */

export interface CachedApiKey extends ApiKeyContext {
  origins: string[];
  expiresAt: number | null;
}

export interface CachedPublicResponse {
  tenantId: string;
  siteId: string;
  status: number;
  body: string;
  headers: Array<[string, string]>;
}

export interface Caches {
  /** `null` guardado de proposito: token invalido repetido nao volta ao banco. */
  session: TtlCache<AuthenticatedSession | null>;
  tenant: TtlCache<TenantContext>;
  plan: TtlCache<EffectivePlan>;
  billing: TtlCache<SiteBillingSituation & { tenantId: string }>;
  apiKey: TtlCache<CachedApiKey>;
  publicResponse: TtlCache<CachedPublicResponse>;
  /** Token de acesso do Google Analytics (so em memoria, nunca no banco). */
  analyticsToken: TtlCache<string>;
  /** Relatorios do Analytics, por conexao+propriedade+periodo. */
  analyticsReport: TtlCache<unknown>;
  /** Contadores da janela do limite da API publica (por chave, nesta instancia). */
  publicRate: Map<string, { count: number; resetAt: number }>;
  readonly enabled: boolean;
  invalidateTenant: (tenantId: string, siteId?: string) => void;
  invalidateUser: (userId: string) => void;
  invalidateSession: (tokenHash: string) => void;
  invalidateAll: () => void;
  stats: () => Record<string, { size: number; hits: number; misses: number }>;
}

export function createCaches(
  options: { authTtlSeconds: number; publicTtlSeconds: number; analyticsTtlSeconds?: number },
  now: () => number = () => Date.now(),
): Caches {
  const auth = options.authTtlSeconds * 1000;
  const pub = options.publicTtlSeconds * 1000;

  const session = new TtlCache<AuthenticatedSession | null>(auth, 5_000, now);
  const tenant = new TtlCache<TenantContext>(auth, 10_000, now);
  const plan = new TtlCache<EffectivePlan>(auth, 5_000, now);
  const billing = new TtlCache<SiteBillingSituation & { tenantId: string }>(auth, 5_000, now);
  const apiKey = new TtlCache<CachedApiKey>(auth, 5_000, now);
  const publicResponse = new TtlCache<CachedPublicResponse>(pub, 2_000, now);
  const analyticsReport = new TtlCache<unknown>((options.analyticsTtlSeconds ?? 0) * 1000, 500, now);
  // Token de acesso do Google dura ~1 h; 45 min deixa folga. Segue o cache de
  // autenticacao: desligado (0) em teste, o token e renovado a cada uso.
  const analyticsToken = new TtlCache<string>(auth > 0 ? 45 * 60_000 : 0, 5_000, now);
  const publicRate = new Map<string, { count: number; resetAt: number }>();

  const caches: Caches = {
    session,
    tenant,
    plan,
    billing,
    apiKey,
    publicResponse,
    analyticsToken,
    analyticsReport,
    publicRate,
    enabled: auth > 0 || pub > 0,

    invalidateTenant(tenantId, siteId) {
      tenant.deleteWhere((key) => key.startsWith(`${tenantId}:`));
      plan.delete(tenantId);
      if (siteId) billing.delete(siteId);
      else billing.deleteWhere((_k, v) => v.tenantId === tenantId);
      publicResponse.deleteWhere((_k, v) => v.tenantId === tenantId);
      analyticsReport.deleteWhere((key) => key.startsWith(`${tenantId}:`));
    },

    invalidateUser(userId) {
      session.deleteWhere((_k, v) => v?.user.id === userId);
      tenant.deleteWhere((key) => key.endsWith(`:${userId}`));
    },

    invalidateSession(tokenHash) {
      session.delete(tokenHash);
    },

    invalidateAll() {
      for (const c of [session, tenant, plan, billing, apiKey, publicResponse, analyticsToken, analyticsReport]) c.clear();
      publicRate.clear();
    },

    stats() {
      const read = (c: TtlCache<unknown>) => ({ size: c.size, hits: c.hits, misses: c.misses });
      return {
        session: read(session),
        tenant: read(tenant),
        plan: read(plan),
        billing: read(billing),
        apiKey: read(apiKey),
        publicResponse: read(publicResponse),
        analyticsReport: read(analyticsReport),
      };
    },
  };
  return caches;
}
