/**
 * Webhooks que a plataforma **envia** ao site do cliente.
 *
 * O caminho normal nao precisa deles: um site Vite busca o conteudo em tempo
 * de execucao e a alteracao aparece na proxima visita. O webhook existe para
 * o site que renderiza no servidor e guarda cache -- sem um aviso, esse site
 * so descobriria a mudanca quando o cache expirasse, o que na Vercel pode
 * significar horas depois de o cliente ter publicado.
 *
 * A assinatura usa **a mesma convencao dos webhooks que recebemos** da
 * ValidaPay: `t=<timestamp>,v1=<hmac>`, com o HMAC calculado sobre
 * `<t>.<corpo bruto>`. Reaproveitar a convencao em vez de inventar outra tem
 * uma vantagem concreta: quem integra ja encontra o mesmo formato em qualquer
 * provedor de pagamento, e o verificador cabe em dez linhas.
 */

/** Eventos que a plataforma envia. */
export const OUTBOUND_WEBHOOK_EVENTS = ['content.published'] as const;
export type OutboundWebhookEvent = (typeof OUTBOUND_WEBHOOK_EVENTS)[number];

export function isOutboundWebhookEvent(value: string): value is OutboundWebhookEvent {
  return (OUTBOUND_WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** Cabecalhos de uma entrega. Os mesmos nomes que recebemos, do outro lado. */
export const OUTBOUND_SIGNATURE_HEADER = 'x-codeca-signature';
export const OUTBOUND_EVENT_HEADER = 'x-codeca-event';
export const OUTBOUND_DELIVERY_HEADER = 'x-codeca-delivery';
export const OUTBOUND_ATTEMPT_HEADER = 'x-codeca-attempt';

/** Prazo de cada tentativa. Curto de proposito: ver `outbound.ts` na API. */
export const OUTBOUND_TIMEOUT_MS = 8_000;

/** Tolerancia sugerida ao site do cliente para o timestamp da assinatura. */
export const OUTBOUND_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Corpo de `content.published`.
 *
 * Carrega **o que mudou, nao o conteudo novo**. Duas razoes: o corpo iria
 * assinado por um segredo compartilhado mas viajaria pela internet ate um
 * endereco que a plataforma nao controla, e o site precisa buscar o conteudo
 * pela API de qualquer forma -- e com a propria credencial, que define o que
 * ele pode ler. Mandar o conteudo aqui duplicaria a regra de visibilidade em
 * dois lugares.
 */
export interface ContentPublishedPayload {
  event: 'content.published';
  /** Site cujo conteudo mudou. */
  siteId: string;
  /** Modulo afetado, como declarado no registro. */
  moduleKey: string;
  /**
   * O que aconteceu com o registro.
   *
   * `removed` tambem e publicacao: uma pagina que deixou de existir precisa
   * sair do cache do site tanto quanto uma que mudou.
   */
  action: 'created' | 'updated' | 'removed';
  /** Registro afetado, quando o modulo guarda uma colecao. */
  entityId: string | null;
  /** Endereco na URL do registro, para invalidar a pagina certa. */
  slug: string | null;
  /** Instante da publicacao, em ISO 8601. */
  publishedAt: string;
}

/**
 * Entrega: o que o painel mestre mostra de uma tentativa.
 *
 * `lastError` guarda o motivo da falha sem o corpo da resposta -- um corpo de
 * erro de servidor alheio pode trazer qualquer coisa, inclusive segredo de
 * quem respondeu.
 */
export const DELIVERY_STATES = ['pending', 'delivered', 'failed', 'exhausted'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const DELIVERY_STATE_LABELS: Record<DeliveryState, string> = {
  pending: 'Aguardando envio',
  delivered: 'Entregue',
  failed: 'Falhou, sera tentada de novo',
  exhausted: 'Desistimos depois de varias tentativas',
};

/**
 * Tentativas antes de desistir.
 *
 * Cinco porque as tentativas seguintes saem no cron diario: cinco cobrem
 * quase uma semana de indisponibilidade do site do cliente, o que e mais do
 * que suficiente -- e insistir para sempre encheria a tabela de entregas que
 * ninguem vai receber.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Atraso antes da proxima tentativa, em minutos, por numero de tentativa. */
export function nextAttemptDelayMinutes(attempts: number): number {
  // 1min, 5min, 30min, 2h -- a partir da quinta nao ha proxima.
  const escala = [1, 5, 30, 120];
  return escala[Math.min(Math.max(attempts, 1), escala.length) - 1] ?? 120;
}

/**
 * `true` quando a resposta do site indica falha que vale repetir.
 *
 * Um 4xx do site do cliente (fora de 408 e 429) nao melhora com repeticao: o
 * endereco esta errado, ou o site recusa a assinatura. Repetir so geraria
 * ruido nos dois lados.
 */
export function deliveryWorthRetrying(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status >= 500 || status === 0;
}
