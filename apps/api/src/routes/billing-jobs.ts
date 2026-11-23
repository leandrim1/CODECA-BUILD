import { pruneExpiredRecords } from '../lib/housekeeping.js';
import { drenarFilaDoBlob } from '../lib/blob-cleanup.js';
import { AppError, type SyncRunOrigin } from '@codeca/shared';
import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import {
  exhaustedWebhookEvents,
  pendingWebhookEvents,
  processWebhookEvent,
} from '../lib/billing/webhook-store.js';
import { checkReconcileHeartbeat, recordReconcileHeartbeat } from '../lib/ops/heartbeat.js';
import { reconcileBilling } from '../lib/billing/reconcile.js';
import { recheckDomains } from '../lib/domain-recheck.js';
import { runSchedulerPass } from '../lib/sync/scheduler.js';
import { flushPendingDeliveries } from '../lib/integration/outbound.js';
import { ok } from '../lib/http.js';
import { runAccountNotices } from '../lib/mail/notices.js';
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

/**
 * De onde veio esta chamada.
 *
 * A Vercel marca as proprias chamadas de cron com `x-vercel-cron` e com um
 * `user-agent` proprio; qualquer outra coisa que apresente o segredo e um
 * agendador externo. A distincao nao e decorativa: e ela que permite a tela
 * dizer "o agendador externo esta mesmo chamando" em vez de pedir que o
 * cliente acredite na configuracao.
 *
 * `?origem=manual` existe para o disparo a mao -- um teste de implantacao nao
 * deve entrar na conta da cadencia como se fosse agendamento. Nao e um furo
 * de seguranca: quem chega aqui ja apresentou o segredo do job, e mentir a
 * propria origem so prejudicaria a leitura do proprio painel.
 */
function detectarOrigem(c: Context<AppBindings>): SyncRunOrigin {
  const declarada = new URL(c.req.url).searchParams.get('origem');
  if (declarada === 'manual') return 'manual';
  if (declarada === 'externo') return 'externo';
  if (declarada === 'vercel') return 'vercel';

  if (c.req.header('x-vercel-cron') !== undefined) return 'vercel';
  if (/^vercel-cron/i.test(c.req.header('user-agent') ?? '')) return 'vercel';
  return 'externo';
}

/**
 * Verificacao das fontes de sincronizacao, em rota propria.
 *
 * A passagem ja acontece dentro do job diario (passo 6 de `executarJob`), que
 * e o que faz a funcionalidade rodar sem mudar plano nem configuracao. Esta
 * rota existe para **cadencia maior**: um agendador externo (cron-job.org e
 * afins) chamando `/api/sync/run` de 6 em 6 horas com o mesmo segredo do job.
 *
 * ## Por que 200, e nao 409, quando ja ha uma passagem rodando
 *
 * Duas chamadas se cruzarem e o funcionamento normal de dois agendadores
 * independentes, nao um erro: a Vercel as 17:47 atrasa um pouco e encontra o
 * cron externo das 18:00. A trava faz o que tem de fazer -- uma passagem so
 * --, e responder 409 encheria o historico do cron-job.org de falhas
 * vermelhas para algo que funcionou como projetado, o que treina o operador
 * a ignorar o alarme. O corpo diz `resultado: "em_andamento"` para quem
 * quiser olhar.
 *
 * Resposta sem segredo nenhum, em nenhum caminho: nem o valor recebido, nem o
 * esperado, nem o cabecalho de onde veio.
 */
export function syncJobRoutes() {
  const app = new Hono<AppBindings>();

  const executar = async (c: Context<AppBindings>) => {
    const ctx = c.get('ctx');
    assertJobSecret(c.req.header('authorization'), ctx.env.BILLING_RECONCILIATION_SECRET);

    // Esta tarefa vigia a outra: confere que a conciliacao de cobranca rodou.
    // Nunca impede a propria execucao.
    await checkReconcileHeartbeat({ db: ctx.db, env: ctx.env, now: ctx.now, monitor: ctx.monitor }).catch(
      () => undefined,
    );

    // Avisos por e-mail sobre a conta. E esta passagem, a da tarde, que cai
    // na janela dos avisos de avaliacao. Nunca lanca.
    await runAccountNotices(ctx);

    const url = new URL(c.req.url);
    const limitParam = Number(url.searchParams.get('limit') ?? '');
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : undefined;

    /**
     * Chave de idempotencia do chamador.
     *
     * Aceita no cabecalho padrao de fato (`idempotency-key`) e tambem em
     * `?chave=`, porque nem todo agendador deixa configurar cabecalho.
     */
    const chave =
      (c.req.header('idempotency-key') ?? url.searchParams.get('chave') ?? '').trim();

    const resultado = await runSchedulerPass(
      { db: ctx.db, fetcher: ctx.siteFetcher, renderer: ctx.renderer, now: ctx.now },
      {
        origin: detectarOrigem(c),
        ...(chave !== '' ? { idempotencyKey: chave } : {}),
        ...(limit !== undefined ? { limit } : {}),
      },
    );

    if (resultado.status === 'em_andamento') {
      return ok(c, {
        resultado: 'em_andamento',
        mensagem: 'Outra passagem já está em andamento. Esta chamada não fez nada.',
        iniciadaEm: resultado.startedAt,
      });
    }

    if (resultado.status === 'duplicada') {
      return ok(c, {
        resultado: 'duplicada',
        mensagem: 'Esta entrega já havia sido processada. Nada foi feito de novo.',
        execucao: resultado.run,
      });
    }

    if (resultado.status === 'falhou') {
      // 503: o chamador pode tentar de novo, e a proxima tentativa nao
      // duplica nada -- a fila ja foi reservada de forma atomica.
      return c.json(
        {
          error: { code: 'unavailable', message: resultado.message },
          execucao: resultado.run,
        },
        503,
      );
    }

    return ok(c, {
      resultado: 'concluida',
      execucao: resultado.run,
      ...resultado.report,
    });
  };

  app.post('/run', executar);
  app.get('/run', executar);

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

  let replayed = 0;
  let report: Awaited<ReturnType<typeof reconcileBilling>>;
  try {
    // 1. Eventos que ficaram pendentes ou falharam: reprocessa antes de
    //    consultar a API, porque muitos deles ja trazem o estado correto.
    const pending = await pendingWebhookEvents(ctx.db, Math.min(limit, 20));
    for (const event of pending) {
      const result = await processWebhookEvent(billingCtx, event);
      if (result.status === 'processed') replayed += 1;
    }

    // 2. Reconciliacao propriamente dita.
    report = await reconcileBilling(billingCtx, { limit });
  } catch (error) {
    // A conciliacao e a rede de seguranca dos pagamentos: se ela cai inteira,
    // alguem precisa saber hoje, e nao quando um cliente reclamar.
    await ctx.monitor.report({
      kind: 'reconcile_failed',
      severity: 'critical',
      message: 'A conciliação diária de cobrança falhou e não terminou.',
      error,
    });
    throw error;
  }
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
  ).catch(async (error: unknown) => {
    console.error('[domains] falha na reverificação:', error instanceof Error ? error.message : error);
    await ctx.monitor.report({
      kind: 'job_failed',
      severity: 'critical',
      message: 'A reverificação diária de domínios falhou.',
      error,
      alertKey: 'job_failed:domains',
    });
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
  const housekeeping = await pruneExpiredRecords(ctx.db, ctx.now()).catch(async (error: unknown) => {
    console.error('[housekeeping] falha:', error instanceof Error ? error.message : error);
    await ctx.monitor.report({
      kind: 'job_failed',
      severity: 'critical',
      message: 'A limpeza diária de registros vencidos falhou.',
      error,
      alertKey: 'job_failed:housekeeping',
    });
    return null;
  });

  // 6. Arquivos que nao sairam do Blob na primeira tentativa. Mesma regra: uma
  //    falha aqui nao derruba o resto do job.
  const limpezaDoBlob = await drenarFilaDoBlob(ctx.db, ctx.blob, ctx.now()).catch(async (error: unknown) => {
    console.error('[blob] falha ao drenar a fila:', error instanceof Error ? error.message : error);
    await ctx.monitor.report({
      kind: 'job_failed',
      severity: 'warning',
      message: 'A limpeza de arquivos pendentes no Blob falhou.',
      error,
      alertKey: 'job_failed:blob_cleanup',
    });
    return null;
  });

  /*
    Desistencia e evento operacional, nao rotina: um arquivo que o provedor
    recusa dez vezes seguidas fica ocupando o balde sem ninguem olhar. Sem
    este alerta, o custo voltaria a crescer em silencio -- que foi o defeito
    que esta fila veio corrigir.
  */
  if (limpezaDoBlob && limpezaDoBlob.desistidas > 0) {
    await ctx.monitor.report({
      kind: 'job_failed',
      severity: 'warning',
      message: `${limpezaDoBlob.desistidas} arquivo(s) no Blob esgotaram as tentativas de remoção.`,
      alertKey: 'blob_cleanup:desistidas',
    });
  }

  if (report.failures.length > 0 || report.divergences.length > 0) {
    // Alerta operacional no log: a origem fica visivel no painel mestre.
    console.warn(
      `[billing] reconciliação com ${report.divergences.length} divergência(s) e `
        + `${report.failures.length} falha(s).`,
    );
  }
  if (report.failures.length > 0) {
    // Falha aqui e, quase sempre, a ValidaPay nao respondendo a uma consulta.
    await ctx.monitor.report({
      kind: 'billing_provider_error',
      severity: 'critical',
      message: 'A conciliação não conseguiu consultar a ValidaPay para parte das assinaturas.',
      context: { falhas: report.failures.length, divergencias: report.divergences.length },
    });
  }

  // Eventos que esgotaram as tentativas automaticas: so uma pessoa resolve.
  const esgotados = await exhaustedWebhookEvents(ctx.db).catch(() => 0);
  if (esgotados > 0) {
    await ctx.monitor.report({
      kind: 'webhook_stuck',
      severity: 'critical',
      message: 'Há eventos de cobrança que falharam repetidamente e aguardam reprocesso manual.',
      context: { eventos: esgotados },
    });
  }

  if (deliveries.exhausted > 0) {
    console.warn(`[webhook] ${deliveries.exhausted} entrega(s) esgotaram as tentativas.`);
  }

  /**
   * 6. Fontes de sincronizacao vencidas.
   *
   * Entra aqui pelo mesmo motivo que as tarefas acima: o plano permite um
   * agendamento, uma vez por dia. E isto que faz a sincronizacao funcionar
   * sem aba aberta e sem servico novo. Falha aqui nao pode impedir a resposta
   * do resto do job -- e, dentro dela, a falha de uma fonte nao afeta as
   * outras (ver `checkOneSource`).
   */
  const syncPass = await runSchedulerPass(
    { db: ctx.db, fetcher: ctx.siteFetcher, renderer: ctx.renderer, now: ctx.now },
    { origin: 'vercel' },
  ).catch(async (error: unknown) => {
    console.error('[sync] falha na passagem agendada:', error instanceof Error ? error.message : error);
    await ctx.monitor.report({
      kind: 'job_failed',
      severity: 'critical',
      message: 'A verificação agendada de sincronização de sites falhou.',
      error,
      alertKey: 'job_failed:sync',
    });
    return null;
  });

  // A reconciliacao responde o relatorio da sincronizacao como sempre; os
  // estados novos (trava e repeticao) nao sao falha e nao tem relatorio.
  const sync = syncPass?.status === 'concluida' ? syncPass.report : null;

  if (sync && sync.budgetExhausted) {
    console.warn(
      `[sync] orçamento de tempo esgotado: ${sync.checked} de ${sync.claimed} fonte(s) verificadas nesta passagem.`,
    );
  }

  // 7. Avisos por e-mail sobre a conta, a partir do estado que a conciliacao
  //    acabou de confirmar. Nunca lanca (ver `runAccountNotices`).
  const notices = await runAccountNotices(ctx, { housekeeping: true });

  // Batimento: a outra tarefa agendada confere que esta terminou (ver
  // `lib/ops/heartbeat.ts`).
  await recordReconcileHeartbeat(
    { db: ctx.db, env: ctx.env, now: ctx.now },
    { falhas: report.failures.length, eventosRetomados: replayed },
  );

  return ok(c, { ...report, deliveries, domains, housekeeping, limpezaDoBlob, sync, notices });
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
