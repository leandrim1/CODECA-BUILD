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
  cms_panel: 'Painel de conteudo para o cliente',
  custom_domain: 'Dominio proprio',
  lead_export: 'Exportacao de interessados',
  included_hosting: 'Hospedagem incluida',
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
    'A plataforma passa a gerenciar o dominio (Vercel) dos sites com projeto de hospedagem '
    + 'configurado. Quem faz o deploy do site continua sendo a CODECA IA.',
};


export const planLimitsSchema = z.object({
  maxUsers: z.number().int().min(1),
  maxPublishedProperties: z.number().int().min(0),
  maxProjects: z.number().int().min(0),
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
    name: 'Avaliacao',
    description: 'Para conhecer o painel antes de contratar.',
    priceCents: 0,
    limits: {
      maxUsers: 2,
      maxPublishedProperties: 5,
      maxProjects: 3,
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
    description: 'Site personalizado com dominio proprio. O conteudo e mantido pela CODECA IA.',
    priceCents: 1590,
    limits: {
      maxUsers: 2,
      maxPublishedProperties: 20,
      maxProjects: 10,
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
    description: 'Site personalizado com painel para a empresa gerenciar o proprio conteudo.',
    priceCents: 5990,
    limits: {
      maxUsers: 5,
      maxPublishedProperties: 100,
      maxProjects: 50,
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
    description: 'Tudo do Profissional, com a hospedagem do site por conta da CODECA IA.',
    priceCents: 11990,
    limits: {
      maxUsers: 15,
      maxPublishedProperties: 400,
      maxProjects: 200,
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
  publishedProperties: number;
  projects: number;
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
        message: `Seu plano permite ate ${limit} ${label}. Atualize o plano para continuar.`,
      };
}
