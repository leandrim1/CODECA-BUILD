import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Primitivas de criptografia do servidor.
 *
 * Este modulo e exposto apenas em `@codeca/shared/server` e depende de
 * `node:crypto`, portanto nunca e importado pelo codigo que roda no navegador.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;

/**
 * Gera o hash da senha com scrypt e salt aleatorio por senha.
 * Formato: `scrypt$N$r$p$saltBase64$hashBase64`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT_PARAMS);
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/** Compara a senha informada com o hash guardado, em tempo constante. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashRaw, 'base64');
  } catch {
    return false;
  }
  const derived = await scrypt(password.normalize('NFKC'), Buffer.from(saltRaw, 'base64'), expected.length, {
    N,
    r,
    p,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Token opaco para sessoes, convites e redefinicao de senha.
 * Apenas o hash e persistido; o valor em claro so existe no cookie ou no link.
 */
export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash de token com segredo do ambiente, para impedir busca por rainbow table. */
export function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * Hash do endereco IP. Permite rate limiting e auditoria sem armazenar o
 * endereco em claro, atendendo a minimizacao de dados exigida pela LGPD.
 */
export function hashIp(ip: string, secret: string): string {
  if (!ip) return '';
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function newUuid(): string {
  return randomUUID();
}

/** Codigo curto legivel, usado em referencias internas. */
export function shortCode(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += alphabet[(bytes[i] ?? 0) % alphabet.length];
  }
  return output;
}

/**
 * Assina um corpo de webhook que a plataforma envia.
 *
 * Mesma convencao dos webhooks que recebemos: o HMAC cobre
 * `<timestamp>.<corpo bruto>`, e nao apenas o corpo. Incluir o instante e o
 * que impede o reenvio de uma entrega antiga capturada em transito -- sem
 * ele, uma requisicao valida seria valida para sempre.
 *
 * O corpo precisa ser assinado exatamente como vai ser enviado: serializar
 * duas vezes pode mudar espacamento ou ordem de chaves, e a conferencia do
 * outro lado falharia.
 */
export function signOutboundWebhook(
  secret: string,
  timestampMs: number,
  rawBody: string,
): string {
  return `t=${timestampMs},v1=${createHmac('sha256', secret)
    .update(`${timestampMs}.${rawBody}`)
    .digest('hex')}`;
}

/**
 * Segredo de assinatura de um webhook de saida.
 *
 * Guardado **recuperavel**, ao contrario das chaves de integracao, que ficam
 * em hash. Nao e descuido: assinar exige o segredo em claro a cada entrega, e
 * um hash nao serve para isso. A contrapartida e que ele nunca aparece em
 * log, em auditoria nem numa leitura do painel depois de criado.
 */
export function generateWebhookSecret(): string {
  return `cb_whsec_${randomBytes(32).toString('base64url')}`;
}
