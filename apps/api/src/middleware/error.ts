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
  console.error(
    `[api:error] requestId=${requestId} ${c.req.method} ${new URL(c.req.url).pathname}`,
    error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : error,
  );

  const generic = AppError.internal(
    'Ocorreu um erro inesperado. Tente novamente; se persistir, informe o codigo da requisicao.',
  );
  return c.json({ error: { ...generic.toBody().error, requestId } }, 500);
};

export const notFoundHandler: NotFoundHandler<AppBindings> = (c) =>
  c.json(AppError.notFound('Endpoint nao encontrado.').toBody(), 404);

function respond(c: Context<AppBindings>, error: AppError, status: number) {
  if (error.code === 'rate_limited') {
    const retry = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    if (retry) c.header('retry-after', String(retry));
  }
  return c.json(error.toBody(), status as 400);
}
