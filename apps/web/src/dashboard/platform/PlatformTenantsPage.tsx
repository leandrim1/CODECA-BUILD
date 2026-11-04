import { ContentUsageBreakdown } from '../../components/ContentUsage.js';
import { useState } from 'react';
import { LifeBuoy, Plus } from 'lucide-react';
import { TENANT_STATUSES, formatBytes, formatDateTime } from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Meter,
  Modal,
  PageHeader,
  Pagination,
  Select,
  TextArea,
  TextInput,
  useToast,
  type Column,
} from '@codeca/ui';
import { useDebounced, useMutation, useResource } from '../../hooks/useResource.js';
import { platformApi } from '../../services/endpoints.js';
import { ResourcePanel } from '../../components/ResourcePanel.js';
import { labels, tenantTone, toOptions } from '../../utils/labels.js';
import { useForm } from '../../utils/forms.js';
import type { PlatformTenantRow } from '../../types/index.js';

/** Cadastro, ativacao e suspensao das empresas. */
export function PlatformTenantsPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const debounced = useDebounced(search);

  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState<PlatformTenantRow | null>(null);

  const plans = useResource('platformApi.plans', () => platformApi.plans(), []);
  const list = useResource(
    'platformApi.tenants',
    () =>
      platformApi.tenants({
        page,
        pageSize: 20,
        ...(debounced ? { search: debounced } : {}),
        ...(status ? { status } : {}),
      }),
    [page, debounced, status],
  );

  const createForm = useForm({ legalName: '', displayName: '', planCode: '', ownerEmail: '', ownerName: '' });

  const create = useMutation(() => platformApi.createTenant(createForm.values), {
    onSuccess: () => {
      toast.success('Empresa criada', 'O proprietário recebeu um convite por e-mail.');
      setCreating(false);
      createForm.reset();
      list.reload();
    },
    onError: (error) => {
      createForm.applyApiError(error);
      if (Object.keys(error.fieldErrors).length === 0) toast.error('Não foi possível criar', error.message);
    },
  });

  const columns: Array<Column<PlatformTenantRow>> = [
    {
      key: 'name',
      header: 'Empresa',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{row.displayName}</p>
          <p className="truncate text-xs text-slate-500">{row.slug}</p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plano',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {row.planName}
          {row.hasOverrides ? <Badge tone="info">ajustado</Badge> : null}
        </span>
      ),
    },
    { key: 'status', header: 'Situação', render: (row) => <Badge tone={tenantTone(row.status)}>{labels.tenantStatus[row.status]}</Badge> },
    {
      key: 'created',
      header: 'Criada em',
      hideOnMobile: true,
      render: (row) => <span className="text-xs text-slate-600">{formatDateTime(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <Button variant="outline" size="sm" onClick={() => setOpened(row)}>
          Gerenciar
        </Button>
      ),
    },
  ];

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Empresas"
        description="Cadastro, plano, limites e situação da conta de cada empresa."
        actions={
          <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setCreating(true)}>
            Nova empresa
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="Empresas"
          actions={
            <div className="flex flex-wrap gap-2">
              <div className="w-full sm:w-48">
                <TextInput
                  label="Buscar"
                  className="[&>label]:sr-only"
                  placeholder="Nome da empresa"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="w-full sm:w-40">
                <Select
                  label="Situação"
                  className="[&>label]:sr-only"
                  placeholder="Todas"
                  value={status}
                  options={toOptions(labels.tenantStatus, TENANT_STATUSES)}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
          }
        />
        <ResourcePanel resource={list}>
          {(data) => (
            <>
              <DataTable columns={columns} rows={data.items} rowKey={(row) => row.id} caption="Empresas" />
              <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
            </>
          )}
        </ResourcePanel>
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nova empresa"
        description="O proprietário recebe um convite para definir a senha."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button loading={create.loading} onClick={() => void create.run(undefined)}>
              Criar empresa
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <TextInput
            label="Nome de exibição"
            required
            value={createForm.values.displayName}
            error={createForm.errors.displayName}
            onChange={(event) => createForm.setField('displayName', event.target.value)}
          />
          <TextInput
            label="Razão social"
            required
            value={createForm.values.legalName}
            error={createForm.errors.legalName}
            onChange={(event) => createForm.setField('legalName', event.target.value)}
          />
          <Select
            label="Plano"
            required
            value={createForm.values.planCode}
            placeholder="Selecione"
            error={createForm.errors.planCode}
            options={(plans.data?.plans ?? []).map((plan) => ({ value: plan.code, label: plan.name }))}
            onChange={(event) => createForm.setField('planCode', event.target.value)}
          />
          <TextInput
            label="Nome do proprietário"
            required
            value={createForm.values.ownerName}
            error={createForm.errors.ownerName}
            onChange={(event) => createForm.setField('ownerName', event.target.value)}
          />
          <TextInput
            label="E-mail do proprietário"
            type="email"
            required
            value={createForm.values.ownerEmail}
            error={createForm.errors.ownerEmail}
            onChange={(event) => createForm.setField('ownerEmail', event.target.value)}
          />
        </div>
      </Modal>

      {opened ? (
        <TenantDetailModal
          tenantRow={opened}
          onClose={() => setOpened(null)}
          onChanged={() => {
            list.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function TenantDetailModal({
  tenantRow,
  onClose,
  onChanged,
}: {
  tenantRow: PlatformTenantRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const detail = useResource('platformApi.tenantDetail', () => platformApi.tenantDetail(tenantRow.id), [tenantRow.id], { fresh: true });
  const plans = useResource('platformApi.plans', () => platformApi.plans(), []);
  const [status, setStatus] = useState(tenantRow.status as string);
  const [planCode, setPlanCode] = useState(tenantRow.planCode);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  const update = useMutation(
    () => platformApi.updateTenant(tenantRow.id, { status, planCode, notes }),
    {
      onSuccess: () => {
        toast.success('Empresa atualizada');
        detail.reload();
        onChanged();
      },
      onError: (error) => toast.error('Não foi possível atualizar', error.message),
    },
  );

  const grant = useMutation(
    () =>
      platformApi.grantSupportAccess({
        tenantId: tenantRow.id,
        reason,
        expiresInMinutes: 60,
        readOnly: true,
      }),
    {
      onSuccess: () => {
        toast.success('Acesso de suporte concedido', 'Somente leitura, válido por 1 hora e registrado em auditoria.');
        setReason('');
        detail.reload();
      },
      onError: (error) => toast.error('Não foi possível conceder', error.message),
    },
  );

  const revoke = useMutation((grantId: string) => platformApi.revokeSupportAccess(grantId), {
    onSuccess: () => {
      toast.success('Acesso revogado');
      detail.reload();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={tenantRow.displayName}
      description={`Identificador interno: ${tenantRow.slug}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button loading={update.loading} onClick={() => void update.run(undefined)}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <ResourcePanel resource={detail}>
        {(data) => (
          <div className="grid gap-5">
            <section className="grid gap-4">
              <h3 className="text-sm font-semibold text-slate-800">Conta</h3>
              <Select
                label="Situação"
                value={status}
                options={toOptions(labels.tenantStatus, TENANT_STATUSES)}
                hint="Suspender deixa o painel em modo leitura e tira o site do ar."
                onChange={(event) => setStatus(event.target.value)}
              />
              <Select
                label="Plano"
                value={planCode}
                options={(plans.data?.plans ?? []).map((plan) => ({ value: plan.code, label: plan.name }))}
                onChange={(event) => setPlanCode(event.target.value)}
              />
              <TextArea
                label="Anotações internas"
                rows={3}
                value={notes}
                placeholder={(data.tenant.internalNotes as string) || 'Observações visíveis apenas para a plataforma'}
                onChange={(event) => setNotes(event.target.value)}
              />
            </section>

            <section className="grid gap-3">
              <h3 className="text-sm font-semibold text-slate-800">Uso</h3>
              <Meter
                label="Conteúdos cadastrados"
                current={data.usage.contentRecords}
                limit={data.plan.limits.maxContentRecords}
              />
              <ContentUsageBreakdown byModule={data.usage.contentByModule} />
              <Meter label="Usuários" current={data.usage.users} limit={data.plan.limits.maxUsers} />
              <Meter
                label="Armazenamento"
                current={data.usage.storageBytes}
                limit={data.plan.limits.storageBytes}
                format={formatBytes}
              />
            </section>

            <section className="grid gap-2">
              <h3 className="text-sm font-semibold text-slate-800">Equipe</h3>
              <ul className="grid gap-1 text-sm">
                {data.members.map((member) => (
                  <li key={member.email} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {member.name || member.email}
                      <span className="ml-1.5 text-xs text-slate-500">{member.email}</span>
                    </span>
                    <Badge tone={member.status === 'active' ? 'success' : 'warning'}>
                      {member.role} - {member.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>

            <section className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                <LifeBuoy aria-hidden="true" className="size-4" />
                Acesso de suporte
              </h3>
              <p className="text-xs text-amber-900">
                Ser administrador da plataforma não da acesso ao conteúdo desta empresa. Para consultar os
                dados é necessária uma concessão explícita, somente leitura, com prazo e registro em
                auditoria.
              </p>

              {data.supportGrant ? (
                <Alert tone="warning" title="Acesso ativo">
                  <p>Motivo: {data.supportGrant.reason}</p>
                  <p className="mt-1">Expira em {formatDateTime(data.supportGrant.expiresAt)}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    loading={revoke.loading}
                    onClick={() => data.supportGrant && void revoke.run(data.supportGrant.id)}
                  >
                    Revogar agora
                  </Button>
                </Alert>
              ) : (
                <div className="grid gap-2">
                  <TextArea
                    label="Motivo do acesso"
                    rows={2}
                    value={reason}
                    hint="Mínimo de 10 caracteres. Fica registrado na auditoria da empresa."
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    loading={grant.loading}
                    disabled={reason.trim().length < 10}
                    onClick={() => void grant.run(undefined)}
                  >
                    Conceder acesso por 1 hora
                  </Button>
                </div>
              )}
            </section>
          </div>
        )}
      </ResourcePanel>
    </Modal>
  );
}
