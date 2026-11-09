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
 * O que a plataforma consegue cumprir, e como ela sabe disso.
 *
 * ## O piso, que nao depende de ninguem
 *
 * O plano da Vercel em uso e o gratuito, que dispara cada agendamento **uma
 * vez por dia**. Sao dois, o teto do plano: a reconciliacao as 05:23 (que
 * tambem roda uma passagem da sincronizacao) e `/api/sync/run` as 17:47. Na
 * pratica as fontes sao olhadas duas vezes ao dia; o que esta **garantido** e
 * uma. Esse e o piso, e vale sempre.
 *
 * ## A cadencia maior, que precisa ser provada
 *
 * Um agendador externo (cron-job.org e afins) pode chamar `/api/sync/run` de
 * 6 em 6 horas. Mas ele vive fora daqui: pode nunca ter sido configurado,
 * pode ter sido apagado, pode estar com a conta suspensa. Por isso a
 * plataforma **nao acredita em configuracao, ela mede**. Cada passagem grava
 * uma linha em `sync_runs` com a origem; a cadencia anunciada ao cliente sai
 * do historico real dessas linhas, nunca de um valor que alguem digitou.
 *
 * A consequencia e a regra que importa: enquanto nao houver execucoes
 * externas suficientes e recentes, a tela continua dizendo "uma vez por dia".
 * Ela so passa a falar em 6 horas depois de ter visto 6 horas acontecer.
 *
 * ## O que este numero nao e
 *
 * Nao e a preferencia do cliente: uma fonte em "semanal" continua vencendo a
 * cada sete dias. O que ele diz e de quanto em quanto tempo a plataforma olha
 * a fila.
 */

/** Piso garantido pelos dois agendamentos da Vercel, sozinhos. Em minutos. */
export const SCHEDULER_BASELINE_MINUTES = 24 * 60;

/**
 * Nome antigo do piso, mantido para nao quebrar quem ja importava.
 *
 * Quem decide o que a tela mostra agora e `effectiveSchedulerMinutes`, que
 * leva em conta o que foi medido.
 */
export const SCHEDULER_INTERVAL_MINUTES = SCHEDULER_BASELINE_MINUTES;

/** Regras para aceitar que o agendador externo existe de verdade. */
export const SCHEDULER_VALIDATION = {
  /** Execucoes externas bem sucedidas necessarias para confiar na medida. */
  minRuns: 3,
  /** Janela de observacao. Execucao velha nao prova cadencia de hoje. */
  windowDays: 7,
} as const;

// ------------------------------------------------- execucoes do agendador

/** Quem disparou uma passagem do agendador. */
export const SYNC_RUN_ORIGINS = ['vercel', 'externo', 'manual'] as const;
export type SyncRunOrigin = (typeof SYNC_RUN_ORIGINS)[number];

export const SYNC_RUN_ORIGIN_LABELS: Record<SyncRunOrigin, string> = {
  vercel: 'Agendamento da Vercel',
  externo: 'Agendador externo',
  manual: 'Disparo manual',
};

/**
 * Situacao de uma passagem.
 *
 * `expirada` e a passagem que comecou e nunca terminou -- a funcao morreu no
 * meio. Nao e sucesso nem falha de verificacao: e ausencia de resposta, e
 * precisa de nome proprio para nao contar como nenhuma das duas na cadencia.
 */
export const SYNC_RUN_STATES = ['executando', 'concluida', 'falhou', 'expirada'] as const;
export type SyncRunState = (typeof SYNC_RUN_STATES)[number];

/**
 * O que uma passagem de fato fez.
 *
 * Separar isto do estado tecnico (`SyncRunState`) e o que conserta a leitura
 * do historico. Uma passagem pode terminar **bem** sem ter feito nada --
 * porque nada venceu --, e isso nao e sucesso nem falha: e uma terceira
 * coisa, e so nomeando-a da para a tela parar de mostrar "concluida, 0
 * sites" como se fosse problema, ou como se fosse trabalho.
 */
export type SyncRunOutcome =
  /** Nao ha fonte conectada em lugar nenhum. */
  | 'sem_fontes'
  /** Ha fontes, nenhuma venceu ainda. Normal, e o caso mais comum. */
  | 'nada_vencido'
  /** Fontes venceram e foram verificadas. */
  | 'verificou'
  /** Fontes venceram e **nao** foram verificadas. Isto e problema. */
  | 'vencidas_nao_processadas'
  /** A passagem nao chegou ao fim. */
  | 'falhou';

/**
 * Deduz o que a passagem fez, a partir dos numeros que ela gravou.
 *
 * Funcao pura, no pacote compartilhado, para a tela e o servidor nunca
 * divergirem sobre o que "concluida com zero" significa.
 */
export function syncRunOutcome(run: SyncRunSummary): SyncRunOutcome {
  if (run.state === 'falhou' || run.state === 'expirada') return 'falhou';
  if (run.sourcesChecked > 0) return 'verificou';
  if (run.sourcesConnected === 0) return 'sem_fontes';
  if (run.sourcesDue === 0) return 'nada_vencido';
  // Havia fonte vencida e ninguem a verificou: o unico caso que merece alarme.
  return 'vencidas_nao_processadas';
}

/** Frase do resultado, com os numeros reais. */
export function syncRunOutcomeLabel(run: SyncRunSummary): string {
  switch (syncRunOutcome(run)) {
    case 'falhou':
      return run.error !== '' ? run.error : 'A verificação não foi concluída.';
    case 'sem_fontes':
      return 'Nenhum site de origem conectado ainda.';
    case 'nada_vencido':
      return `Nada a verificar: ${run.sourcesConnected} ${
        run.sourcesConnected === 1 ? 'site conectado' : 'sites conectados'
      }, nenhum vencido neste horário.`;
    case 'vencidas_nao_processadas':
      return `${run.sourcesDue} ${
        run.sourcesDue === 1 ? 'site estava vencido' : 'sites estavam vencidos'
      } e não foram verificados.`;
    case 'verificou':
    default:
      return `${run.sourcesChecked} ${
        run.sourcesChecked === 1 ? 'site verificado' : 'sites verificados'
      }${run.changesFound > 0 ? `, ${run.changesFound} alteração(ões) encontrada(s)` : ', sem alterações'}.`;
  }
}

/** Retrato de uma passagem, para a tela. */
export interface SyncRunSummary {
  id: string;
  origin: SyncRunOrigin;
  state: SyncRunState;
  /** A fila no instante da passagem. Da denominador ao zero. */
  sourcesConnected: number;
  sourcesPaused: number;
  sourcesDue: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  sourcesClaimed: number;
  sourcesChecked: number;
  sourcesFailed: number;
  changesFound: number;
  error: string;
}

/**
 * O que a tela precisa saber sobre o agendador.
 *
 * Separa com todas as letras o que e **garantido** do que foi **observado**,
 * porque a tela mostra os dois e eles querem dizer coisas diferentes.
 */
export interface SchedulerStatus {
  /** Piso dos agendamentos da Vercel. Sempre verdadeiro. */
  baselineMinutes: number;
  /** Maior intervalo medido entre passagens recentes. `null` sem historico. */
  observedMinutes: number | null;
  /** Execucoes externas bem sucedidas na janela. */
  externalRuns: number;
  /** `true` quando ha medida suficiente para confiar no intervalo observado. */
  externalValidated: boolean;
  lastRun: SyncRunSummary | null;
}

/**
 * O intervalo que a plataforma pode afirmar, em minutos.
 *
 * Sem medida validada, devolve o piso -- nunca a promessa. Com medida, devolve
 * a **pior** das duas, porque uma cadencia so vale pelo seu pior intervalo:
 * um agendador que roda de 6 em 6 horas mas pulou uma noite entregou 12, e e
 * 12 que o cliente precisa ouvir.
 */
export function effectiveSchedulerMinutes(status: SchedulerStatus): number {
  if (!status.externalValidated || status.observedMinutes === null) {
    return status.baselineMinutes;
  }
  return Math.min(status.baselineMinutes, status.observedMinutes);
}

/**
 * `true` quando a preferencia pede mais do que o agendador entrega.
 *
 * O segundo parametro e o intervalo real; sem ele vale o piso, que e a
 * resposta certa para quem nao tem como medir (o painel antes de carregar, um
 * teste de unidade sobre a tabela de frequencias).
 */
export function frequencyExceedsScheduler(
  frequency: SyncFrequency,
  schedulerMinutes: number = SCHEDULER_BASELINE_MINUTES,
): boolean {
  const minutos = SYNC_FREQUENCY_MINUTES[frequency];
  return minutos !== null && minutos < schedulerMinutes;
}

/** Intervalo em minutos escrito como a tela fala. */
export function describeInterval(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} minutos`;
  const horas = minutes / 60;
  if (horas < 24) {
    const inteiras = Math.floor(horas);
    const resto = Math.round((horas - inteiras) * 60);
    if (resto === 0) return inteiras === 1 ? 'uma hora' : `${inteiras} horas`;
    return `${inteiras}h${String(resto).padStart(2, '0')}`;
  }
  const dias = Math.round((horas / 24) * 10) / 10;
  return dias === 1 ? 'um dia' : `${dias} dias`.replace('.', ',');
}

/**
 * A frase que a tela mostra sobre a cadencia.
 *
 * Nunca anuncia o que nao foi medido: sem agendador externo validado, fala do
 * piso e diz o que falta para a cadencia maior valer.
 */
export function schedulerNote(status: SchedulerStatus): string {
  const efetivo = effectiveSchedulerMinutes(status);
  if (!status.externalValidated) {
    return (
      `A plataforma verifica as fontes ${
        describeInterval(status.baselineMinutes) === 'um dia'
          ? 'uma vez por dia'
          : `a cada ${describeInterval(status.baselineMinutes)}`
      }. Frequências menores entram na fila e são atendidas na verificação seguinte.`
    );
  }
  return (
    `A plataforma verifica as fontes a cada ${describeInterval(efetivo)}, `
    + `medido nas últimas ${status.externalRuns} execuções do agendador externo. `
    + 'Frequências menores que isso entram na fila e são atendidas na verificação seguinte.'
  );
}

/**
 * Apura o estado do agendador a partir das passagens ja gravadas.
 *
 * ## Por que o **pior** intervalo, e nao a media
 *
 * Cadencia e uma promessa de teto, nao de media. Um agendador que roda de 6
 * em 6 horas mas pulou uma noite entregou 12 horas naquele dia, e e 12 que o
 * cliente precisa ouvir -- a media de 6h30 esconderia exatamente o buraco que
 * importa.
 *
 * ## Por que o intervalo ate agora conta como um intervalo
 *
 * Sem isso, um agendador externo que parou ontem continuaria exibindo "a cada
 * 6 horas" para sempre, apoiado em execucoes antigas. Contando o tempo desde
 * a ultima passagem, a medida se degrada sozinha: o buraco cresce, o
 * intervalo observado passa do piso, e a tela volta a dizer "uma vez por dia"
 * sem ninguem precisar desligar nada.
 *
 * Recebe apenas as passagens **concluidas** da janela; as que falharam ou
 * expiraram nao provam cadencia nenhuma, e sao justamente elas que precisam
 * abrir um buraco na medida.
 */
export function computeSchedulerStatus(input: {
  now: Date;
  /** Passagens concluidas na janela, em qualquer ordem. */
  runs: readonly { origin: SyncRunOrigin; startedAt: Date }[];
  lastRun: SyncRunSummary | null;
  baselineMinutes?: number;
}): SchedulerStatus {
  const baselineMinutes = input.baselineMinutes ?? SCHEDULER_BASELINE_MINUTES;
  const inicioJanela = new Date(
    input.now.getTime() - SCHEDULER_VALIDATION.windowDays * 24 * 60 * 60_000,
  );

  const naJanela = input.runs
    .filter((run) => run.startedAt >= inicioJanela && run.startedAt <= input.now)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const externalRuns = naJanela.filter((run) => run.origin === 'externo').length;

  const base: SchedulerStatus = {
    baselineMinutes,
    observedMinutes: null,
    externalRuns,
    externalValidated: false,
    lastRun: input.lastRun,
  };

  if (naJanela.length < SCHEDULER_VALIDATION.minRuns) return base;

  let piorMs = 0;
  for (let i = 1; i < naJanela.length; i += 1) {
    const anterior = naJanela[i - 1];
    const atual = naJanela[i];
    if (!anterior || !atual) continue;
    piorMs = Math.max(piorMs, atual.startedAt.getTime() - anterior.startedAt.getTime());
  }

  // O tempo desde a ultima passagem tambem e um intervalo, e e o que faz a
  // medida envelhecer sozinha quando o agendador externo para.
  const ultima = naJanela[naJanela.length - 1];
  if (ultima) piorMs = Math.max(piorMs, input.now.getTime() - ultima.startedAt.getTime());

  const observedMinutes = Math.round(piorMs / 60_000);

  return {
    ...base,
    observedMinutes,
    externalValidated:
      externalRuns >= SCHEDULER_VALIDATION.minRuns && observedMinutes < baselineMinutes,
  };
}

/** Frase do piso, para quem ainda nao carregou o estado do agendador. */
export const SCHEDULER_NOTE =
  'A plataforma verifica as fontes uma vez por dia. Frequências menores entram na fila e são atendidas na verificação seguinte.';

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
  /**
   * O que foi **medido** sobre o agendador, nao o que foi configurado.
   *
   * A tela mostra os dois numeros com nomes diferentes de proposito: o piso
   * que a Vercel garante sozinha, e o intervalo que o historico comprova. Sem
   * agendador externo validado os dois sao iguais, e nada de 6 horas e
   * anunciado.
   */
  scheduler: SchedulerStatus & {
    /** O intervalo que a plataforma pode afirmar hoje, em minutos. */
    effectiveMinutes: number;
    /** O mesmo, escrito como a tela fala. */
    effectiveLabel: string;
    baselineLabel: string;
  };
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
