import { useState } from 'react';
import { Mail, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { TENANT_ROLES, TENANT_ROLE_LABELS, canAssignRole, formatDateTime, tenantCapabilities } from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Modal,
  PageHeader,
  Select,
  TextInput,
  useToast,
  type Column,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { memberApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { useForm } from '../utils/forms.js';
import type { MemberRecord } from '../types/index.js';

/**
 * Equipe e usuarios do painel.
 *
 * Os papeis definem o que cada pessoa pode fazer. A interface esconde o que o
 * papel nao alcanca, mas quem decide e o servidor em cada requisicao.
 */
const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: 'Acesso total, incluindo plano, assinatura e exclusao da empresa.',
  admin: 'Administra empresa, equipe, dominios e todo o conteudo.',
  editor: 'Cria e publica conteudo e paginas; nao administra equipe nem dominios.',
  viewer: 'Apenas consulta, sem alterar nada.',
};

export function TeamPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can, tenant, user } = useAuth();

  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<MemberRecord | null>(null);

  const list = useResource(() => memberApi.list(tenantId), [tenantId]);
  const form = useForm({ email: '', name: '', role: 'editor' });

  const invite = useMutation(
    (input: { email: string; name: string; role: string }) => memberApi.invite(tenantId, input),
    {
      onSuccess: (result) => {
        if (result.emailDelivery.delivered) {
          toast.success('Convite enviado', 'A pessoa recebera um link para definir a senha.');
        } else {
          toast.push({
            tone: 'warning',
            title: 'Convite criado, mas o e-mail nao saiu',
            description: result.emailDelivery.reason ?? 'Verifique a configuracao de e-mail do ambiente.',
          });
        }
        setInviting(false);
        form.reset();
        list.reload();
      },
      onError: (error) => {
        form.applyApiError(error);
        if (error.isPlanLimit) toast.error('Limite de usuarios alcancado', error.message);
        else if (Object.keys(error.fieldErrors).length === 0) toast.error('Nao foi possivel convidar', error.message);
      },
    },
  );

  const changeRole = useMutation(
    (input: { membershipId: string; role: string }) =>
      memberApi.updateRole(tenantId, input.membershipId, input.role),
    {
      onSuccess: () => {
        toast.success('Papel atualizado');
        list.reload();
      },
      onError: (error) => toast.error('Nao foi possivel alterar', error.message),
    },
  );

  const remove = useMutation((membershipId: string) => memberApi.remove(tenantId, membershipId), {
    onSuccess: () => {
      toast.success('Membro removido');
      setRemoving(null);
      list.reload();
    },
    onError: (error) => toast.error('Nao foi possivel remover', error.message),
  });

  const currentRole = tenant?.role ?? 'viewer';

  const columns: Array<Column<MemberRecord>> = [
    {
      key: 'person',
      header: 'Pessoa',
      render: (member) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">
            {member.name || member.email}
            {member.userId === user?.id ? <span className="ml-1.5 text-xs text-slate-400">(voce)</span> : null}
          </p>
          <p className="truncate text-xs text-slate-500">{member.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Papel',
      render: (member) =>
        can('members:update') && canAssignRole(currentRole, member.role) ? (
          <Select
            label="Papel"
            className="[&>label]:sr-only w-44"
            value={member.role}
            options={TENANT_ROLES.filter((role) => canAssignRole(currentRole, role)).map((role) => ({
              value: role,
              label: TENANT_ROLE_LABELS[role],
            }))}
            onChange={(event) => void changeRole.run({ membershipId: member.membershipId, role: event.target.value })}
          />
        ) : (
          <Badge tone={member.role === 'owner' ? 'brand' : 'neutral'}>{TENANT_ROLE_LABELS[member.role]}</Badge>
        ),
    },
    {
      key: 'status',
      header: 'Situacao',
      render: (member) => (
        <div className="grid gap-1">
          <Badge tone={member.status === 'active' ? 'success' : member.status === 'invited' ? 'warning' : 'neutral'}>
            {member.status === 'active' ? 'Ativo' : member.status === 'invited' ? 'Convite pendente' : 'Desativado'}
          </Badge>
          {member.emailVerifiedAt ? null : <span className="text-xs text-slate-400">E-mail nao confirmado</span>}
        </div>
      ),
    },
    {
      key: 'access',
      header: 'Ultimo acesso',
      hideOnMobile: true,
      render: (member) =>
        member.lastLoginAt ? (
          <span className="text-xs text-slate-600">{formatDateTime(member.lastLoginAt)}</span>
        ) : (
          <span className="text-xs text-slate-400">Nunca acessou</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (member) =>
        can('members:remove') && member.userId !== user?.id ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remover ${member.name || member.email}`}
            onClick={() => setRemoving(member)}
          >
            <Trash2 aria-hidden="true" className="size-3.5 text-rose-600" />
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Equipe e usuarios"
        description="Quem tem acesso ao painel desta construtora e o que cada pessoa pode fazer."
        actions={
          can('members:invite') ? (
            <Button icon={<UserPlus aria-hidden="true" className="size-4" />} onClick={() => setInviting(true)}>
              Convidar pessoa
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader title="Membros" />
        <ResourcePanel resource={list}>
          {(data) => (
            <DataTable
              columns={columns}
              rows={data.members}
              rowKey={(member) => member.membershipId}
              caption="Membros da equipe"
            />
          )}
        </ResourcePanel>
      </Card>

      <Card>
        <CardHeader
          title="O que cada papel pode fazer"
          description="As permissoes sao verificadas no servidor em todas as operacoes."
        />
        <CardBody>
          <ul className="grid gap-3 sm:grid-cols-2">
            {TENANT_ROLES.map((role) => (
              <li key={role} className="rounded-lg border border-slate-200 p-3">
                <p className="flex items-center gap-1.5 font-medium text-slate-900">
                  <ShieldCheck aria-hidden="true" className="size-4 text-brand-600" />
                  {TENANT_ROLE_LABELS[role]}
                </p>
                <p className="mt-1 text-sm text-slate-600">{ROLE_DESCRIPTIONS[role]}</p>
                <p className="mt-1.5 text-xs text-slate-400">
                  {tenantCapabilities(role).length} permissoes
                </p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Modal
        open={inviting}
        onClose={() => setInviting(false)}
        title="Convidar pessoa"
        description="A pessoa recebe um link por e-mail para definir a senha e entrar."
        footer={
          <>
            <Button variant="outline" onClick={() => setInviting(false)}>
              Cancelar
            </Button>
            <Button loading={invite.loading} onClick={() => void invite.run(form.values)}>
              Enviar convite
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <TextInput
            label="E-mail"
            type="email"
            required
            value={form.values.email}
            error={form.errors.email}
            onChange={(event) => form.setField('email', event.target.value)}
          />
          <TextInput
            label="Nome"
            value={form.values.name}
            error={form.errors.name}
            onChange={(event) => form.setField('name', event.target.value)}
          />
          <Select
            label="Papel"
            value={form.values.role}
            options={TENANT_ROLES.filter((role) => canAssignRole(currentRole, role)).map((role) => ({
              value: role,
              label: TENANT_ROLE_LABELS[role],
            }))}
            hint={ROLE_DESCRIPTIONS[form.values.role]}
            onChange={(event) => form.setField('role', event.target.value)}
          />
          <Alert tone="info">
            <Mail aria-hidden="true" className="mr-1 inline size-3.5" />
            O vinculo so passa a valer quando a pessoa aceitar o convite.
          </Alert>
        </div>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Remover acesso"
        message={
          <>
            <strong>{removing?.name || removing?.email}</strong> perdera o acesso ao painel desta construtora.
            A conta da pessoa continua existindo na plataforma.
          </>
        }
        confirmLabel="Remover acesso"
        loading={remove.loading}
        onConfirm={() => removing && void remove.run(removing.membershipId)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
