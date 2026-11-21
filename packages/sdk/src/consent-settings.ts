import {
  createConsentManager,
  type ConsentCategory,
  type ConsentManager,
} from './consent.js';
import { aplicarConsentimento, pontearConsentModeDoGoogle } from './consent-gate.js';
import { montarConsentimento, type ConsentUiOptions } from './consent-ui.js';

/**
 * A ponte entre o painel da CODECA Build e o banner do site.
 *
 * Sem isto, o nome do controlador, os enderecos das politicas e a lista de
 * ferramentas ficariam escritos no codigo do site -- e corrigir o CNPJ de um
 * cliente exigiria uma nova publicacao. Com isto, quem edita e o painel.
 *
 * Duas regras valem aqui:
 *
 * **O banner nunca depende da rede.** Se a plataforma nao responder, o
 * consentimento funciona com o que o site passou direto no codigo. Um visitante
 * ficando sem poder recusar porque uma requisicao falhou seria o pior resultado
 * possivel -- e e justamente o que acontece quando o banner espera a rede.
 *
 * **O controlador vem do painel ou nao vem.** A CODECA Build e operadora: nao
 * se apresenta como controladora dos dados dos visitantes dos sites dos
 * clientes. Campo vazio no painel significa banner sem afirmacao de
 * controlador, e nao banner com o nome da plataforma.
 */

export interface CookieToolFromPanel {
  key: string;
  name: string;
  provider: string;
  category: ConsentCategory;
  purpose: string;
  cookies: string[];
  privacyUrl: string;
}

export interface CookieSettingsFromPanel {
  controllerName: string;
  controllerDocument: string;
  controllerContact: string;
  privacyPolicyUrl: string;
  cookiePolicyUrl: string;
  policyVersion: string;
  bannerEnabled: boolean;
  tools: CookieToolFromPanel[];
}

export interface CarregarConfiguracaoOptions {
  /** Endereco do painel, por exemplo `https://app.codecabuild.com.br`. */
  baseUrl: string;
  /** Chave **publicavel**. A secreta nao tem o que fazer no navegador. */
  publishableKey: string;
  fetch?: typeof globalThis.fetch;
  /** Teto de espera. Curto de proposito: o banner nao espera a rede. */
  timeoutMs?: number;
}

/**
 * Busca a configuracao de cookies deste site no painel.
 *
 * Devolve `null` em qualquer falha -- rede, chave recusada, resposta fora do
 * formato. Quem chama decide o que fazer sem o painel; nunca ha excecao
 * atravessando o caminho do banner.
 */
export async function carregarConfiguracaoDeCookies(
  options: CarregarConfiguracaoOptions,
): Promise<CookieSettingsFromPanel | null> {
  const buscar = options.fetch ?? globalThis.fetch;
  if (typeof buscar !== 'function') return null;

  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), options.timeoutMs ?? 4_000);

  try {
    const resposta = await buscar(`${options.baseUrl.replace(/\/+$/, '')}/api/v1/consent/settings`, {
      headers: { authorization: `Bearer ${options.publishableKey}` },
      signal: controle.signal,
    });
    if (!resposta.ok) return null;

    const corpo: unknown = await resposta.json();
    const dado = (corpo as { data?: unknown })?.data ?? corpo;
    if (!dado || typeof dado !== 'object') return null;

    const bruto = dado as Partial<CookieSettingsFromPanel>;
    if (typeof bruto.policyVersion !== 'string' || bruto.policyVersion === '') return null;

    return {
      controllerName: texto(bruto.controllerName),
      controllerDocument: texto(bruto.controllerDocument),
      controllerContact: texto(bruto.controllerContact),
      privacyPolicyUrl: texto(bruto.privacyPolicyUrl),
      cookiePolicyUrl: texto(bruto.cookiePolicyUrl),
      policyVersion: bruto.policyVersion,
      bannerEnabled: bruto.bannerEnabled !== false,
      tools: Array.isArray(bruto.tools) ? bruto.tools : [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(limite);
  }
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

export interface IniciarConsentimentoOptions {
  baseUrl: string;
  publishableKey: string;
  /**
   * Versao da politica quando o painel nao responde.
   *
   * O painel e a fonte normal. Este valor existe para o banner continuar
   * funcionando sem rede -- e para o site que prefere nao consultar o painel.
   */
  policyVersion?: string;
  /** `false` nao consulta o painel: vale so o que esta no codigo do site. */
  lerDoPainel?: boolean;
  /** `false` nao envia o registro da escolha para a plataforma. */
  reportar?: boolean;
  /**
   * `true` liga a ponte com o Consent Mode do Google.
   *
   * Desligado por padrao: o caminho forte e nao carregar o script antes do
   * "sim", e a ponte serve ao caso em que a ferramenta exige presenca previa.
   */
  consentModeDoGoogle?: boolean;
  /** Textos e links da interface. O painel preenche o que faltar. */
  ui?: Omit<ConsentUiOptions, 'manager'>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface ConsentimentoIniciado {
  manager: ConsentManager;
  /** `null` quando o painel nao respondeu ou nao foi consultado. */
  settings: CookieSettingsFromPanel | null;
  abrirPreferencias: () => void;
  destruir: () => void;
}

/**
 * Liga o consentimento inteiro: escolha, bloqueio e interface.
 *
 * E o caminho de uma linha para um site novo. Quem quer desenho proprio usa as
 * pecas (`createConsentManager`, `aplicarConsentimento`, `montarConsentimento`)
 * separadamente -- esta funcao nao esconde nenhuma delas.
 */
export async function iniciarConsentimento(
  options: IniciarConsentimentoOptions,
): Promise<ConsentimentoIniciado> {
  const settings =
    options.lerDoPainel === false
      ? null
      : await carregarConfiguracaoDeCookies({
          baseUrl: options.baseUrl,
          publishableKey: options.publishableKey,
          ...(options.fetch ? { fetch: options.fetch } : {}),
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        });

  const policyVersion = settings?.policyVersion ?? options.policyVersion ?? '1';
  const base = options.baseUrl.replace(/\/+$/, '');

  const manager = createConsentManager({
    policyVersion,
    ...(options.reportar === false ? {} : { reportTo: `${base}/api/v1/consent` }),
  });

  // O portao primeiro: o que a pessoa ja tinha recusado continua recusado
  // antes de qualquer interface aparecer.
  const soltarPortao = aplicarConsentimento(manager);
  const soltarPonte = options.consentModeDoGoogle ? pontearConsentModeDoGoogle(manager) : null;

  // Banner desligado no painel: o portao continua valendo, a interface nao
  // aparece. Serve ao site que so usa o necessario.
  if (settings?.bannerEnabled === false) {
    return {
      manager,
      settings,
      abrirPreferencias: () => undefined,
      destruir: () => {
        soltarPortao();
        soltarPonte?.();
      },
    };
  }

  const ui = montarConsentimento({
    manager,
    ...(settings?.controllerName ? { controlador: settings.controllerName } : {}),
    ...(settings?.privacyPolicyUrl ? { politicaDePrivacidade: settings.privacyPolicyUrl } : {}),
    ...(settings?.cookiePolicyUrl ? { politicaDeCookies: settings.cookiePolicyUrl } : {}),
    ...options.ui,
  });

  return {
    manager,
    settings,
    abrirPreferencias: ui.abrirPreferencias,
    destruir: () => {
      ui.destruir();
      soltarPortao();
      soltarPonte?.();
    },
  };
}
