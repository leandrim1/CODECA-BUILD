import { z } from 'zod';
import { TRIAL_PERIOD_DAYS } from './billing/states.js';
import type { PlanBillingInput } from './validators/billing.js';

/** Limites e recursos controlados por plano. Verificados sempre no backend. */

export const PLAN_FEATURES = [
  'custom_domain',
  'visual_editor_advanced_blocks',
  'version_history',
  'lead_export',
  'multi_page',
  'seo_advanced',
  'remove_platform_badge',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  custom_domain: 'Dominio proprio',
  visual_editor_advanced_blocks: 'Blocos avancados no editor',
  version_history: 'Historico de versoes',
  lead_export: 'Exportacao de interessados',
  multi_page: 'Multiplas paginas',
  seo_advanced: 'SEO avancado (canonical, sitemap, robots)',
  remove_platform_badge: 'Remover selo da plataforma',
};

export const planLimitsSchema = z.object({
  maxUsers: z.number().int().min(1),
  maxPublishedProperties: z.number().int().min(0),
  maxProjects: z.number().int().min(0),
  maxPages: z.number().int().min(1),
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
    description: 'Para conhecer a plataforma antes de publicar um dominio proprio.',
    priceCents: 0,
    limits: {
      maxUsers: 2,
      maxPublishedProperties: 5,
      maxProjects: 3,
      maxPages: 10,
      maxDomains: 0,
      storageBytes: 200 * MB,
      features: ['multi_page'],
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
    description: 'Site institucional com imoveis e obras, dominio proprio incluso.',
    priceCents: 19900,
    limits: {
      maxUsers: 5,
      maxPublishedProperties: 40,
      maxProjects: 20,
      maxPages: 20,
      maxDomains: 1,
      storageBytes: 2 * 1024 * MB,
      features: ['custom_domain', 'multi_page', 'version_history', 'lead_export'],
    },
    billing: {
      recurrenceType: 'MONTHLY',
      recurrenceInterval: 1,
      trialDays: null,
      paymentMethods: ['creditcard', 'pix_automatico', 'pix'],
    },
  },
  {
    code: 'profissional',
    name: 'Profissional',
    description: 'Para construtoras com carteira ampla de imoveis e obras.',
    priceCents: 39900,
    limits: {
      maxUsers: 15,
      maxPublishedProperties: 300,
      maxProjects: 150,
      maxPages: 60,
      maxDomains: 3,
      storageBytes: 10 * 1024 * MB,
      features: [...PLAN_FEATURES],
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
  pages: number;
  domains: number;
  storageBytes: number;
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
