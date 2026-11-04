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
    throw AppError.badRequest('Corpo da requisição deve ser um JSON válido.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

/**
 * Igual a `parseJsonBody`, mas devolve tambem o corpo como chegou.
 *
 * A politica de campos precisa saber o que o **cliente** mandou, nao o que o
 * schema preencheu: um campo travado com valor padrao (a moeda de um imovel,
 * por exemplo) apareceria como alteracao do cliente e recusaria toda criacao.
 */
export async function parseJsonBodyWithRaw<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<{ data: z.output<T>; raw: Record<string, unknown> }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw AppError.badRequest('Corpo da requisição deve ser um JSON válido.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationError(result.error);
  return {
    data: result.data,
    raw: raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {},
  };
}

/**
 * Atualizacao parcial (PATCH): so vale o que o cliente ENVIOU.
 *
 * `schema.partial()` do zod torna os campos opcionais, mas **continua aplicando
 * os `.default()`**: um PATCH `{ "title": "x" }` chegava ao codigo com
 * `publicationStatus: 'draft'`, `commercialStatus: 'disponivel'` etc. e
 * despublicava o imovel em silencio. Foi encontrado pelo teste de carga (404 na
 * API publica de um imovel que ninguem despublicou).
 *
 * Aqui o corpo e validado pelo schema e, depois, so ficam as chaves presentes no
 * corpo original. Campos ausentes nao sao tocados.
 */
export function onlySentKeys<T extends Record<string, unknown>>(data: T, raw: Record<string, unknown>): T {
  const sent = {} as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) sent[key] = data[key];
  }
  return sent as T;
}

export async function parseJsonPatchWithRaw<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<{ data: z.output<T>; raw: Record<string, unknown> }> {
  const { data, raw } = await parseJsonBodyWithRaw(c, schema);
  return { data: onlySentKeys(data as Record<string, unknown>, raw) as z.output<T>, raw };
}

export async function parseJsonPatch<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  return (await parseJsonPatchWithRaw(c, schema)).data;
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function parseParams<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  const result = schema.safeParse(c.req.param());
  if (!result.success) throw AppError.notFound('Endereço inválido.');
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
