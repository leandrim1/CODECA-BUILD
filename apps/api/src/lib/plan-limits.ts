import { and, eq, schema, sql, type Database } from '@codeca/database';
import {
  AppError,
  PLAN_FEATURE_LABELS,
  formatBytes,
  planLimitsSchema,
  type PlanFeature,
  type PlanLimits,
  type UsageSnapshot,
} from '@codeca/shared';

/**
 * Limites de plano verificados no servidor.
 *
 * A interface tambem esconde recursos nao contratados, mas a decisao real
 * acontece aqui: qualquer chamada direta a API passa pelas mesmas checagens.
 * Os limites efetivos sao os do plano, com as excecoes definidas pelo painel
 * mestre em `tenants.limit_overrides`.
 */

export interface EffectivePlan {
  planId: string;
  planCode: string;
  planName: string;
  limits: PlanLimits;
  /** Limites sobrepostos individualmente para esta empresa. */
  overridden: boolean;
}

export async function loadEffectivePlan(db: Database, tenantId: string): Promise<EffectivePlan> {
  const [row] = await db
    .select({
      planId: schema.plans.id,
      planCode: schema.plans.code,
      planName: schema.plans.name,
      limits: schema.plans.limits,
      overrides: schema.tenants.limitOverrides,
    })
    .from(schema.tenants)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.tenants.planId))
    .where(eq(schema.tenants.id, tenantId));

  if (!row) throw AppError.notFound('Empresa nao encontrada.');

  const base = planLimitsSchema.parse(row.limits);
  const overrides = row.overrides ?? null;
  const limits = overrides ? planLimitsSchema.parse({ ...base, ...overrides }) : base;

  return {
    planId: row.planId,
    planCode: row.planCode,
    planName: row.planName,
    limits,
    overridden: overrides !== null,
  };
}

export async function loadUsage(db: Database, tenantId: string): Promise<UsageSnapshot> {
  const countOf = sql<number>`cast(count(*) as int)`;

  const [users] = await db
    .select({ value: countOf })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.status, 'active')));

  const [publishedProperties] = await db
    .select({ value: countOf })
    .from(schema.properties)
    .where(
      and(eq(schema.properties.tenantId, tenantId), eq(schema.properties.publicationStatus, 'published')),
    );

  const [projects] = await db
    .select({ value: countOf })
    .from(schema.projects)
    .where(eq(schema.projects.tenantId, tenantId));

  const [domains] = await db
    .select({ value: countOf })
    .from(schema.domains)
    .where(eq(schema.domains.tenantId, tenantId));

  const [storage] = await db
    .select({ value: sql<number>`cast(coalesce(sum(${schema.mediaAssets.sizeBytes}), 0) as bigint)` })
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.tenantId, tenantId));

  return {
    users: users?.value ?? 0,
    publishedProperties: publishedProperties?.value ?? 0,
    projects: projects?.value ?? 0,
    domains: domains?.value ?? 0,
    storageBytes: Number(storage?.value ?? 0),
  };
}

export interface PlanStatus {
  plan: EffectivePlan;
  usage: UsageSnapshot;
}

export async function loadPlanStatus(db: Database, tenantId: string): Promise<PlanStatus> {
  const [plan, usage] = await Promise.all([loadEffectivePlan(db, tenantId), loadUsage(db, tenantId)]);
  return { plan, usage };
}

export function assertFeature(plan: EffectivePlan, feature: PlanFeature): void {
  if (!plan.limits.features.includes(feature)) {
    throw AppError.planLimit(
      `O recurso "${PLAN_FEATURE_LABELS[feature]}" nao esta incluido no plano ${plan.planName}. `
        + 'Atualize o plano para utiliza-lo.',
      { feature, planCode: plan.planCode },
    );
  }
}

type CountableLimit = 'maxUsers' | 'maxPublishedProperties' | 'maxProjects' | 'maxDomains';

const LIMIT_LABELS: Record<CountableLimit, string> = {
  maxUsers: 'usuarios ativos',
  maxPublishedProperties: 'imoveis publicados',
  maxProjects: 'obras cadastradas',
  maxDomains: 'dominios',
};

const USAGE_KEY: Record<CountableLimit, keyof UsageSnapshot> = {
  maxUsers: 'users',
  maxPublishedProperties: 'publishedProperties',
  maxProjects: 'projects',
  maxDomains: 'domains',
};

/**
 * Garante espaco para mais `increment` registros do tipo informado.
 * `currentOverride` permite informar a contagem ja conhecida pela rota.
 */
export async function assertWithinLimit(
  db: Database,
  tenantId: string,
  limit: CountableLimit,
  options: { increment?: number; plan?: EffectivePlan; currentOverride?: number } = {},
): Promise<void> {
  const plan = options.plan ?? (await loadEffectivePlan(db, tenantId));
  const max = plan.limits[limit];
  const increment = options.increment ?? 1;

  const current =
    options.currentOverride ?? (await loadUsage(db, tenantId))[USAGE_KEY[limit]];

  if (current + increment > max) {
    throw AppError.planLimit(
      `O plano ${plan.planName} permite ate ${max} ${LIMIT_LABELS[limit]}. `
        + `Voce ja utiliza ${current}. Atualize o plano para continuar.`,
      { limit, max, current, planCode: plan.planCode },
    );
  }
}

/** Garante espaco de armazenamento para um novo arquivo. */
export async function assertStorageAvailable(
  db: Database,
  tenantId: string,
  sizeBytes: number,
  plan?: EffectivePlan,
): Promise<void> {
  const effective = plan ?? (await loadEffectivePlan(db, tenantId));
  const [row] = await db
    .select({ used: sql<number>`cast(coalesce(sum(${schema.mediaAssets.sizeBytes}), 0) as bigint)` })
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.tenantId, tenantId));

  const used = Number(row?.used ?? 0);
  if (used + sizeBytes > effective.limits.storageBytes) {
    throw new AppError(
      'storage_limit_reached',
      `O plano ${effective.planName} inclui ${formatBytes(effective.limits.storageBytes)} de armazenamento. `
        + `Voce já utiliza ${formatBytes(used)}. Remova arquivos sem uso ou atualize o plano.`,
      { used, limit: effective.limits.storageBytes, requested: sizeBytes },
    );
  }
}
