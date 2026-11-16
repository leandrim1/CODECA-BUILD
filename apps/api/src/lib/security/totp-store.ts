import { and, eq, isNull, schema, type Database } from '@codeca/database';
import { AppError } from '@codeca/shared';
import type { Env } from '../../env.js';
import { decryptSecret, encryptSecret } from '../secret-box.js';
import {
  generateRecoveryCode,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  RECOVERY_CODE_COUNT,
  totpEncryptionKey,
  verifyTotp,
} from './totp.js';

/**
 * Guarda e confere o segundo fator de uma conta.
 *
 * Tres regras que o resto do sistema pode assumir:
 *
 * 1. **Segredo cifrado.** Nunca sai daqui em texto, nunca vai para log, nunca
 *    aparece em resposta -- exceto no instante da configuracao, uma vez.
 * 2. **`confirmedAt` manda.** Enquanto for nulo, o segundo fator nao existe
 *    para o login: alguem que comece a configurar e desista nao fica trancado.
 * 3. **Codigo nao se repete.** `lastStep` grava o passo aceito; o mesmo codigo
 *    nao entra duas vezes.
 */

export interface TotpContext {
  db: Database;
  env: Env;
  now: () => Date;
}

const chave = (env: Env) => totpEncryptionKey(env.AUTH_SECRET);
/** O proprio usuario e o dado associado: o segredo de um nao serve no outro. */
const aad = (userId: string) => `totp:${userId}`;

export interface TotpState {
  /** Ha segredo confirmado: o login vai pedir o codigo. */
  enabled: boolean;
  /** Ha segredo guardado ainda sem confirmacao. */
  pending: boolean;
  confirmedAt: Date | null;
  /** Quantos codigos de recuperacao ainda nao foram usados. */
  recoveryCodesLeft: number;
}

export async function totpState(db: Database, userId: string): Promise<TotpState> {
  const [linha] = await db
    .select({ confirmedAt: schema.userTotp.confirmedAt })
    .from(schema.userTotp)
    .where(eq(schema.userTotp.userId, userId));
  if (!linha) return { enabled: false, pending: false, confirmedAt: null, recoveryCodesLeft: 0 };

  const restantes = await db
    .select({ id: schema.userRecoveryCodes.id })
    .from(schema.userRecoveryCodes)
    .where(and(eq(schema.userRecoveryCodes.userId, userId), isNull(schema.userRecoveryCodes.usedAt)));

  return {
    enabled: linha.confirmedAt !== null,
    pending: linha.confirmedAt === null,
    confirmedAt: linha.confirmedAt,
    recoveryCodesLeft: restantes.length,
  };
}

/** Atalho do caminho do login: so a pergunta "esta conta pede codigo?". */
export async function totpEnabled(db: Database, userId: string): Promise<boolean> {
  const [linha] = await db
    .select({ confirmedAt: schema.userTotp.confirmedAt })
    .from(schema.userTotp)
    .where(eq(schema.userTotp.userId, userId));
  return linha?.confirmedAt != null;
}

export interface TotpEnrollment {
  secret: string;
  otpauthUri: string;
}

/**
 * Comeca a configuracao: gera um segredo e devolve o que o aplicativo le.
 *
 * Chamar de novo antes de confirmar **troca** o segredo -- quem recomeça
 * porque leu o QR Code errado nao fica preso ao primeiro.
 *
 * Recusa se o segundo fator ja estiver confirmado: trocar o aparelho passa por
 * desligar (com senha) e ligar de novo, e nao por sobrescrever em silencio.
 */
export async function startTotpEnrollment(
  ctx: TotpContext,
  input: { userId: string; email: string },
): Promise<TotpEnrollment> {
  const atual = await totpState(ctx.db, input.userId);
  if (atual.enabled) {
    throw AppError.conflict('A verificação em duas etapas já está ativa nesta conta.');
  }

  const secret = generateTotpSecret();
  const cifrado = encryptSecret(chave(ctx.env), secret, aad(input.userId));
  const agora = ctx.now();

  await ctx.db
    .insert(schema.userTotp)
    .values({ userId: input.userId, secret: cifrado, createdAt: agora, updatedAt: agora })
    .onConflictDoUpdate({
      target: schema.userTotp.userId,
      set: { secret: cifrado, confirmedAt: null, lastStep: null, updatedAt: agora },
    });

  return {
    secret,
    otpauthUri: otpauthUri({ secret, email: input.email, issuer: ctx.env.PLATFORM_NAME }),
  };
}

/**
 * Confirma a configuracao com um codigo do aplicativo e devolve os codigos de
 * recuperacao -- a unica vez em que eles existem em texto.
 */
export async function confirmTotpEnrollment(
  ctx: TotpContext,
  input: { userId: string; code: string },
): Promise<{ recoveryCodes: string[] }> {
  const [linha] = await ctx.db
    .select()
    .from(schema.userTotp)
    .where(eq(schema.userTotp.userId, input.userId));
  if (!linha) throw AppError.badRequest('Comece a configuração antes de confirmar o código.');
  if (linha.confirmedAt) throw AppError.conflict('A verificação em duas etapas já está ativa.');

  const secret = decryptSecret(chave(ctx.env), linha.secret, aad(input.userId));
  const conferencia = verifyTotp(secret, input.code, ctx.now(), linha.lastStep);
  if (!conferencia.valid) {
    throw AppError.badRequest(
      'Código inválido. Confira se o horário do celular está automático e tente o código atual.',
    );
  }

  const agora = ctx.now();
  const codigos = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(schema.userTotp)
      .set({ confirmedAt: agora, lastStep: conferencia.step ?? null, updatedAt: agora })
      .where(eq(schema.userTotp.userId, input.userId));
    // Configurar de novo troca a lista inteira: a antiga deixa de valer.
    await tx.delete(schema.userRecoveryCodes).where(eq(schema.userRecoveryCodes.userId, input.userId));
    await tx.insert(schema.userRecoveryCodes).values(
      codigos.map((codigo) => ({
        userId: input.userId,
        codeHash: hashRecoveryCode(ctx.env.AUTH_SECRET, codigo),
        createdAt: agora,
      })),
    );
  });

  return { recoveryCodes: codigos };
}

export type SecondFactorResult =
  | { ok: true; usedRecoveryCode: boolean; recoveryCodesLeft: number }
  | { ok: false };

/**
 * Confere o segundo fator no login: um codigo do aplicativo **ou** um codigo de
 * recuperacao.
 *
 * Os dois caminhos sao de uso unico: o passo aceito e gravado, e o codigo de
 * recuperacao e marcado como usado na mesma transacao em que e aceito -- duas
 * requisicoes simultaneas com o mesmo codigo nao passam as duas.
 */
export async function verifySecondFactor(
  ctx: TotpContext,
  input: { userId: string; code: string },
): Promise<SecondFactorResult> {
  const [linha] = await ctx.db
    .select()
    .from(schema.userTotp)
    .where(eq(schema.userTotp.userId, input.userId));
  if (!linha?.confirmedAt) return { ok: false };

  const agora = ctx.now();
  const secret = decryptSecret(chave(ctx.env), linha.secret, aad(input.userId));
  const conferencia = verifyTotp(secret, input.code, agora, linha.lastStep);

  if (conferencia.valid) {
    await ctx.db
      .update(schema.userTotp)
      .set({ lastStep: conferencia.step ?? null, updatedAt: agora })
      .where(eq(schema.userTotp.userId, input.userId));
    const restantes = await ctx.db
      .select({ id: schema.userRecoveryCodes.id })
      .from(schema.userRecoveryCodes)
      .where(and(eq(schema.userRecoveryCodes.userId, input.userId), isNull(schema.userRecoveryCodes.usedAt)));
    return { ok: true, usedRecoveryCode: false, recoveryCodesLeft: restantes.length };
  }

  // Nao bateu como codigo do aplicativo: pode ser um de recuperacao.
  const hash = hashRecoveryCode(ctx.env.AUTH_SECRET, input.code);
  const consumidos = await ctx.db
    .update(schema.userRecoveryCodes)
    .set({ usedAt: agora })
    .where(
      and(
        eq(schema.userRecoveryCodes.userId, input.userId),
        eq(schema.userRecoveryCodes.codeHash, hash),
        // Só um consumo: se outra requisicao chegou primeiro, esta nao acha nada.
        isNull(schema.userRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: schema.userRecoveryCodes.id });

  if (consumidos.length === 0) return { ok: false };

  const restantes = await ctx.db
    .select({ id: schema.userRecoveryCodes.id })
    .from(schema.userRecoveryCodes)
    .where(and(eq(schema.userRecoveryCodes.userId, input.userId), isNull(schema.userRecoveryCodes.usedAt)));
  return { ok: true, usedRecoveryCode: true, recoveryCodesLeft: restantes.length };
}

/** Desliga o segundo fator. Quem chama ja conferiu a identidade. */
export async function disableTotp(db: Database, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.userTotp).where(eq(schema.userTotp.userId, userId));
    await tx.delete(schema.userRecoveryCodes).where(eq(schema.userRecoveryCodes.userId, userId));
  });
}

/** Gera uma lista nova de codigos de recuperacao, invalidando a anterior. */
export async function regenerateRecoveryCodes(ctx: TotpContext, userId: string): Promise<string[]> {
  const estado = await totpState(ctx.db, userId);
  if (!estado.enabled) {
    throw AppError.badRequest('A verificação em duas etapas não está ativa nesta conta.');
  }
  const agora = ctx.now();
  const codigos = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  await ctx.db.transaction(async (tx) => {
    await tx.delete(schema.userRecoveryCodes).where(eq(schema.userRecoveryCodes.userId, userId));
    await tx.insert(schema.userRecoveryCodes).values(
      codigos.map((codigo) => ({
        userId,
        codeHash: hashRecoveryCode(ctx.env.AUTH_SECRET, codigo),
        createdAt: agora,
      })),
    );
  });
  return codigos;
}
