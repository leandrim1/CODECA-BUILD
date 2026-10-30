import { eq, schema, sql, type Database } from '@codeca/database';
import type { Env } from '../env.js';

/**
 * Primeiro acesso da plataforma.
 *
 * Uma instalacao nova nao tem administrador: sem alguem com `platform_admin`,
 * o painel mestre e inalcancavel e so um comando no banco resolveria. Em vez
 * de exigir esse passo manual, **a primeira conta cadastrada assume o papel**.
 *
 * O que torna isso seguro:
 *
 * - vale **uma unica vez**: a promocao so acontece enquanto nao existe nenhum
 *   administrador. A partir da segunda conta, ninguem mais e promovido;
 * - e serializada por um lock de transacao, de modo que dois cadastros
 *   simultaneos nao gerem dois administradores;
 * - pode ser restringida a um e-mail especifico com `PLATFORM_ADMIN_EMAIL`.
 *   Com a variavel definida, apenas aquele endereco assume o papel, e qualquer
 *   outra conta criada antes dele continua comum. A variavel guarda um e-mail,
 *   nunca uma senha.
 *
 * Quem assume o papel tem o e-mail dado como confirmado: e a conta de quem
 * instalou a plataforma, e esperar por um e-mail de confirmacao que depende de
 * um servico ainda nao configurado deixaria a instalacao travada.
 */

/** Chave do lock que serializa a reivindicacao do primeiro administrador. */
const BOOTSTRAP_LOCK_KEY = 4_120_250_117;

export interface AdminClaim {
  claimed: boolean;
  /** Por que nao foi promovido, para registrar no log e na auditoria. */
  reason: 'first_account' | 'admin_exists' | 'email_not_allowed';
}

/**
 * Promove o usuario a administrador da plataforma se esta for a primeira conta.
 *
 * Precisa ser chamada **dentro da transacao** que cria o usuario: o lock vale
 * ate o fim dela, e a promocao vive ou morre junto com o cadastro.
 */
export async function claimFirstPlatformAdmin(
  tx: Database,
  input: { userId: string; email: string },
  env: Env,
): Promise<AdminClaim> {
  // Com a variavel definida, so o endereco indicado pode assumir o papel.
  const pinned = env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  if (pinned && pinned !== input.email.trim().toLowerCase()) {
    return { claimed: false, reason: 'email_not_allowed' };
  }

  // Serializa a reivindicacao: dois cadastros ao mesmo tempo nao viram dois
  // administradores. O lock e liberado no fim da transacao.
  await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);

  const [existing] = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.platformRole, 'platform_admin'))
    .limit(1);

  if (existing) return { claimed: false, reason: 'admin_exists' };

  await tx
    .update(schema.users)
    .set({
      platformRole: 'platform_admin',
      // Conta de quem instalou a plataforma: nao fica esperando um e-mail que
      // depende de um servico talvez nao configurado ainda.
      emailVerifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, input.userId));

  return { claimed: true, reason: 'first_account' };
}
