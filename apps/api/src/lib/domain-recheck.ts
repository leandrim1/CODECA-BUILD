import { and, asc, eq, inArray, schema, sql, type Database } from '@codeca/database';
import type { Env } from '../env.js';
import { AUDIT_ACTIONS, recordAudit } from './audit.js';
import { mapProviderStatus, verificationPatch } from './domain-status.js';
import { loadHosting } from './hosting.js';
import type { DomainProvider } from './vercel-domains.js';

/**
 * Reverificacao periodica dos dominios.
 *
 * ## Por que existe
 *
 * Um dominio "Ativo" so diz que estava certo **no dia em que alguem apertou o
 * botao**. Depois disso o cliente troca de registrador, apaga o registro A sem
 * saber o que era, ou deixa o dominio vencer -- e o painel continua dizendo
 * "Ativo" enquanto o site nao abre. Do outro lado, quem cadastrou o dominio e
 * foi ajustar o DNS so descobriria que deu certo voltando ao painel para
 * apertar o botao.
 *
 * ## O que faz
 *
 * Reconsulta a Vercel dos dominios **gerenciados** e grava o estado novo pelas
 * mesmas regras do botao ("Verificar novamente"). Duas transicoes ficam na
 * trilha de auditoria: um dominio que passou a funcionar e um que deixou de
 * funcionar. A segunda tambem vai ao log, que e onde a operacao enxerga.
 *
 * ## O que nao faz, de proposito
 *
 * - **Dominio em modo registro** (hospedagem fora da plataforma): nunca e
 *   consultado. A plataforma nao sabe o que dizer sobre o DNS dele.
 * - **Sem `VERCEL_API_TOKEN`**: nada e consultado. Sem provedor o mapeamento
 *   devolveria "aguardando DNS" para tudo e rebaixaria dominios ativos por
 *   uma falha de configuracao nossa, nao do cliente.
 * - **Falha do provedor** (rede, 5xx, limite): o estado do dominio nao muda.
 *   Uma queda da Vercel nao pode marcar como quebrado um dominio que esta no
 *   ar. So `lastCheckedAt` anda, para que o dominio que falha sempre nao fique
 *   na frente da fila e deixe os outros sem vez.
 *
 * O trabalho por execucao e limitado (`limit`) e a fila anda pelo dominio
 * verificado ha mais tempo, entao o que sobra fica para a proxima passagem.
 */

/** Estados em que ainda ha algo a conferir. `registered` e `unlinked` ficam de fora. */
const STATUSES_TO_RECHECK = ['pending', 'awaiting_dns', 'verifying_ownership', 'active', 'misconfigured'] as const;

export interface DomainRecheckContext {
  db: Database;
  env: Env;
  domains: DomainProvider;
  now: () => Date;
}

export interface DomainRecheckReport {
  /** `false` quando nao ha token da Vercel: nada foi consultado. */
  providerConfigured: boolean;
  checked: number;
  unchanged: number;
  becameActive: Array<{ hostname: string }>;
  lostActive: Array<{ hostname: string; status: string }>;
  /** Dominios em modo registro que cairam na fila e foram ignorados. */
  skippedExternal: number;
  failures: Array<{ hostname: string; error: string }>;
}

export async function recheckDomains(
  ctx: DomainRecheckContext,
  options: { limit: number },
): Promise<DomainRecheckReport> {
  const report: DomainRecheckReport = {
    providerConfigured: ctx.domains.configured,
    checked: 0,
    unchanged: 0,
    becameActive: [],
    lostActive: [],
    skippedExternal: 0,
    failures: [],
  };
  if (!ctx.domains.configured) return report;

  // O mais antigo primeiro; quem nunca foi verificado (nulo) vem antes de todos.
  const queue = await ctx.db
    .select()
    .from(schema.domains)
    .where(inArray(schema.domains.status, [...STATUSES_TO_RECHECK]))
    .orderBy(sql`${schema.domains.lastCheckedAt} asc nulls first`, asc(schema.domains.createdAt))
    .limit(options.limit);

  for (const domain of queue) {
    const { mode } = await loadHosting(ctx.db, { tenantId: domain.tenantId, siteId: domain.siteId });
    if (!mode.managed) {
      report.skippedExternal += 1;
      continue;
    }

    try {
      // Mesma escolha do botao: dominio que ainda nao esta no projeto e
      // anexado (a Vercel responde 404 a `verify` de dominio desconhecido).
      const provider = domain.vercelDomainId
        ? await ctx.domains.verify(mode.projectId, domain.hostname)
        : await ctx.domains.add(mode.projectId, domain.hostname);
      const { status } = mapProviderStatus(provider, ctx.domains.configured);
      const now = ctx.now();

      await ctx.db
        .update(schema.domains)
        .set(verificationPatch(domain, provider, status, now))
        .where(and(eq(schema.domains.id, domain.id), eq(schema.domains.tenantId, domain.tenantId)));

      report.checked += 1;
      if (status === domain.status) {
        report.unchanged += 1;
      } else if (status === 'active') {
        report.becameActive.push({ hostname: domain.hostname });
        await recordAudit(ctx.db, ctx.env, {
          tenantId: domain.tenantId,
          action: AUDIT_ACTIONS.domainVerified,
          entityType: 'domain',
          entityId: domain.id,
          metadata: { hostname: domain.hostname, source: 'recheck' },
        });
      } else if (domain.status === 'active') {
        report.lostActive.push({ hostname: domain.hostname, status });
        await recordAudit(ctx.db, ctx.env, {
          tenantId: domain.tenantId,
          action: AUDIT_ACTIONS.domainVerificationLost,
          entityType: 'domain',
          entityId: domain.id,
          metadata: { hostname: domain.hostname, status, source: 'recheck' },
        });
      }
    } catch (error) {
      report.failures.push({
        hostname: domain.hostname,
        error: error instanceof Error ? error.message : 'erro desconhecido',
      });
      // Anda a fila sem mexer no estado: ver "O que nao faz".
      await ctx.db
        .update(schema.domains)
        .set({ lastCheckedAt: ctx.now() })
        .where(and(eq(schema.domains.id, domain.id), eq(schema.domains.tenantId, domain.tenantId)));
    }
  }

  return report;
}
