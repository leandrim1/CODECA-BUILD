import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Link2Off,
  Pause,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  CONFLICT_CHOICE_LABELS,
  REMOVAL_ACTION_LABELS,
  SYNC_FREQUENCIES,
  SYNC_FREQUENCY_LABELS,
  SYNC_RUN_ORIGIN_LABELS,
  SYNC_SOURCE_STATE_LABELS,
  checkImportUrl,
  formatDateTime,
  isImageChange,
  isRemoval,
  type ConflictChoice,
  type RemovalAction,
  type SyncChangeView,
  type SyncFrequency,
  type SyncOverviewView,
  type SyncSourceState,
  type SyncTarget,
} from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useTenantId } from '../hooks/useAuth.js';
import { useMutation } from '../hooks/useResource.js';
import { siteSyncApi } from '../services/endpoints.js';

/**
 * Sincronizacao com o site de origem.
 *
 * ## O que esta tela promete
 *
 * Que a plataforma nunca troca nada sozinha. Toda alteracao chega
 * **pendente**; conflito mostra as tres versoes e exige escolha; conteudo que
 * saiu do ar nunca e apagado sem a pessoa dizer o que fazer.
 *
 * ## Por que ela nao fica consultando o servidor
 *
 * Diferente da tela de importacao, aqui nao ha processo em andamento no
 * navegador: quem verifica e o agendador do backend, na cadencia que o
 * cartao "Verificacao automatica" mostra medida. A tela
 * le o estado quando abre e depois de cada acao. "Verificar agora" apenas
 * antecipa uma passagem -- o mesmo caminho que o cron usa.
 */

type Decisao = 'pendente' | 'aprovada' | 'ignorada' | 'manter_atual';

export function SyncPage() {
  const tenantId = useTenantId();
  const toast = useToast();

  const [data, setData] = useState<SyncOverviewView | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [frequencia, setFrequencia] = useState<SyncFrequency>('semanal');
  const [aplicarAberto, setAplicarAberto] = useState(false);
  const [desconectarAberto, setDesconectarAberto] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const corpo = await siteSyncApi.overview(tenantId);
      setData(corpo);
      if (corpo.source) setFrequencia(corpo.source.frequency);
      setErro('');
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível carregar a sincronização.');
    } finally {
      setCarregando(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // ------------------------------------------------------------- acoes

  const conectar = useMutation(
    async (endereco: string) => siteSyncApi.connect(tenantId, endereco, frequencia),
    {
      onSuccess: async () => {
        setUrl('');
        toast.push({
          tone: 'success',
          title: 'Site de origem conectado',
          description: 'A primeira verificação acontece na próxima passagem da plataforma. Você pode antecipá-la agora.',
        });
        await carregar();
      },
      onError: (error) => {
        const campo = error.fieldErrors['url'];
        if (campo) setUrlError(campo);
        else toast.push({ tone: 'error', title: 'Não foi possível conectar', description: error.message });
      },
    },
  );

  const verificar = useMutation(async () => siteSyncApi.check(tenantId), {
    onSuccess: async (resultado) => {
      toast.push({
        tone: resultado.failed ? 'warning' : resultado.changesFound > 0 ? 'info' : 'success',
        title: resultado.failed ? 'A verificação não foi concluída' : 'Verificação concluída',
        description: resultado.message,
      });
      await carregar();
    },
    onError: (error) =>
      toast.push({ tone: 'error', title: 'Não foi possível verificar', description: error.message }),
  });

  const salvarFrequencia = useMutation(
    async (nova: SyncFrequency) => siteSyncApi.update(tenantId, { frequency: nova }),
    {
      onSuccess: async () => {
        toast.push({ tone: 'success', title: 'Frequência atualizada' });
        await carregar();
      },
      onError: (error) =>
        toast.push({ tone: 'error', title: 'Não foi possível salvar', description: error.message }),
    },
  );

  const alternarPausa = useMutation(
    async (pausar: boolean) => siteSyncApi.update(tenantId, { paused: pausar }),
    {
      onSuccess: async () => {
        await carregar();
      },
      onError: (error) =>
        toast.push({ tone: 'error', title: 'Não foi possível alterar', description: error.message }),
    },
  );

  const aplicar = useMutation(async () => siteSyncApi.apply(tenantId, []), {
    onSuccess: async (corpo) => {
      setAplicarAberto(false);
      toast.push({
        tone: corpo.result.failed > 0 ? 'warning' : 'success',
        title: 'Alterações aplicadas',
        description: corpo.result.message,
      });
      await carregar();
    },
    onError: (error) =>
      toast.push({ tone: 'error', title: 'Não foi possível aplicar', description: error.message }),
  });

  const desconectar = useMutation(async () => siteSyncApi.disconnect(tenantId), {
    onSuccess: async () => {
      setDesconectarAberto(false);
      toast.push({
        tone: 'success',
        title: 'Site de origem desconectado',
        description: 'O conteúdo que você já aplicou continua no painel.',
      });
      await carregar();
    },
    onError: (error) =>
      toast.push({ tone: 'error', title: 'Não foi possível desconectar', description: error.message }),
  });

  const desfazer = useMutation(
    async (changeId: string) => siteSyncApi.revert(tenantId, changeId),
    {
      onSuccess: async (corpo) => {
        toast.push({ tone: 'success', title: 'Alteração desfeita', description: corpo.message });
        await carregar();
      },
      onError: (error) =>
        toast.push({ tone: 'error', title: 'Não foi possível desfazer', description: error.message }),
    },
  );

  /** Decide uma alteração, com resposta imediata na tela. */
  const decidir = useCallback(
    async (
      change: SyncChangeView,
      decision: Decisao,
      extra: { conflictChoice?: ConflictChoice; removalAction?: RemovalAction } = {},
    ) => {
      setData((atual) =>
        atual === null
          ? atual
          : {
              ...atual,
              changes: atual.changes.map((item) =>
                item.id === change.id
                  ? {
                      ...item,
                      decision,
                      conflictChoice: extra.conflictChoice ?? item.conflictChoice,
                      removalAction: extra.removalAction ?? item.removalAction,
                    }
                  : item,
              ),
            },
      );

      try {
        await siteSyncApi.decide(tenantId, [{ changeId: change.id, decision, ...extra }]);
      } catch (error) {
        toast.push({
          tone: 'error',
          title: 'A decisão não foi salva',
          description: error instanceof Error ? error.message : 'Tente novamente.',
        });
        await carregar();
      }
    },
    [tenantId, toast, carregar],
  );

  /** Decide um grupo inteiro de uma vez. */
  const decidirGrupo = useCallback(
    async (changes: SyncChangeView[], decision: Decisao) => {
      const alcancaveis = changes.filter(
        (change) => change.outcome === 'pendente' && !change.targetDisabled && !change.conflict,
      );
      if (alcancaveis.length === 0) return;

      setData((atual) =>
        atual === null
          ? atual
          : {
              ...atual,
              changes: atual.changes.map((item) =>
                alcancaveis.some((change) => change.id === item.id) ? { ...item, decision } : item,
              ),
            },
      );

      try {
        await siteSyncApi.decide(
          tenantId,
          alcancaveis.map((change) => ({ changeId: change.id, decision })),
        );
      } catch (error) {
        toast.push({
          tone: 'error',
          title: 'As decisões não foram salvas',
          description: error instanceof Error ? error.message : 'Tente novamente.',
        });
        await carregar();
      }
    },
    [tenantId, toast, carregar],
  );

  const conectarAgora = () => {
    const check = checkImportUrl(url);
    if (!check.ok) {
      setUrlError(check.message);
      return;
    }
    setUrlError('');
    void conectar.run(check.url);
  };

  const grupos = useMemo(() => agrupar(data?.changes ?? []), [data]);
  const aprovadas = (data?.changes ?? []).filter(
    (change) => change.decision === 'aprovada' && change.outcome === 'pendente',
  );
  const pendentes = (data?.changes ?? []).filter(
    (change) => change.decision === 'pendente' && change.outcome === 'pendente',
  );
  const aplicadas = (data?.changes ?? []).filter((change) => change.outcome === 'aplicada');

  if (carregando) {
    return (
      <div className="panel-shell grid gap-6">
        <PageHeader title="Sincronização" />
        <div className="flex items-center gap-2 text-sm text-[color:var(--muted)]">
          <Spinner /> Carregando…
        </div>
      </div>
    );
  }

  const source = data?.source ?? null;

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Sincronização"
        description="Mantenha o conteúdo da CODECA Build atualizado a partir do site que a sua empresa já tem. A plataforma verifica sozinha e avisa quando algo muda — nada é alterado sem a sua aprovação."
      />

      {erro ? (
        <Alert tone="danger" title="Não foi possível carregar">
          {erro}
        </Alert>
      ) : null}

      {data?.scheduler ? <CadenciaDoAgendador scheduler={data.scheduler} /> : null}

      {source === null ? (
        <ConectarFonte
          url={url}
          urlError={urlError}
          frequencia={frequencia}
          carregando={conectar.loading}
          schedulerNote={data?.schedulerNote ?? ''}
          onUrl={(valor) => {
            setUrl(valor);
            if (urlError) setUrlError('');
          }}
          onFrequencia={setFrequencia}
          onConectar={conectarAgora}
        />
      ) : (
        <>
          <PainelDaFonte
            source={source}
            schedulerNote={data?.schedulerNote ?? ''}
            frequencia={frequencia}
            verificando={verificar.loading}
            salvando={salvarFrequencia.loading}
            alterandoPausa={alternarPausa.loading}
            onFrequencia={(nova) => {
              setFrequencia(nova);
              void salvarFrequencia.run(nova);
            }}
            onVerificar={() => void verificar.run(undefined)}
            onPausa={() => void alternarPausa.run(source.state !== 'pausada')}
            onDesconectar={() => setDesconectarAberto(true)}
          />

          {pendentes.length === 0 && aplicadas.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={28} />}
              title="Nenhuma alteração encontrada"
              description="O conteúdo da CODECA Build está igual ao do seu site de origem. Avisaremos aqui quando algo mudar."
            />
          ) : (
            <div className="grid gap-4">
              {grupos.map((grupo) => (
                <GrupoDeAlteracoes
                  key={grupo.target}
                  grupo={grupo}
                  onDecidir={decidir}
                  onDecidirGrupo={decidirGrupo}
                  onDesfazer={(change) => void desfazer.run(change.id)}
                />
              ))}
            </div>
          )}

          {aprovadas.length > 0 || pendentes.length > 0 ? (
            <Card>
              <CardBody>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <p className="text-sm text-[color:var(--muted)]">
                    {aprovadas.length === 0
                      ? `${pendentes.length} ${pendentes.length === 1 ? 'alteração aguarda' : 'alterações aguardam'} sua decisão. Aprove o que quiser trazer.`
                      : `${aprovadas.length} ${aprovadas.length === 1 ? 'alteração aprovada' : 'alterações aprovadas'}. O conteúdo novo entra como rascunho.`}
                  </p>
                  <Button
                    onClick={() => setAplicarAberto(true)}
                    disabled={aprovadas.length === 0}
                    icon={<Save size={16} />}
                  >
                    Aprovar alterações selecionadas
                  </Button>
                </div>
              </CardBody>
            </Card>
          ) : null}

          {data && data.checks.length > 0 ? <Historico checks={data.checks} /> : null}
        </>
      )}

      <ConfirmDialog
        open={aplicarAberto}
        title="Aplicar as alterações aprovadas?"
        message={`${aprovadas.length} ${aprovadas.length === 1 ? 'alteração será gravada' : 'alterações serão gravadas'} no seu painel. Conteúdo novo entra como rascunho, e você pode desfazer cada alteração depois.`}
        confirmLabel="Aplicar"
        tone="primary"
        loading={aplicar.loading}
        onCancel={() => setAplicarAberto(false)}
        onConfirm={() => void aplicar.run(undefined)}
      />

      <ConfirmDialog
        open={desconectarAberto}
        title="Desconectar o site de origem?"
        message="A plataforma para de verificar esse endereço e o histórico de sincronizações é apagado. O conteúdo que você já aplicou continua no seu painel, intacto."
        confirmLabel="Desconectar"
        tone="danger"
        loading={desconectar.loading}
        onCancel={() => setDesconectarAberto(false)}
        onConfirm={() => void desconectar.run(undefined)}
      />
    </div>
  );
}

// --------------------------------------------------------------- partes

function ConectarFonte(props: {
  url: string;
  urlError: string;
  frequencia: SyncFrequency;
  carregando: boolean;
  schedulerNote: string;
  onUrl: (valor: string) => void;
  onFrequencia: (valor: SyncFrequency) => void;
  onConectar: () => void;
}) {
  return (
    <>
      <Card>
        <CardHeader title="Como funciona a sincronização" />
        <CardBody>
          <ol className="grid gap-2 text-sm text-[color:var(--muted)]">
            {[
              'Você informa o endereço do site que já tem. A plataforma acessa apenas o conteúdo público dele.',
              'De tempos em tempos, verificamos se algo mudou por lá — sem você precisar abrir o painel.',
              'Quando encontramos novidades, elas aparecem aqui como pendentes, com o antes e o depois lado a lado.',
              'Você escolhe o que trazer. Nada é alterado no seu painel sem a sua aprovação, e você pode desfazer depois.',
            ].map((texto, indice) => (
              <li key={texto} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
                <span aria-hidden className="text-[color:var(--accent)]">{indice + 1}.</span>
                <span>{texto}</span>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Conectar site de origem"
          description="Aceitamos endereços públicos que começam com http:// ou https://."
        />
        <CardBody>
          <div className="grid gap-3">
            <TextInput
              label="Endereço do site de origem"
              value={props.url}
              placeholder="https://siteantigo.com.br"
              inputMode="url"
              autoComplete="url"
              error={props.urlError !== '' ? props.urlError : undefined}
              hint="Se você já importou este site, reaproveitamos o que foi trazido na importação."
              onChange={(event) => props.onUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') props.onConectar();
              }}
            />

            <Select
              label="Com que frequência verificar"
              value={props.frequencia}
              onChange={(event) => props.onFrequencia(event.target.value as SyncFrequency)}
              options={SYNC_FREQUENCIES.map((valor) => ({
                value: valor,
                label: SYNC_FREQUENCY_LABELS[valor],
              }))}
              hint={props.schedulerNote}
            />

            <div>
              <Button
                onClick={props.onConectar}
                loading={props.carregando}
                disabled={props.url.trim() === ''}
                icon={<RefreshCw size={16} />}
              >
                Conectar e acompanhar
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

const TOM_DO_ESTADO: Record<SyncSourceState, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ativa: 'success',
  pausada: 'neutral',
  verificando: 'warning',
  erro: 'danger',
};

function PainelDaFonte(props: {
  source: NonNullable<SyncOverviewView['source']>;
  schedulerNote: string;
  frequencia: SyncFrequency;
  verificando: boolean;
  salvando: boolean;
  alterandoPausa: boolean;
  onFrequencia: (valor: SyncFrequency) => void;
  onVerificar: () => void;
  onPausa: () => void;
  onDesconectar: () => void;
}) {
  const { source } = props;
  const pausada = source.state === 'pausada';

  return (
    <Card>
      <CardHeader
        title={source.sourceUrl}
        description="Site de origem acompanhado pela plataforma"
        actions={<Badge tone={TOM_DO_ESTADO[source.state]}>{SYNC_SOURCE_STATE_LABELS[source.state]}</Badge>}
      />
      <CardBody>
        <div className="grid gap-4">
          {source.state === 'erro' && source.lastError !== '' ? (
            <Alert tone="danger" title="A última verificação falhou">
              {source.lastError}
              {source.consecutiveFailures > 1
                ? ` Falhas seguidas: ${source.consecutiveFailures}.`
                : ''}
            </Alert>
          ) : null}

          {pausada ? (
            <Alert tone="info" title="Sincronização pausada">
              A plataforma não está verificando este endereço. Retome quando quiser.
            </Alert>
          ) : null}

          {source.changesPending > 0 ? (
            <Alert tone="warning" title="Atualizações disponíveis">
              {source.changesPending === 1
                ? '1 alteração aguarda a sua decisão.'
                : `${source.changesPending} alterações aguardam a sua decisão.`}
              {source.conflictsPending > 0
                ? ` ${source.conflictsPending} ${source.conflictsPending === 1 ? 'conflita' : 'conflitam'} com edições feitas no painel.`
                : ''}
              {source.removalsPending > 0
                ? ` ${source.removalsPending} ${source.removalsPending === 1 ? 'conteúdo saiu' : 'conteúdos saíram'} do ar na origem.`
                : ''}
            </Alert>
          ) : null}

          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Info rotulo="Última verificação" valor={quando(source.lastCheckedAt)} />
            <Info rotulo="Última sincronização" valor={quando(source.lastSyncedAt)} />
            <Info
              rotulo="Próxima verificação"
              valor={source.state === 'pausada' ? 'Pausada' : quando(source.nextCheckAt)}
            />
            <Info
              rotulo="Alterações encontradas"
              valor={`${source.changesFound} (${source.changesPending} pendentes)`}
            />
          </dl>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-end">
            <Select
              label="Verificar"
              value={props.frequencia}
              disabled={props.salvando}
              onChange={(event) => props.onFrequencia(event.target.value as SyncFrequency)}
              options={SYNC_FREQUENCIES.map((valor) => ({
                value: valor,
                label: SYNC_FREQUENCY_LABELS[valor],
              }))}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={props.onVerificar}
                loading={props.verificando}
                icon={<RefreshCw size={16} />}
              >
                Verificar atualizações agora
              </Button>
              <Button
                variant="outline"
                onClick={props.onPausa}
                loading={props.alterandoPausa}
                icon={pausada ? <Play size={16} /> : <Pause size={16} />}
              >
                {pausada ? 'Retomar' : 'Pausar'}
              </Button>
              <Button variant="ghost" onClick={props.onDesconectar} icon={<Link2Off size={16} />}>
                Desconectar
              </Button>
            </div>
          </div>

          {/*
            A honestidade sobre a cadencia: o agendador da plataforma passa uma
            vez por dia. Prometer 6 horas e entregar 24 seria enganar o cliente.
          */}
          {source.schedulerNote !== null ? (
            <Alert tone="info" title="Sobre a frequência escolhida">
              {source.schedulerNote}
            </Alert>
          ) : null}

          {source.pages.length > 0 ? (
            <details className="rounded-lg border border-[color:var(--border)] p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Páginas acompanhadas ({source.pages.length})
              </summary>
              <ul className="mt-2 grid gap-1 text-xs">
                {source.pages.map((page) => (
                  <li
                    key={page.url}
                    className="grid grid-cols-[minmax(0,1fr)] gap-0.5 border-t border-[color:var(--border)] pt-1 first:border-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-2"
                  >
                    <span className="[overflow-wrap:anywhere]">{page.url}</span>
                    <span className="flex flex-wrap gap-1">
                      {page.missingSince !== null ? (
                        <Badge tone="danger">fora do ar desde {quando(page.missingSince)}</Badge>
                      ) : page.unchanged ? (
                        <Badge tone="neutral">sem mudanças</Badge>
                      ) : (
                        <Badge tone="success">acompanhada</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-[color:var(--muted)]">{rotulo}</dt>
      <dd className="text-sm font-medium [overflow-wrap:anywhere]">{valor}</dd>
    </div>
  );
}

/**
 * O que a plataforma garante, e o que ela esta entregando.
 *
 * Os dois numeros aparecem com nomes separados de proposito. O **garantido**
 * vem dos dois agendamentos da Vercel e vale sempre. O **observado** sai do
 * historico real das passagens, e so aparece como cadencia depois de o
 * agendador externo ter sido visto funcionando -- configurar o cron-job.org
 * nao basta, ele precisa ter chamado.
 *
 * Essa separacao e a razao de o cartao existir. Um unico numero obrigaria a
 * escolher entre prometer 6 horas sem prova (e o cliente descobrir sozinho
 * que nao era verdade) ou esconder a cadencia maior depois de ela passar a
 * funcionar de fato.
 */
function CadenciaDoAgendador(props: { scheduler: NonNullable<SyncOverviewView['scheduler']> }) {
  const { scheduler } = props;
  const ultima = scheduler.lastRun;

  return (
    <Card>
      <CardHeader
        title="Verificação automática"
        description="Com que frequência a plataforma olha os sites de origem"
      />
      <CardBody className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[color:var(--border)] p-3">
            <p className="text-xs text-[color:var(--muted-foreground)]">Garantida pela plataforma</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-medium">
              <Clock size={16} aria-hidden />
              {scheduler.baselineLabel === 'um dia'
                ? 'Uma vez por dia'
                : `A cada ${scheduler.baselineLabel}`}
            </p>
            <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
              Dois agendamentos da Vercel. Não depende de nenhum serviço externo.
            </p>
          </div>

          <div className="rounded-lg border border-[color:var(--border)] p-3">
            <p className="text-xs text-[color:var(--muted-foreground)]">Medida no histórico</p>
            {scheduler.externalValidated ? (
              <>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 size={16} aria-hidden />A cada {scheduler.effectiveLabel}
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                  Agendador externo confirmado: {scheduler.externalRuns}{' '}
                  {scheduler.externalRuns === 1 ? 'execução' : 'execuções'} nos últimos 7 dias.
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle size={16} aria-hidden />
                  Sem agendador externo confirmado
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                  {scheduler.externalRuns === 0
                    ? 'Nenhuma chamada externa registrada. Vale a frequência garantida acima.'
                    : `${scheduler.externalRuns} chamada(s) externa(s) registrada(s) — ainda não é histórico suficiente para anunciar uma cadência maior.`}
                </p>
              </>
            )}
          </div>
        </div>

        {/*
          A ultima execucao responde a pergunta que o cliente faz primeiro
          quando desconfia: "isso rodou mesmo?". Com horario, origem e
          duracao, a resposta nao depende de acreditar em ninguem.
        */}
        <div className="rounded-lg border border-[color:var(--border)] p-3">
          <p className="text-xs text-[color:var(--muted-foreground)]">Última execução</p>
          {ultima === null ? (
            <p className="mt-1 text-sm">Nenhuma execução registrada ainda.</p>
          ) : (
            <div className="mt-1 grid gap-1 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <History size={16} aria-hidden />
                <span>{quando(ultima.startedAt)}</span>
                <Badge tone="neutral">{SYNC_RUN_ORIGIN_LABELS[ultima.origin]}</Badge>
                {ultima.state === 'concluida' ? (
                  <Badge tone="success">concluída</Badge>
                ) : ultima.state === 'executando' ? (
                  <Badge tone="warning">em andamento</Badge>
                ) : ultima.state === 'expirada' ? (
                  <Badge tone="warning">não terminou</Badge>
                ) : (
                  <Badge tone="danger">falhou</Badge>
                )}
              </p>
              <p className="text-xs text-[color:var(--muted-foreground)]">
                {ultima.durationMs !== null ? `Durou ${duracao(ultima.durationMs)}. ` : ''}
                {ultima.sourcesChecked} site(s) verificado(s)
                {ultima.sourcesFailed > 0 ? `, ${ultima.sourcesFailed} com falha` : ''}
                {ultima.changesFound > 0 ? `, ${ultima.changesFound} alteração(ões) encontrada(s)` : ''}
                .
              </p>
              {ultima.error !== '' ? (
                <p className="text-xs text-[color:var(--danger,#b91c1c)]">{ultima.error}</p>
              ) : null}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/** Duracao em milissegundos escrita como a tela fala. */
function duracao(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const segundos = ms / 1000;
  if (segundos < 60) return `${segundos.toFixed(1).replace('.', ',')} s`;
  const minutos = Math.floor(segundos / 60);
  const resto = Math.round(segundos % 60);
  return `${minutos} min ${resto} s`;
}

function quando(iso: string | null): string {
  if (iso === null) return 'Ainda não';
  return formatDateTime(iso);
}

interface Grupo {
  target: SyncTarget;
  label: string;
  changes: SyncChangeView[];
}

function agrupar(changes: readonly SyncChangeView[]): Grupo[] {
  const mapa = new Map<SyncTarget, Grupo>();
  for (const change of changes) {
    const atual = mapa.get(change.target) ?? {
      target: change.target,
      label: change.targetLabel,
      changes: [],
    };
    atual.changes.push(change);
    mapa.set(change.target, atual);
  }
  return [...mapa.values()];
}

function GrupoDeAlteracoes(props: {
  grupo: Grupo;
  onDecidir: (
    change: SyncChangeView,
    decision: Decisao,
    extra?: { conflictChoice?: ConflictChoice; removalAction?: RemovalAction },
  ) => void | Promise<void>;
  onDecidirGrupo: (changes: SyncChangeView[], decision: Decisao) => void | Promise<void>;
  onDesfazer: (change: SyncChangeView) => void;
}) {
  const { grupo } = props;
  const pendentes = grupo.changes.filter(
    (change) => change.decision === 'pendente' && change.outcome === 'pendente',
  );
  // Conflito e remocao ficam fora do "aprovar tudo": sao escolhas que a
  // pessoa precisa fazer uma a uma, com os dois lados a vista.
  const emLote = pendentes.filter((change) => !change.conflict && !isRemoval(change.type));

  return (
    <Card>
      <CardHeader
        title={grupo.label}
        description={`${grupo.changes.length} ${grupo.changes.length === 1 ? 'alteração' : 'alterações'}`}
        actions={
          emLote.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => void props.onDecidirGrupo(emLote, 'aprovada')}>
              Aprovar categoria
            </Button>
          ) : null
        }
      />
      <CardBody>
        <ul className="grid gap-3">
          {grupo.changes.map((change) => (
            <AlteracaoItem
              key={change.id}
              change={change}
              onDecidir={props.onDecidir}
              onDesfazer={props.onDesfazer}
            />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function AlteracaoItem(props: {
  change: SyncChangeView;
  onDecidir: (
    change: SyncChangeView,
    decision: Decisao,
    extra?: { conflictChoice?: ConflictChoice; removalAction?: RemovalAction },
  ) => void | Promise<void>;
  onDesfazer: (change: SyncChangeView) => void;
}) {
  const { change } = props;
  const decidivel = change.outcome === 'pendente' && !change.targetDisabled;
  const remocao = isRemoval(change.type);
  const imagem = isImageChange(change.type);

  return (
    <li className="grid gap-2 rounded-lg border border-[color:var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium [overflow-wrap:anywhere]">{change.label}</span>
        <Badge tone={remocao ? 'danger' : change.type === 'novo' ? 'success' : 'neutral'}>
          {change.typeLabel}
        </Badge>
        {change.conflict ? <Badge tone="warning">conflito</Badge> : null}
        {change.targetDisabled ? <Badge tone="neutral">módulo não habilitado</Badge> : null}
        {change.outcome === 'aplicada' ? <Badge tone="success">aplicada</Badge> : null}
        {change.outcome === 'ignorada' ? <Badge tone="neutral">ignorada</Badge> : null}
        {change.outcome === 'revertida' ? <Badge tone="neutral">desfeita</Badge> : null}
        {change.outcome === 'falhou' ? <Badge tone="danger">falhou</Badge> : null}
      </div>

      {imagem ? (
        <ComparacaoDeImagem change={change} />
      ) : (
        <ComparacaoDeTexto change={change} />
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
        <span>Identificada em {formatDateTime(change.detectedAt)}</span>
        {change.pageUrl !== '' ? (
          <a
            className="underline [overflow-wrap:anywhere]"
            href={change.pageUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            ver no site de origem
          </a>
        ) : null}
        {change.approvedByName !== '' ? <span>· por {change.approvedByName}</span> : null}
      </div>

      {change.error !== '' ? (
        <p className="text-xs text-[color:var(--danger)] [overflow-wrap:anywhere]">{change.error}</p>
      ) : null}

      {decidivel ? (
        <Acoes change={change} remocao={remocao} onDecidir={props.onDecidir} />
      ) : change.outcome === 'aplicada' && !imagem ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => props.onDesfazer(change)}>
            Desfazer esta alteração
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function ComparacaoDeTexto({ change }: { change: SyncChangeView }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Lado
        titulo="Na CODECA Build"
        texto={change.codecaPreview}
        vazio="Ainda não existe aqui"
        tom="neutro"
      />
      <Lado
        titulo={isRemoval(change.type) ? 'No site de origem' : 'Encontrado no site de origem'}
        texto={change.sourcePreview}
        vazio={isRemoval(change.type) ? 'Saiu do ar' : 'Vazio'}
        tom="origem"
      />
      {/*
        A terceira versao so aparece no conflito: fora dele ela seria ruido,
        porque e igual a um dos dois lados.
      */}
      {change.conflict && change.baselinePreview !== '' ? (
        <div className="sm:col-span-2">
          <Lado
            titulo="Versão original (antes de qualquer edição)"
            texto={change.baselinePreview}
            vazio="Não havia"
            tom="neutro"
          />
        </div>
      ) : null}
    </div>
  );
}

function Lado(props: { titulo: string; texto: string; vazio: string; tom: 'neutro' | 'origem' }) {
  return (
    <div
      className={`grid gap-1 rounded-md p-2 ${
        props.tom === 'origem'
          ? 'bg-[color:var(--surface-2)] ring-1 ring-[color:var(--accent)]/25'
          : 'bg-[color:var(--surface-2)]'
      }`}
    >
      <p className="text-xs text-[color:var(--muted)]">{props.titulo}</p>
      <p className="text-sm [overflow-wrap:anywhere]">
        {props.texto !== '' ? props.texto : <span className="text-[color:var(--muted)]">{props.vazio}</span>}
      </p>
    </div>
  );
}

function ComparacaoDeImagem({ change }: { change: SyncChangeView }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <figure className="grid gap-1">
        <figcaption className="text-xs text-[color:var(--muted)]">Na CODECA Build</figcaption>
        {change.codecaImageUrl !== null ? (
          <img
            src={change.codecaImageUrl}
            alt=""
            loading="lazy"
            className="max-h-40 w-full rounded-md object-contain ring-1 ring-[color:var(--border)]"
          />
        ) : (
          <p className="rounded-md bg-[color:var(--surface-2)] p-3 text-sm text-[color:var(--muted)]">
            Ainda não existe aqui
          </p>
        )}
      </figure>
      <figure className="grid gap-1">
        <figcaption className="text-xs text-[color:var(--muted)]">No site de origem</figcaption>
        {change.sourceImageUrl !== null && !isRemoval(change.type) ? (
          /*
            A previa aponta para o site de origem, e nao para a biblioteca: a
            imagem so e baixada quando a alteracao for aprovada. `referrerPolicy`
            evita vazar o endereco do painel para o site de terceiro.
          */
          <img
            src={change.sourceImageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="max-h-40 w-full rounded-md object-contain ring-1 ring-[color:var(--border)]"
          />
        ) : (
          <p className="rounded-md bg-[color:var(--surface-2)] p-3 text-sm text-[color:var(--muted)]">
            {isRemoval(change.type) ? 'Saiu do ar' : 'Sem prévia'}
          </p>
        )}
      </figure>
    </div>
  );
}

function Acoes(props: {
  change: SyncChangeView;
  remocao: boolean;
  onDecidir: (
    change: SyncChangeView,
    decision: Decisao,
    extra?: { conflictChoice?: ConflictChoice; removalAction?: RemovalAction },
  ) => void | Promise<void>;
}) {
  const { change } = props;
  const aprovada = change.decision === 'aprovada';
  const ignorada = change.decision === 'ignorada' || change.decision === 'manter_atual';

  if (props.remocao) {
    return (
      <div className="grid gap-2">
        <p className="text-xs text-[color:var(--muted)]">
          Identificamos que este conteúdo não está mais disponível no site de origem. Ele continua no
          seu painel até você decidir.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={change.decision === 'manter_atual' ? 'primary' : 'outline'}
            onClick={() => void props.onDecidir(change, 'manter_atual', { removalAction: 'manter' })}
          >
            {REMOVAL_ACTION_LABELS.manter}
          </Button>
          <Button
            size="sm"
            variant={aprovada && change.removalAction === 'arquivar' ? 'primary' : 'outline'}
            onClick={() => void props.onDecidir(change, 'aprovada', { removalAction: 'arquivar' })}
          >
            {REMOVAL_ACTION_LABELS.arquivar}
          </Button>
          <Button
            size="sm"
            variant={aprovada && change.removalAction === 'excluir' ? 'danger' : 'outline'}
            icon={<Trash2 size={14} />}
            onClick={() => void props.onDecidir(change, 'aprovada', { removalAction: 'excluir' })}
          >
            {REMOVAL_ACTION_LABELS.excluir}
          </Button>
        </div>
      </div>
    );
  }

  if (change.conflict) {
    return (
      <div className="grid gap-2">
        <p className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-xs text-[color:var(--muted)]">
          <ShieldAlert size={14} className="mt-0.5 text-[color:var(--warning)]" />
          <span>
            Este conteúdo foi editado no painel da CODECA Build <strong>e</strong> mudou no site de
            origem. Escolha qual versão vale.
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={change.decision === 'manter_atual' ? 'primary' : 'outline'}
            onClick={() => void props.onDecidir(change, 'manter_atual', { conflictChoice: 'manter_codeca' })}
          >
            {CONFLICT_CHOICE_LABELS.manter_codeca}
          </Button>
          <Button
            size="sm"
            variant={aprovada ? 'primary' : 'outline'}
            onClick={() => void props.onDecidir(change, 'aprovada', { conflictChoice: 'usar_origem' })}
          >
            {CONFLICT_CHOICE_LABELS.usar_origem}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Checkbox
        label="Aprovar esta alteração"
        checked={aprovada}
        onChange={(marcado) => void props.onDecidir(change, marcado ? 'aprovada' : 'pendente')}
      />
      <Button
        size="sm"
        variant={ignorada ? 'primary' : 'ghost'}
        onClick={() => void props.onDecidir(change, 'ignorada')}
      >
        Ignorar
      </Button>
    </div>
  );
}

function Historico({ checks }: { checks: SyncOverviewView['checks'] }) {
  return (
    <Card>
      <CardHeader title="Histórico de sincronizações" />
      <CardBody>
        <ul className="grid gap-2 text-sm">
          {checks.map((check) => (
            <li
              key={check.id}
              className="grid grid-cols-[minmax(0,1fr)] gap-1 border-t border-[color:var(--border)] pt-2 first:border-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-3"
            >
              <span className="grid gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  {check.state === 'erro' ? (
                    <AlertTriangle size={14} className="text-[color:var(--danger)]" />
                  ) : check.state === 'verificando' ? (
                    <Clock size={14} />
                  ) : (
                    <History size={14} className="text-[color:var(--muted)]" />
                  )}
                  <span className="[overflow-wrap:anywhere]">{check.message}</span>
                </span>
                <span className="text-xs text-[color:var(--muted)]">
                  {formatDateTime(check.startedAt)} ·{' '}
                  {check.trigger === 'manual' ? 'pedida no painel' : 'automática'}
                  {check.triggeredByName !== '' ? ` por ${check.triggeredByName}` : ''} ·{' '}
                  {check.pagesChecked} {check.pagesChecked === 1 ? 'página' : 'páginas'}
                  {check.pagesUnchanged > 0 ? `, ${check.pagesUnchanged} sem mudanças` : ''}
                  {check.pagesFailed > 0 ? `, ${check.pagesFailed} com falha` : ''}
                </span>
              </span>
              <span className="flex flex-wrap gap-1">
                {check.changesFound > 0 ? (
                  <Badge tone="warning">{check.changesFound} encontradas</Badge>
                ) : (
                  <Badge tone="neutral">sem alterações</Badge>
                )}
                {check.changesApproved > 0 ? (
                  <Badge tone="success">{check.changesApproved} aprovadas</Badge>
                ) : null}
                {check.conflicts > 0 ? <Badge tone="warning">{check.conflicts} conflitos</Badge> : null}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
