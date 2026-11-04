import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra autenticada (AES-256-GCM) para segredos guardados no banco.
 *
 * ## Formato
 *
 * `v1.<iv>.<tag>.<texto cifrado>`, tudo em base64url. O prefixo de versao
 * permite trocar de algoritmo ou de chave sem ambiguidade.
 *
 * ## Dado autenticado (AAD)
 *
 * O chamador informa um contexto (`aad`, por exemplo empresa + site). Ele nao e
 * guardado, mas entra na autenticacao: um texto cifrado copiado para a linha de
 * OUTRA empresa falha ao decifrar. E uma segunda barreira de isolamento, alem
 * das consultas filtradas por `tenant_id`.
 *
 * ## IV
 *
 * 12 bytes aleatorios por mensagem (recomendacao do NIST para GCM). Nunca se
 * reaproveita IV com a mesma chave.
 */

const VERSION = 'v1';

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

export function encryptSecret(key: Buffer, plaintext: string, aad: string): string {
  if (key.length !== 32) throw new SecretBoxError('Chave de cifra inválida.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(key: Buffer, payload: string, aad: string): string {
  if (key.length !== 32) throw new SecretBoxError('Chave de cifra inválida.');
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretBoxError('Formato de segredo desconhecido.');
  const [, iv, tag, data] = parts as [string, string, string, string];
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Mensagem unica: nao distingue chave errada, contexto errado e adulteracao.
    throw new SecretBoxError('Não foi possível decifrar o segredo.');
  }
}

/** Aceita 32 bytes em base64, base64url ou hexadecimal (64 caracteres). */
export function parseEncryptionKey(raw: string | undefined): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  const candidates: Buffer[] = [];
  if (/^[0-9a-fA-F]{64}$/.test(value)) candidates.push(Buffer.from(value, 'hex'));
  candidates.push(Buffer.from(value, 'base64'), Buffer.from(value, 'base64url'));
  return candidates.find((buffer) => buffer.length === 32) ?? null;
}
