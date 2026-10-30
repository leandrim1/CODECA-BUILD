import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { PLAN_FEATURES, PLAN_FEATURE_LABELS, formatBytes } from '@codeca/shared';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Modal,
  PageHeader,
  Switch,
  TextArea,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useMutation, useResource } from '../../hooks/useResource.js';
import { platformApi } from '../../services/endpoints.js';
import { ResourcePanel } from '../../components/ResourcePanel.js';
import { useForm } from '../../utils/forms.js';
import type { PlanRecord } from '../../types/index.js';

/** Planos comerciais: limites e recursos por plano. */
export function PlatformPlansPage() {
  const [editing, setEditing] = useState<PlanRecord | 'new' | null>(null);
  const plans = useResource(() => platformApi.plans(), []);

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Planos"
        description="Limites e recursos de cada plano. Alteracoes passam a valer imediatamente para as empresas que usam o plano."
        actions={
          <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEditing('new')}>
            Novo plano
          </Button>
        }
      />

      <ResourcePanel resource={plans}>
        {(data) => (
          <div className="grid gap-4 lg:grid-cols-3">
            {data.plans.map((plan) => (
              <Card key={plan.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {plan.name}
                      {plan.isActive ? null : <Badge tone="neutral">inativo</Badge>}
                      {plan.isPublic ? null : <Badge tone="info">interno</Badge>}
                    </span>
                  }
                  description={`${plan.code} - ${plan.tenantCount} construtora(s)`}
                  actions={
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<Pencil aria-hidden="true" className="size-3.5" />}
                      onClick={() => setEditing(plan)}
                    >
                      Editar
                    </Button>
                  }
                />
                <CardBody className="grid gap-3">
                  <p className="text-2xl font-semibold text-slate-900">
                    {plan.priceCents === 0 ? 'Gratuito' : `R$ ${(plan.priceCents / 100).toLocaleString('pt-BR')}`}
                    {plan.priceCents > 0 ? <span className="text-sm font-normal text-slate-500">/mes</span> : null}
                  </p>
                  <ul className="grid gap-1 text-sm text-slate-600">
                    <li>{plan.limits.maxPublishedProperties} imoveis publicados</li>
                    <li>{plan.limits.maxProjects} obras</li>
                    <li>{plan.limits.maxUsers} usuarios</li>
                    <li>{plan.limits.maxDomains} dominio(s)</li>
                    <li>{formatBytes(plan.limits.storageBytes)} de armazenamento</li>
                  </ul>
                  <ul className="grid gap-0.5 text-xs text-slate-500">
                    {plan.limits.features.map((feature) => (
                      <li key={feature}>- {PLAN_FEATURE_LABELS[feature]}</li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </ResourcePanel>

      {editing ? (
        <PlanModal
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            plans.reload();
          }}
        />
      ) : null}
    </div>
  );
}

const MB = 1024 * 1024;

function PlanModal({
  plan,
  onClose,
  onSaved,
}: {
  plan: PlanRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const form = useForm({
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    priceReais: plan ? String(plan.priceCents / 100) : '0',
    maxUsers: String(plan?.limits.maxUsers ?? 5),
    maxPublishedProperties: String(plan?.limits.maxPublishedProperties ?? 40),
    maxProjects: String(plan?.limits.maxProjects ?? 20),
    maxDomains: String(plan?.limits.maxDomains ?? 1),
    storageMb: String(Math.round((plan?.limits.storageBytes ?? 2048 * MB) / MB)),
    features: (plan?.limits.features ?? []) as string[],
    isPublic: plan?.isPublic ?? true,
    isActive: plan?.isActive ?? true,
  });

  const save = useMutation(
    () => {
      const limits = {
        maxUsers: Number(form.values.maxUsers),
        maxPublishedProperties: Number(form.values.maxPublishedProperties),
        maxProjects: Number(form.values.maxProjects),
        maxDomains: Number(form.values.maxDomains),
        storageBytes: Number(form.values.storageMb) * MB,
        features: form.values.features,
      };
      const body = {
        name: form.values.name,
        description: form.values.description,
        priceCents: Math.round(Number(form.values.priceReais) * 100),
        limits,
        isPublic: form.values.isPublic,
        isActive: form.values.isActive,
      };
      return plan
        ? platformApi.updatePlan(plan.id, body)
        : platformApi.createPlan({ ...body, code: form.values.code });
    },
    {
      onSuccess: () => {
        toast.success('Plano salvo');
        onSaved();
      },
      onError: (error) => {
        form.applyApiError(error);
        if (Object.keys(error.fieldErrors).length === 0) toast.error('Nao foi possivel salvar', error.message);
      },
    },
  );

  const { values, errors, setField } = form;

  return (
    <Modal
      open
      onClose={onClose}
      title={plan ? `Editar plano ${plan.name}` : 'Novo plano'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.loading} onClick={() => void save.run(undefined)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {plan ? null : (
          <TextInput
            label="Codigo"
            required
            value={values.code}
            error={errors.code}
            hint="Identificador interno, apenas letras minusculas, numeros, - e _."
            onChange={(event) => setField('code', event.target.value.toLowerCase())}
          />
        )}
        <TextInput
          label="Nome"
          required
          value={values.name}
          error={errors.name}
          onChange={(event) => setField('name', event.target.value)}
        />
        <TextArea
          label="Descricao"
          rows={2}
          value={values.description}
          onChange={(event) => setField('description', event.target.value)}
        />
        <TextInput
          label="Preco mensal (R$)"
          inputMode="decimal"
          value={values.priceReais}
          onChange={(event) => setField('priceReais', event.target.value)}
        />

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="text-sm font-medium text-slate-700">Limites</legend>
          <TextInput
            label="Usuarios"
            inputMode="numeric"
            value={values.maxUsers}
            onChange={(event) => setField('maxUsers', event.target.value)}
          />
          <TextInput
            label="Imoveis publicados"
            inputMode="numeric"
            value={values.maxPublishedProperties}
            onChange={(event) => setField('maxPublishedProperties', event.target.value)}
          />
          <TextInput
            label="Obras"
            inputMode="numeric"
            value={values.maxProjects}
            onChange={(event) => setField('maxProjects', event.target.value)}
          />
          <TextInput
            label="Dominios"
            inputMode="numeric"
            value={values.maxDomains}
            onChange={(event) => setField('maxDomains', event.target.value)}
          />
          <TextInput
            label="Armazenamento (MB)"
            inputMode="numeric"
            value={values.storageMb}
            onChange={(event) => setField('storageMb', event.target.value)}
          />
        </fieldset>

        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium text-slate-700">Recursos incluidos</legend>
          <div className="grid gap-1 rounded-lg border border-slate-200 p-3">
            {PLAN_FEATURES.map((feature) => (
              <Checkbox
                key={feature}
                label={PLAN_FEATURE_LABELS[feature]}
                checked={values.features.includes(feature)}
                onChange={(checked) =>
                  setField(
                    'features',
                    checked
                      ? [...values.features, feature]
                      : values.features.filter((item) => item !== feature),
                  )
                }
              />
            ))}
          </div>
        </fieldset>

        <Switch
          label="Visivel para contratacao"
          checked={values.isPublic}
          onChange={(checked) => setField('isPublic', checked)}
        />
        <Switch
          label="Plano ativo"
          hint="Planos inativos nao podem ser atribuidos a novas construtoras."
          checked={values.isActive}
          onChange={(checked) => setField('isActive', checked)}
        />
      </div>
    </Modal>
  );
}
