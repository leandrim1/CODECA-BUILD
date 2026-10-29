import { AppError } from '@codeca/shared';
import { Hono } from 'hono';
import {
  asRecord,
  processWebhookEvent,
  readString,
  storeWebhookEvent,
} from '../lib/billing/index.js';
import {
  WEBHOOK_ACCESS_TOKEN_HEADER,
  WEBHOOK_ATTEMPT_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_FAILURE_MESSAGES,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  verifyWebhookSignature,
} from '../lib/validapay/webhook.js';
import type { AppBindings } from '../types.js';

/**
 * Webhook da ValidaPay.
 *
 * Endpoint publico -- sem sessao, sem CSRF -- e por isso a autenticidade vem
 * da assinatura HMAC, verificada antes de qualquer leitura do conteudo. A ordem
 * importa e e esta:
 *
 *   1. ler o corpo **bruto** (reserializar quebraria o HMAC);
 *   2. conferir assinatura e janela de tempo;
 *   3. gravar o evento de forma duravel (unico pelo `X-Webhook-Id`);
 *   4. so entao responder 2xx;
 *   5. processar.
 *
 * Assinatura invalida responde 401 e nada e gravado. Um evento valido cuja
 * aplicacao falhe responde 2xx de todo modo: ele ja esta salvo, e a
 * reconciliacao ou o reprocesso manual o retomam. Reenviar nao duplica nada.
 */

export function webhookRoutes() {
  const app = new Hono<AppBindings>();

  app.post('/validapay', async (c) => {
    const ctx = c.get('ctx');

    // 1. Corpo bruto, byte a byte, como chegou.
    const rawBody = await c.req.text();

    if (!ctx.env.VALIDAPAY_WEBHOOK_SECRET) {
      // Sem segredo configurado nao ha como provar a origem: recusamos em vez
      // de aceitar um corpo nao verificado.
      console.error('[webhook] VALIDAPAY_WEBHOOK_SECRET nao configurado: evento recusado.');
      throw AppError.notConfigured(
        'O recebimento de webhooks nao esta configurado. Defina VALIDAPAY_WEBHOOK_SECRET.',
      );
    }

    // 2. Assinatura e janela de tempo.
    const verification = verifyWebhookSignature({
      rawBody,
      signatureHeader: c.req.header(WEBHOOK_SIGNATURE_HEADER),
      secret: ctx.env.VALIDAPAY_WEBHOOK_SECRET,
      now: ctx.now(),
      toleranceMs: ctx.env.VALIDAPAY_WEBHOOK_TOLERANCE_SECONDS * 1000,
      ...(ctx.env.VALIDAPAY_WEBHOOK_ACCESS_TOKEN
        ? {
            expectedAccessToken: ctx.env.VALIDAPAY_WEBHOOK_ACCESS_TOKEN,
            accessTokenHeader: c.req.header(WEBHOOK_ACCESS_TOKEN_HEADER),
          }
        : {}),
    });

    if (!verification.valid) {
      const failure = verification.failure ?? 'invalid_signature';
      // Log sem o corpo e sem a assinatura recebida.
      console.warn(`[webhook] recusado: ${failure}`);
      return c.json(
        { error: { code: 'unauthorized', message: WEBHOOK_FAILURE_MESSAGES[failure] } },
        401,
      );
    }

    // O corpo so e interpretado depois de provada a origem.
    let payload: Record<string, unknown>;
    try {
      payload = asRecord(JSON.parse(rawBody)) ?? {};
    } catch {
      return c.json(
        { error: { code: 'bad_request', message: 'Corpo do webhook nao e um JSON valido.' } },
        400,
      );
    }

    const event = c.req.header(WEBHOOK_EVENT_HEADER) ?? readString(payload, 'event');
    if (!event) {
      return c.json(
        { error: { code: 'bad_request', message: 'Evento nao identificado no webhook.' } },
        400,
      );
    }

    const attemptHeader = c.req.header(WEBHOOK_ATTEMPT_HEADER);
    const attempt = attemptHeader && /^\d+$/.test(attemptHeader) ? Number(attemptHeader) : null;

    // 3. Gravacao duravel e deduplicacao pelo id do evento.
    const stored = await storeWebhookEvent(ctx.db, {
      externalEventId: c.req.header(WEBHOOK_ID_HEADER) ?? null,
      event,
      attempt,
      rawBody,
      payload,
    });

    // 4. Evento repetido: nada a fazer, e a resposta confirma o recebimento.
    if (stored.duplicate) {
      return c.json(
        {
          data: {
            received: true,
            duplicate: true,
            status: stored.row.status,
            eventId: stored.row.id,
          },
        },
        200,
      );
    }

    // 5. Processamento. Falha aqui nao devolve erro: o evento esta salvo e
    //    sera retomado, e devolver 5xx faria a ValidaPay reenviar por 72h sem
    //    necessidade.
    const result = await processWebhookEvent(
      { db: ctx.db, now: ctx.now, source: 'webhook' },
      stored.row,
    );

    return c.json(
      {
        data: {
          received: true,
          duplicate: false,
          status: result.status,
          eventId: stored.row.id,
          detail: result.detail,
        },
      },
      200,
    );
  });

  return app;
}
