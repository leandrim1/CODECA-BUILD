/**
 * Ponto de entrada do consentimento: `@codeca/sdk/consent`.
 *
 * Separado do cliente de conteudo de proposito. Um site que so le conteudo
 * nao carrega o gerenciador de consentimento, e um site que so precisa do
 * banner nao carrega o cliente da API -- a primeira visita, que e onde o
 * banner aparece, e justamente a que menos pode pesar.
 */
export {
  createConsentManager,
  CONSENT_CATEGORIES,
  CATEGORIAS_OPCIONAIS,
  CONSENT_ENGINE_VERSION,
  type ConsentCategory,
  type ConsentDecision,
  type ConsentManager,
  type ConsentOptions,
  type ConsentRecord,
  type ConsentState,
  type ConsentListener,
} from './consent.js';

export {
  aplicarConsentimento,
  liberarMarcados,
  limparCookiesDe,
  pontearConsentModeDoGoogle,
  revogarEReiniciar,
  ATRIBUTO_CATEGORIA,
  ATRIBUTO_SRC,
} from './consent-gate.js';

export { montarConsentimento, type ConsentUiOptions } from './consent-ui.js';
