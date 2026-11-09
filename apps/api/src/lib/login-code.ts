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

  /*
   * Intervalo minimo entre pedidos. Vale igual para qualquer e-mail, exista
   * conta ou nao.
   *
   * So conta o ultimo codigo que AINDA SERVE (nao usado e nao vencido). Olhar o
   * ultimo codigo qualquer tem uma consequencia ruim: quem entra, sai e entra de
   * novo dentro de 60 s nao recebe codigo novo -- porque existe um "recente" --
   * e o recente ja foi consumido na primeira entrada. A pessoa ficaria presa por
   * um minuto vendo "codigo incorreto" sem nada ter chegado.
   *
   * O intervalo existe para nao enviar dois codigos enquanto um vale; sem codigo
   * valendo, enviar e justamente o certo. A cota por e-mail (5 por hora) segue
   * sendo o que limita o volume.
   */
  const [latest] = await db
    .select({ createdAt: schema.loginCodes.createdAt })
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

// -------------------------------------------- comprovante da 1a etapa

/**
 * Comprovante da etapa em andamento do login.
 *
 * Vai em cookie HttpOnly assinado (nada em `localStorage`, nada que o JavaScript
 * da pagina leia). O e-mail, o usuario e o destino saem DAQUI, nunca do corpo da
 * requisicao -- senao bastaria trocar o e-mail no corpo para usar o codigo de
 * outra pessoa.
 *
 * Tres caminhos emitem o comprovante, e e `method` que os distingue:
 * `password` e `google` depois de vencida a primeira etapa, e `email` no login
 * so com o e-mail, em que o codigo E a autenticacao.
 */
export const LOGIN_PENDING_COOKIE = 'codeca_login_pending';
export const LOGIN_PENDING_COOKIE_PATH = '/api/auth/code';
export const LOGIN_PENDING_TTL_MINUTES = 15;

export interface PendingLogin {
  email: string;
  /**
   * Conta a que o codigo se refere, ou vazio quando NAO existe conta com este
   * e-mail (`method: 'email'`).
   *
   * O vazio e o que permite a rota publica responder igual exista ou nao a
   * conta, sem revelar cadastro: o codigo e emitido do mesmo jeito, mas a
   * validacao nao encontra usuario e para no mesmo erro de codigo invalido.
   */
  userId: string;
  /** Qual caminho emitiu o comprovante. */
  method: 'password' | 'google' | 'email';
  /** "Manter conectado" marcado na primeira etapa. */
  rememberMe: boolean;
  /** Destino depois de entrar (ja validado como caminho interno). */
  next: string;
}

const sign = (env: Env, payload: string) =>
  createHmac('sha256', env.AUTH_SECRET).update(`login-pending:${payload}`).digest('base64url');

export function createPendingLogin(env: Env, pending: PendingLogin, now: Date): string {
  const payload = Buffer.from(
    JSON.stringify({ ...pending, x: now.getTime() + LOGIN_PENDING_TTL_MINUTES * 60_000 }),
  ).toString('base64url');
  return `${payload}.${sign(env, payload)}`;
}

/** O comprovante, ou `null` se e falso, adulterado ou venceu. */
export function readPendingLogin(env: Env, value: string | null | undefined, now: Date): PendingLogin | null {
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature || !constantTimeEquals(signature, sign(env, payload))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (
      typeof p.email !== 'string' ||
      typeof p.userId !== 'string' ||
      (p.method !== 'password' && p.method !== 'google' && p.method !== 'email') ||
      typeof p.rememberMe !== 'boolean' ||
      typeof p.next !== 'string' ||
      typeof p.x !== 'number' ||
      p.x < now.getTime()
    ) {
      return null;
    }
    return { email: p.email, userId: p.userId, method: p.method, rememberMe: p.rememberMe, next: p.next };
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
