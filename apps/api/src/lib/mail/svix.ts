import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Conferencia de assinatura no padrao Svix, usado pelos webhooks do Resend.
 *
 *   conteudo assinado: `<svix-id>.<svix-timestamp>.<corpo bruto>`
 *   chave:             a parte depois de `whsec_`, decodificada de base64
 *   cabecalho:         `svix-signature: v1,<base64> [v1,<base64> ...]`
 *   tempo:             `svix-timestamp` em SEGUNDOS
 *
 * Feita aqui, sem dependencia nova: sao vinte linhas de HMAC.
 */
export type SvixFailure = 'missing_headers' | 'invalid_timestamp' | 'timestamp_out_of_tolerance' | 'invalid_signature';

export interface SvixInput {
  rawBody: string;
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  secret: string;
  now: Date;
  toleranceSeconds?: number;
}

export function signSvix(secret: string, id: string, timestampSeconds: number, rawBody: string): string {
  const semPrefixo = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  return createHmac('sha256', Buffer.from(semPrefixo, 'base64'))
    .update(`${id}.${timestampSeconds}.${rawBody}`)
    .digest('base64');
}

export function verifySvixSignature(input: SvixInput): { valid: true } | { valid: false; failure: SvixFailure } {
  if (!input.id || !input.timestamp || !input.signature) return { valid: false, failure: 'missing_headers' };
  if (!/^\d+$/.test(input.timestamp)) return { valid: false, failure: 'invalid_timestamp' };

  const segundos = Number(input.timestamp);
  const tolerancia = input.toleranceSeconds ?? 300;
  // Sem janela, uma entrega capturada valeria para sempre.
  if (Math.abs(input.now.getTime() / 1000 - segundos) > tolerancia) {
    return { valid: false, failure: 'timestamp_out_of_tolerance' };
  }

  const esperado = Buffer.from(signSvix(input.secret, input.id, segundos, input.rawBody), 'utf8');
  const confere = input.signature.split(/\s+/).some((parte) => {
    const [versao, valor] = parte.split(',');
    if (versao !== 'v1' || !valor) return false;
    const recebido = Buffer.from(valor, 'utf8');
    return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
  });
  return confere ? { valid: true } : { valid: false, failure: 'invalid_signature' };
}
