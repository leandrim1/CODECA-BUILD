import { useState } from 'react';
import { formatDateTime } from '@codeca/shared';
import { Card, CardHeader, DataTable, PageHeader, Pagination, TextInput, type Column } from '@codeca/ui';
import { useDebounced, useResource } from '../../hooks/useResource.js';
import { platformApi } from '../../services/endpoints.js';
import { ResourcePanel } from '../../components/ResourcePanel.js';
import type { AuditLogRow } from '../../types/index.js';

/**
 * Trilha de auditoria.
 *
 * Os metadados nao guardam senhas, tokens nem o conteudo de mensagens: apenas
 * o que e necessario para reconstruir quem fez o que e quando.
 */
export function PlatformAuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const debounced = useDebounced(action);

  const list = useResource(
    () => platformApi.audit({ page, pageSize: 30, ...(debounced ? { action: debounced } : {}) }),
    [page, debounced],
  );

  const columns: Array<Column<AuditLogRow>> = [
    {
      key: 'when',
      header: 'Quando',
      render: (row) => <span className="whitespace-nowrap text-xs text-slate-600">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'action',
      header: 'Acao',
      render: (row) => <span className="font-mono text-xs">{row.action}</span>,
    },
    {
      key: 'actor',
      header: 'Quem',
      render: (row) => <span className="text-xs">{row.actorEmail || 'sistema'}</span>,
    },
    {
      key: 'entity',
      header: 'Registro',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-xs text-slate-500">
          {row.entityType}
          {row.entityId ? ` ${row.entityId.slice(0, 8)}` : ''}
        </span>
      ),
    },
    {
      key: 'metadata',
      header: 'Detalhes',
      hideOnMobile: true,
      render: (row) =>
        Object.keys(row.metadata).length === 0 ? (
          <span className="text-xs text-slate-400">-</span>
        ) : (
          <code className="block max-w-xs truncate text-xs text-slate-500">{JSON.stringify(row.metadata)}</code>
        ),
    },
  ];

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Auditoria"
        description="Operacoes relevantes registradas pela plataforma, de todas as construtoras."
      />

      <Card>
        <CardHeader
          title="Registros"
          actions={
            <div className="w-56">
              <TextInput
                label="Filtrar por acao"
                className="[&>label]:sr-only"
                placeholder="property.created, domain.verified..."
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          }
        />
        <ResourcePanel resource={list}>
          {(data) => (
            <>
              <DataTable columns={columns} rows={data.items} rowKey={(row) => row.id} caption="Auditoria" />
              <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
            </>
          )}
        </ResourcePanel>
      </Card>
    </div>
  );
}
