import { CodecaError } from './errors.js';

/**
 * Verificacao do webhook que a plataforma envia ao site.
 *
 * Usa **Web Crypto**, nao `node:crypto`: o endpoint de revalidacao de um site
 * costuma rodar na borda (Vercel Edge, Cloudflare), onde `node:crypto` nao
 * existe. Web Crypto existe nos dois, e no navegador -- embora aqui ele nao
 * deva rodar nunca, porque exige o segredo.
 *
 * A conferencia usa `crypto.subtle.verify` em vez de recalcular o HMAC e
 * comparar texto. Comparar string em JavaScript vaza tempo por caractere, e
 * `verify` compara internamente de forma constante.
 */

/** Cabecalho que carrega a assinatura. */
export const CODECA_SIGNATURE_HEADER = 'x-codeca-signature';
export const CODECA_EVENT_HEADER = 'x-codeca-event';
export const CODECA_DELIVERY_HEADER = 'x-codeca-delivery';

/** Tolerancia padrao do instante declarado na assinatura. */
export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

export interface ContentPublishedEvent {
  event: 'content.published';
  siteId: string;
  moduleKey: string;
  action: 'created' | 'updated' | 'removed';
  entityId: string | null;
  slug: string | null;
  publishedAt: string;
}

export interface VerifyWebhookInput {
  /**
   * Corpo **exatamente como chegou**.
   *
   * Nao use o objeto ja convertido: `JSON.parse` seguido de
   * `JSON.stringify` muda espacamento e ordem das chaves, e a assinatura
   * deixa de conferir. Em Next.js, `await request.text()`.
   */
  rawBody: string;
  /** Valor de `x-codeca-signature`. */
  signature: string | null | undefined;
  /** Segredo do endereco, cadastrado no painel da plataforma. */
  secret: string;
  /** Agora, em milissegundos. Injetavel para teste. */
  nowMs?: number;
  toleranceMs?: number;
}

/**
 * Confere a assinatura e devolve o evento.
 *
 * Lanca `CodecaError` quando nao confere -- e o comportamento certo para um
 * endpoint de revalidacao: responder 200 a uma requisicao nao assinada
 * deixaria qualquer um na internet invalidar o cache do site a vontade.
 */
export async function verifyWebhook(input: VerifyWebhookInput): Promise<ContentPublishedEvent> {
  if (!input.secret) {
    throw new CodecaError('segredo_ausente', 'Informe o segredo do webhook.', 0);
  }
  if (!input.signature) {
    throw new CodecaError(
      'assinatura_ausente',
      `Requisicao sem o cabecalho ${CODECA_SIGNATURE_HEADER}.`,
      401,
    );
  }

  const partes = parseSignature(input.signature);
  if (!partes) {
    throw new CodecaError('assinatura_malformada', 'Assinatura em formato inesperado.', 401);
  }

  const agora = input.nowMs ?? Date.now();
  const tolerancia = input.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  if (Math.abs(agora - partes.timestampMs) > tolerancia) {
    // Sem esta conferencia, uma requisicao valida capturada em transito
    // continuaria valida para sempre.
    throw new CodecaError(
      'assinatura_expirada',
      'A assinatura esta fora da janela de tolerancia.',
      401,
    );
  }

  const confere = await verificarHmac(
    input.secret,
    `${partes.timestampMs}.${input.rawBody}`,
    partes.hmacHex,
  );
  if (!confere) {
    throw new CodecaError('assinatura_invalida', 'A assinatura nao confere.', 401);
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(input.rawBody);
  } catch {
    throw new CodecaError('corpo_invalido', 'O corpo assinado nao e um JSON valido.', 400);
  }

  if (!ehContentPublished(corpo)) {
    throw new CodecaError('evento_desconhecido', 'Evento nao reconhecido por esta versao.', 400);
  }

  return corpo;
}

/** `t=<ms>,v1=<hex>` */
function parseSignature(header: string): { timestampMs: number; hmacHex: string } | null {
  let t: string | undefined;
  let v1: string | undefined;

  for (const pedaco of header.split(',')) {
    const indice = pedaco.indexOf('=');
    if (indice <= 0) continue;
    const chave = pedaco.slice(0, indice).trim();
    const valor = pedaco.slice(indice + 1).trim();
    if (chave === 't') t = valor;
    else if (chave === 'v1') v1 = valor;
  }

  if (!t || !v1) return null;
  const timestampMs = Number(t);
  if (!Number.isFinite(timestampMs)) return null;
  if (!/^[0-9a-f]+$/i.test(v1) || v1.length % 2 !== 0) return null;

  return { timestampMs, hmacHex: v1 };
}

async function verificarHmac(secret: string, dados: string, hmacHex: string): Promise<boolean> {
  const codificador = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  return crypto.subtle.verify('HMAC', chave, hexParaBytes(hmacHex), codificador.encode(dados));
}

function hexParaBytes(hex: string): ArrayBuffer {
  // Devolve o `ArrayBuffer` e nao a visao: `crypto.subtle` aceita
  // `BufferSource`, e a tipagem recente distingue os dois.
  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return buffer;
}

function ehContentPublished(valor: unknown): valor is ContentPublishedEvent {
  if (valor === null || typeof valor !== 'object') return false;
  const corpo = valor as Record<string, unknown>;
  return (
    corpo.event === 'content.published'
    && typeof corpo.siteId === 'string'
    && typeof corpo.moduleKey === 'string'
    && (corpo.action === 'created' || corpo.action === 'updated' || corpo.action === 'removed')
  );
}
