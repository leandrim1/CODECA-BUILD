import { and, createPrimarySite, eq, like, or, schema, type Database } from '@codeca/database';
import { AppError, DEFAULT_GRACE_PERIOD_DAYS, TRIAL_PERIOD_DAYS, slugify, uniqueSlug } from '@codeca/shared';

/**
 * Cadastro de uma empresa nova para um usuario que ja existe.
 *
 * E o MESMO cadastro do formulario de e-mail e senha -- empresa, vinculo de
 * proprietario, site principal e assinatura de avaliacao --, em um lugar so.
 * O login com Google chega aqui depois de a pessoa informar o nome da empresa;
 * a empresa nunca e criada automaticamente a partir de dados do Google.
 */

export async function loadTrialPlan(db: Database): Promise<{ id: string }> {
  const [trialPlan] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(and(eq(schema.plans.code, 'trial'), eq(schema.plans.isActive, true)));
  if (!trialPlan) {
    throw AppError.internal('Nenhum plano inicial configurado. Rode o seed de planos.');
  }
  return trialPlan;
}

export async function nextTenantSlug(db: Database, desired: string): Promise<string> {
  const base = slugify(desired) || 'empresa';
  // Le so os slugs que podem colidir (`base` e `base-N`), nao a tabela inteira:
  // com milhares de empresas, a leitura total custava mais a cada cadastro. O
  // indice unico de `slug` ainda e a garantia final contra corrida.
  const escaped = base.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const rows = await db
    .select({ slug: schema.tenants.slug })
    .from(schema.tenants)
    .where(or(eq(schema.tenants.slug, base), like(schema.tenants.slug, `${escaped}-%`)));
  return uniqueSlug(base, rows.map((row) => row.slug));
}

/** Precisa rodar DENTRO de uma transacao: empresa, vinculo e assinatura vivem ou morrem juntos. */
export async function createCompanyForUser(
  tx: Database,
  input: {
    userId: string;
    contactEmail: string;
    companyName: string;
    phone: string;
    slug: string;
    trialPlanId: string;
    now: Date;
  },
): Promise<{ tenantId: string; siteId: string }> {
  const [tenant] = await tx
    .insert(schema.tenants)
    .values({
      slug: input.slug,
      legalName: input.companyName,
      displayName: input.companyName,
      planId: input.trialPlanId,
      status: 'trialing',
      contactEmail: input.contactEmail,
      contactPhone: input.phone,
      address: {
        street: '',
        number: '',
        complement: '',
        neighborhood: '',
        city: '',
        state: '',
        postalCode: '',
        showFullAddress: true,
      },
    })
    .returning({ id: schema.tenants.id });
  if (!tenant) throw AppError.internal('Não foi possível criar a empresa.');

  await tx.insert(schema.memberships).values({
    tenantId: tenant.id,
    userId: input.userId,
    role: 'owner',
    status: 'active',
    acceptedAt: input.now,
  });

  // O site e criado junto com a empresa: todo conteudo pertence a um, e a
  // assinatura tambem. Nasce como rascunho -- quem o publica e a CODECA IA
  // ao concluir a integracao do site desenvolvido para o cliente.
  const site = await createPrimarySite(tx, { tenantId: tenant.id, name: input.companyName });

  // A avaliacao ja libera o acesso: `accessUntil` e o campo que a API
  // publica consulta, e vence sozinho quando o trial acaba.
  const trialEndsAt = new Date(input.now.getTime() + TRIAL_PERIOD_DAYS * 24 * 3600 * 1000);
  await tx.insert(schema.subscriptions).values({
    tenantId: tenant.id,
    siteId: site.id,
    planId: input.trialPlanId,
    status: 'trialing',
    publicationState: 'allowed',
    trialEndsAt,
    accessUntil: trialEndsAt,
    currentPeriodStart: input.now,
    currentPeriodEnd: trialEndsAt,
    gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
  });

  return { tenantId: tenant.id, siteId: site.id };
}
