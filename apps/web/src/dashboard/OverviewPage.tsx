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
  Boxes,
  MessageCircleQuestion,
  ShoppingBag,
  Sparkles,
  Tags,
  Images,
} from 'lucide-react';
import {
  DOMAIN_STATUS_LABELS,
  formatBytes,
  formatDateTime,
  relativeTime,
  MODULE_REGISTRY,
  type ModuleKey,
} from '@codeca/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Meter, PageHeader, Skeleton, cx } from '@codeca/ui';
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

/**
 * Modulos de colecao sem um indicador proprio acima.
 *
 * Imoveis, obras, servicos e banners tem cartoes com detalhes do que e
 * especifico deles (disponiveis, em andamento). Os demais -- e os modulos
 * personalizados do projeto -- aparecem com a contagem de cadastrados, que e
 * exatamente o que o limite do plano mede. Assim a visao geral de uma loja abre
 * com produtos, a de uma clinica com a equipe, e nenhuma delas com um zero em
 * "imoveis".
 */
const MODULOS_SEM_INDICADOR_PROPRIO: ReadonlyArray<{
  key: ModuleKey;
  icon: LucideIcon;
  to: string;
}> = [
  { key: 'produtos', icon: ShoppingBag, to: '/painel/produtos' },
  { key: 'categorias', icon: Tags, to: '/painel/categorias' },
  { key: 'galerias', icon: Images, to: '/painel/galerias' },
  { key: 'depoimentos', icon: Sparkles, to: '/painel/depoimentos' },
  { key: 'equipe', icon: Users, to: '/painel/equipe' },
  { key: 'faq', icon: MessageCircleQuestion, to: '/painel/perguntas' },
];

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
    label: 'Imóveis publicados',
    to: '/painel/imoveis',
    module: 'imoveis',
    capability: 'content:read',
    value: (d) => d.properties.published,
    detail: (d) => `${d.properties.available} disponíveis - ${d.properties.drafts} em rascunho`,
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
    label: 'Serviços publicados',
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
    detail: (d) => `${d.leads.novos} novos - ${d.leads.last30Days} nos últimos 30 dias`,
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
  const { enabled, panelIncluded, planName, loading: modulesLoading, customModules } = useSiteModules();
  const overview = useResource('tenantApi.overview', () => tenantApi.overview(tenantId), [tenantId], {
    // Sem painel no plano a rota responde 402: nem pede.
    enabled: panelIncluded,
    // Contagens e contatos mudam por fora (o site do cliente envia contatos):
    // o numero guardado aparece na hora, mas e conferido a cada visita.
    staleTime: 0,
  });

  const saudacao = `Olá, ${user?.name.split(' ')[0] ?? 'tudo bem'}`;

  if (!panelIncluded) {
    return (
      <div className="panel-shell grid gap-6">
        <PageHeader title={saudacao} description={`Sua conta na CODECA Build.`} />
        <Card>
          <CardBody className="grid gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              O conteúdo do seu site é mantido pela CODECA IA
            </h2>
            <p className="text-sm text-slate-600">
              {planName
                ? `O plano ${planName} inclui o site personalizado e o domínio próprio. Para`
                : 'Seu plano inclui o site personalizado e o domínio próprio. Para'}{' '}
              alterar textos, imagens e produtos por conta própria, sem depender de pedido,
              contrate o plano Profissional.
            </p>
            <p className="text-sm text-slate-600">
              Precisa de uma alteração agora? Fale com a equipe que desenvolveu o seu site.
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
        description={`Resumo do conteúdo do site de ${tenant?.tenantName ?? 'sua empresa'}.`}
      />

      {user && !user.emailVerified ? (
        <Alert
          tone="warning"
          title="Confirme seu e-mail"
          action={
            <Link to="/confirmar-email">
              <Button variant="outline" size="sm">
                Reenviar confirmação
              </Button>
            </Link>
          }
        >
          Os convites de equipe e a conexão de domínio ficam liberados após a confirmação do
          e-mail.
        </Alert>
      ) : null}

      {/*
        Aviso da sincronizacao.
        
        Fica aqui, e nao so na tela de Sincronizacao, porque o cliente nao tem
        motivo para abrir aquela tela todo dia -- e a plataforma verifica o
        site de origem sozinha. Sem este aviso, uma alteracao encontrada
        poderia ficar semanas esperando sem ninguem saber. O servidor devolve
        `null` quando nao ha nada pendente, entao nao ha aviso com zero.
      */}
      {overview.data?.syncNotice ? (
        <Alert
          tone={overview.data.syncNotice.conflicts > 0 ? 'warning' : 'info'}
          title="Atualizações no seu site de origem"
          action={
            <Link to="/painel/sincronizacao">
              <Button variant="outline" size="sm">
                Revisar
              </Button>
            </Link>
          }
        >
          {overview.data.syncNotice.message}
        </Alert>
      ) : null}

      {/*
        Os cartoes de indicador dependem dos modulos do site. Se aparecessem
        quando a configuracao chega -- depois do resumo -- empurrariam tudo o
        que esta abaixo. Entao a tela espera os dois e, enquanto isso, reserva
        o espaco com um esqueleto do mesmo desenho.
      */}
      <ResourcePanel
        resource={modulesLoading ? { ...overview, initialLoading: true } : overview}
        skeleton={<ResumoEmEspera />}
      >
        {(data) => {
          const primaryDomain = data.domains.find((domain) => domain.isPrimary) ?? data.domains[0];
          const visiveis = INDICADORES.filter((item) => {
            if (item.capability && !can(item.capability)) return false;
            // Enquanto a configuracao do site nao chega o cartao fica fora:
            // melhor a tela crescer do que mostrar um numero que nao e deste
            // projeto.
            return item.module ? enabled(item.module) : true;
          });

          // Cartoes dos demais modulos habilitados, com a contagem que o limite
          // do plano usa. So quem pode ler conteudo ve.
          const doPlano = data.usage.contentByModule;
          const extras = can('content:read')
            ? [
                ...MODULOS_SEM_INDICADOR_PROPRIO.filter((m) => enabled(m.key)).map((m) => ({
                  icon: m.icon,
                  label: MODULE_REGISTRY[m.key].name,
                  to: m.to,
                  value: doPlano[m.key] ?? 0,
                })),
                ...customModules
                  .filter((m) => m.kind === 'collection')
                  .map((m) => ({
                    icon: Boxes,
                    label: m.name,
                    to: `/painel/p/${m.key}`,
                    value: doPlano[`custom:${m.key}`] ?? 0,
                  })),
              ]
            : [];

          return (
            <div className="grid gap-6">
              {visiveis.length > 0 || extras.length > 0 ? (
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
                  {extras.map((item) => (
                    <StatCard
                      key={item.to}
                      icon={item.icon}
                      label={item.label}
                      value={item.value}
                      detail="cadastrado(s) no total"
                      to={item.to}
                    />
                  ))}
                </section>
              ) : null}

              {/*
                `items-start` impede o cartao da direita de esticar.

                Numa grade, a celula ocupa a altura da linha por padrao, entao
                "Plano e limites" -- que e curto -- era alongado ate a altura da
                coluna da esquerda e terminava com um palmo de branco dentro da
                borda. Alinhar ao topo faz cada cartao ter a altura do proprio
                conteudo.
              */}
              <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
                <div className="grid gap-6">
                  <Card>
                    <CardHeader title="Situação do site" description={data.site.name} />
                    <CardBody className="grid gap-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={siteTone(data.site.status)}>
                          {labels.siteStatus[data.site.status]}
                        </Badge>
                        {primaryDomain?.status === 'active' ? (
                          <Badge tone="success">Domínio respondendo</Badge>
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
                              <p className="font-medium text-slate-800">Integração funcionando</p>
                              <p className="mt-0.5 text-slate-500">
                                O site buscou conteúdo {relativeTime(data.site.lastApiAccessAt)}. O
                                que você salva aqui aparece no site sem publicar nada.
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="font-medium text-slate-800">
                                O site ainda não buscou conteúdo
                              </p>
                              <p className="mt-0.5 text-slate-500">
                                A CODECA IA conclui a conexão do projeto. Você pode cadastrar o
                                conteúdo desde já: ele fica salvo e aparece quando a ligação
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
                            {/*
                              "HTTPS: pendente" num dominio so registrado diria
                              que a plataforma vai emitir um certificado. Nao
                              vai: o site e hospedado fora dela.
                            */}
                            <p className="mt-0.5 text-xs text-slate-500">
                              {primaryDomain.status === 'registered'
                                ? 'Hospedado fora da plataforma'
                                : `HTTPS: ${primaryDomain.sslStatus === 'active' ? 'ativo' : 'pendente'}`}
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
                                {/* Registrado nao tem o que concluir: so ha o que ver. */}
                                {primaryDomain.status === 'registered' ? 'Ver' : 'Concluir'}
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      ) : can('domains:read') ? (
                        <Alert tone="info" title="Nenhum domínio conectado">
                          Conecte o domínio da empresa para o site responder no endereço próprio.{' '}
                          <Link to="/painel/dominio" className="link">
                            Configurar domínio
                          </Link>
                        </Alert>
                      ) : null}
                    </CardBody>
                  </Card>

                  {can('leads:read') ? (
                    <Card>
                      <CardHeader
                        title="Últimos interessados"
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
                            description="Quando alguém preencher o formulário do site, o contato aparece aqui."
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
                      O limite de conteudos e geral -- vale para todos os
                      modulos do site, qualquer que seja o segmento --, entao
                      aparece sempre, e nao so para quem tem imoveis ou obras.
                    */}
                    <Meter
                      label="Conteúdos cadastrados"
                      current={data.usage.contentRecords}
                      limit={data.plan.limits.maxContentRecords}
                    />
                    <Meter label="Usuários" current={data.usage.users} limit={data.plan.limits.maxUsers} />
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

/** Esqueleto com o desenho do resumo: indicadores no alto, dois cartoes abaixo. */
function ResumoEmEspera() {
  return (
    <div className="grid gap-6" role="status" aria-label="Carregando o resumo">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((indice) => (
          <Skeleton key={indice} className="h-[8.5rem] rounded-2xl" />
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
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
    /*
      O cartao inteiro e o alvo do clique, nao so o link embaixo.
      
      O numero e o que a pessoa olha; obrigar a mirar num "Gerenciar" de 11px
      depois de ja ter lido o numero e trabalho a toa. O link continua ali,
      visivel e com foco proprio, para quem navega por teclado.
    */
    <Card className="group relative transition-shadow duration-200 ease-[var(--ease-out-soft)] hover:shadow-raised">
      <CardBody className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-slate-500">{label}</span>
          <span
            className={cx(
              'grid size-9 place-items-center rounded-xl bg-slate-100 text-slate-500',
              // No hover o icone assume o azul da marca: a cor confirma que o
              // cartao e clicavel, usando a paleta que ja existe.
              'transition-colors duration-200 group-hover:bg-brand-50 group-hover:text-brand-600',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
          </span>
        </div>
        <p className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</p>
        <p className="text-xs leading-relaxed text-slate-500">{detail}</p>
        <Link
          to={to}
          className="mt-1 text-xs link after:absolute after:inset-0 after:content-['']"
        >
          Gerenciar
        </Link>
      </CardBody>
    </Card>
  );
}
