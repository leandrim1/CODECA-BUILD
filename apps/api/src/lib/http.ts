import { AppError, isAppError } from '@codeca/shared';
import type { Context } from 'hono';
import { z } from 'zod';

/** Utilitarios de requisicao e resposta compartilhados pelas rotas. */

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json({ data }, status as 200);
}

export function created<T>(c: Context, data: T) {
  return c.json({ data }, 201);
}

export function noContent(c: Context) {
  return c.body(null, 204);
}

/** Converte um ZodError em um AppError 422 com detalhes por campo. */
export function validationError(error: z.ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return AppError.validation('Alguns campos precisam ser corrigidos.', { fields });
}

export async function parseJsonBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw AppError.badRequest('Corpo da requisicao deve ser um JSON valido.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function parseParams<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  const result = schema.safeParse(c.req.param());
  if (!result.success) throw AppError.notFound('Endereco invalido.');
  return result.data;
}

/** IP do cliente considerando os cabecalhos de proxy da Vercel. */
export function clientIp(c: Context): string {
  const headers = c.req.raw.headers;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? headers.get('cf-connecting-ip') ?? '';
}

export function userAgent(c: Context): string {
  return (c.req.header('user-agent') ?? '').slice(0, 300);
}

/** Host da requisicao, sem porta e em minusculas. */
export function requestHost(c: Context): string {
  const header = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '';
  return header.toLowerCase().split(':')[0] ?? '';
}

export function requestOrigin(c: Context): string {
  const proto = c.req.header('x-forwarded-proto') ?? 'https';
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '';
  return host ? `${proto}://${host}` : '';
}

export { AppError, isAppError };
