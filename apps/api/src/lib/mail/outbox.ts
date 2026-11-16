import { createHmac } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, lt, lte, schema, type Database } from '@codeca/database';
import type { Env } from '../../env.js';
import type { Mailer } from '../mailer.js';
import { renderEmail, type EmailKind, type EmailVars } from './templates.js';

/**
 * Fila persistente dos avisos por e-mail.
 *
 * Por que uma fila, e nao enviar na hora: o envio depende de um servico
 * externo que falha, e os avisos nascem de lugares que nao podem esperar por
 * ele (o webhook de pagamento, o cadastro). Aqui o aviso e **gravado** junto do
 * fato que o gerou, e enviado depois, quantas vezes for preciso.
 *
 * E uma tabela do proprio Postgres, e nao Redis nem servico de fila: o volume
 * e de dezenas de e-mails por dia, e o banco ja esta la, ja tem backup e ja e
 * transacional. Custo adicional: nenhum.
 *
 * ## Situacoes
 *
 *   pending ──► sending ──► sent          (aceito pelo provedor)
 *                  │
 *                  ├──► pending           (falha passageira; nova tentativa depois)
 *                  ├──► failed            (recusa definitiva, tentativas esgotadas ou prazo vencido)
 *                  └──► suppressed        (endereco que devolveu ou marcou como spam)
 *
 * **`sent` quer dizer "o provedor aceitou", nao "chegou".** Se chegou, quem
 * diz e o webhook de entrega, em `deliveryStatus`.
 *
 * ## Idempotencia
 *
 * `dedupeKey` e unica no banco. Ela e montada com a chave do EVENTO (por
 * exemplo `payment_confirmed:<id da cobranca>`) mais o resumo do destinatario:
 * o mesmo evento, venha do webhook, da conciliacao ou de uma reentrega, so
 * consegue gerar um registro por pessoa. O endereco sozinho nunca e a chave.
 *
 * No provedor, a chave de idempotencia e o id do registro: uma nova tentativa
 * do mesmo registro nao vira um segundo e-mail.
 */

/** Espera antes de cada nova tentativa, em minutos. */
export const OUTBOX_BACKOFF_MINUTES = [1, 5, 30, 120, 720] as const;
export const OUTBOX_MAX_ATTEMPTS = OUTBOX_BACKOFF_MINUTES.length;
/** Registro em `sending` ha mais que isto: o processo que o pegou morreu. */
const STALE_LOCK_MS = 10 * 60 * 1000;
/**
 * Aviso parado ha mais que isto nao e mais enviado: "sua avaliacao termina
 * amanha" entregue tres dias depois e uma informacao errada.
 */
export const OUTBOX_EXPIRY_MS = 48 * 3600 * 1000;
/** Depois disto, o endereco e apagado do registro; o resumo fica. */
export const OUTBOX_RECIPIENT_RETENTION_DAYS = 90;

export interface OutboxContext {
  db: Database;
  env: Env;
  mailer: Mailer;
  now: () => Date;
}

/** Resumo do endereco: identifica sem guardar o endereco. */
export function emailHash(env: Pick<Env, 'AUTH_SECRET'>, email: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(`mail:${email.trim().toLowerCase()}`).digest('hex');
}

/** Dados do modelo guardados no registro. O resto vem do ambiente, no envio. */
export type StoredVars = Omit<EmailVars, 'appUrl' | 'supportEmail'>;

export interface EnqueueInput {
  /** `null` para o aviso que precisa sobreviver a exclusao da empresa. */
  tenantId: string | null;
  kind: EmailKind;
  /** Chave do evento, sem o destinatario. Ex.: `trial_ended:<empresa>:<data>`. */
  eventKey: string;
  to: string;
  vars: StoredVars;
}

/**
 * Poe um aviso na fila. Devolve `true` se o registro foi criado agora.
 *
 * Com os avisos desligados (`BILLING_EMAILS_ENABLED`), nao grava nada.
 */
export async function enqueueEmail(
  ctx: Pick<OutboxContext, 'db' | 'env' | 'now'>,
  input: EnqueueInput,
  db: Database = ctx.db,
): Promise<boolean> {
  if (!ctx.env.BILLING_EMAILS_ENABLED) return false;
  const to = input.to.trim().toLowerCase();
  if (to === '') return false;

  const hash = emailHash(ctx.env, to);
  const rendered = renderEmail(input.kind, { ...input.vars, appUrl: ctx.env.APP_URL });
  const criados = await db
    .insert(schema.emailOutbox)
    .values({
      tenantId: input.tenantId,
      kind: input.kind,
      dedupeKey: `${input.eventKey}:${hash.slice(0, 24)}`,
      recipient: to,
      recipientHash: hash,
      subject: rendered.subject,
      payload: input.vars as Record<string, unknown>,
      nextAttemptAt: ctx.now(),
      createdAt: ctx.now(),
      updatedAt: ctx.now(),
    })
    .onConflictDoNothing({ target: schema.emailOutbox.dedupeKey })
    .returning({ id: schema.emailOutbox.id });
  return criados.length > 0;
}

export interface OutboxReport {
  /** Por que nada foi processado, quando for o caso. */
  skipped?: 'disabled' | 'mailer_not_configured';
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
  expired: number;
  recovered: number;
}

const vazio = (): OutboxReport => ({
  claimed: 0,
  sent: 0,
  retried: 0,
  failed: 0,
  suppressed: 0,
  expired: 0,
  recovered: 0,
});

/**
 * Envia o que esta na vez.
 *
 * Pode rodar em dois processos ao mesmo tempo: cada registro e reservado com
 * `FOR UPDATE SKIP LOCKED` e marcado `sending` na mesma transacao, entao so um
 * processo o pega.
 */
export async function processOutbox(ctx: OutboxContext, options: { limit?: number } = {}): Promise<OutboxReport> {
  const report = vazio();
  if (!ctx.env.BILLING_EMAILS_ENABLED) return { ...report, skipped: 'disabled' };
  // Sem provedor, tentar so queimaria as tentativas de cada aviso.
  if (!ctx.mailer.configured) return { ...report, skipped: 'mailer_not_configured' };

  const now = ctx.now();
  const limit = options.limit ?? 20;

  // 1. Recuperacao: quem ficou em `sending` porque o processo morreu no meio.
  const recuperados = await ctx.db
    .update(schema.emailOutbox)
    .set({ status: 'pending', lockedAt: null, updatedAt: now })
    .where(
      and(
        eq(schema.emailOutbox.status, 'sending'),
        lt(schema.emailOutbox.lockedAt, new Date(now.getTime() - STALE_LOCK_MS)),
      ),
    )
    .returning({ id: schema.emailOutbox.id });
  report.recovered = recuperados.length;

  // 2. Aviso velho demais deixa de fazer sentido.
  const vencidos = await ctx.db
    .update(schema.emailOutbox)
    .set({ status: 'failed', lastError: 'Prazo de envio vencido: o aviso não é mais atual.', updatedAt: now })
    .where(
      and(
        eq(schema.emailOutbox.status, 'pending'),
        lt(schema.emailOutbox.createdAt, new Date(now.getTime() - OUTBOX_EXPIRY_MS)),
      ),
    )
    .returning({ id: schema.emailOutbox.id });
  report.expired = vencidos.length;

  // 3. Reserva atomica.
  const lote = await ctx.db.transaction(async (tx) => {
    const candidatos = await tx
      .select({ id: schema.emailOutbox.id })
      .from(schema.emailOutbox)
      .where(and(eq(schema.emailOutbox.status, 'pending'), lte(schema.emailOutbox.nextAttemptAt, now)))
      .orderBy(asc(schema.emailOutbox.nextAttemptAt))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (candidatos.length === 0) return [];
    return tx
      .update(schema.emailOutbox)
      .set({ status: 'sending', lockedAt: now, updatedAt: now })
      .where(
        and(
          inArray(
            schema.emailOutbox.id,
            candidatos.map((c) => c.id),
          ),
          // Relido aqui: se outro processo ja levou, este nao leva de novo.
          eq(schema.emailOutbox.status, 'pending'),
        ),
      )
      .returning();
  });
  report.claimed = lote.length;

  for (const row of lote) {
    const concluir = (patch: Partial<typeof schema.emailOutbox.$inferInsert>) =>
      ctx.db
        .update(schema.emailOutbox)
        .set({ lockedAt: null, updatedAt: ctx.now(), ...patch })
        .where(eq(schema.emailOutbox.id, row.id));

    try {
      if (!row.recipient) {
        await concluir({ status: 'failed', lastError: 'Registro sem destinatário.' });
        report.failed += 1;
        continue;
      }

      const [bloqueio] = await ctx.db
        .select({ reason: schema.emailSuppressions.reason })
        .from(schema.emailSuppressions)
        .where(eq(schema.emailSuppressions.emailHash, row.recipientHash));
      if (bloqueio) {
        await concluir({ status: 'suppressed', lastError: `Endereço fora dos avisos: ${bloqueio.reason}.` });
        report.suppressed += 1;
        continue;
      }

      const rendered = renderEmail(row.kind as EmailKind, {
        ...(row.payload as unknown as StoredVars),
        appUrl: ctx.env.APP_URL,
        supportEmail: ctx.env.SUPPORT_EMAIL ?? null,
      });
      const envio = await ctx.mailer.send({
        to: row.recipient,
        kind: 'account_notice',
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        idempotencyKey: row.id,
      });

      const attempts = row.attempts + 1;
      if (envio.delivered) {
        await concluir({
          status: 'sent',
          attempts,
          sentAt: ctx.now(),
          provider: envio.provider ?? '',
          providerMessageId: envio.providerMessageId ?? null,
          lastError: '',
        });
        report.sent += 1;
      } else if (envio.permanent || attempts >= OUTBOX_MAX_ATTEMPTS) {
        await concluir({
          status: 'failed',
          attempts,
          provider: envio.provider ?? '',
          lastError: resumir(envio.reason),
        });
        report.failed += 1;
      } else {
        const espera = OUTBOX_BACKOFF_MINUTES[attempts - 1] ?? 720;
        await concluir({
          status: 'pending',
          attempts,
          provider: envio.provider ?? '',
          nextAttemptAt: new Date(ctx.now().getTime() + espera * 60_000),
          lastError: resumir(envio.reason),
        });
        report.retried += 1;
      }
    } catch (error) {
      // Erro nosso (modelo, banco): volta para a fila, contando a tentativa.
      const attempts = row.attempts + 1;
      const esgotou = attempts >= OUTBOX_MAX_ATTEMPTS;
      await concluir({
        status: esgotou ? 'failed' : 'pending',
        attempts,
        nextAttemptAt: new Date(ctx.now().getTime() + (OUTBOX_BACKOFF_MINUTES[attempts - 1] ?? 720) * 60_000),
        lastError: resumir(error instanceof Error ? error.message : String(error)),
      }).catch(() => undefined);
      if (esgotou) report.failed += 1;
      else report.retried += 1;
    }
  }

  return report;
}

/** O motivo guardado e curto e nunca traz o endereco de ninguem. */
function resumir(motivo: string | undefined): string {
  return (motivo ?? 'Falha sem motivo informado.').replace(/[^\s@<>"]+@[^\s@<>"]+/g, '[e-mail]').slice(0, 300);
}

/** Apaga o endereco dos registros antigos ja resolvidos. */
export async function anonymizeOldOutbox(db: Database, now: Date): Promise<number> {
  const limite = new Date(now.getTime() - OUTBOX_RECIPIENT_RETENTION_DAYS * 24 * 3600 * 1000);
  const linhas = await db
    .update(schema.emailOutbox)
    .set({ recipient: null, updatedAt: now })
    .where(
      and(
        isNotNull(schema.emailOutbox.recipient),
        lt(schema.emailOutbox.createdAt, limite),
        inArray(schema.emailOutbox.status, ['sent', 'failed', 'suppressed']),
      ),
    )
    .returning({ id: schema.emailOutbox.id });
  return linhas.length;
}

// ------------------------------------------------- eventos de entrega

export type DeliveryEvent = 'delayed' | 'delivered' | 'bounced' | 'complained';
const PESO: Record<string, number> = { '': 0, delayed: 1, delivered: 2, bounced: 3, complained: 4 };

/**
 * Registra o que o provedor informou depois de aceitar.
 *
 * Eventos chegam fora de ordem: um `delivered` atrasado nao apaga um `bounced`.
 * Devolucao definitiva e marcacao como spam tiram o endereco dos avisos.
 */
export async function recordDeliveryEvent(
  ctx: Pick<OutboxContext, 'db' | 'now'>,
  input: { providerMessageId: string; event: DeliveryEvent; permanent?: boolean },
): Promise<{ matched: boolean; suppressed: boolean }> {
  const [row] = await ctx.db
    .select({
      id: schema.emailOutbox.id,
      deliveryStatus: schema.emailOutbox.deliveryStatus,
      recipientHash: schema.emailOutbox.recipientHash,
    })
    .from(schema.emailOutbox)
    .where(eq(schema.emailOutbox.providerMessageId, input.providerMessageId));
  if (!row) return { matched: false, suppressed: false };

  if ((PESO[input.event] ?? 0) > (PESO[row.deliveryStatus] ?? 0)) {
    await ctx.db
      .update(schema.emailOutbox)
      .set({ deliveryStatus: input.event, deliveryUpdatedAt: ctx.now(), updatedAt: ctx.now() })
      .where(eq(schema.emailOutbox.id, row.id));
  }

  const suprimir = input.event === 'complained' || (input.event === 'bounced' && input.permanent === true);
  if (suprimir) {
    await ctx.db
      .insert(schema.emailSuppressions)
      .values({
        emailHash: row.recipientHash,
        reason: input.event === 'complained' ? 'marcado como spam' : 'devolução definitiva',
        createdAt: ctx.now(),
      })
      .onConflictDoNothing();
  }
  return { matched: true, suppressed: suprimir };
}
