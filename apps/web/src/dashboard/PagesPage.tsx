import { useState } from 'react';
import { Link } from 'react-router-dom';
import { History, Pencil, Plus, Rocket, Trash2 } from 'lucide-react';
import { formatDateTime, relativeTime, slugify } from '@codeca/shared';
import {
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
  Switch,
  TextInput,
  useToast,
  type Column,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { pageApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { Can } from '../components/Guards.js';
import { labels, publicationTone } from '../utils/labels.js';
import type { PageSummary, PageVersionSummary } from '../types/index.js';
import { useForm } from '../utils/forms.js';

/**
 * Paginas do site.
 *
 * Mostra claramente a diferenca entre o rascunho em edicao e a versao no ar:
 * salvar nao publica, e publicar cria uma nova versao no historico.
 */
export function PagesPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const pages = useResource(() => pageApi.list(tenantId), [tenantId]);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<PageSummary | null>(null);
  const [versionsOf, setVersionsOf] = useState<PageSummary | null>(null);

  const createForm = useForm({ title: '', slug: '', showInNavigation: true });

  const create = useMutation(
    (input: { title: string; slug: string; showInNavigation: boolean }) => pageApi.create(tenantId, input),
    {
      onSuccess: () => {
        toast.success('Pagina criada', 'Abra o editor para montar o conteudo.');
        setCreating(false);
        createForm.reset();
        pages.reload();
      },
      onError: (error) => {
        createForm.applyApiError(error);
        if (error.isPlanLimit) toast.error('Limite do plano alcancado', error.message);
      },
    },
  );

  const publish = useMutation((pageId: string) => pageApi.publish(tenantId, pageId), {
    onSuccess: (result) => {
      toast.success('Pagina publicada', `Versao ${result.version} esta no ar.`);
      pages.reload();
    },
    onError: (error) => toast.error('Nao foi possivel publicar', error.message),
  });

  const remove = useMutation((pageId: string) => pageApi.remove(tenantId, pageId), {
    onSuccess: () => {
      toast.success('Pagina excluida');
      setRemoving(null);
      pages.reload();
    },
    onError: (error) => toast.error('Nao foi possivel excluir', error.message),
  });

  const columns: Array<Column<PageSummary>> = [
    {
      key: 'title',
      header: 'Pagina',
      render: (page) => (
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-slate-900">
            {page.title}
            {page.isHome ? <Badge tone="brand">Inicial</Badge> : null}
          </p>
          <p className="text-xs text-slate-500">/{page.isHome ? '' : page.slug}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Situacao',
      render: (page) => (
        <div className="grid gap-1">
          <Badge tone={publicationTone(page.status)}>{labels.publication[page.status]}</Badge>
          {page.publishedVersionId && page.draftUpdatedAt > (page.publishedAt ?? '') ? (
            <span className="text-xs text-amber-700">Rascunho com alteracoes nao publicadas</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'published',
      header: 'Ultima publicacao',
      hideOnMobile: true,
      render: (page) =>
        page.publishedAt ? (
          <span className="text-xs text-slate-600">{formatDateTime(page.publishedAt)}</span>
        ) : (
          <span className="text-xs text-slate-400">Nunca publicada</span>
        ),
    },
    {
      key: 'draft',
      header: 'Rascunho salvo',
      hideOnMobile: true,
      render: (page) => <span className="text-xs text-slate-600">{relativeTime(page.draftUpdatedAt)}</span>,
    },
    {
      key: 'actions',
      header: 'Acoes',
      align: 'right',
      render: (page) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Can capability="site:edit">
            <Link to={`/painel/editor?pagina=${page.id}`}>
              <Button variant="outline" size="sm" icon={<Pencil aria-hidden="true" className="size-3.5" />}>
                Editar
              </Button>
            </Link>
          </Can>
          <Can capability="site:read">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVersionsOf(page)}
              icon={<History aria-hidden="true" className="size-3.5" />}
            >
              Versoes
            </Button>
          </Can>
          <Can capability="site:publish">
            <Button
              variant="ghost"
              size="sm"
              loading={publish.loading}
              onClick={() => void publish.run(page.id)}
              icon={<Rocket aria-hidden="true" className="size-3.5" />}
            >
              Publicar
            </Button>
          </Can>
          {!page.isHome ? (
            <Can capability="site:edit">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRemoving(page)}
                aria-label={`Excluir ${page.title}`}
              >
                <Trash2 aria-hidden="true" className="size-3.5 text-rose-600" />
              </Button>
            </Can>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Paginas"
        description="Cada pagina tem um rascunho em edicao e uma versao publicada. O site publico mostra apenas a versao publicada."
        actions={
          can('site:edit') ? (
            <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setCreating(true)}>
              Nova pagina
            </Button>
          ) : undefined
        }
      />

      <Card>
        <ResourcePanel resource={pages}>
          {(data) => (
            <DataTable
              columns={columns}
              rows={data.pages}
              rowKey={(page) => page.id}
              caption="Paginas do site"
              empty={
                <CardBody>
                  <EmptyState title="Nenhuma pagina" description="Crie a primeira pagina do site." />
                </CardBody>
              }
            />
          )}
        </ResourcePanel>
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nova pagina"
        description="O endereco faz parte da URL publica do site."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button
              loading={create.loading}
              onClick={() =>
                void create.run({
                  title: createForm.values.title,
                  slug: createForm.values.slug || slugify(createForm.values.title),
                  showInNavigation: createForm.values.showInNavigation,
                })
              }
            >
              Criar pagina
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <TextInput
            label="Titulo"
            required
            value={createForm.values.title}
            error={createForm.errors.title}
            onChange={(event) => createForm.setField('title', event.target.value)}
          />
          <TextInput
            label="Endereco"
            required
            value={createForm.values.slug}
            error={createForm.errors.slug}
            placeholder={slugify(createForm.values.title) || 'sobre-nos'}
            hint="Enderecos reservados pela plataforma, como /imoveis e /obras, nao podem ser usados."
            onChange={(event) => createForm.setField('slug', slugify(event.target.value))}
          />
          <Switch
            label="Mostrar no menu de navegacao"
            checked={createForm.values.showInNavigation}
            onChange={(checked) => createForm.setField('showInNavigation', checked)}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Excluir pagina"
        message={
          <>
            A pagina <strong>{removing?.title}</strong> e todo o historico de versoes dela serao excluidos.
            Esta acao nao pode ser desfeita.
          </>
        }
        confirmLabel="Excluir pagina"
        loading={remove.loading}
        onConfirm={() => removing && void remove.run(removing.id)}
        onCancel={() => setRemoving(null)}
      />

      {versionsOf ? (
        <VersionsModal page={versionsOf} onClose={() => setVersionsOf(null)} onRestored={() => pages.reload()} />
      ) : null}
    </div>
  );
}

/** Historico de versoes publicadas com opcao de restaurar. */
function VersionsModal({
  page,
  onClose,
  onRestored,
}: {
  page: PageSummary;
  onClose: () => void;
  onRestored: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const versions = useResource(() => pageApi.versions(tenantId, page.id), [tenantId, page.id]);

  const restore = useMutation(
    (input: { versionId: string; publish: boolean }) =>
      pageApi.restore(tenantId, page.id, input.versionId, input.publish),
    {
      onSuccess: (_result, input) => {
        toast.success(
          input.publish ? 'Versao restaurada e publicada' : 'Versao restaurada como rascunho',
          input.publish ? undefined : 'Abra o editor para revisar antes de publicar.',
        );
        onRestored();
        onClose();
      },
      onError: (error) => toast.error('Nao foi possivel restaurar', error.message),
    },
  );

  const columns: Array<Column<PageVersionSummary>> = [
    { key: 'version', header: 'Versao', render: (row) => <span className="tabular-nums">#{row.version}</span> },
    { key: 'date', header: 'Publicada em', render: (row) => formatDateTime(row.createdAt) },
    {
      key: 'author',
      header: 'Por',
      hideOnMobile: true,
      render: (row) => row.authorName ?? row.authorEmail ?? 'Conta removida',
    },
    { key: 'note', header: 'Observacao', hideOnMobile: true, render: (row) => row.note || '-' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        can('site:restore') ? (
          <div className="flex justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              loading={restore.loading}
              onClick={() => void restore.run({ versionId: row.id, publish: false })}
            >
              Restaurar
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={restore.loading}
              onClick={() => void restore.run({ versionId: row.id, publish: true })}
            >
              Restaurar e publicar
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Historico de ${page.title}`}
      size="xl"
      footer={<Button onClick={onClose}>Fechar</Button>}
    >
      <ResourcePanel resource={versions}>
        {(data) => (
          <div className="grid gap-4">
            {!data.historyEnabled ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                O plano {data.planName} guarda apenas a versao atual. Atualize o plano para manter o historico
                completo e restaurar versoes anteriores.
              </p>
            ) : null}
            <DataTable
              columns={columns}
              rows={data.versions}
              rowKey={(row) => row.id}
              caption="Versoes publicadas"
              empty={<EmptyState title="Nenhuma versao publicada" />}
            />
          </div>
        )}
      </ResourcePanel>
    </Modal>
  );
}
