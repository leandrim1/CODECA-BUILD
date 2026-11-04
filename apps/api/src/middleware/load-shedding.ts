import { AppError } from '@codeca/shared';
import type { MiddlewareHandler } from 'hono';
import { runtimeMetrics } from '../lib/runtime-metrics.js';
import type { AppBindings } from '../types.js';

/**
 * Protecao contra sobrecarga ("load shedding" / backpressure).
 *
 * Uma instancia que aceita mais trabalho do que consegue fazer nao fica mais
 * rapida: enfileira, todas as requisicoes passam a demorar, o navegador desiste
 * e repete -- e a fila cresce. Medido neste projeto: com 500 usuarios
 * simultaneos sem limite, o p95 foi de 4,3 s para TODOS.
 *
 * Acima de `max` requisicoes em andamento, a instancia recusa a nova na hora
 * com 503 + `Retry-After` curto (e sorteado, para os clientes nao voltarem
 * juntos). Quem entrou continua sendo atendido com latencia normal; quem foi
 * recusado tenta de novo em instantes (o painel ja repete GETs).
 *
 * Fica de fora: `/health` (o monitor precisa responder justamente sob carga) e
 * o webhook de pagamento (perder um evento custa dinheiro; ele ja e gravado de
 * forma duravel e deduplicado).
 *
 * `max = 0` desliga.
 */
const EXEMPT = [/\/health$/, /\/webhooks\//];

export function loadShedding(max: number): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const exempt = EXEMPT.some((pattern) => pattern.test(c.req.path));
    if (max > 0 && !exempt && runtimeMetrics.inflight >= max) {
      runtimeMetrics.shed += 1;
      const retryAfter = 1 + Math.floor(Math.random() * 3);
      throw AppError.unavailable('Estamos com muitos acessos neste momento. Tente novamente em instantes.', retryAfter);
    }
    runtimeMetrics.inflight += 1;
    if (runtimeMetrics.inflight > runtimeMetrics.peakInflight) runtimeMetrics.peakInflight = runtimeMetrics.inflight;
    try {
      await next();
    } finally {
      runtimeMetrics.inflight -= 1;
    }
  };
}
