import { Link } from 'react-router-dom';
import {
  Building2,
  ExternalLink,
  GalleryHorizontalEnd,
  Globe,
  HardHat,
  Image,
  type LucideIcon,
  Plug,
  Users,
  Wrench,
} from 'lucide-react';
import {
  DOMAIN_STATUS_LABELS,
  formatBytes,
  formatDateTime,
  relativeTime,
  type ModuleKey,
} from '@codeca/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Meter, PageHeader } from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useResource } from '../hooks/useResource.js';
import { useSiteModules } from '../hooks/useSiteModules.js';
import { tenantApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import type { OverviewResponse } from '../types/index.js';
import { labels, domainTone, leadTone, siteTone } from '../utils/labels.js';

/**
 * Visao geral do painel do cliente.
 *
 * Todos os numeros vem de contagens reais no banco. Nenhum indicador e
 * estimado: quando nao existe dado, a tela diz que nao existe.
 *
 * Os indicadores seguem os modulos **daquele site**, como o resto do painel.
 * Um site de restaurante nao tem por que abrir em "0 imoveis publicados": o
 * zero sugere que faltou cadastrar, quando na verdade o modulo nao existe
 * naquele projeto.
 */

type Indicador = {
  icon: LucideIcon;
  label: string;
  to: string;
  /** Modulo que precisa estar habilitado neste site; sem isso, vale sempre. */
  module?: ModuleKey;
  capability?: Parameters<ReturnType<typeof useAuth>['can']>[0];
  value: (data: OverviewResponse) => number;
  detail: (data: OverviewResponse) => string;
};

const INDICADORES: Indicador[] = [
  {
    icon: Building2,
    label: 'Imoveis publicados',
    to: '/painel/imoveis',
    module: 'imoveis',
    capability: 'content:read',
    value: (d) => d.properties.published,
    detail: (d) => `${d.properties.available} disponiveis - ${d.properties.drafts} em rascunho`,
  },
  {
    icon: HardHat,
    label: 'Obras cadastradas',
    to: '/painel/obras',
    module: 'obras',
    capability: 'content:read',
    value: (d) => d.projects.total,
    detail: (d) => `${d.projects.inProgress} em andamento - ${d.projects.completed} concluidas`,
  },
  {
    icon: Wrench,
    label: 'Servicos publicados',
    to: '/painel/servicos',
    module: 'servicos',
    capability: 'content:read',
    value: (d) => d.services.published,
    detail: (d) => `${d.services.total} cadastrado(s) no total`,
  },
  {
    icon: GalleryHorizontalEnd,
    label: 'Banners ativos',
    to: '/painel/banners',
    module: 'banners',
    capability: 'content:read',
    value: (d) => d.banners.active,
    detail: (d) => `${d.banners.total} cadastrado(s) no total`,
  },
  {
    icon: Users,
    label: 'Interessados',
    to: '/painel/interessados',
    capability: 'leads:read',
    value: (d) => d.leads.total,
    detail: (d) => `${d.leads.novos} novos - ${d.leads.last30Days} nos ultimos 30 dias`,
  },
  {
    icon: Image,
    label: 'Arquivos na biblioteca',
    to: '/painel/midia',
    capability: 'media:read',
    value: (d) => d.media.total,
    detail: (d) => formatBytes(d.media.bytes),
  },
];

export function OverviewPage() {
  const tenantId = useTenantId();
  const { user, tenant, can } = useAuth();
  const { enabled, panelIncluded, planName } = useSiteModules();
  const overview = useResource(() => tenantApi.overview(tenantId), [tenantId], {
    // Sem painel no plano a rota responde 402: nem pede.
    enabled: panelIncluded,
  });

  const saudacao = `Ola, ${user?.name.split(' ')[0] ?? 'tudo bem'}`;

  if (!panelIncluded) {
    return (
      <div className="panel-shell grid gap-6">
        <PageHeader title={saudacao} description={`Sua conta na CODECA Build.`} />
        <Card>
          <CardBody className="grid gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              O conteudo do seu site e mantido pela CODECA IA
            </h2>
            <p className="text-sm text-slate-600">
              {planName
                ? `O plano ${planName} inclui o site personalizado e o dominio proprio. Para`
                : 'Seu plano inclui o site personalizado e o dominio proprio. Para'}{' '}
              alterar textos, imagens e produtos por conta propria, sem depender de pedido,
              contrate o plano Profissional.
            </p>
            <p className="text-sm text-slate-600">
              Precisa de uma alteracao agora? Fale com a equipe que desenvolveu o seu site.
            </p>
            {can('billing:read') ? (
              <div>
                <Link to="/painel/plano">
                  <Button>Ver planos e assinatura</Button>
                </Link>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title={saudacao}
        description={`Resumo do conteudo do site de ${tenant?.tenantName ?? 'sua empresa'}.`}
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
          Os convites de equipe e a conexao de dominio ficam liberados apos a confirmacao do
          e-mail.
        </Alert>
      ) : null}

      <ResourcePanel resource={overview}>
        {(data) => {
          const primaryDomain = data.domains.find((domain) => domain.isPrimary) ?? data.domains[0];
          const visiveis = INDICADORES.filter((item) => {
            if (item.capability && !can(item.capability)) return false;
            // Enquanto a configuracao do site nao chega o cartao fica fora:
            // melhor a tela crescer do que mostrar um numero que nao e deste
            // projeto.
            return item.module ? enabled(item.module) : true;
          });

          return (
            <div className="grid gap-6">
              {visiveis.length > 0 ? (
                <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores">
                  {visiveis.map((item) => (
                    <StatCard
                      key={item.to}
                      icon={item.icon}
                      label={item.label}
                      value={item.value(data)}
                      detail={item.detail(data)}
                      to={item.to}
                    />
                  ))}
                </section>
              ) : null}

              <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
                <div className="grid gap-6">
                  <Card>
                    <CardHeader title="Situacao do site" description={data.site.name} />
                    <CardBody className="grid gap-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={siteTone(data.site.status)}>
                          {labels.siteStatus[data.site.status]}
                        </Badge>
                        {primaryDomain?.status === 'active' ? (
                          <Badge tone="success">Dominio respondendo</Badge>
                        ) : null}
                      </div>

                      {/*
                        A plataforma nao publica o site -- quem publica e o
                        projeto da CODECA IA. O que ela sabe dizer e se o site
                        veio buscar conteudo, e e isso que aparece aqui.
                      */}
                      <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3">
                        <Plug aria-hidden="true" className="mt-0.5 size-4 flex-none text-slate-400" />
                        <div className="min-w-0 text-sm">
                          {data.site.lastApiAccessAt ? (
                            <>
                              <p className="font-medium text-slate-800">Integracao funcionando</p>
                              <p className="mt-0.5 text-slate-500">
                                O site buscou conteudo {relativeTime(data.site.lastApiAccessAt)}. O
                                que voce salva aqui aparece no site sem publicar nada.
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="font-medium text-slate-800">
                                O site ainda nao buscou conteudo
                              </p>
                              <p className="mt-0.5 text-slate-500">
                                A CODECA IA conclui a conexao do projeto. Voce pode cadastrar o
                                conteudo desde ja: ele fica salvo e aparece quando a ligacao
                                estiver pronta.
                              </p>
                            </>
                          )}
                        </div>
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
                            ) : can('domains:read') ? (
                              <Link to="/painel/dominio" className="text-sm link">
                                Concluir
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      ) : can('domains:read') ? (
                        <Alert tone="info" title="Nenhum dominio conectado">
                          Conecte o dominio da empresa para o site responder no endereco proprio.{' '}
                          <Link to="/painel/dominio" className="link">
                            Configurar dominio
                          </Link>
                        </Alert>
                      ) : null}
                    </CardBody>
                  </Card>

                  {can('leads:read') ? (
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
                  ) : null}
                </div>

                <Card>
                  <CardHeader
                    title="Plano e limites"
                    description={data.plan.planName}
                    actions={
                      can('billing:read') ? (
                        <Link to="/painel/plano">
                          <Button variant="outline" size="sm">
                            Detalhes
                          </Button>
                        </Link>
                      ) : null
                    }
                  />
                  <CardBody className="grid gap-4">
                    {/*
                      Mesma regra dos indicadores: o limite de imoveis so e
                      informacao para quem tem o modulo. Usuarios e
                      armazenamento valem para todo site.
                    */}
                    {enabled('imoveis') ? (
                      <Meter
                        label="Imoveis publicados"
                        current={data.usage.publishedProperties}
                        limit={data.plan.limits.maxPublishedProperties}
                      />
                    ) : null}
                    {enabled('obras') ? (
                      <Meter label="Obras" current={data.usage.projects} limit={data.plan.limits.maxProjects} />
                    ) : null}
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
