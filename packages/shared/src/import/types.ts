import { z } from 'zod';
import type { SegmentGuess } from './segment.js';
import { MODULE_KEYS, MODULE_REGISTRY } from '../modules/registry.js';

/**
 * Contratos da importacao automatica de sites.
 *
 * Fonte unica dos estados, dos tipos de candidato e das decisoes. O banco, a
 * API e a tela leem daqui, para "aguardando confirmacao" significar a mesma
 * coisa nos tres.
 */

/**
 * Para onde um conteudo importado pode ir.
 *
 * Sao os modulos do registro **mais** `midia`. A biblioteca de imagens nao e
 * um modulo -- nao tem campos, nao e habilitada por site, e todo site a tem --
 * mas e destino de importacao como qualquer outro, e a revisao precisa
 * agrupa-la junto dos demais. Dai um tipo proprio em vez de esticar
 * `ModuleKey`, que vale so para o que o registro declara.
 */
export const MEDIA_TARGET = 'midia' as const;
export const IMPORT_TARGETS = [...MODULE_KEYS, MEDIA_TARGET] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export function isImportTarget(value: string): value is ImportTarget {
  return (IMPORT_TARGETS as readonly string[]).includes(value);
}

export function isMediaTarget(value: ImportTarget): value is typeof MEDIA_TARGET {
  return value === MEDIA_TARGET;
}

/** Nome em portugues do destino, para a tela e para as mensagens. */
export function importTargetLabel(target: ImportTarget): string {
  if (isMediaTarget(target)) return 'Biblioteca de imagens';
  return MODULE_REGISTRY[target].name;
}

/**
 * Estados de uma importacao, do ponto de vista do **servidor**.
 *
 * Sao os que o banco guarda. A tela mostra mais passos que isto (ver
 * `IMPORT_PROGRESS_STEPS`): "aguardando URL" acontece antes de existir
 * registro, e "analise concluida" e "aguardando confirmacao" sao o mesmo
 * estado visto em dois momentos -- inventar duas linhas no banco para o mesmo
 * fato daria dois caminhos para o mesmo lugar e um deles ficaria errado.
 */
export const IMPORT_STATES = [
  'validando',
  'analisando',
  'identificando',
  'processando_imagens',
  'analisada',
  'importando',
  'importada',
  'revertida',
  'erro',
] as const;
export type ImportState = (typeof IMPORT_STATES)[number];

/** Estados em que a analise ainda tem trabalho pendente. */
export const IMPORT_WORKING_STATES: readonly ImportState[] = [
  'validando',
  'analisando',
  'identificando',
  'processando_imagens',
];

export function isWorkingState(state: ImportState): boolean {
  return IMPORT_WORKING_STATES.includes(state);
}

/** Estados finais: nada mais acontece sem uma acao de quem opera. */
export function isFinalState(state: ImportState): boolean {
  return state === 'importada' || state === 'revertida' || state === 'erro';
}

/**
 * Passos exibidos na tela, na ordem.
 *
 * Derivados dos estados do servidor, com os dois que a tela conhece e o banco
 * nao. `state` nulo e um passo que nao corresponde a nenhuma linha.
 */
export const IMPORT_PROGRESS_STEPS: readonly {
  key: string;
  label: string;
  state: ImportState | null;
}[] = [
  { key: 'aguardando_url', label: 'Aguardando o endereço', state: null },
  { key: 'validando', label: 'Validando o endereço', state: 'validando' },
  { key: 'analisando', label: 'Analisando o site', state: 'analisando' },
  { key: 'identificando', label: 'Identificando os conteúdos', state: 'identificando' },
  { key: 'processando_imagens', label: 'Processando as imagens', state: 'processando_imagens' },
  { key: 'analisada', label: 'Análise concluída', state: 'analisada' },
  { key: 'importando', label: 'Importando as informações', state: 'importando' },
  { key: 'importada', label: 'Importação concluída', state: 'importada' },
];

/**
 * O que um candidato encontrado representa.
 *
 * - `documento_campo`: um campo de modulo de instancia unica (institucional,
 *   contato). O alvo e um campo, e por isso o conflito e campo a campo.
 * - `colecao_registro`: um registro novo de modulo de colecao (um servico, um
 *   depoimento, uma pergunta). Nao ha conflito de campo: ou o registro entra,
 *   ou nao entra.
 * - `imagem`: um arquivo para a biblioteca de imagens.
 */
export const IMPORT_ITEM_KINDS = ['documento_campo', 'colecao_registro', 'imagem'] as const;
export type ImportItemKind = (typeof IMPORT_ITEM_KINDS)[number];

/** O que quem opera decidiu sobre o candidato, antes de confirmar. */
export const IMPORT_DECISIONS = ['selecionado', 'ignorado'] as const;
export type ImportDecision = (typeof IMPORT_DECISIONS)[number];

/**
 * O que o candidato ja preenchido no painel deve fazer.
 *
 * Padrao `manter`: a regra do produto e nunca substituir conteudo cadastrado
 * sem autorizacao, e um padrao que substitui tornaria a autorizacao um detalhe
 * que se perde num clique.
 */
export const CONFLICT_RESOLUTIONS = ['manter', 'substituir'] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

/** O que aconteceu com o candidato depois de confirmar. */
export const IMPORT_OUTCOMES = ['pendente', 'importado', 'ignorado', 'falhou', 'revertido'] as const;
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];

/**
 * De onde o dado saiu.
 *
 * Guardado em cada candidato porque a regra "nao inventar informacao" so pode
 * ser conferida se cada valor apontar para a pagina e o sinal que o produziram.
 * Sem isto, "encontramos 6 servicos" e uma afirmacao sem prova.
 */
export const IMPORT_EVIDENCE_SOURCES = [
  'json_ld',
  'open_graph',
  'meta',
  'titulo',
  'cabecalho',
  'texto',
  'lista',
  'link',
  'imagem',
  'formulario',
  'rodape',
  'sitemap',
] as const;
export type ImportEvidenceSource = (typeof IMPORT_EVIDENCE_SOURCES)[number];

export interface ImportEvidence {
  /** Pagina de onde o valor veio. */
  pageUrl: string;
  source: ImportEvidenceSource;
  /** Trecho do site que originou o valor, para quem revisa conferir. */
  excerpt: string;
}

/** Uma pagina que a analise visitou. */
export interface AnalyzedPage {
  url: string;
  /** Codigo HTTP da resposta. 0 quando a requisicao nem completou. */
  status: number;
  title: string;
  /** Classificacao pelo endereco e pelo conteudo: `sobre`, `servicos`, ... */
  role: PageRole;
  /** Caracteres de texto visivel. */
  textLength: number;
  imageCount: number;
  /** Preenchido quando a pagina falhou. */
  error?: string;
  /**
   * `true` quando a pagina quase nao tem texto no HTML.
   *
   * Sinal de site renderizado no navegador: o HTML vem com a casca e o
   * conteudo entra depois, por JavaScript. A analise nao executa JavaScript,
   * entao esta marca e o que permite avisar quem revisa em vez de entregar uma
   * importacao vazia sem explicacao.
   */
  renderedByScript?: boolean;
  /** Conteudo veio do estado serializado no HTML, sem navegador. */
  fromEmbeddedState?: boolean;
  /** Pagina lida depois de um navegador montar o conteudo. */
  renderedWithBrowser?: boolean;
}

/**
 * Para que serve uma pagina.
 *
 * Decide de que modulo os candidatos daquela pagina saem. `outra` e o caso
 * honesto: a pagina foi lida, nada indicou o proposito, e o texto dela nao vai
 * ser atribuido a um modulo por chute.
 */
export const PAGE_ROLES = [
  'inicial',
  'sobre',
  'servicos',
  'produtos',
  'contato',
  'equipe',
  'galeria',
  'portfolio',
  'depoimentos',
  'faq',
  'imoveis',
  'outra',
] as const;
export type PageRole = (typeof PAGE_ROLES)[number];

/** Resumo exibido ao fim da analise. Numeros reais, nunca exemplo. */
export interface ImportSummary {
  pages: number;
  pagesFailed: number;
  images: number;
  /** Campos de institucional e contato com valor encontrado. */
  documentFields: number;
  /** Registros candidatos, por destino. */
  collectionRecords: Partial<Record<ImportTarget, number>>;
  /** Candidatos cujo modulo nao esta habilitado para este site. */
  skippedByModule: number;
  /** Candidatos que colidem com conteudo ja cadastrado. */
  conflicts: number;
  /** Candidatos iguais a outro da mesma analise. */
  duplicates: number;
  /** Texto encontrado que nao foi atribuido a nenhum campo. */
  unmapped: number;
  /**
   * Ramo sugerido para a empresa, com a confianca e os sinais.
   *
   * Sugestao, nunca aplicacao: trocar o segmento mexe nos modulos que o
   * painel abre, e isso e decisao de quem conhece o negocio. Ver
   * `guessSegment`.
   */
  segment?: SegmentGuess | null;
  /** Paginas que precisaram de navegador para render conteudo. */
  renderedPages?: number;
  /** Paginas cujo conteudo veio do estado serializado no HTML. */
  embeddedPages?: number;
}

export function emptySummary(): ImportSummary {
  return {
    pages: 0,
    pagesFailed: 0,
    images: 0,
    documentFields: 0,
    collectionRecords: {},
    skippedByModule: 0,
    conflicts: 0,
    duplicates: 0,
    unmapped: 0,
  };
}

// ------------------------------------------------------------- limites

/**
 * Limites do rastreamento.
 *
 * Nao sao numeros de gosto: a funcao da Vercel para em 60 s
 * (`vercel.json`), entao o trabalho total precisa caber em algumas fatias de
 * ~20 s. Acima de 25 paginas a analise deixa de ser "o site do cliente" e
 * passa a ser um rastreador, com o custo e o risco que isso traz.
 */
export const IMPORT_LIMITS = {
  /** Paginas visitadas por analise. */
  maxPages: 25,
  /** Saltos a partir da inicial. 2 alcanca "inicial -> menu -> item do menu". */
  maxDepth: 2,
  /** Imagens trazidas para a biblioteca por analise. */
  maxImages: 40,
  /** Bytes de uma resposta HTML. Acima disso, o conteudo e cortado. */
  maxHtmlBytes: 2 * 1024 * 1024,
  /** Bytes de uma imagem. O mesmo limite do upload pelo painel. */
  maxImageBytes: 4 * 1024 * 1024,
  /** Tempo de uma requisicao. */
  requestTimeoutMs: 10_000,
  /** Tempo de uma fatia de trabalho, com folga para a resposta sair. */
  sliceBudgetMs: 20_000,
  /** Saltos de redirecionamento, cada um validado de novo. */
  maxRedirects: 3,
  /**
   * Paginas que podem passar pelo navegador numa analise.
   *
   * Baixo de proposito, e nao por economia: renderizar executa o codigo de
   * terceiros, entao quanto menos vezes, melhor. Gasta-se nas paginas que a
   * leitura sem navegador nao resolveu, que sao poucas quando existem.
   */
  maxRenderedPages: 8,
  /** Paginas buscadas em paralelo. Baixo de proposito: e o site de um cliente. */
  concurrency: 3,
  /** Registros candidatos por modulo de colecao. */
  maxRecordsPerModule: 30,
  /** Analises por empresa, por hora. */
  maxRunsPerHour: 10,
  /** Dias que uma analise fica disponivel para confirmar ou reverter. */
  retentionDays: 30,
} as const;

// ------------------------------------------------------------- validacao

export const startImportSchema = z.object({
  /**
   * Endereco informado pelo cliente. Validado de novo no servidor por
   * `checkImportUrl` -- um schema de texto nao sabe o que e rede privada.
   */
  url: z.string().trim().min(1, 'Informe o endereco do site.').max(2048),
});
export type StartImportInput = z.infer<typeof startImportSchema>;

/**
 * Decisao sobre um candidato.
 *
 * `resolution` so tem efeito em `documento_campo` com conflito; nos outros o
 * campo e ignorado em vez de recusado, para a tela poder mandar a lista
 * inteira sem separar por tipo.
 */
export const reviewItemSchema = z.object({
  itemId: z.string().uuid(),
  decision: z.enum(IMPORT_DECISIONS),
  resolution: z.enum(CONFLICT_RESOLUTIONS).optional(),
});

export const reviewImportSchema = z.object({
  items: z.array(reviewItemSchema).min(1).max(1000),
});
export type ReviewImportInput = z.infer<typeof reviewImportSchema>;

/**
 * Confirmacao da importacao.
 *
 * `confirm` existe para a confirmacao ser explicita no corpo, e nao implicita
 * no metodo HTTP: esta rota grava conteudo em varios modulos de uma vez, e um
 * POST disparado por engano teria efeito largo.
 */
export const confirmImportSchema = z.object({
  confirm: z.literal(true),
  /** Destinos que o cliente aceitou. Vazio importa todos os selecionados. */
  targets: z.array(z.enum(IMPORT_TARGETS)).max(IMPORT_TARGETS.length).default([]),
});
export type ConfirmImportInput = z.infer<typeof confirmImportSchema>;

// ------------------------------------------------------------- respostas

export interface ImportItemView {
  id: string;
  kind: ImportItemKind;
  target: ImportTarget;
  /** Campo do documento, ou vazio em registro de colecao e imagem. */
  fieldKey: string;
  /** Rotulo em portugues do que isto preenche. */
  label: string;
  /** Valor que a analise propoe. */
  value: unknown;
  /** Como o valor aparece na revisao. */
  preview: string;
  /** Valor que ja esta no painel, quando ha conflito. */
  currentValue?: unknown;
  currentPreview?: string;
  decision: ImportDecision;
  resolution: ConflictResolution;
  outcome: ImportOutcome;
  conflict: boolean;
  duplicate: boolean;
  /** `true` quando o modulo de destino nao esta habilitado para este site. */
  targetDisabled: boolean;
  evidence: ImportEvidence;
  /** Preenchido quando o candidato falhou ao ser gravado. */
  error?: string;
  /** Identificador do registro criado, quando foi importado. */
  createdId?: string;
}

export interface ImportRunView {
  id: string;
  sourceUrl: string;
  state: ImportState;
  summary: ImportSummary;
  pages: AnalyzedPage[];
  /** Mensagem para quem opera. Nunca um rastro de pilha. */
  message: string;
  /** `true` enquanto a analise tem trabalho pendente. */
  working: boolean;
  startedAt: string;
  finishedAt: string | null;
  analyzedAt: string | null;
  importedAt: string | null;
  createdByName: string;
  /**
   * `true` quando a analise so achou a casca das paginas.
   *
   * Vale como aviso na tela: o site provavelmente monta o conteudo no
   * navegador, e a importacao vai trazer pouco.
   */
  likelyClientRendered: boolean;
}

export interface ImportDetailView extends ImportRunView {
  items: ImportItemView[];
}

/** Resultado da confirmacao. */
export interface ImportResultView {
  run: ImportRunView;
  imported: number;
  failed: number;
  skipped: number;
  /** Imagens efetivamente gravadas na biblioteca. */
  mediaCreated: number;
}
