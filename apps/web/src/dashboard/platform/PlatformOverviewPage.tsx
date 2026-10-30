import { Link } from 'react-router-dom';
import { Building2, FileText, Globe, HardDrive, Users } from 'lucide-react';
import { formatBytes, formatDateTime } from '@codeca/shared';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@codeca/ui';
import { useResource } from '../../hooks/useResource.js';
import { platformApi } from '../../services/endpoints.js';
import { ResourcePanel } from '../../components/ResourcePanel.js';
import { tenantTone } from '../../utils/labels.js';

/** Visao geral da plataforma, para o proprietario do SaaS. */
export function PlatformOverviewPage() {
  const overview = useResource(() => platformApi.overview(), []);

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Visao geral da plataforma"
        description="Numeros agregados de todas as construtoras. Para ver o conteudo de uma empresa e necessaria uma concessao de suporte."
      />

      <ResourcePanel resource={overview}>
        {(data) => (
          <div className="grid gap-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Indicadores">
              <Stat icon={Building2} label="Construtoras" value={data.tenants.total} detail={`${data.tenants.active} ativas - ${data.tenants.trialing} em avaliacao`} />
              <Stat icon={Users} label="Usuarios" value={data.users} detail="Contas na plataforma" />
              <Stat icon={Globe} label="Dominios" value={data.domains.total} detail={`${data.domains.active} ativos - ${data.domains.pending} pendentes`} />
              <Stat icon={HardDrive} label="Armazenamento" value={0} detail={formatBytes(data.storageBytes)} hideValue />
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader title="Construtoras por plano" />
                <CardBody>
                  {data.byPlan.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhuma construtora cadastrada.</p>
                  ) : (
                    <ul className="grid gap-2">
                      {data.byPlan.map((row) => (
                        <li key={row.planCode} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-slate-700">{row.planName}</span>
                          <span className="tabular-nums font-medium text-slate-900">{row.tenants}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Ultimas construtoras"
                  actions={
                    <Link to="/plataforma/empresas" className="text-sm link">
                      Ver todas
                    </Link>
                  }
                />
                <CardBody>
                  {data.recentTenants.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhuma construtora cadastrada.</p>
                  ) : (
                    <ul className="grid gap-2">
                      {data.recentTenants.map((item) => (
                        <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{item.displayName}</p>
                            <p className="text-xs text-slate-500">
                              {item.slug} - {formatDateTime(item.createdAt)}
                            </p>
                          </div>
                          <Badge tone={tenantTone(item.status as never)}>{item.status}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
        )}
      </ResourcePanel>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
  hideValue = false,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  detail: string;
  hideValue?: boolean;
}) {
  return (
    <Card>
      <CardBody className="grid gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-slate-500">{label}</span>
          <Icon aria-hidden="true" className="size-4 text-slate-400" />
        </div>
        {hideValue ? null : <p className="text-2xl font-semibold tabular-nums text-slate-900">{value}</p>}
        <p className={hideValue ? 'text-xl font-semibold text-slate-900' : 'text-xs text-slate-500'}>{detail}</p>
      </CardBody>
    </Card>
  );
}
