import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, ShieldOff, ShieldCheck } from 'lucide-react';
import { formatDateTime } from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Modal,
  PageHeader,
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
  useToast,
  type BadgeTone,
  type Column,
} from '@codeca/ui';
import { ResourcePanel } from '../../components/ResourcePanel.js';
import { useResource } from '../../hooks/useResource.js';
import { platformBillingApi } from '../../services/endpoints.js';
import { ApiError } from '../../services/api.js';
import type { ChargeView, PlatformSubscriptionRow, WebhookEventRow } from '../../types/index.js';

/**
 * Cobranca no painel mestre.
 *
 * Mostra as assinaturas, as cobrancas, os eventos de webhook com falha e as
 * acoes de operacao: reprocessar um evento, reconciliar com a ValidaPay e
 * suspender ou reativar a publicacao de uma empresa com justificativa.
 *
 * As acoes administrativas nao reescrevem o estado financeiro: elas gravam uma
 * decisao propria, registrada em auditoria, ao lado do que o provedor informou.
 */
export function PlatformBillingPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'assinaturas' | 'cobrancas' | 'eventos' | 'historico'>(
    'assinaturas',
  );
  const [working, setWorking] = useState(false);
  const [holdTarget, setHoldTarget] = useState<PlatformSubscriptionRow | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [eventStatus, setEventStatus] = useState('failed');
  const [search, setSearch] = useState('');

  const overview = useResource(() => platformBillingApi.overview(), []);
  const subscriptions = useResource(
    () =>
      platformBillingApi.subscriptions({
        ...(stateFilter ? { state: stateFilter } : {}),
        ...(search ? { search } : {}),
        pageSize: 25,
      }),
    [stateFilter, search],
    { enabled: tab === 'assinaturas' },
  );
  const charges = useResource(() => platformBillingApi.charges({ pageSize: 25 }), [], {
    enabled: tab === 'cobrancas',
  });
  const events = useResource(
    () => platformBillingApi.webhooks({ ...(eventStatus ? { status: eventStatus } : {}), pageSize: 25 }),
    [eventStatus],
    { enabled: tab === 'eventos' },
  );
  const history = useResource(() => platformBillingApi.history({ pageSize: 40 }), [], {
    enabled: tab === 'historico',
  });

  const reload = useCallback(() => {
    overview.reload();
    if (tab === 'assinaturas') subscriptions.reload();
    if (tab === 'cobrancas') charges.reload();
    if (tab === 'eventos') events.reload();
    if (tab === 'historico') history.reload();
  }, [overview, subscriptions, charges, events, history, tab]);

  const runReconcile = async (tenantId?: string) => {
    setWorking(true);
    try {
      const report = await platformBillingApi.reconcile({
        ...(tenantId ? { tenantId } : {}),
        force: Boolean(tenantId),
        limit: 50,
      });
      toast.success(
        'Reconciliacao concluida',
        `${report.subscriptionsChecked} assinatura(s) e ${report.chargesChecked} cobranca(s) conferidas; `
          + `${report.divergences.length} divergencia(s), ${report.failures.length} falha(s).`,
      );
      reload();
    } catch (error) {
      toast.error('Falha na reconciliacao', error instanceof ApiError ? error.message : undefined);
    } finally {
      setWorking(false);
    }
  };

  const replay = async (row: WebhookEventRow) => {
    setWorking(true);
    try {
      const result = await platformBillingApi.replayWebhook(row.id);
      toast.success(`Evento ${row.event} reprocessado`, `${result.status}: ${result.detail}`);
      reload();
    } catch (error) {
      toast.error('Falha ao reprocessar', error instanceof ApiError ? error.message : undefined);
    } finally {
      setWorking(false);
    }
  };

  const applyHold = async () => {
    if (!holdTarget) return;
    setWorking(true);
    try {
      const result = await platformBillingApi.publicationHold({
        siteId: holdTarget.siteId,
        hold: !holdTarget.adminHold,
        reason: holdReason,
      });
      toast.success('Publicacao atualizada', result.message);
      setHoldTarget(null);
      setHoldReason('');
      reload();
    } catch (error) {
      toast.error('Falha ao alterar a publicacao', error instanceof ApiError ? error.message : undefined);
    } finally {
      setWorking(false);
    }
  };

  const syncPlan = async (planId: string, planName: string) => {
    setWorking(true);
    try {
      const result = await platformBillingApi.syncPlan(planId);
      toast.success(`Plano ${planName} sincronizado`, `Preco criado: ${result.externalPriceId}.`);
      overview.reload();
    } catch (error) {
      toast.error('Falha ao sincronizar', error instanceof ApiError ? error.message : undefined);
    } finally {
      setWorking(false);
    }
  };

  const subscriptionColumns = useMemo<Column<PlatformSubscriptionRow>[]>(
    () => [
      {
        key: 'tenant',
        header: 'Site',
        // A assinatura e do site: a empresa aparece como contexto, e nao
        // como o assinante, porque uma empresa pode ter mais de uma linha.
        render: (row) => (
          <div className="grid gap-0.5">
            <span className="text-sm font-medium text-slate-800">{row.siteName}</span>
            <span className="text-xs text-slate-500">
              {row.tenantName} - {row.planName} ({row.planPriceLabel})
            </span>
          </div>
        ),
      },
      {
        key: 'state',
        header: 'Assinatura',
        render: (row) => (
          <div className="grid gap-0.5">
            <Badge tone={stateTone(row.state)}>{row.stateLabel}</Badge>
            {row.providerStatus ? (
              <span className="text-xs text-slate-500">ValidaPay: {row.providerStatus}</span>
            ) : null}
          </div>
        ),
      },
      {
        key: 'publication',
        header: 'Publicacao',
        render: (row) => (
          <div className="grid gap-0.5">
            <Badge tone={row.publicationState === 'allowed' ? 'success' : 'danger'}>
              {row.publicationLabel}
            </Badge>
            {row.adminHold ? (
              <span className="text-xs text-rose-600">Suspenso: {row.adminHoldReason}</span>
            ) : null}
            {row.disputeHold ? (
              <span className="text-xs text-amber-700">Estorno em revisao</span>
            ) : null}
          </div>
        ),
      },
      {
        key: 'period',
        header: 'Acesso / proxima',
        hideOnMobile: true,
        render: (row) => (
          <div className="grid gap-0.5 text-xs text-slate-600">
            <span>{row.accessUntil ? `ate ${formatDateTime(row.accessUntil)}` : 'sem acesso pago'}</span>
            <span>
              {row.nextChargeAt ? `cobra ${formatDateTime(row.nextChargeAt)}` : 'sem cobranca programada'}
            </span>
            <span>tolerancia: {row.gracePeriodDays} dia(s)</span>
          </div>
        ),
      },
      {
        key: 'external',
        header: 'ValidaPay',
        hideOnMobile: true,
        render: (row) => (
          <div className="grid gap-0.5 text-xs text-slate-500">
            <code>{row.externalSubscriptionId ?? 'nao vinculada'}</code>
            <span>
              {row.lastSyncedAt ? `sinc. ${formatDateTime(row.lastSyncedAt)}` : 'nunca sincronizada'}
            </span>
            {row.lastErrorMessage ? (
              <span className="text-rose-600">{row.lastErrorMessage}</span>
            ) : null}
          </div>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (row) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void runReconcile(row.tenantId)}
              disabled={working}
              title="Reconciliar esta empresa com a ValidaPay"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              <span className="sr-only">Reconciliar</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setHoldTarget(row);
                setHoldReason('');
              }}
              disabled={working}
              title={row.adminHold ? 'Reativar a publicacao' : 'Suspender a publicacao'}
            >
              {row.adminHold ? (
                <ShieldCheck aria-hidden="true" className="size-4 text-emerald-600" />
              ) : (
                <ShieldOff aria-hidden="true" className="size-4 text-rose-600" />
              )}
              <span className="sr-only">
                {row.adminHold ? 'Reativar publicacao' : 'Suspender publicacao'}
              </span>
            </Button>
          </div>
        ),
      },
    ],
    [working],
  );

  const chargeColumns = useMemo<
    Column<ChargeView & { tenantName: string; tenantSlug: string }>[]
  >(
    () => [
      {
        key: 'tenant',
        header: 'Empresa',
        render: (row) => <span className="text-sm text-slate-700">{row.tenantName}</span>,
      },
      {
        key: 'created',
        header: 'Data',
        render: (row) => (
          <span className="text-sm text-slate-600">{formatDateTime(row.createdAt)}</span>
        ),
      },
      {
        key: 'amount',
        header: 'Valor',
        align: 'right',
        render: (row) => <span className="text-sm font-medium">{row.amountLabel}</span>,
      },
      {
        key: 'status',
        header: 'Situacao',
        render: (row) => <Badge tone={chargeTone(row.status)}>{row.statusLabel}</Badge>,
      },
      {
        key: 'external',
        header: 'Cobranca',
        hideOnMobile: true,
        render: (row) => (
          <div className="grid gap-0.5 text-xs text-slate-500">
            <code>{row.externalChargeId}</code>
            <span>{row.lastSyncedAt ? `sinc. ${formatDateTime(row.lastSyncedAt)}` : 'sem sinc.'}</span>
          </div>
        ),
      },
      {
        key: 'paid',
        header: 'Pagamento',
        hideOnMobile: true,
        render: (row) => (
          <span className="text-xs text-slate-600">
            {row.paidAt ? formatDateTime(row.paidAt) : row.failureReason || '-'}
          </span>
        ),
      },
    ],
    [],
  );

  const eventColumns = useMemo<Column<WebhookEventRow>[]>(
    () => [
      {
        key: 'event',
        header: 'Evento',
        render: (row) => (
          <div className="grid gap-0.5">
            <span className="text-sm font-medium text-slate-800">{row.event}</span>
            <code className="text-xs text-slate-500">{row.externalEventId}</code>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Situacao',
        render: (row) => (
          <div className="grid gap-0.5">
            <Badge tone={eventTone(row.status)}>{row.status}</Badge>
            <span className="text-xs text-slate-500">
              entrega {row.attempt ?? 1} / processamentos {row.processingAttempts}
            </span>
          </div>
        ),
      },
      {
        key: 'received',
        header: 'Recebido',
        hideOnMobile: true,
        render: (row) => (
          <div className="grid gap-0.5 text-xs text-slate-600">
            <span>{formatDateTime(row.receivedAt)}</span>
            {row.processedAt ? <span>processado {formatDateTime(row.processedAt)}</span> : null}
          </div>
        ),
      },
      {
        key: 'error',
        header: 'Mensagem',
        render: (row) => (
          <span className="text-xs text-rose-600">{row.errorMessage || '-'}</span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (row) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void replay(row)}
            disabled={working}
            title="Reprocessar este evento"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            <span className="sr-only">Reprocessar</span>
          </Button>
        ),
      },
    ],
    [working],
  );

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Cobranca e assinaturas"
        description="Assinaturas, cobrancas, eventos de webhook e reconciliacao com a ValidaPay."
        actions={
          <Button variant="outline" onClick={() => void runReconcile()} disabled={working}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Reconciliar agora
          </Button>
        }
      />

      <ResourcePanel resource={overview}>
        {(data) => (
          <div className="grid gap-4">
            {!data.provider.configured ? (
              <Alert tone="warning" title="ValidaPay nao configurada">
                Defina VALIDAPAY_CLIENT_ID e VALIDAPAY_CLIENT_SECRET no ambiente do servidor. Sem
                elas nenhuma contratacao pode ser concluida.
              </Alert>
            ) : null}
            {!data.provider.webhooksConfigured ? (
              <Alert tone="warning" title="Webhooks nao configurados">
                Sem VALIDAPAY_WEBHOOK_SECRET os eventos de pagamento sao recusados, e a ativacao
                das assinaturas dependeria apenas da reconciliacao.
              </Alert>
            ) : null}
            {!data.provider.reconciliationConfigured ? (
              <Alert tone="info" title="Reconciliacao automatica desligada">
                Defina BILLING_RECONCILIATION_SECRET para habilitar o job periodico.
              </Alert>
            ) : null}
            {data.webhooks.failed > 0 ? (
              <Alert tone="danger" title={`${data.webhooks.failed} evento(s) com falha`}>
                Abra a aba Eventos para inspecionar e reprocessar.
              </Alert>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Ativas" value={data.subscriptions.active ?? 0} />
              <Stat label="Em avaliacao" value={data.subscriptions.trialing ?? 0} />
              <Stat label="Aguardando pagamento" value={data.subscriptions.pending ?? 0} />
              <Stat label="Em atraso" value={data.subscriptions.pastDue ?? 0} tone="warning" />
              <Stat label="Canceladas" value={data.subscriptions.canceled ?? 0} />
              <Stat label="Encerradas" value={data.subscriptions.expired ?? 0} />
              <Stat
                label="Recebido em 30 dias"
                value={data.paidLast30Days.amountLabel}
                hint={`${data.paidLast30Days.count} cobranca(s) paga(s)`}
              />
              <Stat label="Cobrancas em aberto" value={data.openCharges} />
            </div>

            <Card>
              <CardHeader
                title="Planos na ValidaPay"
                description="Um plano sem preco sincronizado nao pode ser contratado."
              />
              <CardBody className="grid gap-2">
                {data.plans.map((plan) => (
                  <div
                    key={plan.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3"
                  >
                    <div className="grid gap-0.5">
                      <span className="text-sm font-medium text-slate-800">
                        {plan.name} - {plan.priceLabel}
                      </span>
                      <span className="text-xs text-slate-500">
                        {plan.billable
                          ? plan.synced
                            ? `preco ${plan.externalPriceId} - sinc. ${
                                plan.externalSyncedAt ? formatDateTime(plan.externalSyncedAt) : '-'
                              }`
                            : 'ainda nao sincronizado'
                          : 'plano gratuito: nao vira preco na ValidaPay'}
                      </span>
                      {plan.externalSyncError ? (
                        <span className="text-xs text-rose-600">{plan.externalSyncError}</span>
                      ) : null}
                    </div>
                    {plan.billable ? (
                      <Button
                        size="sm"
                        variant={plan.synced ? 'ghost' : 'outline'}
                        onClick={() => void syncPlan(plan.id, plan.name)}
                        disabled={working || !data.provider.configured}
                      >
                        {plan.synced ? 'Sincronizar de novo' : 'Sincronizar'}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>
        )}
      </ResourcePanel>

      <SegmentedControl
        label="Secao da cobranca"
        value={tab}
        onChange={(value) => setTab(value as typeof tab)}
        options={[
          { value: 'assinaturas', label: 'Assinaturas' },
          { value: 'cobrancas', label: 'Cobrancas' },
          { value: 'eventos', label: 'Eventos' },
          { value: 'historico', label: 'Historico' },
        ]}
      />

      {tab === 'assinaturas' ? (
        <Card>
          <CardHeader
            title="Assinaturas"
            actions={
              <div className="flex flex-wrap items-end gap-2">
                <TextInput
                  label="Buscar"
                  placeholder="empresa ou sub_..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <Select
                  label="Situacao"
                  value={stateFilter}
                  onChange={(event) => setStateFilter(event.target.value)}
                  placeholder="Todas"
                  options={[
                    { value: 'pending', label: 'Aguardando pagamento' },
                    { value: 'trialing', label: 'Em avaliacao' },
                    { value: 'active', label: 'Ativa' },
                    { value: 'past_due', label: 'Em atraso' },
                    { value: 'cancel_at_period_end', label: 'Cancelamento agendado' },
                    { value: 'canceled', label: 'Cancelada' },
                    { value: 'expired', label: 'Encerrada' },
                    { value: 'suspended', label: 'Suspensa' },
                  ]}
                />
              </div>
            }
          />
          <CardBody>
            <ResourcePanel resource={subscriptions}>
              {(data) => (
                <DataTable
                  columns={subscriptionColumns}
                  rows={data.items}
                  rowKey={(row) => row.id}
                  empty="Nenhuma assinatura encontrada."
                />
              )}
            </ResourcePanel>
          </CardBody>
        </Card>
      ) : null}

      {tab === 'cobrancas' ? (
        <Card>
          <CardHeader title="Cobrancas" />
          <CardBody>
            <ResourcePanel resource={charges}>
              {(data) => (
                <DataTable
                  columns={chargeColumns}
                  rows={data.items}
                  rowKey={(row) => row.id}
                  empty="Nenhuma cobranca registrada."
                />
              )}
            </ResourcePanel>
          </CardBody>
        </Card>
      ) : null}

      {tab === 'eventos' ? (
        <Card>
          <CardHeader
            title="Eventos de webhook"
            description="O mesmo evento pode chegar varias vezes: o reprocessamento e idempotente."
            actions={
              <Select
                label="Situacao"
                value={eventStatus}
                onChange={(event) => setEventStatus(event.target.value)}
                placeholder="Todas"
                options={[
                  { value: 'pending', label: 'Pendentes' },
                  { value: 'failed', label: 'Com falha' },
                  { value: 'unresolved', label: 'Sem empresa' },
                  { value: 'processed', label: 'Processados' },
                  { value: 'ignored', label: 'Ignorados' },
                ]}
              />
            }
          />
          <CardBody>
            <ResourcePanel resource={events}>
              {(data) => (
                <DataTable
                  columns={eventColumns}
                  rows={data.items}
                  rowKey={(row) => row.id}
                  empty="Nenhum evento nesta situacao."
                />
              )}
            </ResourcePanel>
          </CardBody>
        </Card>
      ) : null}

      {tab === 'historico' ? (
        <Card>
          <CardHeader
            title="Historico de cobranca"
            description="Mudancas de estado, publicacao e acoes administrativas, com a origem de cada uma."
          />
          <CardBody>
            <ResourcePanel resource={history}>
              {(data) => (
                <ul className="grid gap-2">
                  {data.items.map((entry) => (
                    <li key={entry.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-slate-800">{entry.action}</span>
                        <span className="text-xs text-slate-500">
                          {entry.source} - {formatDateTime(entry.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        {entry.tenantName ? `${entry.tenantName}: ` : ''}
                        {entry.previousState && entry.newState && entry.previousState !== entry.newState
                          ? `${entry.previousState} -> ${entry.newState}. `
                          : ''}
                        {entry.previousPublication &&
                        entry.newPublication &&
                        entry.previousPublication !== entry.newPublication
                          ? `publicacao: ${entry.previousPublication} -> ${entry.newPublication}. `
                          : ''}
                        {entry.reason}
                      </p>
                    </li>
                  ))}
                  {data.items.length === 0 ? (
                    <li className="text-sm text-slate-500">Nenhum registro ainda.</li>
                  ) : null}
                </ul>
              )}
            </ResourcePanel>
          </CardBody>
        </Card>
      ) : null}

      <Modal
        open={holdTarget !== null}
        onClose={() => setHoldTarget(null)}
        title={
          holdTarget?.adminHold
            ? `Reativar a publicacao de ${holdTarget.siteName}`
            : `Suspender a publicacao de ${holdTarget?.siteName ?? ''}`
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setHoldTarget(null)} disabled={working}>
              Cancelar
            </Button>
            <Button
              variant={holdTarget?.adminHold ? 'primary' : 'danger'}
              onClick={() => void applyHold()}
              loading={working}
              disabled={holdReason.trim().length < 10}
            >
              {holdTarget?.adminHold ? 'Reativar' : 'Suspender'}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 text-sm text-slate-600">
          <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle aria-hidden="true" className="size-4 flex-none" />
            Esta decisao e administrativa e fica registrada em auditoria. Ela nao altera o estado
            financeiro confirmado pela ValidaPay, e nenhum conteudo da empresa e removido.
          </p>
          <TextArea
            label="Justificativa"
            rows={3}
            value={holdReason}
            onChange={(event) => setHoldReason(event.target.value)}
            hint="Minimo de 10 caracteres. Fica visivel no historico de cobranca."
          />
        </div>
      </Modal>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'warning';
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={
          tone === 'warning'
            ? 'mt-1 text-2xl font-semibold text-amber-700'
            : 'mt-1 text-2xl font-semibold text-slate-900'
        }
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function stateTone(state: string): BadgeTone {
  switch (state) {
    case 'active':
      return 'success';
    case 'trialing':
      return 'brand';
    case 'past_due':
    case 'cancel_at_period_end':
    case 'pending':
      return 'warning';
    case 'canceled':
    case 'expired':
    case 'suspended':
      return 'danger';
    default:
      return 'neutral';
  }
}

function chargeTone(status: string): BadgeTone {
  switch (status) {
    case 'paid':
      return 'success';
    case 'pending':
    case 'processing':
    case 'awaiting_payment':
    case 'dispute':
    case 'partially_refunded':
      return 'warning';
    case 'failed':
    case 'expired':
    case 'refunded':
    case 'charged_back':
      return 'danger';
    default:
      return 'neutral';
  }
}

function eventTone(status: string): BadgeTone {
  switch (status) {
    case 'processed':
      return 'success';
    case 'pending':
      return 'warning';
    case 'failed':
    case 'unresolved':
      return 'danger';
    default:
      return 'neutral';
  }
}
