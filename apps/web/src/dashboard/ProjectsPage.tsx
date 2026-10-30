import { useEffect, useState } from 'react';
import { CalendarPlus, ExternalLink, HardHat, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  PROJECT_CATEGORIES,
  PROJECT_STAGES,
  PROJECT_STATUSES,
  PUBLICATION_STATUSES,
  formatIsoDate,
  slugify,
} from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Switch,
  TextArea,
  TextInput,
  useToast,
  type Column,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { useModulePolicy } from '../hooks/useSiteModules.js';
import { projectApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { GalleryField, ImageField } from '../components/MediaPicker.js';
import { labels, projectTone, publicationTone, toOptions } from '../utils/labels.js';
import { numberOrNull, useForm } from '../utils/forms.js';
import type { MediaRef, ProjectRecord } from '../types/index.js';

/**
 * Obras e projetos.
 *
 * O percentual de evolucao e sempre informado pela construtora. Quando fica em
 * branco, o site nao exibe barra de progresso -- a plataforma nunca estima.
 */
export function ProjectsPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<ProjectRecord | 'new' | null>(null);
  const [removing, setRemoving] = useState<ProjectRecord | null>(null);
  const [updatesOf, setUpdatesOf] = useState<ProjectRecord | null>(null);

  const list = useResource(
    () => projectApi.list(tenantId, { page, pageSize: 20, ...(status ? { status } : {}) }),
    [tenantId, page, status],
  );

  const remove = useMutation((id: string) => projectApi.remove(tenantId, id), {
    onSuccess: () => {
      toast.success('Obra excluida');
      setRemoving(null);
      list.reload();
    },
    onError: (error) => toast.error('Nao foi possivel excluir', error.message),
  });

  const columns: Array<Column<ProjectRecord>> = [
    {
      key: 'title',
      header: 'Obra',
      render: (project) => (
        <div className="flex items-center gap-3">
          <div className="size-12 flex-none overflow-hidden rounded-lg bg-slate-100">
            {project.coverImage?.url ? (
              <img src={project.coverImage.url} alt="" className="size-full object-cover" loading="lazy" />
            ) : (
              <div className="grid size-full place-items-center text-slate-300">
                <HardHat aria-hidden="true" className="size-5" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{project.title}</p>
            <p className="truncate text-xs text-slate-500">
              {labels.projectCategory[project.category]} - etapa {labels.projectStage[project.stage]}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'progress',
      header: 'Evolucao',
      hideOnMobile: true,
      render: (project) =>
        project.progressPercent === null ? (
          <span className="text-xs text-slate-400">Nao informada</span>
        ) : (
          <span className="tabular-nums text-sm">{project.progressPercent}%</span>
        ),
    },
    {
      key: 'status',
      header: 'Situacao',
      render: (project) => (
        <div className="grid gap-1">
          <Badge tone={projectTone(project.status)}>{labels.projectStatus[project.status]}</Badge>
          <Badge tone={publicationTone(project.publicationStatus)}>
            {labels.publication[project.publicationStatus]}
          </Badge>
        </div>
      ),
    },
    {
      key: 'dates',
      header: 'Prazos',
      hideOnMobile: true,
      render: (project) => (
        <span className="text-xs text-slate-600">
          {project.startDate ? `Inicio ${formatIsoDate(project.startDate, 'month')}` : 'Inicio nao informado'}
          {project.expectedCompletionDate
            ? ` - previsao ${formatIsoDate(project.expectedCompletionDate, 'month')}`
            : ''}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (project) => (
        <div className="flex justify-end gap-1">
          {project.publicationStatus === 'published' ? (
            <a
              href={`/obras/${project.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Abrir ${project.title} no site`}
              className="inline-grid size-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          ) : null}
          {can('content:write') ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setUpdatesOf(project)}
                icon={<CalendarPlus aria-hidden="true" className="size-3.5" />}
              >
                Evolucao
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Editar ${project.title}`} onClick={() => setEditing(project)}>
                <Pencil aria-hidden="true" className="size-3.5" />
              </Button>
            </>
          ) : null}
          {can('content:delete') ? (
            <Button variant="ghost" size="icon" aria-label={`Excluir ${project.title}`} onClick={() => setRemoving(project)}>
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
        title="Obras e projetos"
        description="Obras em andamento, concluidas e previstas. Cada obra publicada tem pagina propria com a evolucao registrada pela equipe."
        actions={
          can('content:write') ? (
            <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEditing('new')}>
              Nova obra
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader
          title="Obras cadastradas"
          actions={
            <div className="w-44">
              <Select
                label="Situacao"
                className="[&>label]:sr-only"
                placeholder="Todas as situacoes"
                value={status}
                options={toOptions(labels.projectStatus, PROJECT_STATUSES)}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          }
        />
        <ResourcePanel resource={list}>
          {(data) => (
            <>
              <DataTable
                columns={columns}
                rows={data.items}
                rowKey={(project) => project.id}
                caption="Obras cadastradas"
                empty={
                  <CardBody>
                    <EmptyState
                      icon={<HardHat aria-hidden="true" className="size-8" />}
                      title="Nenhuma obra cadastrada"
                      description="Cadastre as obras para mostrar o andamento dos projetos no site."
                    />
                  </CardBody>
                }
              />
              <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
            </>
          )}
        </ResourcePanel>
      </Card>

      {editing ? (
        <ProjectFormModal
          projectId={editing === 'new' ? null : editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}

      {updatesOf ? (
        <ProjectUpdatesModal project={updatesOf} onClose={() => setUpdatesOf(null)} onChanged={() => list.reload()} />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title="Excluir obra"
        message={
          <>
            A obra <strong>{removing?.title}</strong>, a pagina publica e os registros de evolucao serao
            excluidos. As fotos permanecem na biblioteca.
          </>
        }
        confirmLabel="Excluir obra"
        loading={remove.loading}
        onConfirm={() => removing && void remove.run(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

const EMPTY_PROJECT = {
  title: '',
  slug: '',
  shortDescription: '',
  description: '',
  category: 'residencial',
  status: 'em_andamento',
  stage: 'planejamento',
  progressPercent: '',
  city: '',
  state: '',
  neighborhood: '',
  showLocation: true,
  startDate: '',
  expectedCompletionDate: '',
  completedDate: '',
  publicationStatus: 'draft',
  featured: false,
  seoTitle: '',
  seoDescription: '',
  coverImageId: null as string | null,
  galleryImageIds: [] as string[],
};

function ProjectFormModal({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const politica = useModulePolicy('obras');
  const toast = useToast();
  const form = useForm({ ...EMPTY_PROJECT });
  const [cover, setCover] = useState<MediaRef | null>(null);
  const [gallery, setGallery] = useState<MediaRef[]>([]);

  const detail = useResource(() => projectApi.detail(tenantId, projectId as string), [tenantId, projectId], {
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    const project = detail.data?.project;
    if (!project) return;
    form.setValues({
      title: project.title,
      slug: project.slug,
      shortDescription: project.shortDescription,
      description: project.description,
      category: project.category,
      status: project.status,
      stage: project.stage,
      progressPercent: project.progressPercent === null ? '' : String(project.progressPercent),
      city: project.city,
      state: project.state,
      neighborhood: project.neighborhood,
      showLocation: project.showLocation,
      startDate: project.startDate ?? '',
      expectedCompletionDate: project.expectedCompletionDate ?? '',
      completedDate: project.completedDate ?? '',
      publicationStatus: project.publicationStatus,
      featured: project.featured,
      seoTitle: project.seoTitle,
      seoDescription: project.seoDescription,
      coverImageId: project.coverImageId,
      galleryImageIds: (project.gallery ?? []).map((image) => image.id),
    });
    setCover(project.coverImage ?? null);
    setGallery(project.gallery ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data]);

  const save = useMutation(
    () => {
      const values = form.values;
      // Campo travado sai do corpo: reenvia-lo levaria 403 mesmo sem o
      // cliente ter tocado nele.
      const body = politica.semTravados({
        title: values.title,
        ...(values.slug ? { slug: values.slug } : {}),
        shortDescription: values.shortDescription,
        description: values.description,
        category: values.category,
        status: values.status,
        stage: values.stage,
        progressPercent: numberOrNull(values.progressPercent),
        city: values.city,
        state: values.state,
        neighborhood: values.neighborhood,
        showLocation: values.showLocation,
        startDate: values.startDate || null,
        expectedCompletionDate: values.expectedCompletionDate || null,
        completedDate: values.completedDate || null,
        publicationStatus: values.publicationStatus,
        featured: values.featured,
        seoTitle: values.seoTitle,
        seoDescription: values.seoDescription,
        coverImageId: values.coverImageId,
        galleryImageIds: values.galleryImageIds,
      });
      return projectId ? projectApi.update(tenantId, projectId, body) : projectApi.create(tenantId, body);
    },
    {
      onSuccess: () => {
        toast.success(projectId ? 'Obra atualizada' : 'Obra cadastrada');
        onSaved();
      },
      onError: (error) => {
        form.applyApiError(error);
        if (error.isPlanLimit) toast.error('Limite do plano alcancado', error.message);
        else if (Object.keys(error.fieldErrors).length === 0) toast.error('Nao foi possivel salvar', error.message);
      },
    },
  );

  const { values, errors, setField } = form;

  return (
    <Modal
      open
      onClose={onClose}
      title={projectId ? 'Editar obra' : 'Nova obra'}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.loading} onClick={() => void save.run(undefined)}>
            {projectId ? 'Salvar alteracoes' : 'Cadastrar obra'}
          </Button>
        </>
      }
    >
      <div className="grid gap-6">
        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">Identificacao</h3>
          <TextInput
            label="Titulo"
            required
            value={values.title}
            error={errors.title}
            onChange={(event) => setField('title', event.target.value)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
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
            <Select
              label="Categoria"
              required
              value={values.category}
              options={toOptions(labels.projectCategory, PROJECT_CATEGORIES)}
              onChange={(event) => setField('category', event.target.value)}
            />
          </div>
          <TextInput
            label="Resumo"
            value={values.shortDescription}
            onChange={(event) => setField('shortDescription', event.target.value)}
          />
          <TextArea
            label="Descricao"
            rows={4}
            value={values.description}
            onChange={(event) => setField('description', event.target.value)}
          />
        </section>

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">Andamento</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Situacao"
              value={values.status}
              options={toOptions(labels.projectStatus, PROJECT_STATUSES)}
              onChange={(event) => setField('status', event.target.value)}
            />
            <Select
              label="Etapa atual"
              value={values.stage}
              options={toOptions(labels.projectStage, PROJECT_STAGES)}
              onChange={(event) => setField('stage', event.target.value)}
            />
            <TextInput
              label="Percentual de evolucao"
              inputMode="numeric"
              value={values.progressPercent}
              error={errors.progressPercent}
              hint="Deixe vazio se a empresa nao divulga o percentual: o site nao exibe barra de progresso."
              onChange={(event) => setField('progressPercent', event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput
              label="Inicio da obra"
              type="date"
              value={values.startDate}
              onChange={(event) => setField('startDate', event.target.value)}
            />
            <TextInput
              label="Previsao de conclusao"
              type="date"
              value={values.expectedCompletionDate}
              onChange={(event) => setField('expectedCompletionDate', event.target.value)}
            />
            <TextInput
              label="Conclusao efetiva"
              type="date"
              value={values.completedDate}
              onChange={(event) => setField('completedDate', event.target.value)}
            />
          </div>
        </section>

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">Localizacao</h3>
          <Switch
            label="Exibir localizacao no site"
            checked={values.showLocation}
            onChange={(checked) => setField('showLocation', checked)}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput
              label="Bairro"
              value={values.neighborhood}
              onChange={(event) => setField('neighborhood', event.target.value)}
            />
            <TextInput label="Cidade" value={values.city} onChange={(event) => setField('city', event.target.value)} />
            <TextInput
              label="UF"
              maxLength={2}
              value={values.state}
              onChange={(event) => setField('state', event.target.value.toUpperCase())}
            />
          </div>
        </section>

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">Imagens</h3>
          <ImageField
            label="Imagem de capa"
            tag="obras"
            value={values.coverImageId}
            preview={cover}
            onChange={(mediaId, asset) => {
              setField('coverImageId', mediaId);
              setCover(
                asset
                  ? { id: asset.id, url: asset.blobUrl, alt: asset.alt, width: asset.width, height: asset.height }
                  : null,
              );
            }}
          />
          <GalleryField
            label="Galeria da obra"
            value={values.galleryImageIds}
            previews={gallery}
            onChange={(ids, assets) => {
              setField('galleryImageIds', ids);
              if (assets) {
                setGallery((current) => [
                  ...current,
                  ...assets.map((asset) => ({
                    id: asset.id,
                    url: asset.blobUrl,
                    alt: asset.alt,
                    width: asset.width,
                    height: asset.height,
                  })),
                ]);
              }
            }}
          />
        </section>

        <section className="grid gap-4">
          <h3 className="text-sm font-semibold text-slate-800">Publicacao e SEO</h3>
          <Select
            label="Situacao no site"
            value={values.publicationStatus}
            options={toOptions(labels.publication, PUBLICATION_STATUSES)}
            onChange={(event) => setField('publicationStatus', event.target.value)}
          />
          <Checkbox
            label="Marcar como destaque"
            checked={values.featured}
            onChange={(checked) => setField('featured', checked)}
          />
          <TextInput
            label="Titulo para buscadores"
            value={values.seoTitle}
            onChange={(event) => setField('seoTitle', event.target.value)}
          />
          <TextArea
            label="Descricao para buscadores"
            rows={2}
            value={values.seoDescription}
            onChange={(event) => setField('seoDescription', event.target.value)}
          />
        </section>
      </div>
    </Modal>
  );
}

/** Registros de evolucao da obra, com etapa, percentual e fotos. */
function ProjectUpdatesModal({
  project,
  onClose,
  onChanged,
}: {
  project: ProjectRecord;
  onClose: () => void;
  onChanged: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const detail = useResource(() => projectApi.detail(tenantId, project.id), [tenantId, project.id]);
  const form = useForm({
    title: '',
    note: '',
    stage: project.stage as string,
    progressPercent: '',
    recordedAt: new Date().toISOString().slice(0, 10),
    imageIds: [] as string[],
  });
  const [images, setImages] = useState<MediaRef[]>([]);

  const create = useMutation(
    () =>
      projectApi.addUpdate(tenantId, project.id, {
        title: form.values.title,
        note: form.values.note,
        stage: form.values.stage,
        progressPercent: numberOrNull(form.values.progressPercent),
        recordedAt: form.values.recordedAt || null,
        imageIds: form.values.imageIds,
      }),
    {
      onSuccess: () => {
        toast.success('Evolucao registrada');
        form.reset();
        setImages([]);
        detail.reload();
        onChanged();
      },
      onError: (error) => {
        form.applyApiError(error);
        if (Object.keys(error.fieldErrors).length === 0) toast.error('Nao foi possivel registrar', error.message);
      },
    },
  );

  const remove = useMutation((updateId: string) => projectApi.removeUpdate(tenantId, project.id, updateId), {
    onSuccess: () => {
      toast.success('Registro removido');
      detail.reload();
      onChanged();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Evolucao de ${project.title}`}
      description="Os registros aparecem na pagina publica da obra, em ordem cronologica."
      size="lg"
      footer={<Button onClick={onClose}>Fechar</Button>}
    >
      <div className="grid gap-6">
        {can('content:write') ? (
          <section className="grid gap-4 rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Novo registro</h3>
            <TextInput
              label="Titulo"
              required
              value={form.values.title}
              error={form.errors.title}
              placeholder="Concretagem do quinto pavimento"
              onChange={(event) => form.setField('title', event.target.value)}
            />
            <TextArea
              label="Observacao"
              rows={3}
              value={form.values.note}
              onChange={(event) => form.setField('note', event.target.value)}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                label="Etapa"
                value={form.values.stage}
                options={toOptions(labels.projectStage, PROJECT_STAGES)}
                onChange={(event) => form.setField('stage', event.target.value)}
              />
              <TextInput
                label="Percentual"
                inputMode="numeric"
                value={form.values.progressPercent}
                hint="Opcional."
                onChange={(event) => form.setField('progressPercent', event.target.value)}
              />
              <TextInput
                label="Data"
                type="date"
                value={form.values.recordedAt}
                onChange={(event) => form.setField('recordedAt', event.target.value)}
              />
            </div>
            <GalleryField
              label="Fotos deste registro"
              value={form.values.imageIds}
              previews={images}
              onChange={(ids, assets) => {
                form.setField('imageIds', ids);
                if (assets) {
                  setImages((current) => [
                    ...current,
                    ...assets.map((asset) => ({
                      id: asset.id,
                      url: asset.blobUrl,
                      alt: asset.alt,
                      width: asset.width,
                      height: asset.height,
                    })),
                  ]);
                }
              }}
            />
            <Button loading={create.loading} onClick={() => void create.run(undefined)}>
              Registrar evolucao
            </Button>
          </section>
        ) : null}

        <section className="grid gap-3">
          <h3 className="text-sm font-semibold text-slate-800">Historico</h3>
          <ResourcePanel resource={detail}>
            {(data) =>
              data.updates.length === 0 ? (
                <Alert tone="info">Nenhum registro de evolucao ainda.</Alert>
              ) : (
                <ul className="grid gap-2">
                  {data.updates.map((update) => (
                    <li key={update.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">{update.title}</p>
                          <p className="text-xs text-slate-500">
                            {update.recordedAt ? formatIsoDate(update.recordedAt, 'long') : 'Sem data'}
                            {update.stage ? ` - ${labels.projectStage[update.stage]}` : ''}
                            {update.progressPercent !== null ? ` - ${update.progressPercent}%` : ''}
                          </p>
                        </div>
                        {can('content:delete') ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remover ${update.title}`}
                            onClick={() => void remove.run(update.id)}
                          >
                            <Trash2 aria-hidden="true" className="size-3.5 text-rose-600" />
                          </Button>
                        ) : null}
                      </div>
                      {update.note ? <p className="mt-1.5 text-sm text-slate-600">{update.note}</p> : null}
                      {update.images.length > 0 ? (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {update.images.map((image) => (
                            <li key={image.id} className="size-14 overflow-hidden rounded bg-slate-100">
                              <img src={image.url} alt={image.alt} className="size-full object-cover" loading="lazy" />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )
            }
          </ResourcePanel>
        </section>
      </div>
    </Modal>
  );
}
