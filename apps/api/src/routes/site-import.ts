import { eq, schema } from '@codeca/database';
import {
  AppError,
  IMPORT_LIMITS,
  checkImportUrl,
  confirmImportSchema,
  isWorkingState,
  reviewImportSchema,
  startImportSchema,
  stripWww,
  type ImportTarget,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { clientIp, ok, parseJsonBody, parseParams } from '../lib/http.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { advanceAnalysis, runLimitReached } from '../lib/import/analyzer.js';
import { createCursor } from '../lib/import/crawler.js';
import { revertImport, runImport } from '../lib/import/importer.js';
import {
  countRecentRuns,
  createRun,
  listRuns,
  loadItems,
  loadLatestRun,
  loadRun,
  loadRunningRun,
  toDetailView,
  toRunView,
  updateItemDecision,
  updateRun,
} from '../lib/import/store.js';
import { requireCapability, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Importacao automatica de sites.
 *
 * ## O ciclo, do ponto de vista da tela
 *
 * 1. `POST .../site-import` -- valida o endereco e abre a analise.
 * 2. `GET .../site-import/:id` -- mostra o progresso **e avanca** a analise um
 *    pedaco. O painel consulta de tempo em tempo para a barra de progresso, e e
 *    essa consulta que empurra o trabalho.
 * 3. `PATCH .../site-import/:id/revisao` -- grava o que o cliente selecionou.
 * 4. `POST .../site-import/:id/confirmar` -- grava o conteudo no painel.
 * 5. `POST .../site-import/:id/desfazer` -- reverte.
 *
 * ## Por que a consulta avanca o trabalho
 *
 * A funcao da Vercel para em 60 s e o plano permite um cron diario, ja usado.
 * Nao ha fila. Em vez de inventar infraestrutura, a analise avanca em fatias
 * dentro da requisicao que o painel ja faria para desenhar o progresso. Sem
 * servico novo, e uma analise interrompida continua de onde parou porque a fila
 * mora no banco.
 *
 * ## Isolamento
 *
 * A empresa e o site vem SEMPRE de `c.get('tenant')`, resolvido pela sessao, e
 * nunca do corpo ou da URL. Toda consulta filtra pelos dois, e a chave
 * estrangeira composta `(site_id, tenant_id)` fecha no banco. Uma analise de
 * outra empresa responde 404 -- nao 403, que confirmaria a existencia dela.
 */

const importParams = z.object({
  tenantId: z.string().uuid(),
  importId: z.string().uuid(),
});

/**
 * Orcamento de tempo de uma fatia dentro de uma requisicao do painel.
 *
 * Menor que o `sliceBudgetMs` do rastreamento: a requisicao ainda precisa
 * gravar o cursor e responder, e uma resposta que estoura o tempo da funcao
 * perderia o progresso daquela fatia inteira.
 */
const SLICE_BUDGET_MS = 15_000;

export function siteImportRoutes() {
  const app = new Hono<AppBindings>();

  // ------------------------------------------------- abrir uma analise
  app.post('/:tenantId/site-import', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const input = await parseJsonBody(c, startImportSchema);

    /**
     * Primeira barreira: a forma do endereco.
     *
     * Antes de qualquer limite e de qualquer gravacao, porque recusar
     * `http://10.0.0.5` nao deveria gastar a cota de ninguem -- e porque o
     * erro de endereco precisa chegar a tela como mensagem util, nao como
     * falha de rede trinta segundos depois.
     */
    const check = checkImportUrl(input.url);
    if (!check.ok) {
      throw AppError.validation(check.message, { fields: { url: check.message } });
    }

    // Duas cotas: por empresa e por IP. Ver `RATE_LIMITS.siteImport`.
    const agora = ctx.now();
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.siteImportIp,
      rateLimitSubjectFromIp(clientIp(c), ctx.env.AUTH_SECRET),
      agora,
    );
    await enforceRateLimit(ctx.db, RATE_LIMITS.siteImport, tenant.tenantId, agora);

    const recentes = await countRecentRuns(ctx.db, {
      tenantId: tenant.tenantId,
      since: new Date(agora.getTime() - 60 * 60 * 1000),
    });
    if (runLimitReached(recentes)) {
      throw AppError.rateLimited(
        `Você já iniciou ${IMPORT_LIMITS.maxRunsPerHour} análises nesta hora. Aguarde um pouco antes de analisar outro endereço.`,
      );
    }

    /**
     * Uma analise por site ao mesmo tempo.
     *
     * Duas filas sobre o mesmo site gerariam candidatos em duplicidade e duas
     * listas de revisao concorrentes para o mesmo conteudo.
     */
    const emAndamento = await loadRunningRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
    });
    if (emAndamento) {
      throw AppError.conflict(
        'Já existe uma análise em andamento para este site. Aguarde o fim dela ou cancele antes de começar outra.',
        { importId: emAndamento.id },
      );
    }

    const importId = await createRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      sourceUrl: check.url,
      sourceHost: stripWww(check.hostname),
      userId: session.user.id,
      cursor: createCursor(check.url),
      now: agora,
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteImportStarted,
      entityType: 'site_import',
      entityId: importId,
      // So o endereco: nenhum conteudo do site analisado entra na trilha.
      metadata: { sourceUrl: check.url },
    });

    const run = await loadRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
    });
    if (!run) throw AppError.internal('Não foi possível abrir a análise.');

    return ok(c, { run: toRunView(run, session.user.name) }, 201);
  });

  // ------------------------------- estado atual (e avanco de uma fatia)
  app.get('/:tenantId/site-import/:importId', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { importId } = parseParams(c, importParams);

    let run = await loadRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
    });
    // 404, nao 403: uma analise de outra empresa nao deve ter a existencia
    // confirmada por uma resposta diferente.
    if (!run) throw AppError.notFound('Análise não encontrada.');

    /**
     * O avanco acontece nesta leitura, nao numa rota propria.
     *
     * Exige `content:write`: quem so le o painel nao dispara requisicoes ao
     * site de um terceiro. Um `viewer` continua vendo o progresso -- ele
     * simplesmente nao o empurra.
     */
    if (isWorkingState(run.state) && run.cursor !== null) {
      const podeAvancar = tenant.capabilities.has('content:write');
      if (podeAvancar) {
        try {
          const resultado = await advanceAnalysis(
            {
              db: ctx.db,
              fetcher: ctx.siteFetcher,
              renderer: ctx.renderer,
              now: ctx.now,
              tenantId: tenant.tenantId,
              siteId: tenant.siteId,
            },
            run,
            { budgetMs: SLICE_BUDGET_MS },
          );
          run = resultado.run;
        } catch (error) {
          /**
           * Falha na analise nao derruba a tela.
           *
           * A analise passa a `erro` com uma mensagem em portugues, e a pessoa
           * ve o que aconteceu em vez de uma tela de erro genérica sobre um
           * trabalho que estava em andamento. O detalhe tecnico fica no log.
           */
          console.error(
            '[site-import] falha ao avancar a analise',
            importId,
            error instanceof Error ? error.message : error,
          );
          const mensagem =
            error instanceof AppError
              ? error.message
              : 'Não foi possível concluir a análise deste site.';
          await updateRun(ctx.db, {
            tenantId: tenant.tenantId,
            siteId: tenant.siteId,
            importId,
            state: 'erro',
            message: mensagem,
            cursor: null,
            finishedAt: ctx.now(),
            now: ctx.now(),
          });
          run =
            (await loadRun(ctx.db, { tenantId: tenant.tenantId, siteId: tenant.siteId, importId }))
            ?? run;
        }
      }
    }

    const items = await loadItems(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
    });

    return ok(c, { run: toDetailView(run, items, await authorName(ctx.db, run.requestedByUserId)) });
  });

  // --------------------------------------------- a analise mais recente
  app.get('/:tenantId/site-import', requireCapability('content:read'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');

    const latest = await loadLatestRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
    });
    const history = await listRuns(ctx.db, { tenantId: tenant.tenantId, siteId: tenant.siteId });

    return ok(c, {
      latest: latest ? toRunView(latest, await authorName(ctx.db, latest.requestedByUserId)) : null,
      history: history.map((run) => toRunView(run)),
      limits: {
        maxPages: IMPORT_LIMITS.maxPages,
        maxImages: IMPORT_LIMITS.maxImages,
        maxDepth: IMPORT_LIMITS.maxDepth,
        maxRunsPerHour: IMPORT_LIMITS.maxRunsPerHour,
      },
    });
  });

  // ----------------------------------------------------------- revisao
  app.patch('/:tenantId/site-import/:importId/revisao', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { importId } = parseParams(c, importParams);
    const input = await parseJsonBody(c, reviewImportSchema);

    const run = await loadRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
    });
    if (!run) throw AppError.notFound('Análise não encontrada.');
    if (run.state !== 'analisada') {
      throw AppError.conflict(
        'Esta análise não está aguardando revisão.',
        { state: run.state },
      );
    }

    const agora = ctx.now();
    let aplicadas = 0;
    for (const decisao of input.items) {
      const ok = await updateItemDecision(ctx.db, {
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        importId,
        itemId: decisao.itemId,
        decision: decisao.decision,
        ...(decisao.resolution !== undefined ? { resolution: decisao.resolution } : {}),
        now: agora,
      });
      if (ok) aplicadas += 1;
    }

    const items = await loadItems(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
    });

    return ok(c, { applied: aplicadas, run: toDetailView(run, items) });
  });

  // --------------------------------------------------------- confirmar
  app.post('/:tenantId/site-import/:importId/confirmar', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const { importId } = parseParams(c, importParams);
    const input = await parseJsonBody(c, confirmImportSchema);

    const run = await loadRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
    });
    if (!run) throw AppError.notFound('Análise não encontrada.');

    /**
     * Confirmar duas vezes criaria tudo duas vezes.
     *
     * O estado e a trava: so `analisada` pode ser confirmada. Um clique duplo
     * na tela, ou um reenvio do formulario, para aqui.
     */
    if (run.state !== 'analisada') {
      throw AppError.conflict(
        run.state === 'importada'
          ? 'Esta análise já foi importada.'
          : 'Esta análise não está pronta para ser importada.',
        { state: run.state },
      );
    }

    const result = await runImport(
      {
        db: ctx.db,
        blob: ctx.blob,
        fetcher: ctx.siteFetcher,
        now: ctx.now,
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        userId: session.user.id,
      },
      { run, targets: input.targets as ImportTarget[] },
    );

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteImportConfirmed,
      entityType: 'site_import',
      entityId: importId,
      metadata: {
        sourceUrl: run.sourceUrl,
        imported: result.imported,
        failed: result.failed,
        skipped: result.skipped,
        mediaCreated: result.mediaCreated,
        targets: input.targets,
      },
    });

    const [atualizada, items] = await Promise.all([
      loadRun(ctx.db, { tenantId: tenant.tenantId, siteId: tenant.siteId, importId }),
      loadItems(ctx.db, { tenantId: tenant.tenantId, siteId: tenant.siteId, importId }),
    ]);

    return ok(c, { result, run: toDetailView(atualizada ?? run, items) });
  });

  // ----------------------------------------------------------- desfazer
  app.post('/:tenantId/site-import/:importId/desfazer', requireCapability('content:delete'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const session = sessionOf(c);
    const { importId } = parseParams(c, importParams);

    const run = await loadRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
    });
    if (!run) throw AppError.notFound('Análise não encontrada.');
    if (run.state !== 'importada') {
      throw AppError.conflict(
        run.state === 'revertida'
          ? 'Esta importação já foi desfeita.'
          : 'Só é possível desfazer uma importação que foi concluída.',
        { state: run.state },
      );
    }

    const { reverted, failed } = await revertImport(
      {
        db: ctx.db,
        blob: ctx.blob,
        fetcher: ctx.siteFetcher,
        now: ctx.now,
        tenantId: tenant.tenantId,
        siteId: tenant.siteId,
        userId: session.user.id,
      },
      { run },
    );

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteImportReverted,
      entityType: 'site_import',
      entityId: importId,
      metadata: { sourceUrl: run.sourceUrl, reverted, failed },
    });

    const atualizada = await loadRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
    });
    const items = await loadItems(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
    });

    return ok(c, {
      reverted,
      failed,
      run: toDetailView(atualizada ?? run, items),
    });
  });

  // ------------------------------------------------------------ cancelar
  app.post('/:tenantId/site-import/:importId/cancelar', requireCapability('content:write'), async (c) => {
    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const { importId } = parseParams(c, importParams);

    const run = await loadRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
    });
    if (!run) throw AppError.notFound('Análise não encontrada.');

    /**
     * Cancelar vale para analise em andamento **e** para analise aguardando
     * revisao: a segunda e o caso de "analisei o endereco errado", e deixar
     * essa analise parada bloquearia a abertura de outra para o mesmo site.
     */
    if (!isWorkingState(run.state) && run.state !== 'analisada') {
      throw AppError.conflict('Esta análise não pode ser cancelada.', { state: run.state });
    }

    const agora = ctx.now();
    await updateRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
      state: 'erro',
      message: 'Análise cancelada.',
      cursor: null,
      finishedAt: agora,
      now: agora,
    });

    const atualizada = await loadRun(ctx.db, {
      tenantId: tenant.tenantId,
      siteId: tenant.siteId,
      importId,
    });
    return ok(c, { run: toRunView(atualizada ?? run) });
  });

  return app;
}

/** Nome de quem pediu a analise, para a tela mostrar na linha do historico. */
async function authorName(
  db: Parameters<typeof loadRun>[0],
  userId: string | null,
): Promise<string> {
  if (userId === null) return '';
  const [row] = await db
    .select({ name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return row?.name ?? '';
}
