import { z } from 'zod';
import { emailSchema, httpsUrlSchema } from './validators/common.js';
import { SLUG_PATTERN } from './slug.js';

/**
 * Consentimento de cookies: o lado da plataforma.
 *
 * O mecanismo que pergunta ao visitante e guarda a resposta vive no
 * `@codeca/sdk`, que roda no site do cliente. O que esta aqui e o contrato
 * entre esse mecanismo e a plataforma: **quem** e o controlador daquele site,
 * **o que** ele declara usar, e como o registro da escolha chega.
 *
 * Duas decisoes que explicam a forma do arquivo:
 *
 * **A CODECA nao se apresenta como controladora dos dados dos sites dos
 * clientes.** Quem responde pelo tratamento no site de uma clinica e a
 * clinica. Por isso `controllerName` e campo obrigatorio na configuracao e nao
 * tem valor padrao nosso: um texto legal que diga "CODECA Build" no site do
 * cliente seria falso. Enquanto ninguem preencher, o site nao afirma
 * controlador nenhum -- e melhor faltar do que mentir.
 *
 * **Nada e classificado como necessario por conveniencia.** A categoria de
 * cada ferramenta e declarada por quem a instalou, uma por uma. A lista comeca
 * vazia: a plataforma nao sabe o que o site de cada cliente carrega, e
 * adivinhar aqui viraria uma politica de cookies ficticia.
 *
 * O enum de categorias e **repetido** no `@codeca/sdk` de proposito: o pacote
 * nao tem dependencia nenhuma, e fazer o site do cliente baixar o
 * `@codeca/shared` (com zod dentro) para saber quatro palavras seria um custo
 * sem retorno. Os dois lados sao conferidos pelos testes.
 */

export const CONSENT_CATEGORIES = ['necessarios', 'preferencias', 'estatisticas', 'marketing'] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

/**
 * Nome de cada categoria para quem le a tela.
 *
 * Os textos longos que o visitante ve vivem no `@codeca/sdk`, junto do banner.
 * Aqui ficam so os rotulos curtos do painel mestre.
 */
export const CONSENT_CATEGORY_LABELS: Readonly<Record<ConsentCategory, string>> = {
  necessarios: 'Necessários',
  preferencias: 'Preferências',
  estatisticas: 'Estatísticas',
  marketing: 'Marketing',
};

/** Versao do mecanismo no SDK. Serve para conferir o que gerou um registro. */
export const CONSENT_ENGINE_VERSION = '1';

/** Teto de ferramentas declaradas por site. Alto o bastante para o caso real. */
export const MAX_CONSENT_TOOLS_PER_SITE = 30;

/**
 * Uma ferramenta que o site carrega e o que ela deixa no navegador.
 *
 * `cookies` aceita o nome exato ou um prefixo com `*` -- o Google Analytics
 * grava `_ga_<id>`, que muda por propriedade, e exigir o nome completo
 * obrigaria a mentir ou a deixar em branco.
 */
export const consentToolSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(SLUG_PATTERN, 'Use letras minúsculas, números e hífen.'),
  name: z.string().trim().min(1, 'Informe o nome da ferramenta.').max(80),
  provider: z.string().trim().max(80).default(''),
  category: z.enum(CONSENT_CATEGORIES),
  purpose: z.string().trim().max(300).default(''),
  cookies: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  privacyUrl: z.union([z.literal(''), httpsUrlSchema]).default(''),
});
export type ConsentTool = z.output<typeof consentToolSchema>;

/**
 * Configuracao de cookies de um site, como o painel mestre a grava.
 *
 * `recordConsent` desligado e um pedido legitimo: o cliente que prefere nao
 * ter registro de escolha guardado na CODECA desliga, e a rota publica para de
 * gravar. A escolha do visitante continua valendo -- ela mora no navegador
 * dele, nao aqui.
 */
export const siteCookieSettingsSchema = z.object({
  controllerName: z.string().trim().max(160).default(''),
  controllerDocument: z.string().trim().max(32).default(''),
  controllerContact: z.union([z.literal(''), emailSchema]).default(''),
  privacyPolicyUrl: z.union([z.literal(''), httpsUrlSchema]).default(''),
  cookiePolicyUrl: z.union([z.literal(''), httpsUrlSchema]).default(''),
  /**
   * Versao da politica vigente.
   *
   * Mudar este valor derruba a escolha guardada em todos os navegadores e faz
   * o banner voltar. E o unico jeito honesto de pedir de novo quando o que se
   * pede mudou -- e por isso e um campo que alguem digita, nao um numero que a
   * plataforma incrementa sozinha.
   */
  policyVersion: z.string().trim().min(1, 'Informe a versão da política.').max(20).default('1'),
  bannerEnabled: z.boolean().default(true),
  recordConsent: z.boolean().default(true),
  tools: z.array(consentToolSchema).max(MAX_CONSENT_TOOLS_PER_SITE).default([]),
});
export type SiteCookieSettingsInput = z.input<typeof siteCookieSettingsSchema>;
export type SiteCookieSettings = z.output<typeof siteCookieSettingsSchema>;

/** O que um site recebe quando ainda nao foi configurado. */
export const DEFAULT_SITE_COOKIE_SETTINGS: SiteCookieSettings = {
  controllerName: '',
  controllerDocument: '',
  controllerContact: '',
  privacyPolicyUrl: '',
  cookiePolicyUrl: '',
  policyVersion: '1',
  bannerEnabled: true,
  recordConsent: true,
  tools: [],
};

/**
 * O registro que o navegador do visitante envia.
 *
 * E o `ConsentRecord` do SDK, conferido na entrada. Repare no que **nao** esta
 * aqui: nao ha IP, nao ha agente do navegador e nao ha identificador de
 * visitante. `id` e sorteado no navegador e serve para a mesma decisao, se
 * reenviada, nao virar duas linhas -- nao para reconhecer quem decidiu.
 */
export const consentReportSchema = z.object({
  id: z.string().trim().min(8).max(64),
  decidedAt: z.string().trim().min(10).max(40),
  domain: z.string().trim().max(253).default(''),
  granted: z.array(z.enum(CONSENT_CATEGORIES)).max(CONSENT_CATEGORIES.length),
  denied: z.array(z.enum(CONSENT_CATEGORIES)).max(CONSENT_CATEGORIES.length),
  policyVersion: z.string().trim().min(1).max(20),
  engineVersion: z.string().trim().min(1).max(20),
});
export type ConsentReport = z.output<typeof consentReportSchema>;

/**
 * O que o site do cliente le em `GET /api/v1/consent/settings`.
 *
 * E a configuracao menos o que nao e do visitante: `recordConsent` fica de
 * fora porque e combinacao entre o cliente e a CODECA, nao informacao de quem
 * esta decidindo sobre os proprios cookies.
 */
export const publicCookieSettingsSchema = z.object({
  controllerName: z.string(),
  controllerDocument: z.string(),
  controllerContact: z.string(),
  privacyPolicyUrl: z.string(),
  cookiePolicyUrl: z.string(),
  policyVersion: z.string(),
  bannerEnabled: z.boolean(),
  tools: z.array(consentToolSchema),
});
export type PublicCookieSettings = z.output<typeof publicCookieSettingsSchema>;

/** Contagem de escolhas de um site, para o painel mestre. */
export interface ConsentSummary {
  total: number;
  /** Quantos autorizaram cada categoria opcional. */
  granted: Record<ConsentCategory, number>;
  /** Comeco da janela medida, em ISO. `null` quando nao ha registro. */
  firstAt: string | null;
  lastAt: string | null;
}

/**
 * Prazo de guarda do registro de escolha.
 *
 * A lei nao fixa um numero. Guardar para sempre contraria a propria LGPD
 * (artigo 15: o tratamento termina quando a finalidade se cumpre) e guardar de
 * menos deixa a empresa sem como provar o consentimento que praticou. Tres
 * anos cobre o prazo comum de reclamacao e e o que a documentacao declara.
 */
export const CONSENT_RECORD_RETENTION_DAYS = 3 * 365;
