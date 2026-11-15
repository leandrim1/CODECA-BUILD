import { isTransientDbError } from '@codeca/database';
import { AppError, isAppError } from '@codeca/shared';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { ZodError } from 'zod';
import type { AppBindings } from '../types.js';
import { validationError } from '../lib/http.js';

/**
 * Tratamento padronizado de erros.
 *
 * Erros esperados viram respostas com codigo estavel e mensagem segura. Erros
 * inesperados sao registrados com um identificador de requisicao e devolvem uma
 * mensagem generica, sem stack trace nem detalhe de infraestrutura.
 */

export const errorHandler: ErrorHandler<AppBindings> = (error, c) => {
  if (isAppError(error)) {
    return respond(c, error, error.status);
  }

  if (error instanceof ZodError) {
    const appError = validationError(error);
    return respond(c, appError, appError.status);
  }

  const requestId = c.get('requestId') ?? 'sem-id';

  // Banco indisponivel ou saturado: 503 + Retry-After (repetir e correto), nao
  // 500 (que parece defeito). A causa vai para o log, nunca para a resposta.
  if (isTransientDbError(error)) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'db_unavailable',
        requestId,
        route: c.req.routePath,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    void c.get('ctx')?.monitor.report({
      kind: 'db_unavailable',
      severity: 'critical',
      message: 'O banco de dados não respondeu a uma requisição.',
      context: { requestId, route: c.req.routePath, method: c.req.method },
      error,
    });
    const retryAfter = 1 + Math.floor(Math.random() * 3);
    const unavailable = AppError.unavailable(
      'O serviço está momentaneamente indisponível. Tente novamente em instantes.',
      retryAfter,
    );
    return respond(c, unavailable, unavailable.status);
  }

  console.error(
    `[api:error] requestId=${requestId} ${c.req.method} ${new URL(c.req.url).pathname}`,
    error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : error,
  );

  // Erro que ninguem previu: e o que mais interessa a quem opera. Agrupado por
  // rota, para um defeito numa tela nao esconder o de outra.
  void c.get('ctx')?.monitor.report({
    kind: 'api_error',
    severity: 'critical',
    message: 'Erro inesperado na API.',
    context: { requestId, route: c.req.routePath, method: c.req.method },
    error,
    alertKey: `api_error:${c.req.method}:${c.req.routePath}`,
  });

  const generic = AppError.internal(
    'Ocorreu um erro inesperado. Tente novamente; se persistir, informe o código da requisição.',
  );
  return c.json({ error: { ...generic.toBody().error, requestId } }, 500);
};

export const notFoundHandler: NotFoundHandler<AppBindings> = (c) =>
  c.json(AppError.notFound('Endpoint não encontrado.').toBody(), 404);

function respond(c: Context<AppBindings>, error: AppError, status: number) {
  if (error.code === 'rate_limited' || error.code === 'service_unavailable') {
    const retry = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    if (retry) c.header('retry-after', String(retry));
  }
  return c.json(error.toBody(), status as 400);
}
