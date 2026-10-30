import { Link } from 'react-router-dom';
import {
  Building2,
  ExternalLink,
  Globe,
  HardHat,
  Image,
  LayoutTemplate,
  type LucideIcon,
  Users,
} from 'lucide-react';
import { DOMAIN_STATUS_LABELS, formatBytes, formatDateTime, relativeTime } from '@codeca/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Meter, PageHeader } from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useResource } from '../hooks/useResource.js';
import { tenantApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { labels, domainTone, leadTone } from '../utils/labels.js';

/**
 * Visao geral do painel.
 *
 * Todos os numeros vem de contagens reais no banco. Nenhum indicador e
 * estimado: quando nao existe dado, a tela diz que nao existe.
 */
export function OverviewPage() {
  const tenantId = useTenantId();
  const { user, tenant } = useAuth();
  const overview = useResource(() => tenantApi.overview(tenantId), [tenantId]);

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title={`Ola, ${user?.name.split(' ')[0] ?? 'tudo bem'}`}
        description={`Resumo do site e do conteudo da ${tenant?.tenantName ?? 'construtora'}.`}
        actions={
          <Link to="/painel/editor">
            <Button icon={<LayoutTemplate aria-hidden="true" className="size-4" />}>Abrir o editor</Button>
          </Link>
        }
      />

      {user && !user.emailVerified ? (
        <Alert
          tone="warning"
          title="Confirme seu e-mail"
          action={
            <Link to="/confirmar-email">
              <Button variant="outline" size="sm">
                Reenviar confirmacao
              </Button>
            </Link>
          }
        >
          A publicacao do site, os convites de equipe e a conexao de dominio ficam liberados apos a
          confirmacao do e-mail.
        </Alert>
      ) : null}

      <ResourcePanel resource={overview}>
        {(data) => {
          const primaryDomain = data.domains.find((domain) => domain.isPrimary) ?? data.domains[0];
          const siteNoAr = data.pages.published > 0 && primaryDomain?.status === 'active';

          return (
            <div className="grid gap-6">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores">
                <StatCard
                  icon={Building2}
                  label="Imoveis publicados"
                  value={data.properties.published}
                  detail={`${data.properties.available} disponiveis - ${data.properties.drafts} em rascunho`}
                  to="/painel/imoveis"
                />
                <StatCard
                  icon={HardHat}
                  label="Obras cadastradas"
                  value={data.projects.total}
                  detail={`${data.projects.inProgress} em andamento - ${data.projects.completed} concluidas`}
                  to="/painel/obras"
                />
                <StatCard
                  icon={Users}
                  label="Interessados"
                  value={data.leads.total}
                  detail={`${data.leads.novos} novos - ${data.leads.last30Days} nos ultimos 30 dias`}
                  to="/painel/interessados"
                />
                <StatCard
                  icon={Image}
                  label="Arquivos na biblioteca"
                  value={data.media.total}
                  detail={formatBytes(data.media.bytes)}
                  to="/painel/midia"
                />
              </section>

              <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
                <div className="grid gap-6">
                  <Card>
                    <CardHeader
                      title="Situacao do site"
                      description={
                        data.site.lastPublishedAt
                          ? `Ultima publicacao ${relativeTime(data.site.lastPublishedAt)}`
                          : 'O site ainda nao foi publicado.'
                      }
                      actions={
                        <Link to="/painel/paginas">
                          <Button variant="outline" size="sm">
                            Gerenciar paginas
                          </Button>
                        </Link>
                      }
                    />
                    <CardBody className="grid gap-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={siteNoAr ? 'success' : 'warning'}>
                          {siteNoAr ? 'Site no ar' : 'Site ainda nao publicado'}
                        </Badge>
                        <Badge tone="neutral">{data.pages.published} pagina(s) publicada(s)</Badge>
                        {data.pages.drafts > 0 ? (
                          <Badge tone="warning">{data.pages.drafts} em rascunho</Badge>
                        ) : null}
                      </div>

                      {primaryDomain ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 font-medium text-slate-800">
                              <Globe aria-hidden="true" className="size-4 text-slate-400" />
                              {primaryDomain.hostname}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              HTTPS: {primaryDomain.sslStatus === 'active' ? 'ativo' : 'pendente'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge tone={domainTone(primaryDomain.status)}>
                              {DOMAIN_STATUS_LABELS[primaryDomain.status]}
                            </Badge>
                            {primaryDomain.status === 'active' ? (
                              <a
                                href={`https://${primaryDomain.hostname}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm link"
                              >
                                Abrir
                                <ExternalLink aria-hidden="true" className="size-3.5" />
                              </a>
                            ) : (
                              <Link to="/painel/dominio" className="text-sm link">
                                Concluir
                              </Link>
                            )}
                          </div>
                        </div>
                      ) : (
                        <Alert tone="info" title="Nenhum dominio conectado">
                          Conecte o dominio da construtora para o site responder no endereco proprio.{' '}
                          <Link to="/painel/dominio" className="link">
                            Configurar dominio
                          </Link>
                        </Alert>
                      )}
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader
                      title="Ultimos interessados"
                      actions={
                        <Link to="/painel/interessados">
                          <Button variant="outline" size="sm">
                            Ver todos
                          </Button>
                        </Link>
                      }
                    />
                    <CardBody>
                      {data.recentLeads.length === 0 ? (
                        <EmptyState
                          title="Nenhum contato recebido ainda"
                          description="Quando alguem preencher o formulario do site, o contato aparece aqui."
                        />
                      ) : (
                        <ul className="grid divide-y divide-slate-100">
                          {data.recentLeads.map((lead) => (
                            <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-slate-800">{lead.name}</p>
                                <p className="text-xs text-slate-500">
                                  {labels.leadInterest[lead.interestType]} - {formatDateTime(lead.createdAt)}
                                </p>
                              </div>
                              <Badge tone={leadTone(lead.status)}>{labels.leadStatus[lead.status]}</Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardBody>
                  </Card>
                </div>

                <Card>
                  <CardHeader
                    title="Plano e limites"
                    description={data.plan.planName}
                    actions={
                      <Link to="/painel/plano">
                        <Button variant="outline" size="sm">
                          Detalhes
                        </Button>
                      </Link>
                    }
                  />
                  <CardBody className="grid gap-4">
                    <Meter
                      label="Imoveis publicados"
                      current={data.usage.publishedProperties}
                      limit={data.plan.limits.maxPublishedProperties}
                    />
                    <Meter label="Obras" current={data.usage.projects} limit={data.plan.limits.maxProjects} />
                    <Meter label="Usuarios" current={data.usage.users} limit={data.plan.limits.maxUsers} />
                    <Meter
                      label="Armazenamento"
                      current={data.usage.storageBytes}
                      limit={data.plan.limits.storageBytes}
                      format={formatBytes}
                    />
                    {data.plan.overridden ? (
                      <p className="text-xs text-slate-500">
                        Esta empresa tem limites ajustados individualmente pela plataforma.
                      </p>
                    ) : null}
                  </CardBody>
                </Card>
              </div>
            </div>
          );
        }}
      </ResourcePanel>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  detail: string;
  to: string;
}) {
  return (
    <Card>
      <CardBody className="grid gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-slate-500">{label}</span>
          <span className="grid size-8 place-items-center rounded-lg bg-slate-100 text-slate-500">
            <Icon aria-hidden="true" className="size-4" />
          </span>
        </div>
        <p className="text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
        <p className="text-xs text-slate-500">{detail}</p>
        <Link to={to} className="mt-1 text-xs link">
          Gerenciar
        </Link>
      </CardBody>
    </Card>
  );
}
