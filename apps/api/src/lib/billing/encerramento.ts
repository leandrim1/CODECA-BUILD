import { eq, schema, type Database } from '@codeca/database';
import { AppError } from '@codeca/shared';
import type { BillingProvider } from '../validapay/provider.js';
import type { SubscriptionResponse } from '../validapay/types.js';
import { BILLING_ACTIONS } from './audit.js';
import { applySubscriptionPatch, type SubscriptionRow } from './service.js';

/**
 * Encerra a cobranca de uma empresa **antes** de ela ser excluida.
 *
 * ## Por que existe
 *
 * A exclusao da empresa (direito do titular, LGPD) apagava tudo do nosso lado
 * e nao dizia nada a ValidaPay. A assinatura seguia viva la: o cartao
 * continuava sendo cobrado todo mes, os eventos chegavam sem empresa para
 * receber, e o cliente nao tinha mais painel por onde cancelar.
 *
 * ## A regra
 *
 * **Nada e apagado enquanto houver cobranca que nao conseguimos encerrar.**
 * A ordem e cancelar no provedor primeiro e excluir depois, e qualquer duvida
 * (provedor fora do ar, assinatura que nao responde, pagamento feito que nao
 * foi localizado) interrompe a exclusao inteira. O erro oposto -- apagar e
 * continuar cobrando -- e o unico que nao tem conserto do nosso lado, porque
 * depois da exclusao nao sobra registro de que assinatura era de quem.
 *
 * ## O que "encerrar" quer dizer na ValidaPay
 *
 * O provedor decide, e as duas respostas servem (contrato de
 * `DELETE /v1/subscriptions/:id`):
 *
 * - **sem periodo pago pela frente:** cancela na hora, e as cobrancas em
 *   aberto sao canceladas junto;
 * - **com periodo ja pago:** o cancelamento fica agendado para o fim dele, e
 *   "nao ha novas cobrancas".
 *
 * Nos dois casos nada mais e cobrado. Este modulo nao estorna nem devolve
 * valor: reembolso de periodo ja pago e decisao comercial, fora daqui.
 */

/** Estados locais em que a assinatura ja terminou do lado do provedor. */
const ENCERRADOS_LOCALMENTE: ReadonlySet<SubscriptionRow['status']> = new Set([
  'canceled',
  'expired',
  'completed',
]);

/** Situacoes do provedor em que nao ha mais nada a cancelar. */
const ENCERRADOS_NO_PROVEDOR: ReadonlySet<string> = new Set([
  'CANCELED',
  'EXPIRED',
  'COMPLETED',
  'ARCHIVED',
]);

export type BillingClosureOutcome =
  /** Cancelada na hora. */
  | 'canceled'
  /** Cancelamento agendado para o fim do periodo ja pago; sem novas cobrancas. */
  | 'scheduled'
  /** Ja estava cancelada ou com cancelamento agendado. */
  | 'already_closed';

export interface BillingClosure {
  externalSubscriptionId: string;
  outcome: BillingClosureOutcome;
  /** Fim do periodo pago, quando o cancelamento ficou agendado. */
  effectiveAt: string | null;
}

export interface BillingClosureContext {
  db: Database;
  provider: BillingProvider;
  now: () => Date;
  actorUserId: string;
}

/** Mensagem unica de recusa: diz o que aconteceu e, principalmente, o que NAO aconteceu. */
const RECUSA =
  'Não foi possível encerrar a assinatura na ValidaPay agora, por isso a empresa não foi excluída '
  + 'e nada foi apagado. Tente de novo em alguns minutos; se continuar, fale com o suporte.';

const MOTIVO = 'Empresa excluída pelo proprietário.';

/**
 * O que a tela precisa saber antes de perguntar "tem certeza?".
 *
 * Leitura local, sem consultar o provedor: e so para avisar. Quem decide de
 * verdade e `closeBillingBeforeDeletion`, na hora da exclusao.
 */
export async function billingClosurePreview(
  db: Database,
  tenantId: string,
): Promise<{ assinaturaAtiva: boolean; acessoPagoAte: Date | null }> {
  const linhas = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, tenantId));

  const vivas = linhas.filter(
    (linha) => linha.externalSubscriptionId && !ENCERRADOS_LOCALMENTE.has(linha.status),
  );
  const pagoAte = vivas
    .filter((linha) => linha.status !== 'trialing' && linha.status !== 'pending')
    .map((linha) => linha.accessUntil)
    .filter((data): data is Date => data !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return { assinaturaAtiva: vivas.length > 0, acessoPagoAte: pagoAte ?? null };
}

/**
 * Cancela no provedor tudo o que ainda cobra esta empresa.
 *
 * Devolve o que foi feito, para a auditoria que sobrevive a exclusao. Lanca
 * (e a exclusao nao acontece) quando nao da para ter certeza de que a cobranca
 * parou.
 */
export async function closeBillingBeforeDeletion(
  ctx: BillingClosureContext,
  tenantId: string,
): Promise<BillingClosure[]> {
  const linhas = await ctx.db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, tenantId));

  const encerradas: BillingClosure[] = [];

  for (const linha of linhas) {
    if (linha.externalSubscriptionId) {
      // Encerrada do nosso lado por evento do proprio provedor: nada a fazer.
      if (ENCERRADOS_LOCALMENTE.has(linha.status)) continue;
      encerradas.push(await encerrar(ctx, linha, linha.externalSubscriptionId));
      continue;
    }

    // Sem vinculo, mas com contratacao aberta: a assinatura pode existir no
    // provedor sem que o evento que a vincularia tenha chegado.
    if (linha.checkoutSessionId) {
      const orfas = await localizarPelaContratacao(ctx, linha, tenantId);
      for (const remota of orfas) {
        encerradas.push(await encerrar(ctx, linha, remota.subscriptionId, remota));
      }
    }
  }

  return encerradas;
}

/** Cancela uma assinatura do provedor, ou confirma que ela ja nao cobra. */
async function encerrar(
  ctx: BillingClosureContext,
  linha: SubscriptionRow,
  externalSubscriptionId: string,
  conhecida?: SubscriptionResponse,
): Promise<BillingClosure> {
  try {
    // Consulta antes de cancelar: assim "ja cancelada" e "cancelamento ja
    // agendado" sao estados lidos, e nao erros a interpretar.
    const remota = conhecida ?? (await ctx.provider.getSubscription(externalSubscriptionId));

    if (ENCERRADOS_NO_PROVEDOR.has(remota.status) || remota.cancelAtPeriodEnd === true) {
      return {
        externalSubscriptionId,
        outcome: 'already_closed',
        effectiveAt: remota.cancellation?.effectiveAt ?? null,
      };
    }

    const resposta = await ctx.provider.cancelSubscription(externalSubscriptionId, MOTIVO);
    const imediato = resposta.immediate === true;

    // O espelho local acompanha, mesmo estando prestes a ser apagado: se a
    // exclusao falhar adiante, a empresa nao fica dizendo que a assinatura
    // segue ativa depois de ter sido cancelada.
    await applySubscriptionPatch(
      { db: ctx.db, now: ctx.now, source: 'system', actorUserId: ctx.actorUserId },
      linha,
      {
        status: imediato ? 'canceled' : 'cancel_at_period_end',
        cancelAtPeriodEnd: !imediato,
        cancelRequestedAt: ctx.now(),
        cancelReason: MOTIVO,
        ...(imediato ? { canceledAt: ctx.now(), nextChargeAt: null } : {}),
        providerStatus: resposta.status ?? linha.providerStatus,
        ...(linha.externalSubscriptionId ? {} : { externalSubscriptionId }),
      },
      {
        action: imediato ? BILLING_ACTIONS.canceled : BILLING_ACTIONS.cancelScheduled,
        reason: MOTIVO,
        metadata: { immediate: imediato, effectiveAt: resposta.effectiveAt ?? null, motivo: 'exclusao' },
      },
    );

    return {
      externalSubscriptionId,
      outcome: imediato ? 'canceled' : 'scheduled',
      effectiveAt: resposta.effectiveAt ?? null,
    };
  } catch (error) {
    // Nao importa por que falhou (rede, credencial, assinatura que o provedor
    // nao reconhece): sem a confirmacao, a exclusao nao segue. O detalhe vai
    // para o log do servidor; para a pessoa, o que importa e que nada sumiu.
    const detalhe = error instanceof Error ? error.message : String(error);
    console.error(
      `[billing] exclusao interrompida: nao foi possivel encerrar ${externalSubscriptionId} -- ${detalhe}`,
    );
    throw new AppError('upstream_error', RECUSA);
  }
}

/**
 * Procura, no provedor, a assinatura nascida de uma contratacao aberta.
 *
 * O documento sozinho nao prova de quem e a assinatura (mesma regra da
 * reconciliacao): so vale a que aponta para a NOSSA sessao de checkout.
 */
async function localizarPelaContratacao(
  ctx: BillingClosureContext,
  linha: SubscriptionRow,
  tenantId: string,
): Promise<SubscriptionResponse[]> {
  try {
    const [empresa] = await ctx.db
      .select({ taxId: schema.tenants.taxId })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));

    const candidatas = empresa?.taxId
      ? await ctx.provider.findSubscriptionsByDocument(empresa.taxId)
      : [];
    const nossas = candidatas.filter((remota) => remota.checkoutId === linha.checkoutSessionId);
    if (nossas.length > 0) return nossas;

    // Nenhuma assinatura localizada. Se a sessao foi paga, existe dinheiro do
    // cliente que nao sabemos onde esta: excluir agora apagaria a unica pista.
    const sessao = await ctx.provider.getCheckoutSession(linha.checkoutSessionId ?? '');
    if (sessao.status === 'completed') {
      throw new Error('contratacao paga sem assinatura localizada no provedor');
    }
    return [];
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : String(error);
    console.error(
      `[billing] exclusao interrompida: contratacao ${linha.checkoutSessionId} nao pode ser conferida -- ${detalhe}`,
    );
    throw new AppError('upstream_error', RECUSA);
  }
}
