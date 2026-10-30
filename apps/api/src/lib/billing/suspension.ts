import { eq, schema, type Database } from '@codeca/database';
import {
  DEFAULT_SUSPENSION_POLICY,
  suspensionEffect,
  type PublicationState,
  type SuspensionEffect,
  type SuspensionPolicy,
} from '@codeca/shared';
import { loadSubscription, publicationForRow } from './service.js';

/**
 * Situacao de cobranca de um site, do ponto de vista de quem restringe.
 *
 * Um lugar so para a pergunta "este site pode gravar / pode ser lido agora?".
 * A API publica e o painel decidem pela mesma resposta: duas implementacoes
 * da mesma regra divergem no primeiro caso de borda, e aqui o caso de borda
 * custa o site de um cliente no ar ou um cliente trancado fora do painel.
 */

export interface SiteBillingSituation {
  publication: PublicationState;
  policy: SuspensionPolicy;
  effect: SuspensionEffect;
  /** `null` quando o site nunca teve assinatura registrada. */
  planId: string | null;
}

/**
 * Site sem assinatura nenhuma.
 *
 * Nao e inadimplencia: e um projeto que a CODECA IA ainda nao colocou em
 * cobranca, ou um site interno. Restringir aqui seria punir a propria
 * operacao, entao vale como liberado -- quem decide cobrar e quem cria a
 * assinatura.
 */
const SEM_ASSINATURA: SiteBillingSituation = {
  publication: 'allowed',
  policy: DEFAULT_SUSPENSION_POLICY,
  effect: suspensionEffect('allowed'),
  planId: null,
};

export async function resolveSiteBilling(
  db: Database,
  siteId: string,
  now: Date,
): Promise<SiteBillingSituation> {
  const subscription = await loadSubscription(db, siteId);
  if (!subscription) return SEM_ASSINATURA;

  const publication = publicationForRow(subscription, now);
  const policy = await loadSuspensionPolicy(db, subscription.planId);

  return {
    publication,
    policy,
    effect: suspensionEffect(publication, policy),
    planId: subscription.planId,
  };
}

/** Politica do plano, com o padrao quando a coluna vem vazia. */
export async function loadSuspensionPolicy(
  db: Database,
  planId: string,
): Promise<SuspensionPolicy> {
  const [row] = await db
    .select({ suspension: schema.plans.suspension })
    .from(schema.plans)
    .where(eq(schema.plans.id, planId));

  const guardado = row?.suspension;
  if (!guardado) return DEFAULT_SUSPENSION_POLICY;

  // O JSONB aceita qualquer coisa: um plano gravado antes da coluna existir,
  // ou editado a mao, nao pode derrubar a decisao.
  return {
    publicSite: guardado.publicSite ?? DEFAULT_SUSPENSION_POLICY.publicSite,
    panel: guardado.panel ?? DEFAULT_SUSPENSION_POLICY.panel,
  };
}
