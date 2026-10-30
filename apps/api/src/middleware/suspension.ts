import type { MiddlewareHandler } from 'hono';
import {
  AppError,
  PUBLICATION_STATE_MESSAGES,
  SUSPENSION_PUBLIC_NOTICE,
  panelFullyBlocked,
  panelWritesBlocked,
} from '@codeca/shared';
import { resolveSiteBilling } from '../lib/billing/suspension.js';
import type { AppBindings } from '../types.js';

/**
 * Aplica a politica de suspensao do plano as rotas do painel.
 *
 * O que a suspensao faz e decisao do plano, nao desta funcao: aqui so se
 * pergunta ao plano e se recusa de acordo. Dois cuidados que a implementacao
 * carrega de proposito:
 *
 * 1. **A tela de cobranca nunca passa por aqui.** Bloquear quem precisa pagar
 *    e impedir a propria regularizacao -- o cliente ficaria sem como sair da
 *    suspensao.
 * 2. **Nada e apagado.** A recusa e de escrita e, no maximo, de leitura; o
 *    conteudo continua inteiro no banco. Nenhum caminho desta politica remove
 *    dado.
 *
 * `GET`, `HEAD` e `OPTIONS` passam quando a politica e somente leitura: o
 * cliente ve o que tem. Com a politica `blocked`, nem isso.
 */
export interface SuspensionOptions {
  /**
   * Trechos de caminho que a politica nunca restringe.
   *
   * Existe por uma razao so, e ela e importante o suficiente para ficar
   * explicita na composicao da aplicacao: a tela de cobranca.
   */
  exempt: readonly string[];
}

export function enforceSuspension(options: SuspensionOptions): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const caminho = c.req.path;
    if (options.exempt.some((trecho) => caminho.includes(trecho))) {
      await next();
      return;
    }

    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const situacao = await resolveSiteBilling(ctx.db, tenant.siteId, ctx.now());

    if (situacao.effect.current) {
      await next();
      return;
    }

    const leitura = ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method.toUpperCase());
    const explicacao = PUBLICATION_STATE_MESSAGES[situacao.publication];

    if (panelFullyBlocked(situacao.effect)) {
      throw AppError.forbidden(
        `${explicacao} Enquanto isso o painel fica indisponivel; o conteudo continua salvo.`,
      );
    }

    if (!leitura && panelWritesBlocked(situacao.effect)) {
      throw AppError.forbidden(
        `${explicacao} Enquanto isso o painel fica em somente leitura; nada do que ja esta cadastrado foi apagado.`,
      );
    }

    await next();
  };
}


/**
 * Aplica a politica de suspensao a API publica, lida pelo site do cliente.
 *
 * Tres comportamentos, declarados pelo plano:
 *
 * - `serve`: nada muda. O visitante nao percebe.
 * - `serve_with_notice`: o conteudo continua respondendo e `GET /v1/site`
 *   passa a trazer um aviso neutro, que o site exibe se quiser.
 * - `stop`: as rotas param de responder, com um codigo proprio para o SDK
 *   distinguir pendencia de erro.
 *
 * O aviso vai no contexto em vez de ser recalculado na rota: a decisao e uma
 * so por requisicao, e `GET /v1/site` apenas a le.
 */
export function enforcePublicSuspension(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const ctx = c.get('ctx');
    const credencial = c.get('apiKey');
    const situacao = await resolveSiteBilling(ctx.db, credencial.siteId, ctx.now());

    if (situacao.effect.publicSite === 'stop' && !situacao.effect.current) {
      // 402 e nao 403: a diferenca importa para quem integra. 403 e
      // credencial sem permissao -- algo a corrigir no codigo do site; 402 e
      // pendencia da assinatura, que ninguem resolve mexendo no site.
      throw AppError.subscriptionRequired(
        'O conteudo deste site esta indisponivel por pendencia da assinatura. '
          + 'Nenhum dado foi apagado: regularize no painel para voltar a responder.',
      );
    }

    c.set(
      'publicNotice',
      situacao.effect.publicSite === 'serve_with_notice' && !situacao.effect.current
        ? SUSPENSION_PUBLIC_NOTICE
        : null,
    );

    await next();
  };
}
