import { Check } from 'lucide-react';
import { PLAN_FEATURE_LABELS, PLAN_FEATURES, formatBytes, formatDateTime } from '@codeca/shared';
import { Alert, Badge, Card, CardBody, CardHeader, Meter, PageHeader, cx } from '@codeca/ui';
import { useTenantId } from '../hooks/useAuth.js';
import { useResource } from '../hooks/useResource.js';
import { tenantApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';

/** Plano contratado, uso atual e recursos disponiveis. */
export function PlanPage() {
  const tenantId = useTenantId();
  const plan = useResource(() => tenantApi.plan(tenantId), [tenantId]);

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Plano e assinatura"
        description="Limites verificados no servidor em todas as operacoes, nao apenas na interface."
      />

      <ResourcePanel resource={plan}>
        {(data) => (
          <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
            <div className="grid gap-6">
              <Card>
                <CardHeader
                  title={`Plano ${data.plan.planName}`}
                  description={
                    data.subscription
                      ? `Assinatura ${data.subscription.status}${
                          data.subscription.trialEndsAt
                            ? ` - avaliacao ate ${formatDateTime(data.subscription.trialEndsAt)}`
                            : ''
                        }`
                      : 'Sem assinatura registrada'
                  }
                  actions={data.plan.overridden ? <Badge tone="info">Limites ajustados</Badge> : undefined}
                />
                <CardBody className="grid gap-4">
                  <Meter
                    label="Imoveis publicados"
                    current={data.usage.publishedProperties}
                    limit={data.plan.limits.maxPublishedProperties}
                  />
                  <Meter label="Obras cadastradas" current={data.usage.projects} limit={data.plan.limits.maxProjects} />
                  <Meter label="Paginas" current={data.usage.pages} limit={data.plan.limits.maxPages} />
                  <Meter label="Usuarios ativos" current={data.usage.users} limit={data.plan.limits.maxUsers} />
                  <Meter label="Dominios" current={data.usage.domains} limit={data.plan.limits.maxDomains} />
                  <Meter
                    label="Armazenamento"
                    current={data.usage.storageBytes}
                    limit={data.plan.limits.storageBytes}
                    format={formatBytes}
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Recursos do plano" />
                <CardBody>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {PLAN_FEATURES.map((feature) => {
                      const included = data.plan.limits.features.includes(feature);
                      return (
                        <li
                          key={feature}
                          className={cx('flex items-center gap-2 text-sm', included ? 'text-slate-800' : 'text-slate-400')}
                        >
                          <Check
                            aria-hidden="true"
                            className={cx('size-4 flex-none', included ? 'text-emerald-600' : 'text-slate-300')}
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
              {!data.selfServiceUpgrade ? (
                <Alert tone="info" title="Troca de plano">
                  A cobranca automatizada ainda nao esta implementada nesta versao. A mudanca de plano e feita
                  pela equipe da plataforma, pelo painel mestre.
                </Alert>
              ) : null}

              <Card>
                <CardHeader title="Planos disponiveis" />
                <CardBody className="grid gap-3">
                  {data.availablePlans.map((item) => (
                    <div
                      key={item.code}
                      className={cx(
                        'rounded-lg border p-3',
                        item.code === data.plan.planCode ? 'border-brand-400 bg-brand-50/50' : 'border-slate-200',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-slate-900">{item.name}</p>
                        {item.code === data.plan.planCode ? <Badge tone="brand">Atual</Badge> : null}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                      <p className="mt-1.5 text-sm font-semibold text-slate-800">
                        {item.priceCents === 0
                          ? 'Gratuito'
                          : `R$ ${(item.priceCents / 100).toLocaleString('pt-BR')}/mes`}
                      </p>
                      <ul className="mt-2 grid gap-0.5 text-xs text-slate-500">
                        <li>{item.limits.maxPublishedProperties} imoveis publicados</li>
                        <li>{item.limits.maxProjects} obras</li>
                        <li>{item.limits.maxUsers} usuarios</li>
                        <li>{formatBytes(item.limits.storageBytes)} de armazenamento</li>
                      </ul>
                    </div>
                  ))}
                </CardBody>
              </Card>
            </div>
          </div>
        )}
      </ResourcePanel>
    </div>
  );
}
