import { and, desc, eq, gt, isNull, lt, schema, sql, type Database } from '@codeca/database';
import {
  LOGIN_CODE_LENGTH,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
} from '@codeca/shared';
import { constantTimeEquals } from '@codeca/shared/server';
import { createHmac, randomInt } from 'node:crypto';
import type { Env } from '../env.js';

/**
 * Codigo de acesso por e-mail: 6 digitos, 10 minutos, uso unico.
 *
 * ## Por que o hash leva o segredo do servidor
 *
 * Seis digitos sao um milhao de possibilidades. Um SHA-256 puro seria quebrado
 * por quem lesse a tabela em milissegundos; com HMAC e `AUTH_SECRET`, um
 * vazamento so do banco nao entrega codigo nenhum. O e-mail entra no calculo
 * para um codigo nao valer para outro endereco.
 *
 * ## Como a forca bruta e contida (tres camadas)
 *
 * 1. cinco tentativas por codigo -- a contagem e feita **antes** da conferencia,
 *    num UPDATE condicional, entao tentativas simultaneas tambem contam;
 * 2. cota de validacoes por e-mail e por IP (ver `RATE_LIMITS`);
 * 3. cota de pedidos de codigo novo, que limita quantos codigos (e portanto
 *    quantas rodadas de cinco tentativas) existem por hora.
 */

/** Codigo aleatorio de 6 digitos, de fonte criptografica (nunca `Math.random`). */
export function generateLoginCode(): string {
  return String(randomInt(0, 10 ** LOGIN_CODE_LENGTH)).padStart(LOGIN_CODE_LENGTH, '0');
}

export function hashLoginCode(env: Env, email: string, code: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(`login-code:${email}:${code}`).digest('hex');
}

export type IssueResult =
  | { ok: true; code: string; id: string; expiresAt: Date }
  /** Pedido cedo demais: devolve quanto falta para poder pedir de novo. */
  | { ok: false; retryAfterSeconds: number };

export async function issueLoginCode(
  db: Database,
  env: Env,
  input: { email: string; ipHash: string; now: Date },
): Promise<IssueResult> {
  const { email, now } = input;

  // Limpeza oportunista: sem tarefa agendada, cada pedido apaga o que venceu ha mais de um dia.
  await db.delete(schema.loginCodes).where(lt(schema.loginCodes.expiresAt, new Date(now.getTime() - 24 * 3600_000)));

  // Intervalo minimo entre pedidos. Vale igual para qualquer e-mail, exista conta ou nao.
  const [latest] = await db
    .select({ createdAt: schema.loginCodes.createdAt })
    .from(schema.loginCodes)
    .where(eq(schema.loginCodes.email, email))
    .orderBy(desc(schema.loginCodes.createdAt))
    .limit(1);
  if (latest) {
    const elapsed = (now.getTime() - latest.createdAt.getTime()) / 1000;
    if (elapsed < LOGIN_CODE_RESEND_SECONDS) {
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(LOGIN_CODE_RESEND_SECONDS - elapsed)) };
    }
  }

  // Um codigo novo invalida os anteriores: so o ultimo enviado vale.
  await db
    .update(schema.loginCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.loginCodes.email, email), isNull(schema.loginCodes.usedAt)));

  const code = generateLoginCode();
  const expiresAt = new Date(now.getTime() + LOGIN_CODE_TTL_MINUTES * 60_000);
  const [row] = await db
    .insert(schema.loginCodes)
    .values({
      email,
      codeHash: hashLoginCode(env, email, code),
      expiresAt,
      requestIpHash: input.ipHash,
      createdAt: now,
    })
    .returning({ id: schema.loginCodes.id });

  return { ok: true, code, id: row!.id, expiresAt };
}

/** Desfaz um codigo cujo e-mail nao saiu: ninguem o recebeu, nao pode ficar valendo. */
export async function discardLoginCode(db: Database, id: string): Promise<void> {
  await db.delete(schema.loginCodes).where(eq(schema.loginCodes.id, id));
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'invalid' | 'exhausted' };

export async function verifyLoginCode(
  db: Database,
  env: Env,
  input: { email: string; code: string; now: Date },
): Promise<VerifyResult> {
  const { email, code, now } = input;

  const [active] = await db
    .select()
    .from(schema.loginCodes)
    .where(
      and(
        eq(schema.loginCodes.email, email),
        isNull(schema.loginCodes.usedAt),
        gt(schema.loginCodes.expiresAt, now),
      ),
    )
    .orderBy(desc(schema.loginCodes.createdAt))
    .limit(1);

  const candidate = hashLoginCode(env, email, code);

  if (!active) {
    // Mesmo trabalho de quando existe codigo: a resposta nao denuncia a diferenca.
    constantTimeEquals(candidate, candidate);
    return { ok: false, reason: 'invalid' };
  }

  // A tentativa e contada ANTES de conferir, de forma atomica: varias requisicoes
  // simultaneas nao conseguem passar de MAX conferencias no total.
  const [claimed] = await db
    .update(schema.loginCodes)
    .set({ attempts: sql`${schema.loginCodes.attempts} + 1` })
    .where(
      and(
        eq(schema.loginCodes.id, active.id),
        isNull(schema.loginCodes.usedAt),
        lt(schema.loginCodes.attempts, LOGIN_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning({ attempts: schema.loginCodes.attempts, codeHash: schema.loginCodes.codeHash });
  if (!claimed) return { ok: false, reason: 'exhausted' };

  if (!constantTimeEquals(candidate, claimed.codeHash)) {
    if (claimed.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
      // Errou a ultima tentativa: o codigo morre, mesmo que ainda nao tenha vencido.
      await db.update(schema.loginCodes).set({ usedAt: now }).where(eq(schema.loginCodes.id, active.id));
      return { ok: false, reason: 'exhausted' };
    }
    return { ok: false, reason: 'invalid' };
  }

  // Uso unico: o UPDATE condicional so devolve linha para UMA das requisicoes.
  const [consumed] = await db
    .update(schema.loginCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.loginCodes.id, active.id), isNull(schema.loginCodes.usedAt)))
    .returning({ id: schema.loginCodes.id });
  return consumed ? { ok: true } : { ok: false, reason: 'invalid' };
}

// ------------------------------------------------- comprovante de e-mail

/**
 * Comprovante de que um e-mail NOVO acertou o codigo, para concluir o cadastro.
 *
 * Vai num cookie HttpOnly assinado (nada em `localStorage`, nada que o
 * JavaScript da pagina consiga ler). O e-mail do cadastro sai DAQUI, nunca do
 * corpo da requisicao: ninguem cadastra um endereco que nao provou.
 */
export const SIGNUP_PROOF_COOKIE = 'codeca_signup_proof';
export const SIGNUP_PROOF_COOKIE_PATH = '/api/auth/code';
export const SIGNUP_PROOF_TTL_MINUTES = 20;

const sign = (env: Env, payload: string) =>
  createHmac('sha256', env.AUTH_SECRET).update(`signup-proof:${payload}`).digest('base64url');

export function createSignupProof(env: Env, email: string, now: Date): string {
  const payload = Buffer.from(
    JSON.stringify({ e: email, x: now.getTime() + SIGNUP_PROOF_TTL_MINUTES * 60_000 }),
  ).toString('base64url');
  return `${payload}.${sign(env, payload)}`;
}

/** O e-mail provado, ou `null` se o comprovante e falso, adulterado ou venceu. */
export function readSignupProof(env: Env, value: string | null | undefined, now: Date): string | null {
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature || !constantTimeEquals(signature, sign(env, payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { e?: unknown; x?: unknown };
    if (typeof parsed.e !== 'string' || typeof parsed.x !== 'number' || parsed.x < now.getTime()) return null;
    return parsed.e;
  } catch {
    return null;
  }
}

/** Texto do e-mail. Fixo, como especificado: o unico dado variavel e o codigo. */
export function loginCodeMessage(code: string): { subject: string; text: string } {
  return {
    subject: 'Seu código de acesso ao CODECA Build',
    text:
      'Olá!\n\n'
      + 'Você solicitou um código para acessar sua conta no CODECA Build.\n\n'
      + 'Seu código de verificação é:\n\n'
      + `${code}\n\n`
      + `Esse código expira em ${LOGIN_CODE_TTL_MINUTES} minutos e só pode ser utilizado uma vez.\n\n`
      + 'Se você não solicitou esse acesso, ignore esta mensagem.\n\n'
      + 'CODECA Build\n'
      + 'Tecnologia desenvolvida pela CODECA IA.\n',
  };
}
