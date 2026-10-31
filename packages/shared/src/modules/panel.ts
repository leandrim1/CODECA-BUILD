import type { SuspensionEffect } from '../billing/suspension.js';
import type { EffectiveField } from './policy.js';
import type { ModuleKey } from './registry.js';
import type { ModuleKind } from './types.js';

/**
 * Contrato de `GET /api/tenants/:tenantId/modules`.
 *
 * E a resposta de onde o painel do cliente monta a moldura inteira: o menu,
 * os avisos e o que cada formulario deixa editar. Declarada aqui e usada pelos
 * dois lados por um motivo aprendido na pratica -- a visao geral tinha uma
 * copia do tipo em cada lado, a API parou de enviar um campo e o painel
 * continuou lendo; o `typecheck` passou e a tela quebrou em producao.
 */

export interface SiteModuleView {
  key: ModuleKey;
  name: string;
  description: string;
  kind: ModuleKind;
  enabled: boolean;
  settings: Record<string, unknown>;
  fields: EffectiveField[];
}

/**
 * O plano contratado inclui o painel de conteudo?
 *
 * Vem nesta resposta, e nao de um erro, porque a tela precisa saber **antes**
 * de desenhar. Deduzir o motivo a partir de uma recusa faria o painel abrir
 * com um menu que desaparece no instante seguinte -- e um cliente do plano
 * Essencial veria por um segundo exatamente o que ele nao contratou.
 *
 * `planName` acompanha porque a mensagem nomeia o plano: "o plano Essencial
 * nao inclui" diz mais do que "seu plano nao inclui".
 */
export interface PanelAvailability {
  included: boolean;
  planCode: string;
  planName: string;
}

export interface SiteModulesPayload {
  siteId: string;
  modules: SiteModuleView[];
  /** Restricao em vigor por causa da assinatura. Independente de `panel`. */
  suspension: SuspensionEffect;
  panel: PanelAvailability;
}
