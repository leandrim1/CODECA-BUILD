import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { PUBLICATION_STATUSES, SAFE_ICONS, slugify, type PublicationStatus } from '@codeca/shared';
import { SafeIcon } from '../components/SafeIcon.js';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  cx,
  useToast,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { useModulePolicy } from '../hooks/useSiteModules.js';
import { contentApi } from '../services/endpoints.js';
import {
  CamposPersonalizados,
  useCamposPersonalizados,
} from '../components/CustomFields.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { ImageField } from '../components/MediaPicker.js';
import { labels, publicationTone, toOptions } from '../utils/labels.js';
import { formatList, parseList, useForm } from '../utils/forms.js';
import type { MediaRef, ServiceRecord } from '../types/index.js';

/** Servicos oferecidos pela construtora. */
export function ServicesPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const [editing, setEditing] = useState<ServiceRecord | 'new' | null>(null);
  const [removing, setRemoving] = useState<ServiceRecord | null>(null);

  const list = useResource(() => contentApi.services(tenantId, { pageSize: 50 }), [tenantId]);

  const remove = useMutation((id: string) => contentApi.removeService(tenantId, id), {
    onSuccess: () => {
      toast.success('Servico excluido');
      setRemoving(null);
      list.reload();
    },
    onError: (error) => toast.error('Nao foi possivel excluir', error.message),
  });

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Servicos"
        description="O que a construtora oferece. Os servicos publicados alimentam o bloco de servicos do site."
        actions={
          can('content:write') ? (
            <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEditing('new')}>
              Novo servico
            </Button>
          ) : undefined
        }
      />

      <ResourcePanel resource={list}>
        {(data) =>
          data.items.length === 0 ? (
            <Card>
              <CardBody>
                <EmptyState
                  icon={<Wrench aria-hidden="true" className="size-8" />}
                  title="Nenhum servico cadastrado"
                  description="Cadastre os servicos para que apareçam no site e no formulario de orcamento."
                />
              </CardBody>
            </Card>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.items.map((service) => (
                <Card key={service.id} as="li">
                  <CardBody className="grid gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-700">
                        <SafeIcon name={service.icon} size={20} />
                      </span>
                      <Badge tone={publicationTone(service.publicationStatus)}>
                        {labels.publication[service.publicationStatus]}
                      </Badge>
                    </div>
                    <h3 className="font-semibold text-slate-900">{service.title}</h3>
                    {service.summary ? <p className="text-sm text-slate-600">{service.summary}</p> : null}
                    {service.highlights.length > 0 ? (
                      <ul className="grid gap-0.5 text-xs text-slate-500">
                        {service.highlights.slice(0, 3).map((highlight, index) => (
                          <li key={index}>- {highlight}</li>
                        ))}
                      </ul>
                    ) : null}
                    {can('content:write') ? (
                      <div className="mt-2 flex gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          icon={<Pencil aria-hidden="true" className="size-3.5" />}
                          onClick={() => setEditing(service)}
                        >
                          Editar
                        </Button>
                        {can('content:delete') ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Excluir ${service.title}`}
                            onClick={() => setRemoving(service)}
                          >
                            <Trash2 aria-hidden="true" className="size-3.5 text-rose-600" />
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </CardBody>
                </Card>
              ))}
            </ul>
          )
        }
      </ResourcePanel>

      {editing ? (
        <ServiceFormModal
          service={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title="Excluir servico"
        message={<>O servico <strong>{removing?.title}</strong> sera removido do site.</>}
        confirmLabel="Excluir"
        loading={remove.loading}
        onConfirm={() => removing && void remove.run(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function ServiceFormModal({
  service,
  onClose,
  onSaved,
}: {
  service: ServiceRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const politica = useModulePolicy('servicos');
  const personalizados = useCamposPersonalizados('servicos', service?.customFields);
  const toast = useToast();
  const form = useForm({
    title: service?.title ?? '',
    slug: service?.slug ?? '',
    summary: service?.summary ?? '',
    description: service?.description ?? '',
    icon: service?.icon ?? 'wrench',
    highlights: formatList(service?.highlights ?? []),
    publicationStatus: service?.publicationStatus ?? 'published',
    imageId: service?.imageId ?? null,
    seoTitle: service?.seoTitle ?? '',
    seoDescription: service?.seoDescription ?? '',
  });
  const [image, setImage] = useState<MediaRef | null>(service?.image ?? null);

  useEffect(() => {
    // Mantem o formulario alinhado quando outro servico e aberto.
    form.reset({
      title: service?.title ?? '',
      slug: service?.slug ?? '',
      summary: service?.summary ?? '',
      description: service?.description ?? '',
      icon: service?.icon ?? 'wrench',
      highlights: formatList(service?.highlights ?? []),
      publicationStatus: service?.publicationStatus ?? 'published',
      imageId: service?.imageId ?? null,
      seoTitle: service?.seoTitle ?? '',
      seoDescription: service?.seoDescription ?? '',
    });
    setImage(service?.image ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.id]);

  const save = useMutation(
    () => {
      // Campo travado sai do corpo: reenvia-lo levaria 403 mesmo sem o
      // cliente ter tocado nele.
      const extras = personalizados.paraApi();
      const body = politica.semTravados({
        ...(extras ? { customFields: extras } : {}),
        title: form.values.title,
        ...(form.values.slug ? { slug: form.values.slug } : {}),
        summary: form.values.summary,
        description: form.values.description,
        icon: form.values.icon,
        highlights: parseList(form.values.highlights),
        publicationStatus: form.values.publicationStatus,
        imageId: form.values.imageId,
        seoTitle: form.values.seoTitle,
        seoDescription: form.values.seoDescription,
      });
      return service ? contentApi.updateService(tenantId, service.id, body) : contentApi.createService(tenantId, body);
    },
    {
      onSuccess: () => {
        toast.success(service ? 'Servico atualizado' : 'Servico cadastrado');
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
      title={service ? 'Editar servico' : 'Novo servico'}
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
        <TextInput
          label="Nome do servico"
          required
          value={values.title}
          error={errors.title}
          onChange={(event) => setField('title', event.target.value)}
        />
        <TextInput
          label="Endereco da pagina"
          value={values.slug}
          error={errors.slug}
          placeholder={slugify(values.title)}
          readOnly={!politica.editavel('slug')}
          disabled={!politica.editavel('slug')}
          {...(politica.travaExplicada('slug')
            ? { hint: politica.travaExplicada('slug')! }
            : {})}
          onChange={(event) => setField('slug', slugify(event.target.value))}
        />
        <TextInput
          label="Resumo"
          value={values.summary}
          hint="Uma frase que explica o servico."
          onChange={(event) => setField('summary', event.target.value)}
        />
        <TextArea
          label="Descricao"
          rows={4}
          value={values.description}
          onChange={(event) => setField('description', event.target.value)}
        />
        <TextArea
          label="Itens inclusos"
          rows={4}
          value={values.highlights}
          hint="Um por linha. Aparecem como lista no cartao do servico."
          onChange={(event) => setField('highlights', event.target.value)}
        />

        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium text-slate-700">Icone</legend>
          <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {SAFE_ICONS.map((icon) => (
              <button
                key={icon}
                type="button"
                aria-label={icon}
                aria-pressed={values.icon === icon}
                onClick={() => setField('icon', icon)}
                className={cx(
                  'grid aspect-square place-items-center rounded-md border transition-colors',
                  values.icon === icon
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-transparent text-slate-500 hover:bg-slate-100',
                )}
              >
                <SafeIcon name={icon} size={17} />
              </button>
            ))}
          </div>
        </fieldset>

        <ImageField
          label="Imagem do servico"
          tag="servicos"
          value={values.imageId}
          preview={image}
          onChange={(mediaId, asset) => {
            setField('imageId', mediaId);
            setImage(
              asset ? { id: asset.id, url: asset.blobUrl, alt: asset.alt, width: asset.width, height: asset.height } : null,
            );
          }}
        />

        <Select
          label="Situacao no site"
          value={values.publicationStatus}
          options={toOptions(labels.publication, PUBLICATION_STATUSES)}
          onChange={(event) => setField('publicationStatus', event.target.value as PublicationStatus)}
        />

        <CamposPersonalizados
          moduleKey="servicos"
          values={personalizados.valores}
          onChange={personalizados.definir}
          errors={form.errors}
        />
      </div>
    </Modal>
  );
}
