import { eq, schema, type Database } from '@codeca/database';
import type { EffectivePlan } from '@codeca/shared';
import { loadEffectivePlan } from './plan-limits.js';

/**
 * Quem hospeda o site de uma empresa decide o que a plataforma pode prometer
 * sobre o dominio dela.
 *
 * A especificacao comercial separa as duas coisas: **dominio incluido** nos
 * tres planos, **hospedagem incluida** so no Empresas. Entao a plataforma nao
 * pode assumir que hospeda -- e quando nao hospeda, nao tem como verificar nem
 * configurar o DNS de um site que esta em outro lugar.
 *
 * ## A regra, em um lugar so
 *
 * O dominio e **gerenciado pela plataforma** se, e somente se:
 *
 * 1. o plano da empresa inclui `included_hosting`; **e**
 * 2. o site tem um projeto de hospedagem configurado pela CODECA IA.
 *
 * As duas condicoes, e nao uma: o recurso do plano diz que a hospedagem foi
 * vendida, e o projeto diz **onde** ela esta. Com so a primeira, a plataforma
 * nao saberia em qual projeto anexar o dominio -- e voltaria ao erro de usar
 * o projeto dela mesma. Com so a segunda, configurar um projeto num plano que
 * nao o inclui entregaria hospedagem sem ter sido vendida.
 *
 * Fora disso a plataforma apenas **registra** o dominio: o endereco pertence a
 * este site, e so isso. Nao chama a Vercel e nao afirma nada sobre DNS.
 */

export type HostingMode =
  | { managed: true; projectId: string }
  | {
      managed: false;
      /** Por que nao e gerenciado: o plano nao inclui, ou falta o projeto. */
      reason: 'plan_without_hosting' | 'no_hosting_project';
    };

/** A decisao pura, sem banco: e o que os testes e o painel mestre conferem. */
export function decideHosting(input: {
  features: readonly string[];
  hostingProjectId: string | null;
}): HostingMode {
  if (!input.features.includes('included_hosting')) {
    return { managed: false, reason: 'plan_without_hosting' };
  }
  if (!input.hostingProjectId) {
    return { managed: false, reason: 'no_hosting_project' };
  }
  return { managed: true, projectId: input.hostingProjectId };
}

export async function loadHosting(
  db: Database,
  input: { tenantId: string; siteId: string; plan?: EffectivePlan },
): Promise<{ mode: HostingMode; hostingProjectId: string | null }> {
  const [site] = await db
    .select({ hostingProjectId: schema.sites.hostingProjectId })
    .from(schema.sites)
    .where(eq(schema.sites.id, input.siteId));

  const plan = input.plan ?? (await loadEffectivePlan(db, input.tenantId));
  const hostingProjectId = site?.hostingProjectId ?? null;

  return {
    mode: decideHosting({ features: plan.limits.features, hostingProjectId }),
    hostingProjectId,
  };
}

/**
 * O que o cliente le quando a plataforma so registra o dominio.
 *
 * Dita o limite com todas as letras, em vez de deixar o estado "pendente" dar a
 * entender que algo vai acontecer: nada vai. O DNS de um site hospedado fora
 * e com quem hospeda.
 */
export const EXTERNAL_HOSTING_MESSAGE =
  'Domínio registrado nesta conta. O site deste projeto não é hospedado pela plataforma, '
  + 'então a CODECA Build não verifica nem configura o DNS dele: o apontamento é feito no '
  + 'provedor onde o site está hospedado. Em caso de dúvida, fale com a CODECA IA.';
