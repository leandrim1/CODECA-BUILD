import {
  PLAN_FEATURE_LABELS,
  formatBytes,
  planLimitsSchema,
  type PlanFeature,
  type PlanLimits,
  type UsageSnapshot,
} from '@codeca/shared';
import { eq, schema, type Database } from '@codeca/database';
import { loadEffectivePlan, loadUsage } from '../plan-limits.js';

/**
 * O que acontece com a conta se o plano mudar.
 *
 * Existe porque trocar de plano mexia so na cobranca: nada conferia se a conta
 * CABE no plano novo. Uma empresa com 40 conteudos podia pedir um plano de 5,
 * e ninguem descobria ate a proxima tentativa de cadastrar algo.
 *
 * A regra desta camada, que o resto do sistema pode assumir:
 *
 * > **Reduzir plano nunca apaga nada.** O que ja existe continua existindo e
 * > continua sendo exibido no site. O que o limite menor impede e **criar
 * > mais** -- e isso quem aplica sao as validacoes que ja existiam
 * > (`assertWithinLimit`, `assertContentCapacity`, `assertStorageAvailable`).
 *
 * Nenhum valor financeiro e calculado aqui: pro-rata, credito e data de
 * vigencia vem do provedor, que e quem sabe. Ver `routes/billing.ts`.
 */

export type ImpactSeverity = 'ok' | 'aviso' | 'bloqueio';

export interface LimitImpact {
  /** Chave do limite, para a interface escolher o icone. */
  key: 'users' | 'contentRecords' | 'domains' | 'storageBytes';
  label: string;
  current: number;
  limit: number;
  /** Quanto passa do limite novo. Zero quando cabe. */
  excess: number;
  severity: ImpactSeverity;
  message: string;
}

export interface FeatureImpact {
  feature: PlanFeature;
  label: string;
  message: string;
}

export interface PlanChangeImpact {
  direction: 'upgrade' | 'downgrade' | 'lateral';
  fromPlan: { code: string; name: string; priceCents: number };
  toPlan: { code: string; name: string; priceCents: number };
  /** Limites que a conta ja ultrapassa no plano de destino. */
  limits: LimitImpact[];
  /** Recursos que o plano de destino nao inclui. */
  features: FeatureImpact[];
  /** `true` quando nada no plano novo aperta o que a conta ja tem. */
  fits: boolean;
  /**
   * `true` quando a reducao exige acao da pessoa ANTES de ser pedida.
   *
   * So os limites que a propria pessoa consegue ajustar entram aqui. Perder um
   * recurso (por exemplo o painel) e aviso, nao bloqueio: e uma escolha
   * legitima, e a pessoa precisa poder faze-la.
   */
  blocked: boolean;
  /** O que fazer para caber. Vazio quando cabe. */
  instructions: string[];
}

/**
 * Compara o que a conta usa hoje com o que o plano de destino permite.
 *
 * `usage` e `sites` entram por parametro para o chamador poder reaproveitar
 * leituras que ja fez -- e para os testes montarem cenarios sem banco.
 */
export function describePlanChange(input: {
  from: { code: string; name: string; priceCents: number; limits: PlanLimits };
  to: { code: string; name: string; priceCents: number; limits: PlanLimits };
  usage: UsageSnapshot;
}): PlanChangeImpact {
  const { from, to, usage } = input;
  const direction =
    to.priceCents > from.priceCents ? 'upgrade' : to.priceCents < from.priceCents ? 'downgrade' : 'lateral';

  const limits: LimitImpact[] = [];
  const avaliar = (
    key: LimitImpact['key'],
    label: string,
    current: number,
    limit: number,
    formatar: (n: number) => string = String,
  ) => {
    const excess = Math.max(0, current - limit);
    if (excess === 0) return;
    limits.push({
      key,
      label,
      current,
      limit,
      excess,
      severity: 'bloqueio',
      message:
        `Você usa ${formatar(current)} e o plano ${to.name} permite ${formatar(limit)}. `
        + `Nada será apagado, mas não será possível adicionar mais até ficar dentro do limite.`,
    });
  };

  avaliar('users', 'Pessoas com acesso', usage.users, to.limits.maxUsers);
  avaliar('contentRecords', 'Conteúdos cadastrados', usage.contentRecords, to.limits.maxContentRecords);
  avaliar('domains', 'Domínios', usage.domains, to.limits.maxDomains);
  avaliar('storageBytes', 'Armazenamento', usage.storageBytes, to.limits.storageBytes, formatBytes);
  // Projetos NAO entram: os planos nao tem limite de sites. Inventar um aqui
  // seria criar uma regra comercial que ninguem definiu.

  const features: FeatureImpact[] = from.limits.features
    .filter((f) => !to.limits.features.includes(f))
    .map((feature) => ({
      feature,
      label: PLAN_FEATURE_LABELS[feature] ?? feature,
      message: `O plano ${to.name} não inclui ${(PLAN_FEATURE_LABELS[feature] ?? feature).toLowerCase()}.`,
    }));

  const instructions: string[] = [];
  for (const item of limits) {
    if (item.key === 'users') {
      instructions.push(`Remova ${item.excess} pessoa(s) em Usuários antes de reduzir o plano.`);
    } else if (item.key === 'contentRecords') {
      instructions.push(`Exclua ${item.excess} conteúdo(s) antes de reduzir o plano.`);
    } else if (item.key === 'domains') {
      instructions.push(`Remova ${item.excess} domínio(s) em Domínios antes de reduzir o plano.`);
    } else {
      instructions.push(`Libere ${formatBytes(item.excess)} em Mídia antes de reduzir o plano.`);
    }
  }

  return {
    direction,
    fromPlan: { code: from.code, name: from.name, priceCents: from.priceCents },
    toPlan: { code: to.code, name: to.name, priceCents: to.priceCents },
    limits,
    features,
    fits: limits.length === 0 && features.length === 0,
    blocked: limits.length > 0,
    instructions,
  };
}

/** O mesmo, lendo o estado real da empresa. */
export async function planChangeImpact(
  db: Database,
  input: { tenantId: string; toPlanId: string },
): Promise<PlanChangeImpact> {
  const atual = await loadEffectivePlan(db, input.tenantId);
  const [destino] = await db
    .select({
      code: schema.plans.code,
      name: schema.plans.name,
      priceCents: schema.plans.priceCents,
      limits: schema.plans.limits,
    })
    .from(schema.plans)
    .where(eq(schema.plans.id, input.toPlanId));
  if (!destino) {
    throw new Error(`Plano ${input.toPlanId} não encontrado.`);
  }

  const usage = await loadUsage(db, input.tenantId);
  const [planoAtual] = await db
    .select({ priceCents: schema.plans.priceCents })
    .from(schema.plans)
    .where(eq(schema.plans.id, atual.planId));

  return describePlanChange({
    from: {
      code: atual.planCode,
      name: atual.planName,
      priceCents: planoAtual?.priceCents ?? 0,
      limits: atual.limits,
    },
    to: {
      code: destino.code,
      name: destino.name,
      priceCents: destino.priceCents,
      limits: planLimitsSchema.parse(destino.limits),
    },
    usage,
  });
}
