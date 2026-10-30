import type { DomainStatus } from './domain.js';
import type { SiteStatus } from './constants.js';
import type { EffectivePlan, UsageSnapshot } from './plans.js';
import type { LeadInterestType, LeadStatus } from './constants.js';

/**
 * Contrato da visao geral do painel do cliente.
 *
 * Declarado aqui, e nao em cada lado, por um motivo concreto: a rota devolvia
 * um objeto literal e o painel declarava a resposta a mao. Quando a Etapa 0
 * removeu o renderizador, a API parou de enviar `pages` e `site`, mas o tipo
 * do painel continuou prometendo os dois -- o `typecheck` passou e a tela
 * inicial quebrava ao renderizar, em producao e so em producao.
 *
 * Com uma declaracao unica, a rota nao compila se deixar de enviar um campo e
 * a tela nao compila se ler um campo que a rota nao envia.
 *
 * Datas sao `string` (ISO 8601): e o que atravessa o JSON. A rota converte
 * explicitamente, em vez de deixar o `Date` do banco vazar para o contrato e
 * mentir sobre o que o navegador recebe.
 */

export interface OverviewCounts {
  total: number;
  published: number;
  drafts: number;
}

/**
 * Situacao do site da empresa.
 *
 * No modelo novo a plataforma nao publica o site -- quem publica e o projeto
 * Vercel da CODECA IA. Entao o que a tela pode dizer com honestidade e outro:
 * se o projeto esta ativo e se ele **ja buscou conteudo pela API**.
 * `lastApiAccessAt` nulo e a diferenca entre "integrado" e "cadastrado".
 */
export interface OverviewSite {
  id: string;
  name: string;
  status: SiteStatus;
  /** Ultimo uso de qualquer chave de integracao deste site. */
  lastApiAccessAt: string | null;
}

export interface OverviewDomain {
  id: string;
  hostname: string;
  status: DomainStatus;
  isPrimary: boolean;
  sslStatus: 'pending' | 'active' | 'error';
}

export interface OverviewLead {
  id: string;
  name: string;
  interestType: LeadInterestType;
  status: LeadStatus;
  createdAt: string;
}

/**
 * Resposta de `GET /api/tenants/:tenantId/overview`.
 *
 * As contagens vem todas do banco. Nenhuma e estimada: onde nao existe dado,
 * o numero e zero e a tela diz que nao existe.
 *
 * Os numeros de todos os modulos vem sempre, habilitados ou nao -- a tela
 * decide o que mostrar a partir dos modulos do site, que ela ja carrega. Uma
 * resposta de forma variavel obrigaria cada leitor a testar a presenca de
 * cada campo, e e justamente esse tipo de teste que a tela nao fez.
 */
export interface TenantOverview {
  site: OverviewSite;
  properties: OverviewCounts & { available: number; sold: number };
  projects: { total: number; published: number; inProgress: number; completed: number };
  services: { total: number; published: number };
  banners: { total: number; active: number };
  leads: {
    total: number;
    novos: number;
    emAtendimento: number;
    convertidos: number;
    last30Days: number;
  };
  media: { total: number; bytes: number };
  recentLeads: OverviewLead[];
  domains: OverviewDomain[];
  plan: EffectivePlan;
  usage: UsageSnapshot;
}
