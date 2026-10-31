import { DEFAULT_PLANS, DEFAULT_SEGMENTS } from '@codeca/shared';
import { plans, segments } from './schema.js';
import type { Database } from './client.js';

/**
 * Dados de referencia de uma instalacao nova.
 *
 * Os planos precisam existir para que o cadastro funcione: sem o plano de
 * avaliacao, criar uma conta falha. Mas eles tambem sao editaveis no painel
 * mestre -- preco, limites e recursos sao decisao comercial de quem opera.
 *
 * Por isso a regra aqui e estreita de proposito: **so preenche quando a tabela
 * esta vazia**. Nunca sobrescreve. Um plano com preco ajustado no painel nao
 * volta ao padrao no proximo deploy, que e exatamente o que aconteceria se
 * isto reaproveitasse o `seedDatabase`, cujo `onConflictDoUpdate` reescreve os
 * planos existentes.
 */

export interface BaselineResult {
  /** Quantos planos foram criados. Zero quando ja havia algum. */
  plansCreated: number;
  skipped: boolean;
}

export interface SegmentBaselineResult {
  /** Quantos segmentos foram criados. Zero quando ja havia algum. */
  segmentsCreated: number;
  skipped: boolean;
}

export async function ensureBaselinePlans(db: Database): Promise<BaselineResult> {
  const existing = await db.select({ id: plans.id }).from(plans).limit(1);
  if (existing.length > 0) return { plansCreated: 0, skipped: true };

  const created = await db
    .insert(plans)
    .values(
      DEFAULT_PLANS.map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        limits: plan.limits,
        billing: plan.billing,
        isPublic: true,
        isActive: true,
      })),
    )
    // Corrida entre dois deploys simultaneos: o segundo nao duplica.
    .onConflictDoNothing({ target: plans.code })
    .returning({ id: plans.id });

  return { plansCreated: created.length, skipped: false };
}

/**
 * Segmentos de referencia, pela mesma regra dos planos.
 *
 * Desde a etapa 7 o painel mestre cria, edita e remove segmentos, entao a
 * tabela pode ficar vazia -- e sem nenhum segmento marcado como padrao uma
 * empresa recem-cadastrada nasce com todos os modulos ligados, inclusive os
 * que o projeto dela nao tem. Isto repoe um conjunto inicial **somente**
 * quando nao sobrou nenhum; um segmento removido de proposito nao volta.
 */
export async function ensureBaselineSegments(db: Database): Promise<SegmentBaselineResult> {
  const existing = await db.select({ id: segments.id }).from(segments).limit(1);
  if (existing.length > 0) return { segmentsCreated: 0, skipped: true };

  const created = await db
    .insert(segments)
    .values(
      DEFAULT_SEGMENTS.map((segment) => ({
        code: segment.code,
        name: segment.name,
        description: segment.description,
        defaultModules: [...segment.defaultModules],
        isActive: true,
        isDefault: segment.isDefault,
      })),
    )
    .onConflictDoNothing({ target: segments.code })
    .returning({ id: segments.id });

  return { segmentsCreated: created.length, skipped: false };
}
