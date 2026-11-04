/**
 * Contadores do processo, para o endpoint de metricas e para o log.
 *
 * Por instancia, em memoria: servem para ler a saude de UMA funcao (quantas
 * requisicoes em andamento, quantas recusadas, latencia recente). Em serverless
 * cada instancia tem o seu; o painel de observabilidade da Vercel agrega.
 */

const WINDOW = 500;

export const runtimeMetrics = {
  startedAt: Date.now(),
  inflight: 0,
  peakInflight: 0,
  total: 0,
  status2xx: 0,
  status4xx: 0,
  status5xx: 0,
  shed: 0,
  /** Duracao (ms) das ultimas requisicoes, em anel. */
  recent: [] as number[],
  cursor: 0,
};

export function recordRequest(status: number, ms: number): void {
  runtimeMetrics.total += 1;
  if (status >= 500) runtimeMetrics.status5xx += 1;
  else if (status >= 400) runtimeMetrics.status4xx += 1;
  else runtimeMetrics.status2xx += 1;
  if (runtimeMetrics.recent.length < WINDOW) runtimeMetrics.recent.push(ms);
  else {
    runtimeMetrics.recent[runtimeMetrics.cursor] = ms;
    runtimeMetrics.cursor = (runtimeMetrics.cursor + 1) % WINDOW;
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)] ?? 0);
}

export function snapshotMetrics() {
  const m = runtimeMetrics;
  const mem = process.memoryUsage();
  return {
    uptimeSeconds: Math.round((Date.now() - m.startedAt) / 1000),
    inflight: m.inflight,
    peakInflight: m.peakInflight,
    requests: { total: m.total, ok: m.status2xx, clientError: m.status4xx, serverError: m.status5xx, shed: m.shed },
    latencyMs: { p50: percentile(m.recent, 50), p95: percentile(m.recent, 95), p99: percentile(m.recent, 99), samples: m.recent.length },
    memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
  };
}
