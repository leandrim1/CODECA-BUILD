import { TRIAL_PERIOD_DAYS } from '@codeca/shared';
import { and, eq, gte, inArray, isNotNull, or, schema, type Database } from '@codeca/database';
import type { Env } from '../../env.js';
import type { Mailer } from '../mailer.js';
import type { Monitor } from '../ops/monitor.js';
import { anonymizeOldOutbox, enqueueEmail, processOutbox, type OutboxReport, type StoredVars } from './outbox.js';
import { formatNoticeDate, noticeDaysBetween, noticeHour, type EmailKind } from './templates.js';

/**
 * De onde nascem os avisos sobre a conta.
 *
 * Regra central: **os avisos de cobranca leem o estado ja gravado** --
 * assinaturas e cobrancas como o webhook e a conciliacao as deixaram. Nada aqui
 * interpreta evento da ValidaPay de novo, e nada aqui acredita no navegador:
 * "pagamento confirmado" so existe quando ha uma cobranca `paid` no banco.
 *
 * Como tudo e leitura de estado + chave de evento unica, rodar duas vezes, em
 * dois processos, ou depois de um webhook repetido da no mesmo: o registro ja
 * existe e nada novo e criado.
 *
 * Quem recebe: os proprietarios ativos da empresa. Nunca o e-mail de contato
 * publico da empresa, nunca administradores ou editores.
 */

const DAY = 24 * 3600 * 1000;
/** Fatos mais velhos que isto nao geram aviso (por exemplo, ao ligar o recurso). */
const RECENT_MS = 3 * DAY;
/** Avisos de avaliacao so sao criados nesta janela, no horario de Brasilia. */
const TRIAL_NOTICE_HOURS = { from: 8, until: 20 };

export interface NoticesContext {
  db: Database;
  env: Env;
  mailer: Mailer;
  now: () => Date;
  monitor?: Monitor;
}

interface Owner {
  email: string;
  name: string;
}

async function loadOwners(db: Database, tenantId: string): Promise<Owner[]> {
  return db
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.tenantId, tenantId),
        eq(schema.memberships.role, 'owner'),
        eq(schema.memberships.status, 'active'),
      ),
    );
}

export function firstName(name: string | null | undefined): string {
  const primeiro = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return primeiro;
}

const reais = (cents: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100).replace(/ /g, ' ');

async function enqueueForOwners(
  ctx: NoticesContext,
  input: { tenantId: string; companyName: string; kind: EmailKind; eventKey: string; vars: Omit<StoredVars, 'firstName' | 'companyName'> },
): Promise<number> {
  let criados = 0;
  for (const owner of await loadOwners(ctx.db, input.tenantId)) {
    const novo = await enqueueEmail(ctx, {
      tenantId: input.tenantId,
      kind: input.kind,
      eventKey: input.eventKey,
      to: owner.email,
      vars: { ...input.vars, firstName: firstName(owner.name), companyName: input.companyName },
    });
    if (novo) criados += 1;
  }
  return criados;
}

// ------------------------------------------------------------ boas-vindas

/**
 * Boas-vindas, uma vez por pessoa e empresa.
 *
 * Chamado quando o e-mail da conta e confirmado e na criacao da empresa por
 * quem entrou com Google (cujo e-mail ja vem confirmado).
 */
export async function enqueueWelcome(ctx: NoticesContext, userId: string): Promise<number> {
  if (!ctx.env.BILLING_EMAILS_ENABLED) return 0;
  const vinculos = await ctx.db
    .select({
      tenantId: schema.memberships.tenantId,
      companyName: schema.tenants.displayName,
      email: schema.users.email,
      name: schema.users.name,
      verifiedAt: schema.users.emailVerifiedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.role, 'owner'),
        eq(schema.memberships.status, 'active'),
      ),
    );

  let criados = 0;
  for (const v of vinculos) {
    if (!v.verifiedAt) continue;
    const [avaliacao] = await ctx.db
      .select({ trialEndsAt: schema.subscriptions.trialEndsAt, status: schema.subscriptions.status })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.tenantId, v.tenantId));
    // Sem avaliacao em curso nao ha o que dizer sobre "14 dias".
    if (!avaliacao?.trialEndsAt || avaliacao.status !== 'trialing' || avaliacao.trialEndsAt <= ctx.now()) continue;
    const [demo] = await ctx.db
      .select({ id: schema.sites.id })
      .from(schema.sites)
      .where(and(eq(schema.sites.tenantId, v.tenantId), eq(schema.sites.isDemo, true)));

    const novo = await enqueueEmail(ctx, {
      tenantId: v.tenantId,
      kind: 'welcome',
      eventKey: `welcome:${v.tenantId}:${userId}`,
      to: v.email,
      vars: {
        firstName: firstName(v.name),
        companyName: v.companyName,
        trialDays: TRIAL_PERIOD_DAYS,
        trialEndDate: formatNoticeDate(avaliacao.trialEndsAt),
        hasDemoSite: Boolean(demo),
      },
    });
    if (novo) criados += 1;
  }
  return criados;
}

// -------------------------------------------------------------- avaliacao

/**
 * Avisos da avaliacao: 3 dias antes, na vespera e no encerramento.
 *
 * "3 dias" e "amanha" sao dias de calendario no horario de Brasilia. So para
 * quem continua em avaliacao: quem contratou e pagou deixa de estar `trialing`
 * e nao recebe nenhum deles.
 */
export async function enqueueTrialNotices(ctx: NoticesContext): Promise<number> {
  if (!ctx.env.BILLING_EMAILS_ENABLED) return 0;
  const now = ctx.now();
  const hora = noticeHour(now);
  if (hora < TRIAL_NOTICE_HOURS.from || hora >= TRIAL_NOTICE_HOURS.until) return 0;

  const linhas = await ctx.db
    .select({
      tenantId: schema.subscriptions.tenantId,
      trialEndsAt: schema.subscriptions.trialEndsAt,
      companyName: schema.tenants.displayName,
    })
    .from(schema.subscriptions)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.subscriptions.tenantId))
    .where(
      and(
        eq(schema.subscriptions.status, 'trialing'),
        isNotNull(schema.subscriptions.trialEndsAt),
        gte(schema.subscriptions.trialEndsAt, new Date(now.getTime() - RECENT_MS)),
      ),
    );

  let criados = 0;
  for (const linha of linhas) {
    const fim = linha.trialEndsAt!;
    const dias = noticeDaysBetween(now, fim);
    let kind: EmailKind | null = null;
    if (fim <= now) kind = 'trial_ended';
    else if (dias === 3) kind = 'trial_ending_3d';
    else if (dias === 1) kind = 'trial_ending_1d';
    if (!kind) continue;

    criados += await enqueueForOwners(ctx, {
      tenantId: linha.tenantId,
      companyName: linha.companyName,
      kind,
      eventKey: `${kind}:${linha.tenantId}:${fim.toISOString()}`,
      vars: { trialEndDate: formatNoticeDate(fim) },
    });
  }
  return criados;
}

// --------------------------------------------------------------- cobranca

/** Avisos de cobranca, a partir do estado gravado de assinaturas e cobrancas. */
export async function enqueueBillingNotices(ctx: NoticesContext): Promise<number> {
  if (!ctx.env.BILLING_EMAILS_ENABLED) return 0;
  const now = ctx.now();
  const recente = new Date(now.getTime() - RECENT_MS);
  let criados = 0;

  // --- cobrancas pagas e recusadas
  const cobrancas = await ctx.db
    .select({
      tenantId: schema.charges.tenantId,
      externalChargeId: schema.charges.externalChargeId,
      status: schema.charges.status,
      amountCents: schema.charges.amountCents,
      paidAt: schema.charges.paidAt,
      updatedAt: schema.charges.updatedAt,
      lastEventAt: schema.charges.lastEventAt,
      companyName: schema.tenants.displayName,
      planName: schema.plans.name,
      nextChargeAt: schema.subscriptions.nextChargeAt,
    })
    .from(schema.charges)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.charges.tenantId))
    .innerJoin(schema.subscriptions, eq(schema.subscriptions.id, schema.charges.subscriptionId))
    .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .where(
      and(
        inArray(schema.charges.status, ['paid', 'failed']),
        // O instante do FATO (pagamento, evento), e nao so o da gravacao.
        or(
          gte(schema.charges.paidAt, recente),
          gte(schema.charges.lastEventAt, recente),
          gte(schema.charges.updatedAt, recente),
        ),
      ),
    );

  for (const c of cobrancas) {
    if (c.status === 'paid') {
      if (!c.paidAt || c.paidAt < recente) continue;
      criados += await enqueueForOwners(ctx, {
        tenantId: c.tenantId,
        companyName: c.companyName,
        kind: 'payment_confirmed',
        eventKey: `payment_confirmed:${c.externalChargeId}`,
        vars: {
          planName: c.planName,
          amount: reais(c.amountCents),
          confirmedAt: formatNoticeDate(c.paidAt),
          nextChargeDate: c.nextChargeAt && c.nextChargeAt > now ? formatNoticeDate(c.nextChargeAt) : null,
        },
      });
    } else {
      if ((c.lastEventAt ?? c.updatedAt) < recente) continue;
      criados += await enqueueForOwners(ctx, {
        tenantId: c.tenantId,
        companyName: c.companyName,
        kind: 'payment_failed',
        eventKey: `payment_failed:${c.externalChargeId}`,
        vars: {},
      });
    }
  }

  // --- assinaturas: atraso, suspensao e cancelamento
  const assinaturas = await ctx.db
    .select({
      sub: schema.subscriptions,
      companyName: schema.tenants.displayName,
      planName: schema.plans.name,
    })
    .from(schema.subscriptions)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.subscriptions.tenantId))
    .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .where(
      and(
        isNotNull(schema.subscriptions.externalSubscriptionId),
        inArray(schema.subscriptions.status, ['past_due', 'suspended', 'active', 'cancel_at_period_end', 'canceled']),
      ),
    );

  for (const { sub, companyName, planName } of assinaturas) {
    const base = { tenantId: sub.tenantId, companyName };
    const fimDoAcesso = sub.accessUntil ? new Date(sub.accessUntil.getTime() + sub.gracePeriodDays * DAY) : null;

    // Suspensao efetiva de uma assinatura que estava liberada.
    if (
      sub.status !== 'canceled' &&
      (sub.publicationState === 'blocked_overdue' ||
        sub.publicationState === 'blocked_admin' ||
        sub.publicationState === 'blocked_dispute')
    ) {
      const motivo =
        sub.publicationState === 'blocked_overdue' ? 'overdue' : sub.publicationState === 'blocked_admin' ? 'admin' : 'dispute';
      const desde =
        motivo === 'overdue' ? fimDoAcesso : motivo === 'admin' ? sub.adminHoldAt : sub.updatedAt;
      // Suspensao antiga nao vira aviso novo.
      if (desde && desde >= new Date(now.getTime() - 7 * DAY)) {
        const ancora =
          motivo === 'overdue'
            ? (sub.accessUntil?.toISOString() ?? '')
            : motivo === 'admin'
              ? (sub.adminHoldAt?.toISOString() ?? '')
              : `ciclo-${sub.currentCycleNumber}`;
        criados += await enqueueForOwners(ctx, {
          ...base,
          kind: 'access_suspended',
          eventKey: `access_suspended:${sub.id}:${motivo}:${ancora}`,
          vars: { suspensionReason: motivo },
        });
      }
      continue;
    }

    if (sub.status === 'past_due' && sub.publicationState === 'allowed') {
      criados += await enqueueForOwners(ctx, {
        ...base,
        kind: 'subscription_overdue',
        eventKey: `subscription_overdue:${sub.id}:${(sub.currentPeriodEnd ?? sub.accessUntil)?.toISOString() ?? `ciclo-${sub.currentCycleNumber}`}`,
        vars: {
          planName,
          accessUntilDate: fimDoAcesso && fimDoAcesso > now ? formatNoticeDate(fimDoAcesso) : null,
        },
      });
      continue;
    }

    if (sub.status === 'cancel_at_period_end' || sub.status === 'canceled') {
      // O cancelamento agendado que chega so pelo webhook nao grava data
      // propria: vale o instante do ultimo evento aplicado.
      const quando = sub.cancelRequestedAt ?? sub.canceledAt ?? sub.lastEventAt ?? sub.updatedAt;
      if (quando < recente) continue;
      // Ancora estavel: agendar e depois efetivar o MESMO cancelamento e um
      // aviso so, e nao dois.
      const ancora = (sub.cancelRequestedAt ?? sub.accessUntil ?? sub.canceledAt ?? quando).toISOString();
      const agendado = sub.status === 'cancel_at_period_end' && sub.accessUntil !== null && sub.accessUntil > now;
      criados += await enqueueForOwners(ctx, {
        ...base,
        kind: 'subscription_canceled',
        eventKey: `subscription_canceled:${sub.id}:${ancora}`,
        vars: {
          confirmedAt: formatNoticeDate(quando),
          cancelMode: agendado ? 'scheduled' : 'immediate',
          accessUntilDate: agendado ? formatNoticeDate(sub.accessUntil!) : null,
        },
      });
    }
  }

  return criados;
}

// ---------------------------------------------------------------- exclusao

/** Aviso de exclusao concluida, para quem pediu. Sobrevive a empresa. */
export async function enqueueAccountDeleted(
  ctx: NoticesContext,
  input: { tenantId: string; companyName: string; to: string; name: string; hadSubscription: boolean },
): Promise<boolean> {
  return enqueueEmail(ctx, {
    tenantId: null,
    kind: 'account_deleted',
    eventKey: `account_deleted:${input.tenantId}`,
    to: input.to,
    vars: {
      firstName: firstName(input.name),
      companyName: input.companyName,
      date: formatNoticeDate(ctx.now()),
      hadSubscription: input.hadSubscription,
    },
  });
}

// ------------------------------------------------------------------ passagem

export interface NoticesReport {
  enabled: boolean;
  enqueued: number;
  outbox: OutboxReport | null;
  anonymized: number;
}

/**
 * Uma passagem completa: cria os avisos devidos e envia o que esta na vez.
 *
 * Chamada pelas duas tarefas agendadas que ja existem e depois de cada webhook
 * de cobranca. **Nunca lanca:** aviso por e-mail nao pode derrubar a
 * conciliacao nem o processamento de um pagamento.
 */
export async function runAccountNotices(
  ctx: NoticesContext,
  options: { trial?: boolean; housekeeping?: boolean } = {},
): Promise<NoticesReport> {
  const report: NoticesReport = { enabled: ctx.env.BILLING_EMAILS_ENABLED, enqueued: 0, outbox: null, anonymized: 0 };
  const falhou = async (etapa: string, error: unknown) => {
    console.error(`[avisos] falha em ${etapa}:`, error instanceof Error ? error.message : error);
    await ctx.monitor
      ?.report({
        kind: 'job_failed',
        severity: 'warning',
        message: `Os avisos por e-mail falharam na etapa "${etapa}".`,
        error,
        alertKey: `job_failed:avisos:${etapa}`,
      })
      .catch(() => undefined);
  };

  if (options.housekeeping) {
    // Vale mesmo com os avisos desligados: e guarda de dado pessoal.
    report.anonymized = await anonymizeOldOutbox(ctx.db, ctx.now()).catch(async (error: unknown) => {
      await falhou('limpeza', error);
      return 0;
    });
  }
  if (!report.enabled) return report;

  if (options.trial !== false) {
    report.enqueued += await enqueueTrialNotices(ctx).catch(async (error: unknown) => {
      await falhou('avaliação', error);
      return 0;
    });
  }
  report.enqueued += await enqueueBillingNotices(ctx).catch(async (error: unknown) => {
    await falhou('cobrança', error);
    return 0;
  });
  report.outbox = await processOutbox(ctx).catch(async (error: unknown) => {
    await falhou('envio', error);
    return null;
  });
  return report;
}
