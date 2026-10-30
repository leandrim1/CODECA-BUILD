import { publicationAllowed, type PublicationState } from './states.js';

/**
 * O que a suspensao faz.
 *
 * Antes, suspender tirava o site do ar: a plataforma servia o site e bastava
 * parar de servir. No modelo novo o site e um projeto da Vercel do cliente --
 * a plataforma entrega conteudo por API e nao tem como derrubar o que ela nao
 * hospeda. Suspender, entao, deixa de ser um ato e passa a ser **politica**:
 * cada plano declara o que acontece quando a assinatura nao esta em dia.
 *
 * Um eixo nao e configuravel: **o dado nunca e apagado**. Nenhum plano pode
 * optar por apagar conteudo, imagem, imovel ou configuracao por inadimplencia.
 * A regra esta aqui, em codigo, e nao apenas na documentacao, porque a
 * tentacao de "liberar espaco" aparece justamente quando o cliente parou de
 * pagar.
 */

// ----------------------------------------------------------- site publico

/**
 * O que a API publica faz quando a assinatura nao esta em dia.
 *
 * - `serve`: responde normalmente. O visitante nao percebe nada.
 * - `serve_with_notice`: responde e acrescenta um aviso neutro, que o site do
 *   cliente pode exibir se quiser.
 * - `stop`: para de responder as rotas de conteudo.
 */
export const PUBLIC_SITE_ON_SUSPENSION = ['serve', 'serve_with_notice', 'stop'] as const;
export type PublicSiteOnSuspension = (typeof PUBLIC_SITE_ON_SUSPENSION)[number];

export const PUBLIC_SITE_ON_SUSPENSION_LABELS: Record<PublicSiteOnSuspension, string> = {
  serve: 'Continua no ar, sem aviso',
  serve_with_notice: 'Continua no ar, com aviso no conteudo',
  stop: 'Para de responder',
};

// ------------------------------------------------------------------ painel

/**
 * O que o painel do cliente faz quando a assinatura nao esta em dia.
 *
 * - `read_only`: o cliente entra, ve tudo e nao grava nada.
 * - `blocked`: o painel de conteudo nao abre.
 *
 * Em nenhum dos dois a tela de cobranca fecha: bloquear quem precisa pagar e
 * impedir a propria regularizacao.
 */
export const PANEL_ON_SUSPENSION = ['read_only', 'blocked'] as const;
export type PanelOnSuspension = (typeof PANEL_ON_SUSPENSION)[number];

export const PANEL_ON_SUSPENSION_LABELS: Record<PanelOnSuspension, string> = {
  read_only: 'Somente leitura',
  blocked: 'Bloqueado',
};

// ------------------------------------------------------------- a politica

export interface SuspensionPolicy {
  publicSite: PublicSiteOnSuspension;
  panel: PanelOnSuspension;
}

/**
 * Politica padrao, aplicada a plano que nao declara outra.
 *
 * Site no ar e painel em somente leitura: o cliente ve o que tem, nao perde
 * nada e volta ao normal ao regularizar. Derrubar o site de quem atrasou uma
 * fatura custa ao cliente final -- que nao tem parte nenhuma no atraso -- e
 * costuma gerar mais cancelamento do que pagamento.
 */
export const DEFAULT_SUSPENSION_POLICY: SuspensionPolicy = {
  publicSite: 'serve',
  panel: 'read_only',
};

// ------------------------------------------------------------- o resultado

export interface SuspensionEffect {
  /** `true` quando a assinatura esta em dia e nada e restringido. */
  current: boolean;
  /** O que a API publica faz agora. */
  publicSite: PublicSiteOnSuspension;
  /** O que o painel permite agora. */
  panel: 'full' | PanelOnSuspension;
  /** Sempre `false`. Existe para o tipo deixar a regra visivel. */
  dataDeleted: false;
}

/**
 * Traduz o estado de publicacao na restricao que vale agora.
 *
 * Funcao pura, como `decidePublication`: a API publica, o painel e as telas
 * decidem pela mesma regra, e nenhuma delas reimplanta a propria versao.
 *
 * `publicationAllowed` cobre tambem a tolerancia -- quem esta no periodo de
 * graca continua liberado, e nao chega aqui como suspenso.
 */
export function suspensionEffect(
  publication: PublicationState,
  policy: SuspensionPolicy = DEFAULT_SUSPENSION_POLICY,
): SuspensionEffect {
  if (publicationAllowed(publication)) {
    return { current: true, publicSite: 'serve', panel: 'full', dataDeleted: false };
  }

  return {
    current: false,
    publicSite: policy.publicSite,
    panel: policy.panel,
    dataDeleted: false,
  };
}

/**
 * Aviso que o site do cliente pode exibir ao visitante.
 *
 * Neutro de proposito. O visitante nao tem parte na pendencia e nao deve
 * saber dela: nada de valor em aberto, data de vencimento ou a palavra
 * inadimplente. O site do cliente recebe este texto por uma chave
 * publicavel, que e publica por definicao -- o que entra aqui entra na
 * internet.
 */
export const SUSPENSION_PUBLIC_NOTICE =
  'Este conteudo pode estar temporariamente desatualizado.';

/** `true` quando a escrita no painel deve ser recusada. */
export function panelWritesBlocked(effect: SuspensionEffect): boolean {
  return effect.panel !== 'full';
}

/** `true` quando o painel de conteudo nao deve nem abrir. */
export function panelFullyBlocked(effect: SuspensionEffect): boolean {
  return effect.panel === 'blocked';
}
