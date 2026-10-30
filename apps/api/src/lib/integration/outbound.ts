import { and, asc, eq, inArray, lte, schema, type Database } from '@codeca/database';
import {
  MAX_DELIVERY_ATTEMPTS,
  OUTBOUND_ATTEMPT_HEADER,
  OUTBOUND_DELIVERY_HEADER,
  OUTBOUND_EVENT_HEADER,
  OUTBOUND_SIGNATURE_HEADER,
  OUTBOUND_TIMEOUT_MS,
  deliveryWorthRetrying,
  nextAttemptDelayMinutes,
  type ContentPublishedPayload,
  type OutboundWebhookEvent,
} from '@codeca/shared';
import { signOutboundWebhook } from '@codeca/shared/server';

/**
 * Envio dos webhooks de publicacao.
 *
 * O desenho e todo determinado por uma restricao: isto roda em funcao
 * serverless. Nao existe fila em memoria, nao existe processo de fundo e o
 * processo atual pode terminar no instante seguinte a resposta. Logo:
 *
 * 1. A entrega e **gravada** no banco antes de qualquer tentativa.
 * 2. A tentativa imediata e oportunista: se funcionar, otimo; se nao, a linha
 *    continua lá.
 * 3. O que falhou volta no cron.
 *
 * E por isso que a publicacao **nunca falha por causa do webhook**. Gravar um
 * imovel e a operacao que o cliente pediu; avisar o site e consequencia. Se o
 * aviso derrubasse a gravacao, uma indisponibilidade no site do cliente
 * impediria o cliente de trabalhar.
 */

export interface QueueContentPublishedInput {
  tenantId: string;
  siteId: string;
  moduleKey: string;
  action: ContentPublishedPayload['action'];
  entityId?: string | null;
  slug?: string | null;
}

export interface OutboundContext {
  db: Database;
  now: () => Date;
  /** Injetavel para os testes observarem a entrega sem rede. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Grava uma entrega por endpoint ativo do site e tenta enviar na hora.
 *
 * Nao lanca: um erro aqui nao pode derrubar a escrita que o cliente pediu. A
 * falha fica registrada na propria linha de entrega, que e onde o painel
 * mestre a mostra.
 */
export async function queueContentPublished(
  ctx: OutboundContext,
  input: QueueContentPublishedInput,
): Promise<{ queued: number }> {
  try {
    const endpoints = await ctx.db
      .select({ id: schema.siteWebhooks.id })
      .from(schema.siteWebhooks)
      .where(
        and(
          eq(schema.siteWebhooks.siteId, input.siteId),
          eq(schema.siteWebhooks.isActive, true),
        ),
      );

    // O caso comum e nenhum endpoint: a maioria dos sites nao precisa de
    // aviso. Sair aqui evita escrever e tentar entregar sem destinatario.
    if (endpoints.length === 0) return { queued: 0 };

    const agora = ctx.now();
    const payload: ContentPublishedPayload = {
      event: 'content.published',
      siteId: input.siteId,
      moduleKey: input.moduleKey,
      action: input.action,
      entityId: input.entityId ?? null,
      slug: input.slug ?? null,
      publishedAt: agora.toISOString(),
    };

    const linhas = await ctx.db
      .insert(schema.webhookDeliveries)
      .values(
        endpoints.map((endpoint) => ({
          tenantId: input.tenantId,
          siteId: input.siteId,
          webhookId: endpoint.id,
          event: 'content.published' satisfies OutboundWebhookEvent,
          payload: payload as unknown as Record<string, unknown>,
          nextAttemptAt: agora,
        })),
      )
      .returning({ id: schema.webhookDeliveries.id });

    // Tentativa imediata, sem esperar: o cliente nao deve aguardar o site
    // dele responder para ver o proprio conteudo salvo. O que nao der conta
    // agora o cron pega depois.
    await Promise.all(linhas.map((linha) => attemptDelivery(ctx, linha.id)));

    return { queued: linhas.length };
  } catch (error) {
    // Registrar e seguir. A escrita do cliente ja aconteceu.
    console.error('[webhook] nao foi possivel enfileirar content.published:', descrever(error));
    return { queued: 0 };
  }
}

/**
 * `true` quando a alteracao muda o que um visitante enxerga.
 *
 * Recebe o estado de publicacao antes e depois. Um rascunho que continua
 * rascunho nao e publicacao, e avisar o site a cada tecla digitada num
 * rascunho gastaria entrega e invalidaria cache sem motivo. Mas sair de
 * publicado **tambem** conta: uma pagina que deixou de existir precisa sair
 * do cache tanto quanto uma que mudou.
 */
export function visibilityChanged(
  antes: string | null | undefined,
  depois: string | null | undefined,
): boolean {
  return antes === 'published' || depois === 'published';
}

export interface DeliveryAttemptResult {
  delivered: boolean;
  status: number;
  /** `true` quando a entrega foi marcada como esgotada nesta tentativa. */
  exhausted: boolean;
}

/**
 * Tenta entregar uma linha da fila, uma vez.
 *
 * A linha e lida junto com o endpoint para pegar o segredo e a URL atuais: um
 * endpoint corrigido depois da falha passa a valer na tentativa seguinte, sem
 * precisar recriar a entrega.
 */
export async function attemptDelivery(
  ctx: OutboundContext,
  deliveryId: string,
): Promise<DeliveryAttemptResult | null> {
  const [linha] = await ctx.db
    .select({
      delivery: schema.webhookDeliveries,
      url: schema.siteWebhooks.url,
      secret: schema.siteWebhooks.secret,
      isActive: schema.siteWebhooks.isActive,
      webhookId: schema.siteWebhooks.id,
    })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.siteWebhooks, eq(schema.siteWebhooks.id, schema.webhookDeliveries.webhookId))
    .where(eq(schema.webhookDeliveries.id, deliveryId));

  if (!linha) return null;
  if (linha.delivery.status === 'delivered' || linha.delivery.status === 'exhausted') return null;

  // Endpoint desativado depois de a entrega entrar na fila: nao insistir.
  if (!linha.isActive) {
    await ctx.db
      .update(schema.webhookDeliveries)
      .set({
        status: 'exhausted',
        lastError: 'Endereco desativado antes da entrega.',
        updatedAt: ctx.now(),
      })
      .where(eq(schema.webhookDeliveries.id, deliveryId));
    return { delivered: false, status: 0, exhausted: true };
  }

  const agora = ctx.now();
  const tentativa = linha.delivery.attempts + 1;
  // Serializado uma vez e assinado exatamente como vai ser enviado: assinar
  // uma string e enviar outra faria a conferencia falhar do outro lado.
  const corpo = JSON.stringify(linha.delivery.payload);
  const assinatura = signOutboundWebhook(linha.secret, agora.getTime(), corpo);

  const resultado = await enviar(ctx, {
    url: linha.url,
    corpo,
    assinatura,
    evento: linha.delivery.event,
    deliveryId,
    tentativa,
  });

  const entregue = resultado.status >= 200 && resultado.status < 300;
  const podeRepetir = !entregue && deliveryWorthRetrying(resultado.status);
  const esgotou = !entregue && (!podeRepetir || tentativa >= MAX_DELIVERY_ATTEMPTS);

  await ctx.db
    .update(schema.webhookDeliveries)
    .set({
      status: entregue ? 'delivered' : esgotou ? 'exhausted' : 'failed',
      attempts: tentativa,
      lastStatus: resultado.status,
      lastError: entregue ? '' : resultado.motivo,
      deliveredAt: entregue ? agora : null,
      nextAttemptAt: new Date(agora.getTime() + nextAttemptDelayMinutes(tentativa) * 60_000),
      updatedAt: agora,
    })
    .where(eq(schema.webhookDeliveries.id, deliveryId));

  await ctx.db
    .update(schema.siteWebhooks)
    .set({
      lastStatus: resultado.status,
      lastAttemptAt: agora,
      lastError: entregue ? '' : resultado.motivo,
      consecutiveFailures: entregue ? 0 : linha.delivery.attempts + 1,
      updatedAt: agora,
    })
    .where(eq(schema.siteWebhooks.id, linha.webhookId));

  return { delivered: entregue, status: resultado.status, exhausted: esgotou };
}

export interface FlushResult {
  attempted: number;
  delivered: number;
  exhausted: number;
}

/**
 * Reenvia o que ficou para tras. Chamada pelo cron.
 *
 * O limite existe para a passagem caber no prazo da funcao: o que nao couber
 * continua na fila e sai na proxima.
 */
export async function flushPendingDeliveries(
  ctx: OutboundContext,
  options: { limit?: number } = {},
): Promise<FlushResult> {
  const limite = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const agora = ctx.now();

  const pendentes = await ctx.db
    .select({ id: schema.webhookDeliveries.id })
    .from(schema.webhookDeliveries)
    .where(
      and(
        inArray(schema.webhookDeliveries.status, ['pending', 'failed']),
        lte(schema.webhookDeliveries.nextAttemptAt, agora),
      ),
    )
    .orderBy(asc(schema.webhookDeliveries.nextAttemptAt))
    .limit(limite);

  const resultado: FlushResult = { attempted: 0, delivered: 0, exhausted: 0 };
  for (const pendente of pendentes) {
    const tentativa = await attemptDelivery(ctx, pendente.id);
    if (!tentativa) continue;
    resultado.attempted += 1;
    if (tentativa.delivered) resultado.delivered += 1;
    if (tentativa.exhausted) resultado.exhausted += 1;
  }

  return resultado;
}

/** Entregas de um site, para o painel mestre. */
export async function listDeliveries(
  db: Database,
  siteId: string,
  limit = 20,
): Promise<Array<Pick<
  typeof schema.webhookDeliveries.$inferSelect,
  'id' | 'event' | 'status' | 'attempts' | 'lastStatus' | 'lastError' | 'deliveredAt' | 'createdAt'
> & { url: string }>> {
  const linhas = await db
    .select({
      id: schema.webhookDeliveries.id,
      event: schema.webhookDeliveries.event,
      status: schema.webhookDeliveries.status,
      attempts: schema.webhookDeliveries.attempts,
      lastStatus: schema.webhookDeliveries.lastStatus,
      lastError: schema.webhookDeliveries.lastError,
      deliveredAt: schema.webhookDeliveries.deliveredAt,
      createdAt: schema.webhookDeliveries.createdAt,
      url: schema.siteWebhooks.url,
    })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.siteWebhooks, eq(schema.siteWebhooks.id, schema.webhookDeliveries.webhookId))
    .where(eq(schema.webhookDeliveries.siteId, siteId))
    .orderBy(schema.webhookDeliveries.createdAt)
    .limit(limit);

  return linhas.reverse();
}

// ------------------------------------------------------------------ envio

interface EnvioInput {
  url: string;
  corpo: string;
  assinatura: string;
  evento: string;
  deliveryId: string;
  tentativa: number;
}

/**
 * Faz a requisicao, com prazo e sem deixar excecao escapar.
 *
 * Status `0` significa que nao houve resposta -- rede, DNS ou prazo. E
 * tratado como falha que vale repetir, ao contrario de um 4xx do site.
 */
async function enviar(
  ctx: OutboundContext,
  input: EnvioInput,
): Promise<{ status: number; motivo: string }> {
  const executar = ctx.fetch ?? globalThis.fetch;
  const controlador = new AbortController();
  const prazo = setTimeout(() => controlador.abort(), OUTBOUND_TIMEOUT_MS);

  try {
    const resposta = await executar(input.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [OUTBOUND_SIGNATURE_HEADER]: input.assinatura,
        [OUTBOUND_EVENT_HEADER]: input.evento,
        [OUTBOUND_DELIVERY_HEADER]: input.deliveryId,
        [OUTBOUND_ATTEMPT_HEADER]: String(input.tentativa),
        'user-agent': 'CodecaBuild-Webhook/1',
      },
      body: input.corpo,
      signal: controlador.signal,
      redirect: 'error',
    });

    return {
      status: resposta.status,
      // Somente o status. O corpo de erro de um servidor alheio pode conter
      // qualquer coisa, inclusive segredo de quem respondeu, e esta coluna e
      // exibida no painel.
      motivo: resposta.ok ? '' : `O site respondeu ${resposta.status}.`,
    };
  } catch (error) {
    return { status: 0, motivo: descrever(error) };
  } finally {
    clearTimeout(prazo);
  }
}

/** Motivo curto e sem dado sensivel, para a coluna de erro. */
function descrever(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return `O site nao respondeu em ${OUTBOUND_TIMEOUT_MS / 1000}s.`;
  }
  if (error instanceof Error) {
    // A mensagem do fetch costuma trazer o host, que nao e segredo: ele foi
    // cadastrado no painel. Mas o limite de tamanho evita despejar pilha.
    return error.message.slice(0, 200);
  }
  return 'Falha desconhecida ao chamar o site.';
}
