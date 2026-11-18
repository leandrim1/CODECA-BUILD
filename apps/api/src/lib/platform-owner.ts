/**
 * Empresas da propria CODECA IA: isentas de cobranca.
 *
 * A plataforma nao cobra de si mesma. A conta que a CODECA IA usa para o
 * proprio site nao contrata plano, nao paga mensalidade, nao depende da
 * ValidaPay e nunca entra em somente leitura por pendencia de assinatura.
 *
 * ## Por que a identificacao e por EMPRESA, e nao por pessoa
 *
 * O pedido original sugeria uma lista de usuarios (`PLATFORM_OWNER_USER_IDS`).
 * Nao da: o papel de **proprietario e concedivel por convite**
 * (`routes/members.ts`), entao qualquer cliente pode convidar o dono da
 * plataforma como proprietario da empresa dele. Se a isencao seguisse a
 * pessoa, bastaria esse convite ser aceito -- por engano, uma vez -- para a
 * empresa do cliente virar gratuita e ilimitada.
 *
 * O identificador da EMPRESA nao tem esse caminho: nenhuma acao de cliente
 * cria, altera ou alcanca um `tenantId` que esteja nesta lista. A lista so
 * muda por variavel de ambiente, que exige acesso ao painel da hospedagem.
 *
 * ## Por que configuracao de modulo, e nao parametro
 *
 * A lista e fixa para o processo inteiro: nao varia por requisicao. Guardar
 * aqui evita passar `env` por vinte assinaturas de funcao -- e passar por
 * vinte assinaturas tem um custo pior que o acoplamento: basta esquecer UMA e
 * a isencao falha em silencio, trancando justamente quem ela deveria liberar.
 *
 * Mesmo padrao de `setSlowQueryThreshold`, ja usado por `createContext`.
 */

import {
  DEFAULT_SUSPENSION_POLICY,
  PLAN_FEATURES,
  suspensionEffect,
  type PlanLimits,
} from '@codeca/shared';

let isentas: ReadonlySet<string> = new Set();

/** Definida uma vez, na montagem do contexto. */
export function setExemptTenants(ids: readonly string[]): void {
  isentas = new Set(ids.map((id) => id.trim()).filter((id) => id !== ''));
}

/** Esta empresa e da propria CODECA IA? */
export function isExemptTenant(tenantId: string | null | undefined): boolean {
  return typeof tenantId === 'string' && isentas.has(tenantId);
}

/** Quantas empresas estao isentas. Para o diagnostico, sem revelar quais. */
export function exemptTenantCount(): number {
  return isentas.size;
}

/**
 * Teto alto o bastante para nunca barrar, e baixo o bastante para continuar
 * sendo um numero (e nao `Infinity`, que nao sobrevive a JSON nem ao banco).
 *
 * Um milhao de registros e mil terabytes nao sao "ilimitado" no sentido
 * matematico; sao o ponto em que o limite deixou de ser a restricao e passou
 * a ser a infraestrutura. Dizer "ilimitado" e mostrar um numero finito seria
 * mentir na tela.
 */
const TETO = 1_000_000;
const TETO_BYTES = 1_000 * 1024 ** 4;

/** Limites de uma empresa isenta: todos os recursos, sem teto comercial. */
export function exemptPlanLimits(): PlanLimits {
  return {
    maxUsers: TETO,
    maxContentRecords: TETO,
    maxDomains: TETO,
    storageBytes: TETO_BYTES,
    features: [...PLAN_FEATURES],
  };
}

/**
 * Situacao de cobranca de uma empresa isenta: liberada, sempre.
 *
 * `planId: null` de proposito -- nao ha plano contratado, e inventar um faria
 * a tela mostrar uma assinatura que nao existe.
 */
export function exemptBillingSituation() {
  return {
    publication: 'allowed' as const,
    policy: DEFAULT_SUSPENSION_POLICY,
    effect: suspensionEffect('allowed'),
    planId: null,
  };
}
