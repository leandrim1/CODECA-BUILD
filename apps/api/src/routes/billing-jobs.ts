import { pruneExpiredRecords } from '../lib/housekeeping.js';
import { AppError } from '@codeca/shared';
import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { pendingWebhookEvents, processWebhookEvent } from '../lib/billing/webhook-store.js';
import { reconcileBilling } from '../lib/billing/reconcile.js';
import { recheckDomains } from '../lib/domain-recheck.js';
import { flushPendingDeliveries } from '../lib/integration/outbound.js';
import { ok } from '../lib/http.js';
import type { AppBindings } from '../types.js';

/**
 * Job periodico da plataforma.
 *
 * Projetado para a Vercel Cron: uma requisicao HTTP periodica, sem processo
 * permanente e sem laco infinito. Protegido por segredo proprio
 * (`BILLING_RECONCILIATION_SECRET`), enviado como Bearer -- nao basta estar
 * autenticado no painel, e nao e uma rota que qualquer pessoa possa disparar.
 *
 * O trabalho de cada execucao e limitado (`limit`), para caber no tempo da
 * funcao: o que sobrar fica para a proxima passagem, sem perder nada.
 *
 * Faz tres coisas que nao tem a ver umas com as outras -- reconciliar cobranca,
 * reenviar webhook que falhou e reverificar dominios -- e isso e deliberado:
 * o plano Hobby da Vercel permite **um** cron, diario. Separar em tres rotas
 * exigiria um plano pago para nada, ja que as tarefas sao curtas e independentes
 * entre si.
 */

export function billingJobRoutes() {
  const app = new Hono<AppBindings>();

  // A Vercel Cron dispara GET; o POST existe para acionar o job a mao.
  app.post('/reconcile', async (c) => executarJob(c));
  app.get('/reconcile', async (c) => executarJob(c));

  return app;
}

/** Corpo do job, compartilhado pelos dois metodos. */
async function executarJob(c: Context<AppBindings>) {
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
  // Assinaturas e suspensoes podem ter mudado em varias empresas.
  ctx.caches.invalidateAll();

  // 3. Avisos de publicacao que o site do cliente nao recebeu. A primeira
  //    tentativa acontece na propria publicacao; aqui ficam as repeticoes.
  const deliveries = await flushPendingDeliveries(
    { db: ctx.db, now: ctx.now, fetch: ctx.fetch },
    { limit },
  );

  // 4. Dominios gerenciados: quem passou a funcionar e quem deixou de funcionar.
  //    Falha aqui nao pode impedir a resposta do resto do job.
  const domains = await recheckDomains(
    { db: ctx.db, env: ctx.env, domains: ctx.domains, now: ctx.now },
    { limit },
  ).catch((error: unknown) => {
    console.error('[domains] falha na reverificação:', error instanceof Error ? error.message : error);
    return null;
  });
  if (domains && domains.lostActive.length > 0) {
    console.warn(
      `[domains] ${domains.lostActive.length} domínio(s) deixaram de funcionar: `
        + domains.lostActive.map((d) => d.hostname).join(', '),
    );
  }

  // 5. Limpeza de sessoes, codigos e contadores vencidos. Falha aqui nao pode
  //    impedir a resposta do resto do job.
  const housekeeping = await pruneExpiredRecords(ctx.db, ctx.now()).catch((error: unknown) => {
    console.error('[housekeeping] falha:', error instanceof Error ? error.message : error);
    return null;
  });

  if (report.failures.length > 0 || report.divergences.length > 0) {
    // Alerta operacional no log: a origem fica visivel no painel mestre.
    console.warn(
      `[billing] reconciliação com ${report.divergences.length} divergência(s) e `
        + `${report.failures.length} falha(s).`,
    );
  }

  if (deliveries.exhausted > 0) {
    console.warn(`[webhook] ${deliveries.exhausted} entrega(s) esgotaram as tentativas.`);
  }

  return ok(c, { ...report, deliveries, domains, housekeeping });
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
      'A reconciliação automática não está configurada. Defina BILLING_RECONCILIATION_SECRET.',
    );
  }

  const received = (header ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!received) throw AppError.unauthenticated('Segredo do job ausente.');

  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(secret, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw AppError.unauthenticated('Segredo do job inválido.');
  }
}
