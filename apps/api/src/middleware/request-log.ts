import { runWithQueryStats } from '@codeca/database';
import type { MiddlewareHandler } from 'hono';
import { recordRequest, runtimeMetrics } from '../lib/runtime-metrics.js';
import type { AppBindings } from '../types.js';

/**
 * Log estruturado e medicao por requisicao.
 *
 * Uma linha JSON por requisicao **que merece atencao**: erro de servidor ou
 * mais lenta que `slowMs`. As demais nao geram linha -- em carga, uma linha
 * por requisicao e custo de I/O e de armazenamento de log sem informacao nova;
 * os contadores em `runtime-metrics` as cobrem. `all: true` registra todas.
 *
 * Nunca registra corpo, cabecalhos, cookies, query string ou token: apenas o
 * caminho da rota (com o padrao, nao os identificadores), o status, o tempo e o
 * custo no banco.
 */
export function requestLog(options: { slowMs?: number; all?: boolean } = {}): MiddlewareHandler<AppBindings> {
  const slowMs = options.slowMs ?? 1000;
  return async (c, next) => {
    const start = performance.now();
    await runWithQueryStats(async (stats) => {
      try {
        await next();
      } finally {
        const ms = performance.now() - start;
        const status = c.res.status;
        recordRequest(status, ms);
        c.res.headers.set('x-request-id', c.get('requestId'));
        // Server-Timing aparece nas ferramentas do navegador e nos testes de carga.
        c.res.headers.append('server-timing', `app;dur=${ms.toFixed(1)}, db;dur=${stats.totalMs.toFixed(1)};desc="${stats.count} queries"`);
        // 503 recusado por sobrecarga: uma linha por recusa, justamente durante a
        // sobrecarga, agravaria o problema. Registra 1 a cada 50 (o contador
        // `shed` em /api/metrics tem o total exato).
        const sampledOut = status === 503 && runtimeMetrics.total % 50 !== 0;
        if (!sampledOut && (options.all || status >= 500 || ms >= slowMs)) {
          console.log(
            JSON.stringify({
              level: status >= 500 ? 'error' : 'warn',
              event: status >= 500 ? 'request_error' : 'slow_request',
              requestId: c.get('requestId'),
              method: c.req.method,
              route: c.req.routePath,
              status,
              ms: Math.round(ms),
              queries: stats.count,
              dbMs: Math.round(stats.totalMs),
              slowestQuery: stats.slowest,
              inflight: runtimeMetrics.inflight,
            }),
          );
        }
      }
    });
  };
}
