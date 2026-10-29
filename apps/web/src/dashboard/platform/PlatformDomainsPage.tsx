import { AlertTriangle, Lock } from 'lucide-react';
import { DOMAIN_STATUS_LABELS, formatDateTime } from '@codeca/shared';
import { Alert, Badge, Card, CardHeader, DataTable, PageHeader, type Column } from '@codeca/ui';
import { useResource } from '../../hooks/useResource.js';
import { platformApi } from '../../services/endpoints.js';
import { ResourcePanel } from '../../components/ResourcePanel.js';
import { domainTone } from '../../utils/labels.js';
import type { DomainRecord } from '../../types/index.js';

type Row = DomainRecord & { tenantId: string; tenantName: string };

/** Dominios de todas as construtoras, para acompanhar pendencias. */
export function PlatformDomainsPage() {
  const list = useResource(() => platformApi.domains(), []);

  const columns: Array<Column<Row>> = [
    {
      key: 'hostname',
      header: 'Dominio',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{row.hostname}</p>
          <p className="truncate text-xs text-slate-500">{row.tenantName}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Situacao',
      render: (row) => (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={domainTone(row.status)}>{DOMAIN_STATUS_LABELS[row.status]}</Badge>
          {row.isPrimary ? <Badge tone="brand">principal</Badge> : null}
          {row.sslStatus === 'active' ? (
            <Badge tone="success">
              <Lock aria-hidden="true" className="size-3" /> HTTPS
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'checked',
      header: 'Ultima verificacao',
      hideOnMobile: true,
      render: (row) =>
        row.lastCheckedAt ? (
          <span className="text-xs text-slate-600">{formatDateTime(row.lastCheckedAt)}</span>
        ) : (
          <span className="text-xs text-slate-400">Nunca</span>
        ),
    },
    {
      key: 'error',
      header: 'Erro',
      render: (row) =>
        row.lastError ? (
          <span className="flex items-start gap-1 text-xs text-rose-700">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 flex-none" />
            {row.lastError}
          </span>
        ) : (
          <span className="text-xs text-slate-400">-</span>
        ),
    },
  ];

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Dominios"
        description="Todos os dominios cadastrados na plataforma e o estado da verificacao de cada um."
      />

      <ResourcePanel resource={list}>
        {(data) => (
          <div className="grid gap-4">
            {!data.providerConfigured ? (
              <Alert tone="warning" title="Integracao de dominios nao configurada">
                Defina <code>VERCEL_API_TOKEN</code> e <code>VERCEL_PROJECT_ID</code> no ambiente para que a
                plataforma registre e verifique dominios automaticamente.
              </Alert>
            ) : null}

            <Card>
              <CardHeader title={`${data.domains.length} dominio(s)`} />
              <DataTable columns={columns} rows={data.domains} rowKey={(row) => row.id} caption="Dominios" />
            </Card>
          </div>
        )}
      </ResourcePanel>
    </div>
  );
}
