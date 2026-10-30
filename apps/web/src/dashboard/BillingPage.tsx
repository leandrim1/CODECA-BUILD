import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, CreditCard, ExternalLink, RefreshCw } from 'lucide-react';
import {
  PLAN_FEATURES,
  PLAN_FEATURE_LABELS,
  formatBytes,
  formatDateTime,
  type PaymentMethodCode,
} from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Meter,
  Modal,
  PageHeader,
  Select,
  TextArea,
  cx,
  useToast,
  type BadgeTone,
  type Column,
} from '@codeca/ui';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { useTenantId } from '../hooks/useAuth.js';
import { useResource } from '../hooks/useResource.js';
import { billingApi } from '../services/endpoints.js';
import { ApiError } from '../services/api.js';
import type { BillingPlanOption, ChargeView } from '../types/index.js';

/**
 * Plano, assinatura e historico de cobrancas da construtora.
 *
 * Cada botao aqui corresponde a uma operacao que existe de verdade no backend.
 * Quando a integracao de pagamento nao esta configurada no servidor, a tela diz
 * isso e desabilita a contratacao, em vez de exibir um fluxo que nao conclui.
 */
export function BillingPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const billing = useResource(() => billingApi.overview(tenantId), [tenantId]);

  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlanOption | null>(null);
  const [method, setMethod] = useState<PaymentMethodCode | ''>('');
  const [working, setWorking] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [changePlan, setChangePlan] = useState<BillingPlanOption | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const data = billing.data;
  const subscription = data?.subscription ?? null;

  const openCheckout = useCallback((plan: BillingPlanOption) => {
    setCheckoutPlan(plan);
    setMethod(plan.paymentMethods[0]?.code ?? '');
  }, []);

  const confirmCheckout = async () => {
    if (!checkoutPlan || !method) return;
    setWorking(true);
    try {
      const result = await billingApi.checkout(tenantId, {
        planId: checkoutPlan.id,
        paymentMethod: method,
      });
      setCheckoutPlan(null);
      // A pagina de pagamento e hospedada pela ValidaPay: os dados do cartao
      // nunca passam por esta aplicacao.
      window.location.href = result.checkoutUrl;
    } catch (error) {
      toast.error(
        'Nao foi possivel iniciar a contratacao',
        error instanceof ApiError ? error.message : undefined,
      );
    } finally {
      setWorking(false);
    }
  };

  const refreshState = async () => {
    setWorking(true);
    try {
      const result = await billingApi.refresh(tenantId);
      toast.success(
        'Assinatura consultada',
        result.divergence ?? (result.synced ? 'Estado confirmado junto ao provedor.' : undefined),
      );
      billing.reload();
    } catch (error) {
      toast.error('Falha ao consultar', error instanceof ApiError ? error.message : undefined);
    } finally {
      setWorking(false);
    }
  };

  const refreshCharge = async (charge: ChargeView) => {
    setWorking(true);
    try {
      const result = await billingApi.refreshCharge(tenantId, charge.id);
      toast.success('Cobranca consultada', `Situacao atual: ${result.charge.statusLabel}.`);
      billing.reload();
    } catch (error) {
      toast.error('Falha ao consultar', error instanceof ApiError ? error.message : undefined);
    } finally {
      setWorking(false);
    }
  };

  const confirmCancel = async () => {
    setWorking(true);
    try {
      const result = await billingApi.cancel(tenantId, {
        reason: cancelReason,
        mode: 'period_end',
      });
      toast.success('Cancelamento registrado', result.message);
      setCancelOpen(false);
      setCancelReason('');
      billing.reload();
    } catch (error) {
      toast.error('Falha ao cancelar', error instanceof ApiError ? error.message : undefined);
    } finally {
      setWorking(false);
    }
  };

  const undoCancel = async () => {
    setWorking(true);
    try {
      const result = await billingApi.undoCancel(tenantId);
      toast.success('Cancelamento desfeito', result.message);
      billing.reload();
    } catch (error) {
      toast.error('Falha ao desfazer', error instanceof ApiError ? error.message : undefined);
    } finally {
      setWorking(false);
    }
  };

  const openChangePlan = async (plan: BillingPlanOption) => {
    setChangePlan(plan);
    setPreview(null);
    try {
      const result = await billingApi.changePlan(tenantId, { planId: plan.id, preview: true });
      const parts: string[] = [];
      if (result.chargeNowCents) {
        parts.push(`Cobranca proporcional agora: ${centsLabel(result.chargeNowCents)}.`);
      }
      if (result.creditCents) {
        parts.push(`Credito gerado: ${centsLabel(result.creditCents)}, abatido nas proximas cobrancas.`);
      }
      if (!result.chargeNowCents && !result.creditCents) {
        parts.push('Sem cobranca agora: o valor novo passa a valer na proxima cobranca.');
      }
      for (const warning of result.warnings ?? []) parts.push(warning);
      setPreview(parts.join(' '));
    } catch (error) {
      setPreview(
        error instanceof ApiError
          ? error.message
          : 'Nao foi possivel simular a troca de plano agora.',
      );
    }
  };

  const confirmChangePlan = async () => {
    if (!changePlan) return;
    setWorking(true);
    try {
      const result = await billingApi.changePlan(tenantId, { planId: changePlan.id, preview: false });
      toast.success('Troca solicitada', result.message);
      setChangePlan(null);
      billing.reload();
    } catch (error) {
      toast.error('Falha na troca de plano', error instanceof ApiError ? error.message : undefined);
    } finally {
      setWorking(false);
    }
  };

  const chargeColumns = useMemo<Column<ChargeView>[]>(
    () => [
      {
        key: 'created',
        header: 'Data',
        render: (row) => (
          <span className="text-sm text-slate-700">{formatDateTime(row.createdAt)}</span>
        ),
      },
      {
        key: 'cycle',
        header: 'Ciclo',
        hideOnMobile: true,
        render: (row) => <span className="text-sm text-slate-600">{row.cycleNumber ?? '-'}</span>,
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
        render: (row) => (
          <div className="grid gap-0.5">
            <Badge tone={chargeTone(row.status)}>{row.statusLabel}</Badge>
            {row.failureReason ? (
              <span className="text-xs text-rose-600">{row.failureReason}</span>
            ) : null}
          </div>
        ),
      },
      {
        key: 'method',
        header: 'Forma',
        hideOnMobile: true,
        render: (row) => (
          <span className="text-sm text-slate-600">{row.paymentMethodLabel ?? '-'}</span>
        ),
      },
      {
        key: 'paid',
        header: 'Pagamento',
        hideOnMobile: true,
        render: (row) => (
          <span className="text-sm text-slate-600">
            {row.paidAt ? formatDateTime(row.paidAt) : row.dueAt ? `vence ${formatDateTime(row.dueAt)}` : '-'}
          </span>
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
            onClick={() => void refreshCharge(row)}
            disabled={working}
            title="Consultar a situacao desta cobranca no provedor"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            <span className="sr-only">Consultar novamente</span>
          </Button>
        ),
      },
    ],
    [working],
  );

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Plano e assinatura"
        description="Situacao da assinatura, historico de pagamentos e estado da publicacao do site."
        actions={
          subscription ? (
            <Button variant="outline" onClick={() => void refreshState()} disabled={working}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Consultar novamente
            </Button>
          ) : undefined
        }
      />

      <ResourcePanel resource={billing}>
        {(view) => (
          <div className="grid gap-6">
            {!view.available ? (
              <Alert tone="warning" title="Contratacao indisponivel">
                A integracao de pagamento nao esta configurada no servidor. Fale com a equipe da
                plataforma: enquanto isso, nenhuma contratacao pode ser concluida.
              </Alert>
            ) : null}

            {view.subscription ? (
              <>
                {/* Estado da publicacao: a informacao mais importante da tela. */}
                <Alert
                  tone={view.subscription.publicationState === 'allowed' ? 'success' : 'warning'}
                  title={view.subscription.publicationLabel}
                >
                  {view.subscription.publicationMessage}
                  {view.subscription.inGracePeriod && view.subscription.graceEndsAt ? (
                    <>
                      {' '}
                      O site continua no ar durante a tolerancia, ate{' '}
                      <strong>{formatDateTime(view.subscription.graceEndsAt)}</strong>.
                    </>
                  ) : null}
                </Alert>

                {view.subscription.lastErrorMessage ? (
                  <Alert tone="danger" title="Ultima tentativa de pagamento recusada">
                    {view.subscription.lastErrorMessage}
                  </Alert>
                ) : null}

                {view.subscription.state === 'pending' && view.subscription.checkoutUrl ? (
                  <Alert tone="info" title="Pagamento pendente">
                    A contratacao foi iniciada e aguarda o pagamento.{' '}
                    <a
                      className="font-medium text-brand-700 underline"
                      href={view.subscription.checkoutUrl}
                      rel="noreferrer"
                    >
                      Retomar o pagamento
                    </a>
                    .
                  </Alert>
                ) : null}
              </>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
              <div className="grid gap-6">
                <Card>
                  <CardHeader
                    title={`Plano ${view.plan.name}`}
                    description={describeSubscription(view.subscription)}
                    actions={
                      <div className="flex items-center gap-2">
                        {view.plan.overridden ? <Badge tone="info">Limites ajustados</Badge> : null}
                        {view.subscription ? (
                          <Badge tone={stateTone(view.subscription.state)}>
                            {view.subscription.stateLabel}
                          </Badge>
                        ) : null}
                      </div>
                    }
                  />
                  <CardBody className="grid gap-4">
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <Info
                        label="Forma de pagamento"
                        value={view.subscription?.paymentMethodLabel ?? 'Nao definida'}
                        hint={
                          view.subscription?.automaticRenewal === false
                            ? 'Renovacao manual: a cada ciclo e emitida uma cobranca para pagamento.'
                            : view.subscription?.automaticRenewal === true
                              ? 'Renovacao automatica a cada ciclo.'
                              : undefined
                        }
                      />
                      <Info
                        label="Valor do ciclo"
                        value={
                          view.subscription?.currentCycleAmountCents != null
                            ? centsLabel(view.subscription.currentCycleAmountCents)
                            : view.plans.find((plan) => plan.current)?.priceLabel ?? '-'
                        }
                      />
                      <Info
                        label="Acesso garantido ate"
                        value={
                          view.subscription?.accessUntil
                            ? formatDateTime(view.subscription.accessUntil)
                            : 'Aguardando pagamento'
                        }
                      />
                      <Info
                        label="Proxima cobranca"
                        value={
                          view.subscription?.nextChargeAt
                            ? formatDateTime(view.subscription.nextChargeAt)
                            : 'Nao programada'
                        }
                        hint={
                          view.subscription?.cancelAtPeriodEnd
                            ? 'Cancelamento agendado: nao havera nova cobranca.'
                            : undefined
                        }
                      />
                      {view.subscription?.trialEndsAt ? (
                        <Info
                          label="Avaliacao ate"
                          value={formatDateTime(view.subscription.trialEndsAt)}
                        />
                      ) : null}
                      <Info
                        label="Ultima sincronizacao"
                        value={
                          view.subscription?.lastSyncedAt
                            ? formatDateTime(view.subscription.lastSyncedAt)
                            : 'Nunca'
                        }
                      />
                    </dl>

                    <div className="grid gap-3 border-t border-slate-100 pt-4">
                      <Meter
                        label="Imoveis publicados"
                        current={view.usage.publishedProperties}
                        limit={view.plan.limits.maxPublishedProperties}
                      />
                      <Meter
                        label="Obras cadastradas"
                        current={view.usage.projects}
                        limit={view.plan.limits.maxProjects}
                      />
                      <Meter label="Usuarios ativos" current={view.usage.users} limit={view.plan.limits.maxUsers} />
                      <Meter label="Dominios" current={view.usage.domains} limit={view.plan.limits.maxDomains} />
                      <Meter
                        label="Armazenamento"
                        current={view.usage.storageBytes}
                        limit={view.plan.limits.storageBytes}
                        format={formatBytes}
                      />
                    </div>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader
                    title="Historico de cobrancas"
                    description="Cada linha e uma cobranca registrada na ValidaPay."
                  />
                  <CardBody>
                    <DataTable
                      columns={chargeColumns}
                      rows={view.charges}
                      rowKey={(row) => row.id}
                      empty="Nenhuma cobranca registrada ainda."
                    />
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="Recursos do plano" />
                  <CardBody>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {PLAN_FEATURES.map((feature) => {
                        const included = view.plan.limits.features.includes(feature);
                        return (
                          <li
                            key={feature}
                            className={cx(
                              'flex items-center gap-2 text-sm',
                              included ? 'text-slate-800' : 'text-slate-400',
                            )}
                          >
                            <Check
                              aria-hidden="true"
                              className={cx(
                                'size-4 flex-none',
                                included ? 'text-emerald-600' : 'text-slate-300',
                              )}
                            />
                            {PLAN_FEATURE_LABELS[feature]}
                          </li>
                        );
                      })}
                    </ul>
                  </CardBody>
                </Card>
              </div>

              <div className="grid gap-6">
                <Card>
                  <CardHeader title="Planos disponiveis" />
                  <CardBody className="grid gap-3">
                    {view.plans.map((plan) => (
                      <div
                        key={plan.id}
                        className={cx(
                          'rounded-lg border p-3',
                          plan.current ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-slate-900">{plan.name}</p>
                          {plan.current ? <Badge tone="brand">Atual</Badge> : null}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{plan.description}</p>
                        <p className="mt-1.5 text-sm font-semibold text-slate-800">
                          {plan.priceCents === 0 ? 'Gratuito' : `${plan.priceLabel}/mes`}
                        </p>
                        <ul className="mt-2 grid gap-0.5 text-xs text-slate-500">
                          <li>{plan.limits.maxPublishedProperties} imoveis publicados</li>
                          <li>{plan.limits.maxProjects} obras</li>
                          <li>{plan.limits.maxUsers} usuarios</li>
                          <li>{formatBytes(plan.limits.storageBytes)} de armazenamento</li>
                        </ul>

                        {!plan.current && plan.contractable ? (
                          <div className="mt-3 grid gap-2">
                            {view.subscription?.externalSubscriptionId ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void openChangePlan(plan)}
                                disabled={!view.available || working}
                              >
                                Trocar para este plano
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => openCheckout(plan)}
                                disabled={!view.available || working || plan.paymentMethods.length === 0}
                              >
                                <CreditCard aria-hidden="true" className="size-4" />
                                Contratar
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </CardBody>
                </Card>

                {view.subscription?.externalSubscriptionId ? (
                  <Card>
                    <CardHeader title="Cancelamento" />
                    <CardBody className="grid gap-3 text-sm text-slate-600">
                      {view.subscription.cancelAtPeriodEnd ? (
                        <>
                          <p>
                            O cancelamento esta agendado para o fim do periodo pago. O site continua
                            no ar ate la.
                          </p>
                          <Button variant="outline" onClick={() => void undoCancel()} disabled={working}>
                            Desfazer cancelamento
                          </Button>
                        </>
                      ) : (
                        <>
                          <p>
                            O cancelamento respeita o periodo contratado. O conteudo do site, os
                            imoveis e as imagens continuam salvos.
                          </p>
                          <Button
                            variant="danger"
                            onClick={() => setCancelOpen(true)}
                            disabled={working || view.subscription.state === 'canceled'}
                          >
                            Solicitar cancelamento
                          </Button>
                        </>
                      )}
                    </CardBody>
                  </Card>
                ) : null}

                <Card>
                  <CardHeader title="Pagamento com problema?" />
                  <CardBody className="grid gap-2 text-sm text-slate-600">
                    <p>
                      Uma falha isolada nao cancela a assinatura: ha um periodo de tolerancia de{' '}
                      {view.subscription?.gracePeriodDays ?? 5} dias antes de o site ser suspenso.
                    </p>
                    <p>
                      Para regularizar, confira a forma de pagamento com o seu banco e use{' '}
                      <strong>Consultar novamente</strong> para atualizar a situacao aqui.
                    </p>
                    <p className="text-xs text-slate-500">
                      O painel continua acessivel mesmo com o site suspenso, para que a empresa
                      possa regularizar sem perder nada.
                    </p>
                  </CardBody>
                </Card>
              </div>
            </div>
          </div>
        )}
      </ResourcePanel>

      {/* Contratacao: escolha da forma de pagamento antes de ir ao checkout. */}
      <Modal
        open={checkoutPlan !== null}
        onClose={() => setCheckoutPlan(null)}
        title={checkoutPlan ? `Contratar ${checkoutPlan.name}` : 'Contratar'}
        footer={
          <>
            <Button variant="outline" onClick={() => setCheckoutPlan(null)} disabled={working}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmCheckout()} loading={working} disabled={!method}>
              Ir para o pagamento
              <ExternalLink aria-hidden="true" className="size-4" />
            </Button>
          </>
        }
      >
        {checkoutPlan ? (
          <div className="grid gap-4 text-sm text-slate-600">
            <p>
              {checkoutPlan.name} por <strong>{checkoutPlan.priceLabel}</strong> a cada{' '}
              {recurrenceLabel(checkoutPlan)}.
            </p>

            <Select
              label="Forma de pagamento"
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethodCode)}
              options={checkoutPlan.paymentMethods.map((option) => ({
                value: option.code,
                label: option.label,
              }))}
            />

            {method ? (
              <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                {checkoutPlan.paymentMethods.find((option) => option.code === method)?.description}
              </p>
            ) : null}

            {method && !checkoutPlan.paymentMethods.find((o) => o.code === method)?.automatic ? (
              <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle aria-hidden="true" className="size-4 flex-none" />
                Esta forma de pagamento nao tem debito automatico: a cada ciclo e emitida uma nova
                cobranca para pagamento manual.
              </p>
            ) : null}

            <p className="text-xs text-slate-500">
              O pagamento acontece na pagina da ValidaPay. A publicacao do site e liberada quando o
              pagamento for confirmado.
            </p>
          </div>
        ) : null}
      </Modal>

      {/* Troca de plano, com a simulacao devolvida pelo provedor. */}
      <Modal
        open={changePlan !== null}
        onClose={() => setChangePlan(null)}
        title={changePlan ? `Trocar para ${changePlan.name}` : 'Trocar de plano'}
        footer={
          <>
            <Button variant="outline" onClick={() => setChangePlan(null)} disabled={working}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmChangePlan()} loading={working}>
              Confirmar troca
            </Button>
          </>
        }
      >
        <div className="grid gap-3 text-sm text-slate-600">
          <p>
            {changePlan?.name} por <strong>{changePlan?.priceLabel}</strong> a cada{' '}
            {changePlan ? recurrenceLabel(changePlan) : 'mes'}.
          </p>
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            {preview ?? 'Simulando o valor da troca junto ao provedor...'}
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        title="Solicitar cancelamento"
        confirmLabel="Confirmar cancelamento"
        loading={working}
        onCancel={() => setCancelOpen(false)}
        onConfirm={() => void confirmCancel()}
        message={
          <div className="grid gap-3">
            <p>
              O cancelamento respeita o periodo contratado: o site continua no ar ate o fim do
              periodo pago, e o conteudo cadastrado continua salvo.
            </p>
            <TextArea
              label="Motivo (opcional)"
              rows={3}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Conte o motivo para ajudar a plataforma a melhorar."
            />
          </div>
        }
      />
    </div>
  );
}

function Info({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm font-medium text-slate-800">{value}</dd>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function describeSubscription(
  subscription: { stateLabel: string; canceledAt: string | null } | null,
): string {
  if (!subscription) return 'Nenhuma assinatura registrada.';
  if (subscription.canceledAt) {
    return `${subscription.stateLabel} em ${formatDateTime(subscription.canceledAt)}.`;
  }
  return subscription.stateLabel;
}

function recurrenceLabel(plan: BillingPlanOption): string {
  const labels: Record<string, string> = {
    DAILY: 'dia',
    WEEKLY: 'semana',
    MONTHLY: 'mes',
    QUARTERLY: 'trimestre',
    SEMIANNUAL: 'semestre',
    YEARLY: 'ano',
  };
  const unit = labels[plan.recurrenceType] ?? 'mes';
  return plan.recurrenceInterval > 1 ? `${plan.recurrenceInterval} ${unit}es` : unit;
}

function centsLabel(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function stateTone(state: string): BadgeTone {
  switch (state) {
    case 'active':
      return 'success';
    case 'trialing':
      return 'brand';
    case 'past_due':
    case 'cancel_at_period_end':
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
      return 'warning';
    case 'failed':
    case 'expired':
    case 'charged_back':
    case 'refunded':
      return 'danger';
    case 'dispute':
    case 'partially_refunded':
      return 'warning';
    default:
      return 'neutral';
  }
}
