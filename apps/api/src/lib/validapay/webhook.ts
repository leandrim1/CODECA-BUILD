import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificacao da assinatura dos webhooks da ValidaPay.
 *
 * O cabecalho `X-Webhook-Signature` nao e um HMAC do corpo: ele traz
 * `t=<timestamp em ms>,v1=<hmac hex>`, e o HMAC e calculado sobre
 * `<t>.<corpo bruto>`.
 *
 * O corpo precisa ser usado byte a byte, como chegou. Fazer `JSON.parse` e
 * reserializar muda espacamento e ordem das chaves, e a assinatura deixa de
 * conferir -- por isso a rota le o corpo cru antes de qualquer validacao.
 */

export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';
export const WEBHOOK_ID_HEADER = 'x-webhook-id';
export const WEBHOOK_EVENT_HEADER = 'x-webhook-event';
export const WEBHOOK_ATTEMPT_HEADER = 'x-webhook-attempt';
export const WEBHOOK_ACCESS_TOKEN_HEADER = 'x-access-token';

/** Tolerancia padrao do timestamp, em milissegundos. */
export const DEFAULT_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export type WebhookVerificationFailure =
  | 'missing_signature'
  | 'malformed_signature'
  | 'invalid_signature'
  | 'timestamp_out_of_tolerance'
  | 'invalid_access_token'
  | 'not_configured';

export interface WebhookVerificationResult {
  valid: boolean;
  failure?: WebhookVerificationFailure;
  /** Instante declarado na assinatura. */
  signedAt?: Date;
}

export interface VerifyWebhookInput {
  /** Corpo exatamente como recebido. */
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
  now: Date;
  toleranceMs?: number;
  /** Token estatico opcional configurado no painel da ValidaPay. */
  expectedAccessToken?: string;
  accessTokenHeader?: string | null | undefined;
}

export function parseSignatureHeader(header: string): { t?: string; v1?: string } {
  const parts: { t?: string; v1?: string } = {};
  for (const chunk of header.split(',')) {
    const index = chunk.indexOf('=');
    if (index <= 0) continue;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (key === 't') parts.t = value;
    else if (key === 'v1') parts.v1 = value;
  }
  return parts;
}

export function signWebhookBody(timestampMs: number, rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestampMs}.${rawBody}`).digest('hex');
}

export function verifyWebhookSignature(input: VerifyWebhookInput): WebhookVerificationResult {
  if (!input.secret) return { valid: false, failure: 'not_configured' };

  // O token estatico, quando configurado, e uma barreira adicional -- nunca
  // substitui a assinatura.
  if (input.expectedAccessToken) {
    const received = input.accessTokenHeader ?? '';
    if (!constantTimeEquals(received, input.expectedAccessToken)) {
      return { valid: false, failure: 'invalid_access_token' };
    }
  }

  const header = input.signatureHeader?.trim();
  if (!header) return { valid: false, failure: 'missing_signature' };

  const { t, v1 } = parseSignatureHeader(header);
  if (!t || !v1 || !/^\d+$/.test(t) || !/^[0-9a-f]+$/i.test(v1)) {
    return { valid: false, failure: 'malformed_signature' };
  }

  const expected = signWebhookBody(Number(t), input.rawBody, input.secret);
  if (!constantTimeEquals(v1.toLowerCase(), expected)) {
    return { valid: false, failure: 'invalid_signature' };
  }

  // Sem janela de tolerancia, uma assinatura capturada valeria para sempre.
  const tolerance = input.toleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS;
  const ageMs = input.now.getTime() - Number(t);
  if (Math.abs(ageMs) > tolerance) {
    return { valid: false, failure: 'timestamp_out_of_tolerance', signedAt: new Date(Number(t)) };
  }

  return { valid: true, signedAt: new Date(Number(t)) };
}

/** Comparacao de tempo constante entre duas strings. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const WEBHOOK_FAILURE_MESSAGES: Record<WebhookVerificationFailure, string> = {
  missing_signature: 'Cabecalho X-Webhook-Signature ausente.',
  malformed_signature: 'Cabecalho X-Webhook-Signature em formato invalido.',
  invalid_signature: 'Assinatura do webhook invalida.',
  timestamp_out_of_tolerance: 'Timestamp do webhook fora da janela de tolerancia.',
  invalid_access_token: 'Token estatico do webhook invalido.',
  not_configured: 'VALIDAPAY_WEBHOOK_SECRET nao configurado no servidor.',
};
