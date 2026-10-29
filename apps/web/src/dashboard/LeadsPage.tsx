import { useState } from 'react';
import { Download, Trash2, Users } from 'lucide-react';
import { LEAD_INTEREST_TYPES, LEAD_STATUSES, formatDateTime } from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  Pagination,
  Select,
  TextArea,
  TextInput,
  useToast,
  type Column,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useDebounced, useMutation, useResource } from '../hooks/useResource.js';
import { leadApi, memberApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { labels, leadTone, toOptions } from '../utils/labels.js';
import type { LeadRecord } from '../types/index.js';

/**
 * Interessados recebidos pelo site.
 *
 * As observacoes internas ficam apenas aqui: o site publico nunca recebe nem o
 * texto das observacoes nem os dados de contato de outros interessados.
 */
export function LeadsPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [interest, setInterest] = useState('');
  const debounced = useDebounced(search);

  const [opened, setOpened] = useState<LeadRecord | null>(null);
  const [removing, setRemoving] = useState<LeadRecord | null>(null);

  const list = useResource(
    () =>
      leadApi.list(tenantId, {
        page,
        pageSize: 20,
        ...(debounced ? { search: debounced } : {}),
        ...(status ? { status } : {}),
        ...(interest ? { interestType: interest } : {}),
      }),
    [tenantId, page, debounced, status, interest],
  );

  const updateStatus = useMutation(
    (input: { id: string; status: string }) => leadApi.update(tenantId, input.id, { status: input.status }),
    {
      onSuccess: () => {
        toast.success('Situacao atualizada');
        list.reload();
      },
      onError: (error) => toast.error('Nao foi possivel atualizar', error.message),
    },
  );

  const remove = useMutation((id: string) => leadApi.remove(tenantId, id), {
    onSuccess: () => {
      toast.success('Interessado removido');
      setRemoving(null);
      list.reload();
    },
  });

  async function exportCsv() {
    try {
      const csv = await leadApi.exportCsv(tenantId);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'interessados.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error('Nao foi possivel exportar', error instanceof Error ? error.message : 'Tente novamente.');
    }
  }

  const columns: Array<Column<LeadRecord>> = [
    {
      key: 'name',
      header: 'Interessado',
      render: (lead) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{lead.name}</p>
          <p className="truncate text-xs text-slate-500">
            {lead.phone}
            {lead.email ? ` - ${lead.email}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'interest',
      header: 'Assunto',
      render: (lead) => (
        <div className="grid gap-0.5">
          <span className="text-sm">{labels.leadInterest[lead.interestType]}</span>
          {lead.propertyTitle ? (
            <span className="text-xs text-slate-500">Imovel: {lead.propertyTitle}</span>
          ) : null}
          {lead.projectTitle ? <span className="text-xs text-slate-500">Obra: {lead.projectTitle}</span> : null}
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Recebido',
      hideOnMobile: true,
      render: (lead) => <span className="text-xs text-slate-600">{formatDateTime(lead.createdAt)}</span>,
    },
    {
      key: 'status',
      header: 'Situacao',
      render: (lead) =>
        can('leads:write') ? (
          <Select
            label="Situacao"
            className="[&>label]:sr-only w-40"
            value={lead.status}
            options={toOptions(labels.leadStatus, LEAD_STATUSES)}
            onChange={(event) => void updateStatus.run({ id: lead.id, status: event.target.value })}
          />
        ) : (
          <Badge tone={leadTone(lead.status)}>{labels.leadStatus[lead.status]}</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (lead) => (
        <div className="flex justify-end gap-1">
          <Button variant="outline" size="sm" onClick={() => setOpened(lead)}>
            Detalhes
          </Button>
          {can('leads:delete') ? (
            <Button variant="ghost" size="icon" aria-label={`Remover ${lead.name}`} onClick={() => setRemoving(lead)}>
              <Trash2 aria-hidden="true" className="size-3.5 text-rose-600" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Interessados"
        description="Contatos recebidos pelos formularios do site, com historico de atendimento."
        actions={
          list.data?.exportEnabled ? (
            <Button
              variant="outline"
              icon={<Download aria-hidden="true" className="size-4" />}
              onClick={() => void exportCsv()}
            >
              Exportar CSV
            </Button>
          ) : undefined
        }
      />

      <Alert tone="info" title="Dados pessoais">
        Cada contato foi enviado com autorizacao expressa para retorno. Use as informacoes apenas para
        responder a solicitacao e mantenha as observacoes internas restritas a equipe.
      </Alert>

      <Card>
        <CardHeader
          title="Contatos"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-48">
                <TextInput
                  label="Buscar"
                  className="[&>label]:sr-only"
                  placeholder="Nome, telefone ou e-mail"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="w-40">
                <Select
                  label="Situacao"
                  className="[&>label]:sr-only"
                  placeholder="Todas"
                  value={status}
                  options={toOptions(labels.leadStatus, LEAD_STATUSES)}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="w-44">
                <Select
                  label="Assunto"
                  className="[&>label]:sr-only"
                  placeholder="Todos os assuntos"
                  value={interest}
                  options={toOptions(labels.leadInterest, LEAD_INTEREST_TYPES)}
                  onChange={(event) => {
                    setInterest(event.target.value);
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
              <DataTable
                columns={columns}
                rows={data.items}
                rowKey={(lead) => lead.id}
                caption="Interessados"
                empty={
                  <CardBody>
                    <EmptyState
                      icon={<Users aria-hidden="true" className="size-8" />}
                      title="Nenhum contato recebido"
                      description="Quando alguem preencher o formulario do site, o contato aparece aqui."
                    />
                  </CardBody>
                }
              />
              <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
            </>
          )}
        </ResourcePanel>
      </Card>

      {opened ? <LeadDetailModal lead={opened} onClose={() => setOpened(null)} /> : null}

      <ConfirmDialog
        open={removing !== null}
        title="Remover interessado"
        message={
          <>
            Os dados de <strong>{removing?.name}</strong> e as observacoes internas serao excluidos
            definitivamente.
          </>
        }
        confirmLabel="Remover"
        loading={remove.loading}
        onConfirm={() => removing && void remove.run(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function LeadDetailModal({ lead, onClose }: { lead: LeadRecord; onClose: () => void }) {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const [note, setNote] = useState('');

  const detail = useResource(() => leadApi.detail(tenantId, lead.id), [tenantId, lead.id]);
  const members = useResource(() => memberApi.list(tenantId), [tenantId], { enabled: can('members:read') });

  const addNote = useMutation((value: string) => leadApi.addNote(tenantId, lead.id, value), {
    onSuccess: () => {
      setNote('');
      detail.reload();
      toast.success('Observacao registrada');
    },
    onError: (error) => toast.error('Nao foi possivel registrar', error.message),
  });

  const assign = useMutation(
    (userId: string) => leadApi.update(tenantId, lead.id, { assignedToUserId: userId || null }),
    {
      onSuccess: () => {
        detail.reload();
        toast.success('Responsavel atualizado');
      },
      onError: (error) => toast.error('Nao foi possivel atribuir', error.message),
    },
  );

  return (
    <Modal open onClose={onClose} title={lead.name} description="Detalhes e historico de atendimento" size="lg" footer={<Button onClick={onClose}>Fechar</Button>}>
      <ResourcePanel resource={detail}>
        {(data) => (
          <div className="grid gap-5">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Telefone</dt>
                <dd>
                  <a className="link" href={`tel:${data.lead.phone.replace(/\D+/g, '')}`}>
                    {data.lead.phone}
                  </a>
                </dd>
              </div>
              {data.lead.email ? (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">E-mail</dt>
                  <dd>
                    <a className="link" href={`mailto:${data.lead.email}`}>
                      {data.lead.email}
                    </a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Assunto</dt>
                <dd>{labels.leadInterest[data.lead.interestType]}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Recebido em</dt>
                <dd>{formatDateTime(data.lead.createdAt)}</dd>
              </div>
              {data.lead.sourcePath ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Pagina de origem</dt>
                  <dd className="truncate font-mono text-xs">{data.lead.sourcePath}</dd>
                </div>
              ) : null}
            </dl>

            {data.lead.message ? (
              <section>
                <h3 className="text-sm font-semibold text-slate-800">Mensagem</h3>
                <p className="mt-1 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                  {data.lead.message}
                </p>
              </section>
            ) : null}

            {can('leads:write') && members.data ? (
              <Select
                label="Responsavel pelo atendimento"
                placeholder="Sem responsavel"
                value={data.lead.assignedToUserId ?? ''}
                options={members.data.members
                  .filter((member) => member.status === 'active')
                  .map((member) => ({ value: member.userId, label: member.name || member.email }))}
                onChange={(event) => void assign.run(event.target.value)}
              />
            ) : null}

            <section className="grid gap-3">
              <h3 className="text-sm font-semibold text-slate-800">Observacoes internas</h3>
              <p className="text-xs text-slate-500">
                Visiveis apenas para a equipe no painel. Nunca aparecem no site.
              </p>

              {data.notes.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
                  Nenhuma observacao registrada.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {data.notes.map((item) => (
                    <li key={item.id} className="rounded-lg border border-slate-200 p-3">
                      <p className="text-sm text-slate-700">{item.note}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {item.authorName ?? 'Conta removida'} - {formatDateTime(item.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {can('leads:write') ? (
                <div className="grid gap-2">
                  <TextArea
                    label="Nova observacao"
                    rows={3}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <Button
                    size="sm"
                    disabled={note.trim().length === 0}
                    loading={addNote.loading}
                    onClick={() => void addNote.run(note)}
                  >
                    Registrar observacao
                  </Button>
                </div>
              ) : null}
            </section>
          </div>
        )}
      </ResourcePanel>
    </Modal>
  );
}
