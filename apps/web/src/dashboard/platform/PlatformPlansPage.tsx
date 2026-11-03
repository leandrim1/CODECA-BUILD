import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import {
  PANEL_ON_SUSPENSION,
  PANEL_ON_SUSPENSION_LABELS,
  PLAN_FEATURES,
  PLAN_FEATURE_NOTES,
  PLAN_FEATURE_LABELS,
  PUBLIC_SITE_ON_SUSPENSION,
  PUBLIC_SITE_ON_SUSPENSION_LABELS,
  formatBytes,
  planBenefits,
  formatPlanPrice,
  type PanelOnSuspension,
  type PublicSiteOnSuspension,
} from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Modal,
  PageHeader,
  Select,
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
  const plans = useResource('platformApi.plans', () => platformApi.plans(), []);

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
                  description={`${plan.code} - ${plan.tenantCount} empresa(s)`}
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
                    {plan.priceCents === 0 ? 'Gratuito' : formatPlanPrice(plan.priceCents)}
                    {plan.priceCents > 0 ? <span className="text-sm font-normal text-slate-500">/mes</span> : null}
                  </p>
                  {/*
                    A mesma lista da pagina inicial e da tela de plano do
                    cliente: ela sai de `planBenefits`, entao o que o
                    superadmin configura aqui e exatamente o que o visitante
                    le. Os recursos ligados aparecem logo abaixo, com o nome
                    tecnico que se escolhe no formulario.
                  */}
                  <ul className="grid gap-1 text-sm text-slate-600">
                    {planBenefits(plan).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
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
    maxContentRecords: String(plan?.limits.maxContentRecords ?? 100),
    maxDomains: String(plan?.limits.maxDomains ?? 1),
    storageMb: String(Math.round((plan?.limits.storageBytes ?? 2048 * MB) / MB)),
    features: (plan?.limits.features ?? []) as string[],
    isPublic: plan?.isPublic ?? true,
    isActive: plan?.isActive ?? true,
    suspensionPublicSite: plan?.suspension?.publicSite ?? 'serve',
    suspensionPanel: plan?.suspension?.panel ?? 'read_only',
  });

  const save = useMutation(
    () => {
      const limits = {
        maxUsers: Number(form.values.maxUsers),
        maxContentRecords: Number(form.values.maxContentRecords),
        maxDomains: Number(form.values.maxDomains),
        storageBytes: Number(form.values.storageMb) * MB,
        features: form.values.features,
      };
      const body = {
        name: form.values.name,
        description: form.values.description,
        priceCents: Math.round(Number(form.values.priceReais) * 100),
        limits,
        suspension: {
          publicSite: form.values.suspensionPublicSite,
          panel: form.values.suspensionPanel,
        },
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

        <fieldset className="grid items-start gap-4 sm:grid-cols-3">
          <legend className="text-sm font-medium text-slate-700">Limites</legend>
          <TextInput
            label="Usuarios"
            inputMode="numeric"
            value={values.maxUsers}
            onChange={(event) => setField('maxUsers', event.target.value)}
          />
          <TextInput
            label="Conteudos cadastrados"
            inputMode="numeric"
            value={values.maxContentRecords}
            error={errors['limits.maxContentRecords']}
            hint="Limite geral: soma dos registros de todos os modulos do site."
            onChange={(event) => setField('maxContentRecords', event.target.value)}
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
          <p className="text-xs leading-relaxed text-slate-500 sm:col-span-3">
            <strong>Conteudos cadastrados</strong> e um limite unico, igual para todo segmento: conta os
            registros de todos os modulos de colecao habilitados no site (produtos, servicos, imoveis, obras,
            equipe, galerias, banners e os modulos personalizados). Rascunhos e arquivados contam; excluidos
            nao; documentos (institucional, contato) nao. Reduzir o limite nunca apaga nada: quem ja passou
            dele continua editando e excluindo, e so deixa de cadastrar novos.
          </p>
        </fieldset>

        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium text-slate-700">Recursos incluidos</legend>
          <div className="grid gap-1 rounded-lg border border-slate-200 p-3">
            {PLAN_FEATURES.map((feature) => (
              <Checkbox
                key={feature}
                label={PLAN_FEATURE_LABELS[feature]}
                /*
                  O nome de alguns recursos promete mais do que eles fazem:
                  "Hospedagem incluida" nao faz a plataforma hospedar. Dizer o
                  efeito real na propria caixa evita vender achando que e maior.
                */
                hint={PLAN_FEATURE_NOTES[feature]}
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

        <fieldset className="grid gap-4 rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium text-slate-700">
            Quando a assinatura nao esta em dia
          </legend>
          <p className="text-xs text-slate-500">
            Vale apos o periodo de tolerancia. Durante a tolerancia nada muda.
          </p>

          <Select
            label="Site do cliente"
            value={values.suspensionPublicSite}
            options={PUBLIC_SITE_ON_SUSPENSION.map((code) => ({
              value: code,
              label: PUBLIC_SITE_ON_SUSPENSION_LABELS[code],
            }))}
            hint="O site e um projeto na Vercel do cliente: a plataforma controla o conteudo que ele busca, nao a hospedagem."
            onChange={(event) =>
              setField('suspensionPublicSite', event.target.value as PublicSiteOnSuspension)
            }
          />

          <Select
            label="Painel do cliente"
            value={values.suspensionPanel}
            options={PANEL_ON_SUSPENSION.map((code) => ({
              value: code,
              label: PANEL_ON_SUSPENSION_LABELS[code],
            }))}
            hint="A tela de cobranca continua aberta nos dois casos: sem ela o cliente nao tem como regularizar."
            onChange={(event) => setField('suspensionPanel', event.target.value as PanelOnSuspension)}
          />

          <Alert tone="info" title="O conteudo nunca e apagado">
            Imoveis, obras, imagens e configuracoes continuam salvos em qualquer uma das opcoes, e
            voltam a aparecer ao regularizar. Nao ha opcao de apagar.
          </Alert>
        </fieldset>

        <Switch
          label="Visivel para contratacao"
          checked={values.isPublic}
          onChange={(checked) => setField('isPublic', checked)}
        />
        <Switch
          label="Plano ativo"
          hint="Planos inativos nao podem ser atribuidos a novas empresas."
          checked={values.isActive}
          onChange={(checked) => setField('isActive', checked)}
        />
      </div>
    </Modal>
  );
}
