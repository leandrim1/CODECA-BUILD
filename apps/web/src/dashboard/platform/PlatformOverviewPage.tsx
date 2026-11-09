import { Link } from 'react-router-dom';
import { Building2, FileText, Globe, HardDrive, Mail, Users } from 'lucide-react';
import { formatBytes, formatDateTime } from '@codeca/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, PageHeader, useToast } from '@codeca/ui';
import { useMutation, useResource } from '../../hooks/useResource.js';
import { platformApi } from '../../services/endpoints.js';
import { ResourcePanel } from '../../components/ResourcePanel.js';
import { tenantTone } from '../../utils/labels.js';

/** Visao geral da plataforma, para o proprietario do SaaS. */
export function PlatformOverviewPage() {
  const overview = useResource('platformApi.overview', () => platformApi.overview(), []);

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Visão geral da plataforma"
        description="Números agregados de todas as empresas. Para ver o conteúdo de uma empresa é necessária uma concessão de suporte."
      />

      <EnvioDeEmail />

      <ResourcePanel resource={overview}>
        {(data) => (
          <div className="grid gap-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Indicadores">
              <Stat icon={Building2} label="Empresas" value={data.tenants.total} detail={`${data.tenants.active} ativas - ${data.tenants.trialing} em avaliação`} />
              <Stat icon={Users} label="Usuários" value={data.users} detail="Contas na plataforma" />
              <Stat icon={Globe} label="Domínios" value={data.domains.total} detail={`${data.domains.active} ativos - ${data.domains.pending} pendentes - ${data.domains.registered} registrados`} />
              <Stat icon={HardDrive} label="Armazenamento" value={0} detail={formatBytes(data.storageBytes)} hideValue />
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader title="Empresas por plano" />
                <CardBody>
                  {data.byPlan.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhuma empresa cadastrada.</p>
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
                  title="Últimas empresas"
                  actions={
                    <Link to="/plataforma/empresas" className="text-sm link">
                      Ver todas
                    </Link>
                  }
                />
                <CardBody>
                  {data.recentTenants.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhuma empresa cadastrada.</p>
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

/**
 * O envio de e-mail funciona?
 *
 * Esta pergunta merece um lugar fixo aqui porque dela dependem recuperacao de
 * senha, convite de usuario e codigo de acesso -- e porque nada no produto avisa
 * sozinho quando ela passa a ser "nao". A sonda consulta o provedor em leitura;
 * o teste envia uma mensagem, e so para o e-mail de quem clicou.
 *
 * Os dois motivos reais de "o e-mail nao chega" aparecem separados: chave
 * recusada e dominio do remetente nao verificado.
 */
function EnvioDeEmail() {
  const toast = useToast();
  const status = useResource('platformApi.emailStatus', () => platformApi.emailStatus(), []);

  const testar = useMutation(() => platformApi.emailTest(), {
    onSuccess: (result) => {
      if (result.delivered) toast.success('Mensagem enviada', `Confira a caixa de entrada de ${result.to}.`);
      else toast.error('O provedor não aceitou', result.reason ?? 'Sem detalhes.');
    },
    onError: (error) => toast.error('Não foi possível enviar', error.message),
  });

  return (
    <Card>
      <CardHeader
        title="Envio de e-mail"
        description="Recuperação de senha, convites e código de acesso dependem deste caminho."
      />
      <CardBody className="grid gap-4">
        <ResourcePanel resource={status}>
          {(data) => {
            const recusado = data.configured && data.probe?.ok === false;
            const semVerificacao = data.senderVerified === false;
            return (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Mail aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
                  {!data.configured ? (
                    <Badge tone="warning">Não configurado</Badge>
                  ) : recusado ? (
                    <Badge tone="danger">Chave recusada</Badge>
                  ) : semVerificacao ? (
                    <Badge tone="warning">Domínio não verificado</Badge>
                  ) : (
                    <Badge tone="success">Provedor respondendo</Badge>
                  )}
                  <span className="min-w-0 text-sm text-slate-600 [overflow-wrap:anywhere]">{data.from}</span>
                </div>

                {data.hint ? <Alert tone="warning">{data.hint}</Alert> : null}
                {recusado && data.probe?.reason ? <Alert tone="danger">{data.probe.reason}</Alert> : null}

                {data.probe?.domains && data.probe.domains.length > 0 ? (
                  <ul className="grid gap-1 text-sm">
                    {data.probe.domains.map((item) => (
                      <li key={item.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="min-w-0 text-slate-700 [overflow-wrap:anywhere]">{item.name}</span>
                        <Badge tone={item.status.toLowerCase() === 'verified' ? 'success' : 'warning'}>
                          {item.status}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {data.configured ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="outline" size="sm" loading={testar.loading} onClick={() => void testar.run(undefined)}>
                      Enviar teste para mim
                    </Button>
                    <span className="text-xs text-slate-500">
                      A mensagem vai somente para o e-mail da sua conta.
                    </span>
                  </div>
                ) : null}
              </div>
            );
          }}
        </ResourcePanel>
      </CardBody>
    </Card>
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
