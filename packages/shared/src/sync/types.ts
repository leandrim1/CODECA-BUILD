import { z } from 'zod';
import { IMPORT_TARGETS, importTargetLabel, type ImportTarget } from '../import/types.js';

/**
 * Contratos da sincronizacao com o site de origem.
 *
 * A importacao traz o site **uma vez**. A sincronizacao mantem a ligacao viva:
 * revisita a origem, descobre o que mudou la, e oferece ao cliente -- sempre a
 * ele -- a decisao de trazer ou nao.
 *
 * Os destinos (`ImportTarget`) sao os mesmos da importacao, de proposito: e o
 * mesmo conteudo nos mesmos modulos, visto num segundo momento. Um tipo
 * paralelo faria "servicos" significar coisas diferentes em duas telas.
 */

export { IMPORT_TARGETS as SYNC_TARGETS, importTargetLabel as syncTargetLabel };
export type { ImportTarget as SyncTarget };

// ------------------------------------------------------------ frequencia

/**
 * De quanto em quanto tempo revisitar a origem.
 *
 * `manual` nao e "desligado": a fonte continua ligada e o cliente verifica
 * quando quiser. Desligar e `desconectar`, que e outra coisa.
 */
export const SYNC_FREQUENCIES = ['6h', '12h', 'diaria', '3dias', 'semanal', 'manual'] as const;
export type SyncFrequency = (typeof SYNC_FREQUENCIES)[number];

export const SYNC_FREQUENCY_LABELS: Record<SyncFrequency, string> = {
  '6h': 'A cada 6 horas',
  '12h': 'A cada 12 horas',
  diaria: 'Diariamente',
  '3dias': 'A cada 3 dias',
  semanal: 'Semanalmente',
  manual: 'Somente quando eu pedir',
};

/** Intervalo de cada frequencia, em minutos. `manual` nao agenda nada. */
export const SYNC_FREQUENCY_MINUTES: Record<SyncFrequency, number | null> = {
  '6h': 6 * 60,
  '12h': 12 * 60,
  diaria: 24 * 60,
  '3dias': 3 * 24 * 60,
  semanal: 7 * 24 * 60,
  manual: null,
};

/**
 * Quando a proxima verificacao **deveria** acontecer, pela preferencia.
 *
 * "Deveria" e a palavra exata: o momento em que ela vai de fato acontecer
 * depende de quando o agendador da plataforma roda, que e outra coisa e esta
 * em `SCHEDULER_NOTE`. A tela mostra os dois, porque prometer 6 horas e
 * entregar 24 seria mentir para o cliente.
 */
export function nextCheckAt(
  frequency: SyncFrequency,
  from: Date,
): Date | null {
  const minutos = SYNC_FREQUENCY_MINUTES[frequency];
  if (minutos === null) return null;
  return new Date(from.getTime() + minutos * 60_000);
}

/**
 * O que a plataforma consegue cumprir, e por que.
 *
 * O agendador passa de 6 em 6 horas, no minuto 47: e o cron `/api/sync/run`
 * declarado em `vercel.json`. Com ele, todas as frequencias oferecidas na
 * tela sao atendidas na cadencia escolhida -- a menor delas e justamente 6
 * horas. A verificacao tambem continua acontecendo no job diario de
 * reconciliacao, que serve de rede de seguranca se o cron de 6 horas falhar.
 *
 * Este numero e o do **agendador**, nao o da preferencia do cliente: uma fonte
 * configurada para semanal continua vencendo a cada sete dias. O que ele diz e
 * de quanto em quanto tempo a plataforma olha a fila.
 *
 * Depende do plano da Vercel aceitar agendamento mais frequente que diario. Se
 * a instalacao estiver num plano que so dispara uma vez ao dia, esta constante
 * precisa voltar para `24 * 60` -- senao a tela deixa de avisar o cliente de
 * que a cadencia real e menor que a escolhida. Ver
 * `docs/sincronizacao-de-sites.md`.
 */
export const SCHEDULER_NOTE =
  'A plataforma verifica as fontes a cada 6 horas. Frequências menores que isso entram na fila e são atendidas na verificação seguinte.';

/** Intervalo real entre passagens do agendador, em minutos. */
export const SCHEDULER_INTERVAL_MINUTES = 6 * 60;

/** `true` quando a preferencia pede mais do que o agendador entrega. */
export function frequencyExceedsScheduler(frequency: SyncFrequency): boolean {
  const minutos = SYNC_FREQUENCY_MINUTES[frequency];
  return minutos !== null && minutos < SCHEDULER_INTERVAL_MINUTES;
}

// --------------------------------------------------------------- estados

/** Situacao da ligacao com a origem. */
export const SYNC_SOURCE_STATES = ['ativa', 'pausada', 'verificando', 'erro'] as const;
export type SyncSourceState = (typeof SYNC_SOURCE_STATES)[number];

export const SYNC_SOURCE_STATE_LABELS: Record<SyncSourceState, string> = {
  ativa: 'Sincronização ativa',
  pausada: 'Sincronização pausada',
  verificando: 'Verificando agora',
  erro: 'Erro na verificação',
};

/** Resultado de uma verificacao. */
export const SYNC_CHECK_STATES = ['verificando', 'concluida', 'erro'] as const;
export type SyncCheckState = (typeof SYNC_CHECK_STATES)[number];

/** Quem disparou a verificacao. */
export const SYNC_TRIGGERS = ['agendada', 'manual', 'primeira'] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

// ----------------------------------------------------- tipos de alteracao

/**
 * O que aconteceu com um conteudo entre uma verificacao e outra.
 *
 * Separar imagem do resto nao e capricho: a tela mostra imagem lado a lado, e
 * remover uma imagem tem consequencia diferente de remover um texto.
 */
export const SYNC_CHANGE_TYPES = [
  'novo',
  'modificado',
  'removido',
  'imagem_nova',
  'imagem_modificada',
  'imagem_removida',
] as const;
export type SyncChangeType = (typeof SYNC_CHANGE_TYPES)[number];

export const SYNC_CHANGE_TYPE_LABELS: Record<SyncChangeType, string> = {
  novo: 'Novo conteúdo',
  modificado: 'Conteúdo modificado',
  removido: 'Conteúdo removido',
  imagem_nova: 'Nova imagem',
  imagem_modificada: 'Imagem modificada',
  imagem_removida: 'Imagem removida',
};

export function isRemoval(type: SyncChangeType): boolean {
  return type === 'removido' || type === 'imagem_removida';
}

export function isImageChange(type: SyncChangeType): boolean {
  return type === 'imagem_nova' || type === 'imagem_modificada' || type === 'imagem_removida';
}

// ---------------------------------------------------------------- decisao

/**
 * O que o cliente decidiu sobre a alteracao.
 *
 * `pendente` e o padrao de tudo: a regra do produto e que nada entra sem
 * autorizacao, e um padrao diferente de `pendente` tornaria "aprovar" um
 * clique que o cliente poderia nunca dar conscientemente.
 */
export const SYNC_DECISIONS = ['pendente', 'aprovada', 'ignorada', 'manter_atual'] as const;
export type SyncDecision = (typeof SYNC_DECISIONS)[number];

export const SYNC_DECISION_LABELS: Record<SyncDecision, string> = {
  pendente: 'Aguardando decisão',
  aprovada: 'Aprovada',
  ignorada: 'Ignorada',
  manter_atual: 'Manter o conteúdo atual',
};

/** O que fazer com um conteudo que sumiu da origem. */
export const REMOVAL_ACTIONS = ['manter', 'arquivar', 'excluir'] as const;
export type RemovalAction = (typeof REMOVAL_ACTIONS)[number];

export const REMOVAL_ACTION_LABELS: Record<RemovalAction, string> = {
  manter: 'Manter na CODECA Build',
  arquivar: 'Arquivar',
  excluir: 'Excluir',
};

/** O que aconteceu depois de aplicar. */
export const SYNC_OUTCOMES = ['pendente', 'aplicada', 'ignorada', 'falhou', 'revertida'] as const;
export type SyncOutcome = (typeof SYNC_OUTCOMES)[number];

// -------------------------------------------------------------- conflito

/**
 * Como resolver quando o cliente editou o campo no painel **e** a origem
 * tambem mudou.
 *
 * Sem `editar_manualmente` como acao do servidor: "comparar e editar a mao" e
 * a tela mandando o cliente para o modulo, com os dois textos a vista. Fingir
 * que isso e uma terceira gravacao automatica sugeriria uma fusao de textos
 * que ninguem sabe fazer com seguranca.
 */
export const CONFLICT_CHOICES = ['manter_codeca', 'usar_origem'] as const;
export type ConflictChoice = (typeof CONFLICT_CHOICES)[number];

export const CONFLICT_CHOICE_LABELS: Record<ConflictChoice, string> = {
  manter_codeca: 'Manter a versão da CODECA Build',
  usar_origem: 'Usar a versão do site de origem',
};

// --------------------------------------------------------------- limites

/**
 * Limites da sincronizacao.
 *
 * Herdam o espirito dos limites da importacao: a origem e o site de um
 * terceiro, e uma verificacao periodica mal calibrada vira trafego indesejado
 * contra ele todo dia, para sempre.
 */
export const SYNC_LIMITS = {
  /** Fontes processadas por passagem do agendador. */
  sourcesPerRun: 20,
  /** Tempo de uma passagem, com folga para a resposta sair dos 60 s da funcao. */
  runBudgetMs: 45_000,
  /** Tempo de uma fonte dentro da passagem. */
  sourceBudgetMs: 20_000,
  /** Verificacoes manuais por empresa, por hora. */
  manualChecksPerHour: 6,
  /** Falhas seguidas antes de pausar a fonte sozinha. */
  maxConsecutiveFailures: 5,
  /** Minutos do primeiro adiamento depois de uma falha; dobra a cada uma. */
  backoffBaseMinutes: 60,
  /** Teto do adiamento. */
  backoffMaxMinutes: 24 * 60,
  /** Alteracoes guardadas por verificacao. */
  maxChangesPerCheck: 300,
  /** Verificacoes mantidas no historico por fonte. */
  historyLimit: 50,
  /** Dias que uma alteracao pendente continua valendo. */
  pendingRetentionDays: 60,
} as const;

// ------------------------------------------------------------- validacao

export const connectSourceSchema = z.object({
  url: z.string().trim().min(1, 'Informe o endereço do site de origem.').max(2048),
  frequency: z.enum(SYNC_FREQUENCIES).default('semanal'),
});
export type ConnectSourceInput = z.infer<typeof connectSourceSchema>;

export const updateSourceSchema = z.object({
  frequency: z.enum(SYNC_FREQUENCIES).optional(),
  /** `true` pausa, `false` retoma. */
  paused: z.boolean().optional(),
});
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>;

export const decideChangeSchema = z.object({
  changeId: z.string().uuid(),
  decision: z.enum(SYNC_DECISIONS),
  /** Só tem efeito quando a alteração está em conflito. */
  conflictChoice: z.enum(CONFLICT_CHOICES).optional(),
  /** Só tem efeito quando a alteração é uma remoção. */
  removalAction: z.enum(REMOVAL_ACTIONS).optional(),
});

export const decideChangesSchema = z.object({
  items: z.array(decideChangeSchema).min(1).max(500),
});
export type DecideChangesInput = z.infer<typeof decideChangesSchema>;

/**
 * Aplicacao das alteracoes aprovadas.
 *
 * `confirm` explicito no corpo, como na importacao: esta rota grava conteudo
 * em varios modulos de uma vez, e um POST disparado por engano teria efeito
 * largo.
 */
export const applyChangesSchema = z.object({
  confirm: z.literal(true),
  /** Destinos aceitos. Vazio aplica todos os aprovados. */
  targets: z.array(z.enum(IMPORT_TARGETS)).max(IMPORT_TARGETS.length).default([]),
});
export type ApplyChangesInput = z.infer<typeof applyChangesSchema>;

// -------------------------------------------------------------- respostas

/** Uma pagina acompanhada pela sincronizacao. */
export interface SyncPageView {
  url: string;
  /** Ultima vez que a pagina respondeu. */
  lastSeenAt: string | null;
  /** Desde quando a pagina nao responde. Nulo quando ela esta no ar. */
  missingSince: string | null;
  status: number;
  /** `true` quando a ultima verificacao usou requisicao condicional e a pagina nao mudou. */
  unchanged: boolean;
}

export interface SyncChangeView {
  id: string;
  target: ImportTarget;
  targetLabel: string;
  /** Campo do modulo de documento; vazio em registro e imagem. */
  fieldKey: string;
  /** Nome do conteudo, como aparece na revisao. */
  label: string;
  type: SyncChangeType;
  typeLabel: string;
  /** Pagina da origem que produziu a alteracao. */
  pageUrl: string;
  /** O que a origem dizia na ultima sincronizacao. */
  baselinePreview: string;
  /** O que a origem diz agora. */
  sourcePreview: string;
  /** O que esta na CODECA Build agora. */
  codecaPreview: string;
  /** Valor cru da origem, para a tela montar comparacao de imagem. */
  sourceValue: unknown;
  /** Endereco da imagem na origem, quando a alteracao e de imagem. */
  sourceImageUrl: string | null;
  /** Endereco da imagem que esta na biblioteca, quando ha uma. */
  codecaImageUrl: string | null;
  /**
   * `true` quando o cliente editou este conteudo no painel depois da ultima
   * sincronizacao **e** a origem tambem mudou.
   */
  conflict: boolean;
  decision: SyncDecision;
  conflictChoice: ConflictChoice | null;
  removalAction: RemovalAction | null;
  outcome: SyncOutcome;
  detectedAt: string;
  appliedAt: string | null;
  approvedByName: string;
  error: string;
  /** `true` quando o modulo de destino nao esta habilitado para este site. */
  targetDisabled: boolean;
}

export interface SyncCheckView {
  id: string;
  state: SyncCheckState;
  trigger: SyncTrigger;
  startedAt: string;
  finishedAt: string | null;
  pagesChecked: number;
  pagesUnchanged: number;
  pagesFailed: number;
  changesFound: number;
  changesApproved: number;
  changesIgnored: number;
  conflicts: number;
  message: string;
  triggeredByName: string;
}

export interface SyncSourceView {
  id: string;
  sourceUrl: string;
  state: SyncSourceState;
  frequency: SyncFrequency;
  frequencyLabel: string;
  /** Aviso quando a preferencia pede mais do que o agendador entrega. */
  schedulerNote: string | null;
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
  /** Quando a fonte vence pela preferencia. Nulo em `manual`. */
  nextCheckAt: string | null;
  changesFound: number;
  changesPending: number;
  conflictsPending: number;
  removalsPending: number;
  consecutiveFailures: number;
  lastError: string;
  pages: SyncPageView[];
  createdAt: string;
}

export interface SyncOverviewView {
  source: SyncSourceView | null;
  checks: SyncCheckView[];
  changes: SyncChangeView[];
  limits: {
    manualChecksPerHour: number;
    maxChangesPerCheck: number;
  };
  /** Explicacao do agendador, sempre visivel na tela. */
  schedulerNote: string;
}

/** Resultado de aplicar as alteracoes aprovadas. */
export interface SyncApplyResult {
  applied: number;
  failed: number;
  skipped: number;
  archived: number;
  deleted: number;
  mediaCreated: number;
  message: string;
}

/**
 * Aviso curto para o painel, quando ha o que revisar.
 *
 * Entra na visao geral para o cliente nao precisar abrir a tela de
 * sincronizacao para descobrir que existe algo esperando por ele.
 */
export interface SyncNotice {
  /** Alteracoes aguardando decisao. */
  pending: number;
  conflicts: number;
  removals: number;
  state: SyncSourceState;
  message: string;
}

/**
 * Frase do aviso, com os numeros reais.
 *
 * Nunca um exemplo: os numeros sao contados do banco, e quando nao ha nada a
 * funcao devolve `null` em vez de uma frase com zeros.
 */
export function syncNoticeMessage(input: {
  pending: number;
  conflicts: number;
  removals: number;
}): string | null {
  if (input.pending === 0) return null;

  const base =
    input.pending === 1
      ? 'Encontramos 1 atualização no seu site de origem.'
      : `Encontramos ${input.pending} atualizações no seu site de origem.`;

  const extras: string[] = [];
  if (input.conflicts > 0) {
    extras.push(
      input.conflicts === 1
        ? '1 delas conflita com uma edição sua'
        : `${input.conflicts} delas conflitam com edições suas`,
    );
  }
  if (input.removals > 0) {
    extras.push(
      input.removals === 1
        ? '1 conteúdo saiu do ar na origem'
        : `${input.removals} conteúdos saíram do ar na origem`,
    );
  }

  const cauda = extras.length > 0 ? ` ${extras.join(' e ')}.` : '';
  return `${base}${cauda} Revise os conteúdos para atualizar seu site na CODECA Build.`;
}
