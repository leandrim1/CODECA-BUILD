import { and, asc, desc, eq, inArray, schema, type Database } from '@codeca/database';
import { AppError, isHandledEvent } from '@codeca/shared';
import { createHash } from 'node:crypto';
import { BILLING_ACTIONS, recordBillingAudit } from './audit.js';
import { applyBillingEvent, sanitizeErrorMessage, type ApplyEventResult } from './events.js';
import type { BillingContext } from './service.js';
import { asRecord, readDate, readString, type RawPayload } from './payload.js';

/**
 * Deposito durável dos eventos de webhook.
 *
 * A ValidaPay entrega *pelo menos uma vez* e reenvia por 72 horas. O
 * `X-Webhook-Id` e o mesmo em todas as tentativas, por isso entra como chave
 * unica: a segunda chegada do mesmo evento nao reprocessa nada.
 *
 * A ordem e deliberada: **gravar primeiro, processar depois**. Responder 2xx
 * so depois da gravacao garante que nenhum evento aceito se perde se o
 * processamento falhar -- a reconciliacao e o reprocesso manual o retomam.
 * Nada depende da memoria do processo, que a Vercel recicla a qualquer momento.
 */

export type WebhookEventRow = typeof schema.webhookEvents.$inferSelect;

export interface StoreEventInput {
  /** `X-Webhook-Id`. Quando ausente, derivamos um id estavel do corpo. */
  externalEventId: string | null;
  event: string;
  attempt: number | null;
  rawBody: string;
  payload: RawPayload;
}

export interface StoreEventResult {
  row: WebhookEventRow;
  /** `true` quando este evento ja havia sido recebido. */
  duplicate: boolean;
}

/**
 * Grava o evento de forma idempotente.
 *
 * Sem `X-Webhook-Id`, o identificador vem do hash do corpo: duas entregas do
 * mesmo evento tem o mesmo corpo, portanto continuam deduplicadas.
 */
export async function storeWebhookEvent(
  db: Database,
  input: StoreEventInput,
): Promise<StoreEventResult> {
  const externalEventId =
    input.externalEventId ?? `sha256:${createHash('sha256').update(input.rawBody).digest('hex')}`;

  const occurredAt = readDate(input.payload, 'timestamp');
  const externalSubscriptionId = readString(input.payload, 'subscriptionId');
  const externalChargeId = readString(input.payload, 'chargeId');

  const inserted = await db
    .insert(schema.webhookEvents)
    .values({
      externalEventId,
      event: input.event,
      occurredAt,
      attempt: input.attempt,
      status: isHandledEvent(input.event) ? 'pending' : 'ignored',
      externalSubscriptionId,
      externalChargeId,
      payload: input.payload,
    })
    .onConflictDoNothing({ target: schema.webhookEvents.externalEventId })
    .returning();

  if (inserted[0]) return { row: inserted[0], duplicate: false };

  const [existing] = await db
    .select()
    .from(schema.webhookEvents)
    .where(eq(schema.webhookEvents.externalEventId, externalEventId));
  if (!existing) throw AppError.internal('Falha ao registrar o evento de webhook.');
  return { row: existing, duplicate: true };
}

export interface ProcessEventResult extends ApplyEventResult {
  status: WebhookEventRow['status'];
}

/**
 * Processa um evento ja gravado.
 *
 * Roda em transacao: estado da assinatura, cobranca, auditoria e a marca de
 * processado avancam juntos. Uma falha deixa o evento como `failed`, com a
 * mensagem sanitizada, disponivel para reprocessamento.
 */
export async function processWebhookEvent(
  ctx: Omit<BillingContext, 'webhookEventId'>,
  row: WebhookEventRow,
): Promise<ProcessEventResult> {
  if (row.status === 'processed') {
    return {
      status: 'processed',
      outcome: 'ignored',
      tenantId: row.tenantId,
      subscriptionId: row.externalSubscriptionId,
      chargeId: row.externalChargeId,
      detail: 'Evento ja processado anteriormente.',
    };
  }

  if (!isHandledEvent(row.event)) {
    await ctx.db
      .update(schema.webhookEvents)
      .set({ status: 'ignored', processedAt: ctx.now(), updatedAt: ctx.now() })
      .where(eq(schema.webhookEvents.id, row.id));
    return {
      status: 'ignored',
      outcome: 'ignored',
      tenantId: null,
      subscriptionId: null,
      chargeId: null,
      detail: `Evento ${row.event} nao e tratado por esta integracao.`,
    };
  }

  const payload = asRecord(row.payload) ?? {};
  const occurredAt = row.occurredAt ?? row.receivedAt;

  try {
    const result = await ctx.db.transaction(async (tx) => {
      const scoped: BillingContext = {
        db: tx as unknown as Database,
        now: ctx.now,
        source: ctx.source,
        actorUserId: ctx.actorUserId ?? null,
        webhookEventId: row.id,
      };

      const applied = await applyBillingEvent(scoped, {
        event: row.event,
        payload,
        occurredAt,
        webhookEventId: row.id,
      });

      const status: WebhookEventRow['status'] =
        applied.outcome === 'processed'
          ? 'processed'
          : applied.outcome === 'unresolved'
            ? 'unresolved'
            : 'ignored';

      await tx
        .update(schema.webhookEvents)
        .set({
          status,
          tenantId: applied.tenantId,
          processingAttempts: row.processingAttempts + 1,
          processedAt: status === 'processed' || status === 'ignored' ? ctx.now() : null,
          errorMessage: applied.outcome === 'unresolved' ? applied.detail.slice(0, 500) : '',
          updatedAt: ctx.now(),
        })
        .where(eq(schema.webhookEvents.id, row.id));

      if (applied.outcome === 'unresolved') {
        await recordBillingAudit(tx as unknown as Database, {
          action: BILLING_ACTIONS.webhookUnresolved,
          source: 'webhook',
          webhookEventId: row.id,
          reason: applied.detail,
          metadata: {
            event: row.event,
            externalSubscriptionId: applied.subscriptionId,
            externalChargeId: applied.chargeId,
          },
        });
      }

      return { ...applied, status };
    });

    return result;
  } catch (error) {
    // Transacao desfeita: nada foi aplicado pela metade.
    const message = sanitizeErrorMessage(error);
    await ctx.db
      .update(schema.webhookEvents)
      .set({
        status: 'failed',
        processingAttempts: row.processingAttempts + 1,
        errorMessage: message,
        updatedAt: ctx.now(),
      })
      .where(eq(schema.webhookEvents.id, row.id));

    console.error(`[billing] falha ao processar ${row.event} (${row.externalEventId}): ${message}`);

    return {
      status: 'failed',
      outcome: 'unresolved',
      tenantId: row.tenantId,
      subscriptionId: row.externalSubscriptionId,
      chargeId: row.externalChargeId,
      detail: message,
    };
  }
}

/** Eventos aguardando processamento ou com falha, mais antigos primeiro. */
export async function pendingWebhookEvents(
  db: Database,
  limit = 20,
): Promise<WebhookEventRow[]> {
  return db
    .select()
    .from(schema.webhookEvents)
    .where(inArray(schema.webhookEvents.status, ['pending', 'failed', 'unresolved']))
    .orderBy(asc(schema.webhookEvents.receivedAt))
    .limit(limit);
}

export async function loadWebhookEvent(
  db: Database,
  id: string,
): Promise<WebhookEventRow | null> {
  const [row] = await db
    .select()
    .from(schema.webhookEvents)
    .where(eq(schema.webhookEvents.id, id));
  return row ?? null;
}

export interface WebhookEventListOptions {
  status?: WebhookEventRow['status'];
  event?: string;
  limit: number;
  offset: number;
}

export async function listWebhookEvents(
  db: Database,
  options: WebhookEventListOptions,
): Promise<WebhookEventRow[]> {
  const conditions = [];
  if (options.status) conditions.push(eq(schema.webhookEvents.status, options.status));
  if (options.event) conditions.push(eq(schema.webhookEvents.event, options.event));

  return db
    .select()
    .from(schema.webhookEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.webhookEvents.receivedAt))
    .limit(options.limit)
    .offset(options.offset);
}

/**
 * Reprocessa um evento gravado.
 *
 * Seguro de repetir: o processamento passa pelas mesmas funcoes monotonicas, e
 * um estado que ja avancou nao avanca de novo.
 */
export async function replayWebhookEvent(
  ctx: Omit<BillingContext, 'webhookEventId'>,
  row: WebhookEventRow,
): Promise<ProcessEventResult> {
  await ctx.db
    .update(schema.webhookEvents)
    .set({ status: 'pending', errorMessage: '', updatedAt: ctx.now() })
    .where(eq(schema.webhookEvents.id, row.id));

  await recordBillingAudit(ctx.db, {
    tenantId: row.tenantId,
    action: BILLING_ACTIONS.webhookReplayed,
    source: 'admin',
    actorUserId: ctx.actorUserId ?? null,
    webhookEventId: row.id,
    reason: `Reprocessamento manual do evento ${row.event}.`,
    metadata: { externalEventId: row.externalEventId, previousStatus: row.status },
  });

  return processWebhookEvent(ctx, { ...row, status: 'pending', errorMessage: '' });
}
