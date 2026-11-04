import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Link2Off, RefreshCw } from 'lucide-react';
import {
  ANALYTICS_RANGES,
  ANALYTICS_RANGE_LABELS,
  ANALYTICS_RESULT_MESSAGES,
  formatDateTime,
  formatNumber,
  type AnalyticsRange,
  type AnalyticsReport,
  type AnalyticsResult,
  type AnalyticsStatus,
} from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  SegmentedControl,
  Select,
  useToast,
} from '@codeca/ui';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { analyticsApi } from '../services/endpoints.js';

/**
 * Estatisticas do site (Google Analytics 4).
 *
 * A pessoa conecta a PROPRIA conta Google; a plataforma so le (somente leitura)
 * e so da propriedade escolhida para este site. A autorizacao e o token vivem no
 * servidor: aqui so chegam o estado da conexao e os numeros.
 */
export function AnalyticsPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = useResource('analyticsApi.status', () => analyticsApi.status(tenantId), [tenantId]);

  // O retorno do Google chega com ?analytics=<resultado>: mostra e limpa a URL.
  const raw = params.get('analytics');
  const [result, setResult] = useState<AnalyticsResult | null>(() =>
    raw && raw in ANALYTICS_RESULT_MESSAGES ? (raw as AnalyticsResult) : null,
  );
  useEffect(() => {
    if (!raw) return;
    if (raw in ANALYTICS_RESULT_MESSAGES) {
      setResult(raw as AnalyticsResult);
      status.reload();
    }
    const next = new URLSearchParams(params);
    next.delete('analytics');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader title="Estatísticas do site" description="Visitas, páginas mais vistas e origem do tráfego, direto do seu Google Analytics." />

      {result ? (
        <Alert
          tone={result === 'connected' ? 'success' : result === 'cancelled' ? 'info' : 'danger'}
          title={result === 'connected' ? 'Conectado' : 'Conexão com o Google Analytics'}
          action={
            <button type="button" className="text-xs underline" onClick={() => setResult(null)}>
              Fechar
            </button>
          }
        >
          {ANALYTICS_RESULT_MESSAGES[result]}
        </Alert>
      ) : null}

      <ResourcePanel resource={status}>
        {(data) => <AnalyticsBody status={data} reload={status.reload} tenantId={tenantId} toast={toast} />}
      </ResourcePanel>
    </div>
  );
}

function AnalyticsBody({
  status,
  reload,
  tenantId,
  toast,
}: {
  status: AnalyticsStatus;
  reload: () => void;
  tenantId: string;
  toast: ReturnType<typeof useToast>;
}) {
  const { user } = useAuth();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [changing, setChanging] = useState(false);
  const connection = status.connection;

  const connect = useMutation(() => analyticsApi.start(tenantId), {
    // O navegador vai ao Google; o retorno cai no callback da API e volta para esta tela.
    onSuccess: (result) => window.location.assign(result.authorizationUrl),
    onError: (error) => toast.error('Não foi possível conectar', error.message),
  });

  const disconnect = useMutation(() => analyticsApi.disconnect(tenantId), {
    onSuccess: () => {
      toast.success('Google Analytics desconectado');
      setConfirmDisconnect(false);
      setChanging(false);
      reload();
    },
    onError: (error) => toast.error('Não foi possível desconectar', error.message),
  });

  if (!status.available) {
    return (
      <Alert tone="info" title="Integração não disponível">
        A conexão com o Google Analytics ainda não foi habilitada nesta instalação da plataforma. Fale com a
        CODECA IA para habilitá-la.
      </Alert>
    );
  }

  if (user && !user.emailVerified && status.canManage) {
    return (
      <Alert tone="warning" title="Confirme seu e-mail">
        Para conectar o Google Analytics, confirme primeiro o e-mail da sua conta.
      </Alert>
    );
  }

  if (!connection) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<BarChart3 aria-hidden="true" className="size-6" />}
            title="Conecte o Google Analytics"
            description="Você autoriza a leitura (somente leitura) da propriedade GA4 do seu site. Nada é alterado na sua conta Google, e você pode desconectar quando quiser."
            action={
              status.canManage ? (
                <Button loading={connect.loading} onClick={() => void connect.run(undefined)}>
                  Conectar Google Analytics
                </Button>
              ) : (
                <p className="text-sm text-slate-500">Peça a um administrador da empresa para conectar.</p>
              )
            }
          />
          {status.canManage && status.redirectUri ? <RedirectHint uri={status.redirectUri} /> : null}
        </CardBody>
      </Card>
    );
  }

  if (connection.status === 'needs_reconnect') {
    return (
      <Alert
        tone="warning"
        title="Reconexão necessária"
        action={
          status.canManage ? (
            <Button size="sm" loading={connect.loading} onClick={() => void connect.run(undefined)}>
              Reconectar
            </Button>
          ) : undefined
        }
      >
        O acesso ao Google Analytics foi revogado ou expirou. {connection.propertyName ? `A propriedade “${connection.propertyName}” será mantida ao reconectar com a mesma conta.` : ''}
      </Alert>
    );
  }

  if (connection.status === 'pending_property' || changing) {
    return (
      <div className="grid gap-4">
        <PropertyPicker
          tenantId={tenantId}
          currentId={connection.propertyId}
          onDone={() => {
            setChanging(false);
            reload();
          }}
          onCancel={changing ? () => setChanging(false) : undefined}
          onDisconnect={() => setConfirmDisconnect(true)}
        />
        <DisconnectDialog
          open={confirmDisconnect}
          loading={disconnect.loading}
          onConfirm={() => void disconnect.run(undefined)}
          onCancel={() => setConfirmDisconnect(false)}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium text-slate-900">{connection.propertyName}</p>
                <Badge tone="success">Conectado</Badge>
              </div>
              <p className="text-xs text-slate-500">
                {connection.accountName ? `${connection.accountName} · ` : ''}propriedade {connection.propertyId} ·
                conectado em {formatDateTime(connection.connectedAt)}
              </p>
            </div>
            {status.canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" icon={<RefreshCw aria-hidden="true" className="size-4" />} onClick={() => setChanging(true)}>
                  Trocar propriedade
                </Button>
                <Button variant="outline" size="sm" icon={<Link2Off aria-hidden="true" className="size-4" />} onClick={() => setConfirmDisconnect(true)}>
                  Desconectar
                </Button>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <ReportView tenantId={tenantId} />

      <DisconnectDialog
        open={confirmDisconnect}
        loading={disconnect.loading}
        onConfirm={() => void disconnect.run(undefined)}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}

function DisconnectDialog(props: { open: boolean; loading: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmDialog
      open={props.open}
      title="Desconectar o Google Analytics?"
      message="O acesso é revogado no Google e a plataforma deixa de ler as estatísticas deste site. Seus dados no Google Analytics não são afetados."
      confirmLabel="Desconectar"
      loading={props.loading}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    />
  );
}

function RedirectHint({ uri }: { uri: string }) {
  return (
    <details className="mt-4 text-xs text-slate-500">
      <summary className="cursor-pointer">Para o administrador da plataforma</summary>
      <p className="mt-2">
        Esta URL de retorno precisa estar cadastrada, exatamente assim, nas credenciais OAuth do Google Cloud:
      </p>
      <code className="mt-1 block break-all rounded bg-slate-100 px-2 py-1">{uri}</code>
    </details>
  );
}

function PropertyPicker({
  tenantId,
  currentId,
  onDone,
  onCancel,
  onDisconnect,
}: {
  tenantId: string;
  currentId: string | null;
  onDone: () => void;
  onCancel: (() => void) | undefined;
  onDisconnect: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState(currentId ?? '');
  const properties = useResource('analyticsApi.properties', () => analyticsApi.properties(tenantId), [tenantId], {
    fresh: true,
  });

  const save = useMutation((propertyId: string) => analyticsApi.selectProperty(tenantId, propertyId), {
    onSuccess: () => {
      toast.success('Propriedade vinculada', 'As estatísticas deste site vêm agora dessa propriedade.');
      onDone();
    },
    onError: (error) => toast.error('Não foi possível vincular', error.message),
  });

  return (
    <Card>
      <CardHeader
        title="Escolha a propriedade do site"
        description="Estas são as propriedades GA4 a que a conta Google conectada tem acesso."
      />
      <CardBody>
        <ResourcePanel resource={properties}>
          {(data) =>
            data.items.length === 0 ? (
              <Alert tone="warning" title="Nenhuma propriedade GA4 encontrada">
                A conta Google conectada não tem propriedades do Google Analytics 4. Crie uma no Google Analytics ou
                reconecte com outra conta.
              </Alert>
            ) : (
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (selected) void save.run(selected);
                }}
              >
                <Select
                  label="Propriedade"
                  placeholder="Selecione"
                  value={selected}
                  options={data.items.map((item) => ({
                    value: item.propertyId,
                    label: `${item.propertyName}${item.accountName ? ` — ${item.accountName}` : ''}`,
                  }))}
                  onChange={(event) => setSelected(event.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" loading={save.loading} disabled={!selected}>
                    Vincular ao site
                  </Button>
                  {onCancel ? (
                    <Button type="button" variant="outline" onClick={onCancel}>
                      Cancelar
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" onClick={onDisconnect}>
                    Desconectar
                  </Button>
                </div>
              </form>
            )
          }
        </ResourcePanel>
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------ relatorio

function ReportView({ tenantId }: { tenantId: string }) {
  const [range, setRange] = useState<AnalyticsRange>('28d');
  const report = useResource('analyticsApi.report', (signal) => analyticsApi.report(tenantId, range, signal), [tenantId, range]);

  return (
    <div className="grid gap-6">
      <SegmentedControl
        label="Período"
        options={ANALYTICS_RANGES.map((value) => ({ value, label: ANALYTICS_RANGE_LABELS[value] }))}
        value={range}
        onChange={setRange}
      />
      <ResourcePanel resource={report}>{(data) => <ReportCharts report={data} />}</ResourcePanel>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}min ${rest}s` : `${rest}s`;
}

function ReportCharts({ report }: { report: AnalyticsReport }) {
  const { totals } = report;
  const stats: Array<[string, string]> = [
    ['Usuários', formatNumber(totals.activeUsers)],
    ['Sessões', formatNumber(totals.sessions)],
    ['Visualizações de página', formatNumber(totals.pageViews)],
    ['Engajamento', `${Math.round(totals.engagementRate * 100)}%`],
    ['Duração média da sessão', formatDuration(totals.avgSessionSeconds)],
  ];

  return (
    <div className="grid gap-6">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {stats.map(([label, value]) => (
          <Card key={label}>
            <CardBody>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-1 text-xl font-semibold text-slate-900">{value}</dd>
            </CardBody>
          </Card>
        ))}
      </dl>

      <Card>
        <CardHeader title="Sessões por dia" />
        <CardBody>
          <DailyChart daily={report.daily} />
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <RankCard title="Páginas mais vistas" rows={report.topPages.map((p) => ({ label: p.path, value: p.views }))} />
        <RankCard title="Origem do tráfego" rows={report.channels.map((c) => ({ label: c.channel, value: c.sessions }))} />
        <RankCard title="Dispositivos" rows={report.devices.map((d) => ({ label: d.device, value: d.sessions }))} />
      </div>
      <p className="text-xs text-slate-500">Atualizado em {formatDateTime(report.generatedAt)}. Dados do Google Analytics, podem levar algumas horas para refletir.</p>
    </div>
  );
}

/** Barras em SVG: sem biblioteca de graficos no pacote do painel. */
function DailyChart({ daily }: { daily: AnalyticsReport['daily'] }) {
  const max = useMemo(() => Math.max(1, ...daily.map((d) => d.sessions)), [daily]);
  if (daily.length === 0) return <p className="text-sm text-slate-500">Sem dados no período.</p>;
  const width = 600;
  const height = 140;
  const gap = 2;
  const barWidth = Math.max(2, width / daily.length - gap);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Sessões por dia, de ${daily[0]!.date} a ${daily[daily.length - 1]!.date}`}
      className="h-40 w-full"
      preserveAspectRatio="none"
    >
      {daily.map((day, index) => {
        const h = Math.max(1, (day.sessions / max) * (height - 4));
        return (
          <rect
            key={day.date}
            x={index * (barWidth + gap)}
            y={height - h}
            width={barWidth}
            height={h}
            rx={1.5}
            className="fill-brand-500"
          >
            <title>{`${day.date}: ${day.sessions} sessões`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function RankCard({ title, rows }: { title: string; rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">Sem dados no período.</p>
        ) : (
          <ul className="grid gap-3">
            {rows.map((row) => (
              <li key={row.label} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-slate-700" title={row.label}>
                    {row.label}
                  </span>
                  <span className="flex-none font-medium text-slate-900">{formatNumber(row.value)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(row.value / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
