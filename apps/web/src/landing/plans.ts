import { formatPlanPrice, type PlanFeature } from '@codeca/shared';
import type { PublicPlan } from '../services/endpoints.js';

/**
 * Tudo que a pagina diz sobre planos sai daqui, e so de dados.
 *
 * Nenhum numero, nome de plano ou beneficio e escrito a mao nos textos: sao
 * derivados do que a API devolve. Mudar um preco ou um limite no painel mestre
 * muda a pagina, inclusive as respostas do FAQ.
 */

export function preco(plan: PublicPlan): { valor: string; periodo: string | null } {
  if (plan.priceCents === 0) {
    return {
      valor: 'Gratuito',
      periodo: plan.trialDays ? `por ${plan.trialDays} dias` : null,
    };
  }
  return { valor: formatPlanPrice(plan.priceCents), periodo: '/mês' };
}

/**
 * Nome do plano como a pagina o escreve.
 *
 * O nome e editavel no painel mestre e a semente o grava sem acento. So o
 * valor de semente e acentuado aqui; um nome que o superadmin tenha trocado
 * aparece exatamente como ele o escreveu.
 */
export function nomeDoPlano(plan: PublicPlan): string {
  return plan.code === 'trial' && plan.name === 'Avaliacao' ? 'Avaliação' : plan.name;
}

const temRecurso = (plan: PublicPlan, recurso: PlanFeature) =>
  plan.limits.features.includes(recurso);

// ---------------------------------------------------------------------------
// Frases do FAQ que dependem dos planos
// ---------------------------------------------------------------------------

/** "A, B e C". */
export function listar(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

export function planosCom(planos: readonly PublicPlan[], recurso: PlanFeature): string[] {
  return planos.filter((p) => temRecurso(p, recurso)).map(nomeDoPlano);
}

export function planosSemPainel(planos: readonly PublicPlan[]): string[] {
  return planos.filter((p) => !temRecurso(p, 'cms_panel')).map(nomeDoPlano);
}

export function planosComDominio(planos: readonly PublicPlan[]): PublicPlan[] {
  return planos.filter((p) => p.limits.maxDomains > 0);
}
