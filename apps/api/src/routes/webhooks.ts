import { AppError } from '@codeca/shared';
import { Hono } from 'hono';
import {
  asRecord,
  drainStaleWebhookEvents,
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
import { runAccountNotices } from '../lib/mail/notices.js';
import { recordDeliveryEvent, type DeliveryEvent } from '../lib/mail/outbox.js';
import { verifySvixSignature } from '../lib/mail/svix.js';
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
 * Assinatura invalida responde 401 e nada e gravado. Se a gravacao falhar, a
 * resposta e erro (5xx) e a ValidaPay reenvia: nunca se confirma um evento
 * que nao foi guardado. Um evento valido cuja aplicacao falhe responde 2xx de
 * todo modo: ele ja esta salvo, e a retomada, a reconciliacao ou o reprocesso
 * manual o concluem. Reenviar nao duplica nada.
 *
 * A resposta tem prazo (`VALIDAPAY_WEBHOOK_RESPONSE_BUDGET_MS`): se o
 * processamento nao terminar dentro dele, a resposta sai e o trabalho segue em
 * segundo plano. Ver o passo 5, abaixo.
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
      console.error('[webhook] VALIDAPAY_WEBHOOK_SECRET não configurado: evento recusado.');
      throw AppError.notConfigured(
        'O recebimento de webhooks não está configurado. Defina VALIDAPAY_WEBHOOK_SECRET.',
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
      // Sem o corpo e sem a assinatura recebida. Uma recusa isolada e ruido
      // da internet; recusas em serie de eventos legitimos sao um segredo
      // trocado no painel da ValidaPay -- e cada uma e um pagamento que nao
      // entrou. Por isso e alerta, agrupado por motivo.
      await ctx.monitor.report({
        kind: 'webhook_rejected',
        severity: 'critical',
        message: 'Webhook da ValidaPay recusado na verificação de origem.',
        context: { failure },
        alertKey: `webhook_rejected:${failure}`,
      });
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
        { error: { code: 'bad_request', message: 'Corpo do webhook não é um JSON válido.' } },
        400,
      );
    }

    const event = c.req.header(WEBHOOK_EVENT_HEADER) ?? readString(payload, 'event');
    if (!event) {
      return c.json(
        { error: { code: 'bad_request', message: 'Evento não identificado no webhook.' } },
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
      await ctx.monitor.report({
        kind: 'webhook_duplicate',
        severity: 'info',
        message: 'Entrega repetida de um evento já gravado.',
        context: { event, eventId: stored.row.id, status: stored.row.status, attempt },
      });
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

    /*
     * 5. Processamento, com prazo para a resposta.
     *
     * A partir daqui o evento esta salvo, e a resposta e sempre 2xx: devolver
     * 5xx faria a ValidaPay reenviar por 72 h um evento que ja temos.
     *
     * O processamento comeca imediatamente. Se terminar dentro do prazo, a
     * resposta leva o resultado -- o caso normal, de dezenas de milissegundos.
     * Se nao terminar (banco acordando, concorrencia), a resposta sai sem
     * esperar, porque a ValidaPay corta a entrega em 5 s, e o processamento
     * segue em segundo plano. A alternativa de responder SEMPRE antes de
     * processar foi descartada: sem fila, trocaria um processamento que
     * quase sempre cabe na requisicao por um que depende de a funcao
     * continuar viva depois da resposta.
     */
    const billingCtx = { db: ctx.db, now: ctx.now, source: 'webhook' as const };
    const processing = processWebhookEvent(billingCtx, stored.row).then(async (result) => {
      // O evento pode ter alterado assinatura/suspensao de qualquer empresa.
      ctx.caches.invalidateAll();
      if (result.status === 'failed') {
        await ctx.monitor.report({
          kind: 'webhook_failed',
          severity: 'critical',
          message: 'Um evento de cobrança foi recebido e não pôde ser aplicado.',
          context: {
            event,
            eventId: stored.row.id,
            attempts: result.attempts ?? null,
            detail: result.detail,
          },
          // Um alerta por tipo de evento: a causa costuma ser a mesma.
          alertKey: `webhook_failed:${event}`,
        });
      }
      return result;
    });

    // Retomada de eventos que ficaram parados, sempre depois da resposta.
    ctx.background(
      processing
        .catch(() => undefined)
        // Avisos por e-mail nascem do estado que o evento acabou de gravar.
        .then(() => runAccountNotices(ctx, { trial: false }))
        .then(() => drainStaleWebhookEvents(billingCtx, { exceptId: stored.row.id }))
        .then((retomada) => {
          if (retomada.processados > 0) ctx.caches.invalidateAll();
        })
        .catch((error: unknown) =>
          ctx.monitor.report({
            kind: 'webhook_stuck',
            severity: 'warning',
            message: 'A retomada de eventos pendentes falhou.',
            error,
          }),
        ),
    );

    const finished = await withinBudget(processing, ctx.env.VALIDAPAY_WEBHOOK_RESPONSE_BUDGET_MS);

    if (!finished.done) {
      await ctx.monitor.report({
        kind: 'webhook_deferred',
        severity: 'warning',
        message: 'O processamento de um evento passou do prazo e continua em segundo plano.',
        context: { event, eventId: stored.row.id, budgetMs: ctx.env.VALIDAPAY_WEBHOOK_RESPONSE_BUDGET_MS },
      });
      return c.json(
        {
          data: {
            received: true,
            duplicate: false,
            // Gravado e ainda em processamento: a retomada o conclui.
            status: 'pending',
            eventId: stored.row.id,
            detail: 'Evento gravado; o processamento continua em segundo plano.',
          },
        },
        200,
      );
    }

    const result = finished.value;
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

  /**
   * Webhook do Resend: o que aconteceu com um e-mail DEPOIS de aceito.
   *
   * Publico, entao a origem vem da assinatura (padrao Svix, que o Resend usa),
   * conferida sobre o corpo bruto antes de qualquer leitura. Sem segredo
   * configurado, recusa tudo.
   *
   * So atualiza registros da nossa fila, localizados pelo id que o provedor
   * devolveu no envio. Evento de e-mail que nao e da fila (codigo de acesso,
   * convite) e confirmado e ignorado. Repetir ou chegar fora de ordem nao
   * muda o resultado: ver `recordDeliveryEvent`.
   */
  app.post('/resend', async (c) => {
    const ctx = c.get('ctx');
    const rawBody = await c.req.text();

    if (!ctx.env.RESEND_WEBHOOK_SECRET) {
      throw AppError.notConfigured(
        'O recebimento de eventos de e-mail não está configurado. Defina RESEND_WEBHOOK_SECRET.',
      );
    }

    const verificacao = verifySvixSignature({
      rawBody,
      id: c.req.header('svix-id'),
      timestamp: c.req.header('svix-timestamp'),
      signature: c.req.header('svix-signature'),
      secret: ctx.env.RESEND_WEBHOOK_SECRET,
      now: ctx.now(),
    });
    if (!verificacao.valid) {
      await ctx.monitor.report({
        kind: 'webhook_rejected',
        severity: 'warning',
        message: 'Webhook do Resend recusado na verificação de origem.',
        context: { failure: verificacao.failure },
        alertKey: `resend_webhook_rejected:${verificacao.failure}`,
      });
      return c.json({ error: { code: 'unauthorized', message: 'Assinatura inválida.' } }, 401);
    }

    let payload: Record<string, unknown>;
    try {
      payload = asRecord(JSON.parse(rawBody)) ?? {};
    } catch {
      return c.json({ error: { code: 'bad_request', message: 'Corpo não é um JSON válido.' } }, 400);
    }

    const EVENTOS: Record<string, DeliveryEvent> = {
      'email.delivered': 'delivered',
      'email.delivery_delayed': 'delayed',
      'email.bounced': 'bounced',
      'email.complained': 'complained',
    };
    const event = EVENTOS[readString(payload, 'type') ?? ''];
    const data = asRecord(payload.data) ?? {};
    const messageId = readString(data, 'email_id');
    if (!event || !messageId) {
      return c.json({ data: { received: true, handled: false } }, 200);
    }

    // So tira o endereco dos avisos quando o provedor diz que a devolucao e
    // definitiva. Caixa cheia ou servidor fora do ar nao condena o endereco.
    const bounce = asRecord(data.bounce) ?? {};
    const tipo = `${readString(bounce, 'type') ?? ''} ${readString(bounce, 'subType') ?? ''}`.toLowerCase();
    const permanent = event === 'bounced' && /permanent|hard/.test(tipo);

    const resultado = await recordDeliveryEvent(ctx, { providerMessageId: messageId, event, permanent });
    if (resultado.matched && (event === 'bounced' || event === 'complained')) {
      await ctx.monitor.report({
        kind: 'email_failed',
        severity: 'warning',
        message:
          event === 'complained'
            ? 'Um aviso por e-mail foi marcado como spam pelo destinatário.'
            : 'Um aviso por e-mail foi devolvido pelo servidor do destinatário.',
        context: { event, permanent, suppressed: resultado.suppressed },
        alertKey: `email_delivery:${event}`,
      });
    }
    return c.json({ data: { received: true, handled: resultado.matched, suppressed: resultado.suppressed } }, 200);
  });

  return app;
}

/**
 * Espera uma promessa por, no maximo, `budgetMs`.
 *
 * Nao cancela nada: passado o prazo, a promessa continua, e quem chamou decide
 * o que fazer com ela. Com prazo zero, nunca espera.
 */
async function withinBudget<T>(
  task: Promise<T>,
  budgetMs: number,
): Promise<{ done: true; value: T } | { done: false }> {
  if (budgetMs <= 0) return { done: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ done: false }>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), budgetMs);
  });
  try {
    return await Promise.race([task.then((value) => ({ done: true as const, value })), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
