import { DEFAULT_PLANS } from '@codeca/shared';
import { plans } from './schema.js';
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
