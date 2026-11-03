import { formatPlanPrice, type PlanFeature } from '@codeca/shared';
import type { PublicPlan } from '../services/endpoints.js';

/**
 * Tudo que a pagina diz sobre planos sai daqui, e so de dados.
 *
 * Nenhum numero, nome de plano ou beneficio e escrito a mao nos textos: sao
 * derivados do que a API devolve. Mudar um preco ou um limite no painel mestre
 * muda a pagina, inclusive as respostas do FAQ.
 */

const NUMERO = new Intl.NumberFormat('pt-BR');

function pluralizar(n: number, singular: string, plural: string): string {
  return `${NUMERO.format(n)} ${n === 1 ? singular : plural}`;
}

/** 200 MB, 2 GB, 1,5 GB: sem ".0" sobrando e com virgula decimal. */
export function tamanho(bytes: number): string {
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  const texto = Number.isInteger(valor) ? String(valor) : valor.toFixed(1).replace('.', ',');
  return `${texto} ${unidades[i]}`;
}

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
 * Rotulos dos recursos, com acento.
 *
 * Os do sistema (`PLAN_FEATURE_LABELS`) sao escritos sem acento, como o resto
 * do painel; numa pagina de venda isso destoa. Sao so rotulos: o que decide se
 * o recurso aparece continua sendo `limits.features`, vindo do backend.
 */
const ROTULO_DO_RECURSO: Record<PlanFeature, string> = {
  cms_panel: 'Painel de conteúdo para o cliente',
  custom_domain: 'Domínio próprio',
  lead_export: 'Exportação de interessados',
  included_hosting: 'Hospedagem incluída',
};

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

/** A lista de beneficios de um plano, na ordem em que a pagina a mostra. */
export function beneficios(plan: PublicPlan): string[] {
  const { limits } = plan;
  const itens = [
    pluralizar(limits.maxPublishedProperties, 'imóvel publicado', 'imóveis publicados'),
    pluralizar(limits.maxProjects, 'obra cadastrada', 'obras cadastradas'),
    pluralizar(limits.maxUsers, 'usuário', 'usuários'),
    `${tamanho(limits.storageBytes)} de armazenamento`,
    limits.maxDomains === 0
      ? 'Sem domínio próprio'
      : limits.maxDomains === 1
        ? '1 domínio próprio'
        : `Até ${limits.maxDomains} domínios próprios`,
  ];

  // "Dominio proprio" ja esta acima, com a quantidade, e nao se repete.
  if (temRecurso(plan, 'cms_panel')) itens.push(ROTULO_DO_RECURSO.cms_panel);
  else itens.push('Conteúdo mantido pela CODECA IA');
  if (temRecurso(plan, 'lead_export')) itens.push(ROTULO_DO_RECURSO.lead_export);
  if (temRecurso(plan, 'included_hosting')) itens.push(ROTULO_DO_RECURSO.included_hosting);
  return itens;
}

/**
 * Frase de apresentacao do plano.
 *
 * Os textos editoriais valem **enquanto descrevem o plano que existe**: a
 * frase do Essencial diz que o conteudo fica com a CODECA IA, e isso so e
 * verdade sem o painel. Se o superadmin mudar o plano, a frase deixa de
 * valer e entra a descricao cadastrada -- que ele mantem.
 */
export function apresentacao(plan: PublicPlan): string {
  const l = plan.limits;
  switch (plan.code) {
    case 'trial':
      if (temRecurso(plan, 'cms_panel') && l.maxDomains === 0) {
        return 'Para conhecer o painel e visualizar o funcionamento da plataforma.';
      }
      break;
    case 'essencial':
      if (!temRecurso(plan, 'cms_panel') && l.maxDomains > 0) {
        return 'Uma presença digital personalizada com domínio próprio, com a gestão de conteúdo mantida pela CODECA IA.';
      }
      break;
    case 'profissional':
      if (temRecurso(plan, 'cms_panel')) {
        return 'Mais autonomia para sua empresa administrar o conteúdo do próprio site.';
      }
      break;
    case 'empresas':
      if (temRecurso(plan, 'cms_panel') && temRecurso(plan, 'included_hosting')) {
        return 'Uma estrutura mais completa, com gestão de conteúdo e hospedagem incluída.';
      }
      break;
    default:
  }
  return plan.description;
}

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
