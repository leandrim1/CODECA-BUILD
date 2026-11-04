import { formatDateTime } from '@codeca/shared';
import { Alert, Badge, Button, Card, CardHeader, DataTable, PageHeader, useToast, type Column } from '@codeca/ui';
import { useMutation, useResource } from '../../hooks/useResource.js';
import { platformApi } from '../../services/endpoints.js';
import { ResourcePanel } from '../../components/ResourcePanel.js';
import type { SupportGrantRow } from '../../types/index.js';

/**
 * Historico de acessos de suporte.
 *
 * Cada concessao registra quem pediu, para qual empresa, por que motivo e por
 * quanto tempo. O acesso e sempre somente leitura.
 */
export function PlatformSupportPage() {
  const toast = useToast();
  const list = useResource('platformApi.supportGrants', () => platformApi.supportGrants(), []);

  const revoke = useMutation((grantId: string) => platformApi.revokeSupportAccess(grantId), {
    onSuccess: () => {
      toast.success('Acesso revogado');
      list.reload();
    },
    onError: (error) => toast.error('Não foi possível revogar', error.message),
  });

  const columns: Array<Column<SupportGrantRow>> = [
    {
      key: 'tenant',
      header: 'Empresa',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{row.tenantName}</p>
          <p className="truncate text-xs text-slate-500">{row.adminEmail}</p>
        </div>
      ),
    },
    { key: 'reason', header: 'Motivo', render: (row) => <span className="text-sm">{row.reason}</span> },
    {
      key: 'window',
      header: 'Validade',
      hideOnMobile: true,
      render: (row) => <span className="text-xs text-slate-600">{formatDateTime(row.expiresAt)}</span>,
    },
    {
      key: 'status',
      header: 'Situação',
      render: (row) => {
        const expired = new Date(row.expiresAt).getTime() < Date.now();
        if (row.revokedAt) return <Badge tone="neutral">Revogado</Badge>;
        if (expired) return <Badge tone="neutral">Expirado</Badge>;
        return <Badge tone="warning">Ativo</Badge>;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        !row.revokedAt && new Date(row.expiresAt).getTime() > Date.now() ? (
          <Button variant="outline" size="sm" loading={revoke.loading} onClick={() => void revoke.run(row.id)}>
            Revogar
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Acesso de suporte"
        description="Autorizações para consultar dados de uma empresa. Conceda apenas quando houver chamado aberto."
      />

      <Alert tone="info" title="Como funciona">
        O papel de administrador da plataforma não da acesso ao conteúdo das empresas. Para abrir o painel de
        uma empresa é necessária uma concessão explícita, somente leitura, com prazo definido e registro
        em auditoria. A concessão e feita na ficha da empresa, em Empresas.
      </Alert>

      <Card>
        <CardHeader title="Concessões" />
        <ResourcePanel resource={list}>
          {(data) => (
            <DataTable
              columns={columns}
              rows={data.grants}
              rowKey={(row) => row.id}
              caption="Concessões de acesso de suporte"
            />
          )}
        </ResourcePanel>
      </Card>
    </div>
  );
}
