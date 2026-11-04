import { z } from 'zod';
import { TRIAL_PERIOD_DAYS } from './billing/states.js';
import type { PlanBillingInput } from './validators/billing.js';

/** Limites e recursos controlados por plano. Verificados sempre no backend. */

/**
 * Recursos controlados por plano.
 *
 * Quatro, e cada um existe de verdade. Sairam `visual_editor_advanced_blocks`,
 * `version_history`, `multi_page`, `seo_advanced` e `remove_platform_badge`:
 * os cinco descreviam o editor visual removido na etapa 0, nenhum era
 * verificado em lugar nenhum, e os planos continuavam anunciando o que a
 * plataforma nao faz mais.
 *
 * `included_hosting` e aplicado em um ponto so: **o dominio**. Quem hospeda o
 * site e o projeto Vercel do cliente, e a plataforma nao deploya nada -- mas
 * so o plano que inclui hospedagem tem o dominio gerenciado por ela (anexado
 * ao projeto do site, verificado, com HTTPS). Nos demais a plataforma apenas
 * registra o endereco, porque nao hospeda e nao tem como verificar o DNS de um
 * site que esta em outro lugar. Ate 11/2026 isto era so um compromisso
 * registrado, e o recurso existia sem que nada o conferisse.
 */
export const PLAN_FEATURES = [
  'cms_panel',
  'custom_domain',
  'lead_export',
  'included_hosting',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  cms_panel: 'Painel de conteúdo para o cliente',
  custom_domain: 'Domínio próprio',
  lead_export: 'Exportação de interessados',
  included_hosting: 'Hospedagem incluída',
};

/**
 * O que um recurso faz **de fato**, para o painel mestre dizer na propria caixa.
 *
 * Existe porque o nome sozinho engana: "Hospedagem incluida" parece fazer a
 * plataforma hospedar, e ela nao hospeda. Dizer o efeito real evita vender
 * achando que ele e maior -- ou procurar depois uma verificacao que nao existe.
 */
export const PLAN_FEATURE_NOTES: Partial<Record<PlanFeature, string>> = {
  included_hosting:
    'A plataforma passa a gerenciar o domínio (Vercel) dos sites com projeto de hospedagem '
    + 'configurado. Quem faz o deploy do site continua sendo a CODECA IA.',
};


/**
 * Limites de um plano.
 *
 * `maxContentRecords` e o limite **geral** de conteudos cadastrados: a soma de
 * todos os registros dos modulos de colecao do site (produtos, servicos,
 * imoveis, obras, equipe, galerias, registros dos modulos personalizados...).
 * Nao ha limite por tipo: a plataforma atende qualquer segmento, e uma loja usa
 * as vagas em produtos, uma clinica em servicos e profissionais, uma imobiliaria
 * em imoveis. Como a contagem e feita esta em `apps/api/src/lib/content-usage.ts`.
 *
 * Ate 11/2026 havia dois limites -- `maxPublishedProperties` e `maxProjects` --,
 * que faziam a plataforma parecer exclusiva de imobiliarias e construtoras e
 * deixavam todos os outros modulos sem limite nenhum. A migracao 0018 acrescenta
 * `maxContentRecords` sem remover as chaves antigas do JSON (ver o comentario
 * dela); elas nao sao mais lidas por ninguem, e este schema as descarta.
 */
export const planLimitsSchema = z.object({
  maxUsers: z.number().int().min(1),
  maxContentRecords: z.number().int().min(0),
  maxDomains: z.number().int().min(0),
  storageBytes: z.number().int().min(0),
  features: z.array(z.enum(PLAN_FEATURES)),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

const MB = 1024 * 1024;

export interface PlanSeed {
  code: string;
  name: string;
  description: string;
  priceCents: number;
  limits: PlanLimits;
  /** Periodicidade e formas de pagamento usadas ao sincronizar com a ValidaPay. */
  billing: PlanBillingInput;
}

/**
 * Um plano gratuito nao pode ser sincronizado como preco na ValidaPay: a API
 * exige `amount > 0`. Planos sem preco existem apenas na plataforma.
 */
export function planIsBillable(plan: { priceCents: number }): boolean {
  return plan.priceCents > 0;
}

/** Planos padrao criados pelas migracoes/seed. Editaveis no painel mestre. */
export const DEFAULT_PLANS: readonly PlanSeed[] = [
  {
    code: 'trial',
    name: 'Avaliação',
    description: 'Para conhecer o painel e visualizar o funcionamento da plataforma.',
    priceCents: 0,
    limits: {
      maxUsers: 2,
      maxContentRecords: 5,
      maxDomains: 0,
      storageBytes: 200 * MB,
      // A avaliacao inclui o painel: e justamente o que se quer avaliar.
      features: ['cms_panel'],
    },
    // Avaliacao nao e cobrada: nao vira preco na ValidaPay.
    billing: {
      recurrenceType: 'MONTHLY',
      recurrenceInterval: 1,
      trialDays: TRIAL_PERIOD_DAYS,
      paymentMethods: ['creditcard'],
    },
  },
  {
    code: 'essencial',
    name: 'Essencial',
    description: 'Site personalizado com domínio próprio e gestão de conteúdo realizada pela equipe CODECA IA.',
    priceCents: 1590,
    limits: {
      maxUsers: 2,
      maxContentRecords: 20,
      maxDomains: 1,
      storageBytes: 500 * MB,
      /**
       * **Sem `cms_panel`**: este plano nao inclui o painel de conteudo.
       *
       * O acesso continua existindo -- o cliente entra, ve a cobranca e pede
       * upgrade. Sem login, pedir upgrade viraria uma ligacao telefonica.
       */
      features: ['custom_domain'],
    },
    billing: {
      recurrenceType: 'MONTHLY',
      recurrenceInterval: 1,
      trialDays: null,
      // Sem boleto: a tarifa come a mensalidade neste preco.
      paymentMethods: ['creditcard', 'pix_automatico', 'pix'],
    },
  },
  {
    code: 'profissional',
    name: 'Profissional',
    description: 'Mais autonomia para sua empresa administrar e atualizar o próprio site.',
    priceCents: 5990,
    limits: {
      maxUsers: 5,
      maxContentRecords: 100,
      maxDomains: 1,
      storageBytes: 2 * 1024 * MB,
      features: ['cms_panel', 'custom_domain', 'lead_export'],
    },
    billing: {
      recurrenceType: 'MONTHLY',
      recurrenceInterval: 1,
      trialDays: null,
      paymentMethods: ['creditcard', 'pix_automatico', 'pix'],
    },
  },
  {
    code: 'empresas',
    name: 'Empresas',
    description: 'Uma solução ampliada para empresas que precisam de gestão de conteúdo, equipe e hospedagem.',
    priceCents: 11990,
    limits: {
      maxUsers: 15,
      maxContentRecords: 400,
      maxDomains: 3,
      storageBytes: 10 * 1024 * MB,
      features: ['cms_panel', 'custom_domain', 'lead_export', 'included_hosting'],
    },
    billing: {
      recurrenceType: 'MONTHLY',
      recurrenceInterval: 1,
      trialDays: null,
      paymentMethods: ['creditcard', 'pix_automatico', 'pix', 'boleto'],
    },
  },
];

export function planHasFeature(limits: PlanLimits, feature: PlanFeature): boolean {
  return limits.features.includes(feature);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export interface UsageSnapshot {
  users: number;
  /** Conteudos cadastrados: o numero que `limits.maxContentRecords` limita. */
  contentRecords: number;
  /**
   * De onde vem a contagem, modulo a modulo (chave do modulo -> registros).
   * So aparecem os modulos habilitados no site e que tem ao menos um registro.
   */
  contentByModule: Record<string, number>;
  domains: number;
  storageBytes: number;
}

/**
 * Plano em vigor para uma empresa, com os ajustes individuais ja aplicados.
 *
 * `overridden` existe porque a plataforma pode afrouxar um limite para um
 * cliente sem criar um plano novo: a tela precisa dizer que o numero exibido
 * nao e o do plano publicado.
 */
export interface EffectivePlan {
  planId: string;
  planCode: string;
  planName: string;
  limits: PlanLimits;
  overridden: boolean;
}

/**
 * Resposta de `GET /api/tenants/:tenantId/content-usage`: quanto do limite geral
 * de conteudos a empresa ja usou, e de que modulos vem o uso.
 */
export interface ContentUsageView {
  used: number;
  max: number;
  /** Chave do modulo (ou `custom:<chave>`) -> registros. So quem tem algum. */
  byModule: Record<string, number>;
  planName: string;
  /** `true` quando o limite exibido foi ajustado so para esta empresa. */
  overridden: boolean;
}

export interface LimitCheck {
  allowed: boolean;
  limit: number;
  current: number;
  message?: string;
}

export function checkLimit(current: number, limit: number, label: string): LimitCheck {
  const allowed = current < limit;
  return allowed
    ? { allowed, limit, current }
    : {
        allowed,
        limit,
        current,
        message: `Seu plano permite até ${limit} ${label}. Atualize o plano para continuar.`,
      };
}

// ---------------------------------------------------------------------------
// O que o plano oferece, dito em texto
// ---------------------------------------------------------------------------

const NUMERO_BR = new Intl.NumberFormat('pt-BR');

function pluralizar(n: number, singular: string, plural: string): string {
  return `${NUMERO_BR.format(n)} ${n === 1 ? singular : plural}`;
}

/** 200 MB, 2 GB, 1,5 GB: sem ".0" sobrando e com virgula decimal. */
export function formatStorage(bytes: number): string {
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

/**
 * A lista de beneficios de um plano, na ordem comercial.
 *
 * **Fonte unica do texto**: a pagina inicial, a tela de plano do cliente e o
 * painel mestre leem desta funcao. Antes, cada um montava a propria lista --
 * e cada um dizia "imoveis publicados" e "obras" -- de modo que mudar um
 * limite exigia lembrar de tres lugares. Tudo vem de `limits` e de `priceCents`;
 * nenhum numero e escrito aqui.
 *
 * Os textos sao universais: "conteudos cadastrados" vale para produtos,
 * servicos, imoveis, obras, profissionais, cardapios, portfolio e modulos
 * personalizados, qualquer que seja o segmento.
 *
 * "Site personalizado" e dito de todo plano pago: o site sob medida e o produto
 * da CODECA IA, nao um recurso ligavel; a avaliacao, que e gratuita, nao o
 * promete.
 */
export function planBenefits(plan: { priceCents: number; limits: PlanLimits }): string[] {
  const { limits } = plan;
  const itens = [
    `Até ${pluralizar(limits.maxContentRecords, 'conteúdo cadastrado', 'conteúdos cadastrados')}`,
    `Até ${pluralizar(limits.maxUsers, 'usuário vinculado', 'usuários vinculados')}`,
    `${formatStorage(limits.storageBytes)} de armazenamento`,
    limits.maxDomains === 0
      ? 'Sem domínio próprio'
      : limits.maxDomains === 1
        ? '1 domínio próprio'
        : `Até ${limits.maxDomains} domínios próprios`,
  ];

  if (plan.priceCents > 0) itens.push('Site personalizado');

  if (limits.features.includes('cms_panel')) {
    itens.push('Painel administrativo CODECA Build', 'Gestão de textos, imagens e módulos');
  } else {
    itens.push('Gestão de conteúdo pela CODECA IA');
  }
  if (limits.features.includes('lead_export')) itens.push('Exportação de interessados');
  if (limits.features.includes('included_hosting')) itens.push('Hospedagem incluída');
  return itens;
}
