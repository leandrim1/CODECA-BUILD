import type { MiddlewareHandler } from 'hono';
import { AppError, planHasFeature } from '@codeca/shared';
import { loadEffectivePlan } from '../lib/plan-limits.js';
import { subPathAllowed, tenantSubPath } from './tenant-path.js';
import type { AppBindings } from '../types.js';

/**
 * Recusa o painel de conteudo quando o plano nao o inclui.
 *
 * Nasceu do plano Essencial, que vende site e dominio sem painel: a CODECA IA
 * mantem o conteudo e o cliente nao administra nada.
 *
 * **Nao e a mesma coisa que suspensao, e a diferenca e o ponto todo.** As duas
 * bloqueiam as mesmas rotas, mas dizem ao cliente coisas opostas:
 *
 * | | Suspensao | Plano sem painel |
 * | --- | --- | --- |
 * | Motivo | assinatura em atraso | plano em dia, mas nao cobre |
 * | Saida | pagar | upgrade |
 * | Duracao | ate regularizar | permanente no plano atual |
 *
 * Por isso sao duas camadas e dois codigos de erro. Juntar faria um cliente
 * pagante ler "regularize sua assinatura" -- e ligar para o suporte em vez de
 * contratar o plano acima.
 *
 * Bloqueia **leitura tambem**, nao so escrita. Uma lista vazia sugere que ela
 * poderia ser preenchida; o cliente tentaria cadastrar e so entao descobriria.
 */
export interface PanelPlanOptions {
  /**
   * Sufixos de rota que passam sempre, contados depois do id da empresa.
   *
   * O conjunto nao e arbitrario: sem painel, o cliente ainda precisa cuidar
   * da **propria conta**.
   *
   * - `''`, `/contact`: dados cadastrais da empresa. Sao dados dela, nao
   *   conteudo do site, e a nota fiscal depende deles estarem certos.
   * - `/plan`, `/billing`: e por onde se faz o upgrade. Bloquear seria
   *   impedir a propria saida da limitacao -- o mesmo cuidado da suspensao.
   * - `/modules`: e como o painel descobre **por que** esta vazio. Sem isso a
   *   tela deduziria o motivo de um erro, e abriria mostrando um menu que
   *   desaparece no instante seguinte.
   *
   * Fica de fora `/overview`, que e o resumo do conteudo, e tudo o que
   * administra o site.
   */
  exempt: readonly string[];
}

export function requirePanelPlan(options: PanelPlanOptions): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (subPathAllowed(tenantSubPath(c), options.exempt)) {
      await next();
      return;
    }

    const ctx = c.get('ctx');
    const tenant = c.get('tenant');
    const plano = await loadEffectivePlan(ctx.db, tenant.tenantId);

    if (!planHasFeature(plano.limits, 'cms_panel')) {
      throw AppError.planWithoutPanel(
        `O plano ${plano.planName} nao inclui o painel de conteudo: quem mantem o conteudo `
          + 'do site e a CODECA IA. Para administrar voce mesmo, contrate o plano Profissional '
          + 'na tela de plano e assinatura.',
        { planCode: plano.planCode },
      );
    }

    await next();
  };
}
