import { AppError } from '@codeca/shared';
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { pendingWebhookEvents, processWebhookEvent } from '../lib/billing/webhook-store.js';
import { reconcileBilling } from '../lib/billing/reconcile.js';
import { ok } from '../lib/http.js';
import type { AppBindings } from '../types.js';

/**
 * Job de reconciliacao.
 *
 * Projetado para a Vercel Cron: uma requisicao HTTP periodica, sem processo
 * permanente e sem laco infinito. Protegido por segredo proprio
 * (`BILLING_RECONCILIATION_SECRET`), enviado como Bearer -- nao basta estar
 * autenticado no painel, e nao e uma rota que qualquer pessoa possa disparar.
 *
 * O trabalho de cada execucao e limitado (`limit`), para caber no tempo da
 * funcao: o que sobrar fica para a proxima passagem, sem perder nada.
 */

export function billingJobRoutes() {
  const app = new Hono<AppBindings>();

  app.post('/reconcile', async (c) => {
    const ctx = c.get('ctx');
    assertJobSecret(c.req.header('authorization'), ctx.env.BILLING_RECONCILIATION_SECRET);

    const url = new URL(c.req.url);
    const limitParam = Number(url.searchParams.get('limit') ?? '');
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

    const billingCtx = {
      db: ctx.db,
      now: ctx.now,
      source: 'reconciliation' as const,
      provider: ctx.billing,
    };

    // 1. Eventos que ficaram pendentes ou falharam: reprocessa antes de
    //    consultar a API, porque muitos deles ja trazem o estado correto.
    const pending = await pendingWebhookEvents(ctx.db, Math.min(limit, 20));
    let replayed = 0;
    for (const event of pending) {
      const result = await processWebhookEvent(billingCtx, event);
      if (result.status === 'processed') replayed += 1;
    }

    // 2. Reconciliacao propriamente dita.
    const report = await reconcileBilling(billingCtx, { limit });
    report.pendingEventsReplayed = replayed;

    if (report.failures.length > 0 || report.divergences.length > 0) {
      // Alerta operacional no log: a origem fica visivel no painel mestre.
      console.warn(
        `[billing] reconciliacao com ${report.divergences.length} divergencia(s) e `
          + `${report.failures.length} falha(s).`,
      );
    }

    return ok(c, report);
  });

  // A Vercel Cron dispara GET; o mesmo trabalho, mesma protecao.
  app.get('/reconcile', async (c) => {
    const ctx = c.get('ctx');
    assertJobSecret(c.req.header('authorization'), ctx.env.BILLING_RECONCILIATION_SECRET);

    const billingCtx = {
      db: ctx.db,
      now: ctx.now,
      source: 'reconciliation' as const,
      provider: ctx.billing,
    };

    const pending = await pendingWebhookEvents(ctx.db, 20);
    let replayed = 0;
    for (const event of pending) {
      const result = await processWebhookEvent(billingCtx, event);
      if (result.status === 'processed') replayed += 1;
    }

    const report = await reconcileBilling(billingCtx, { limit: 50 });
    report.pendingEventsReplayed = replayed;
    return ok(c, report);
  });

  return app;
}

/**
 * Exige o segredo do job no cabecalho `Authorization: Bearer <segredo>`.
 *
 * Comparacao em tempo constante. Sem segredo configurado a rota fica
 * indisponivel, em vez de aberta.
 */
export function assertJobSecret(header: string | undefined, secret: string | undefined): void {
  if (!secret) {
    throw AppError.notConfigured(
      'A reconciliacao automatica nao esta configurada. Defina BILLING_RECONCILIATION_SECRET.',
    );
  }

  const received = (header ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!received) throw AppError.unauthenticated('Segredo do job ausente.');

  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw AppError.unauthenticated('Segredo do job invalido.');
  }
}
