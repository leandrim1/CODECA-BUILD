import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { PUBLICATION_STATUSES } from '@codeca/shared';
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useTenantId } from '../hooks/useAuth.js';
import { useModulePolicy } from '../hooks/useSiteModules.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { catalogApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { GalleryField } from '../components/MediaPicker.js';
import { Can } from '../components/Guards.js';
import { useForm } from '../utils/forms.js';
import { labels, publicationTone, toOptions } from '../utils/labels.js';
import type { GalleryRecord } from '../types/index.js';

/**
 * Galerias: conjuntos de imagens com nome.
 *
 * A primeira imagem da ordem e a capa -- nao existe campo de capa separado,
 * que seria mais um estado a manter coerente com a lista.
 *
 * Apagar a galeria desfaz o conjunto, nao os arquivos: as imagens continuam na
 * Biblioteca, disponiveis para outros usos. A tela diz isso antes de
 * confirmar, porque a duvida de quem clica e justamente essa.
 */
export function GalleriesPage() {
  const tenantId = useTenantId();
  const [editando, setEditando] = useState<GalleryRecord | 'nova' | null>(null);
  const [removendo, setRemovendo] = useState<GalleryRecord | null>(null);
  const toast = useToast();
  const galerias = useResource(() => catalogApi.galleries(tenantId), [tenantId]);

  const remover = useMutation((id: string) => catalogApi.removeGallery(tenantId, id), {
    onSuccess: () => {
      toast.success('Galeria removida');
      setRemovendo(null);
      galerias.reload();
    },
    onError: (error) => toast.error('Nao foi possivel remover', error.message),
  });

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Galerias"
        description="Conjuntos de imagens com nome: estrutura, antes e depois, eventos."
        actions={
          <Can capability="content:write">
            <Button
              icon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setEditando('nova')}
            >
              Nova galeria
            </Button>
          </Can>
        }
      />

      <ResourcePanel resource={galerias}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              title="Nenhuma galeria cadastrada"
              description="Uma galeria agrupa imagens que a sua empresa quer mostrar juntas."
              action={
                <Can capability="content:write">
                  <Button onClick={() => setEditando('nova')}>Criar a primeira</Button>
                </Can>
              }
            />
          ) : (
            <div className="grid gap-3">
              {data.items.map((galeria) => (
                <Card key={galeria.id}>
                  <CardBody className="grid gap-3">
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-900">{galeria.title}</p>
                          <Badge tone={publicationTone(galeria.publicationStatus)}>
                            {labels.publication[galeria.publicationStatus]}
                          </Badge>
                          <Badge tone="neutral">{galeria.images.length} imagem(ns)</Badge>
                        </div>
                        {galeria.description ? (
                          <p className="mt-1 text-sm text-slate-600">{galeria.description}</p>
                        ) : null}
                      </div>

                      <Can capability="content:write">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditando(galeria)}>
                            <Pencil aria-hidden="true" className="size-4" />
                            <span className="sr-only">Editar</span>
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setRemovendo(galeria)}>
                            <Trash2 aria-hidden="true" className="size-4" />
                            <span className="sr-only">Remover</span>
                          </Button>
                        </div>
                      </Can>
                    </div>

                    {galeria.images.length > 0 ? (
                      <ul className="flex flex-wrap gap-2">
                        {galeria.images.slice(0, 8).map((imagem, indice) => (
                          <li key={imagem.id} className="relative">
                            <img
                              src={imagem.url}
                              alt={imagem.alt || galeria.title}
                              className="h-16 w-16 rounded-lg object-cover"
                            />
                            {indice === 0 ? (
                              <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-slate-900/70 text-center text-[10px] text-white">
                                capa
                              </span>
                            ) : null}
                          </li>
                        ))}
                        {galeria.images.length > 8 ? (
                          <li className="grid h-16 w-16 place-items-center rounded-lg bg-slate-100 text-xs text-slate-500">
                            +{galeria.images.length - 8}
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </CardBody>
                </Card>
              ))}
            </div>
          )
        }
      </ResourcePanel>

      {editando ? (
        <FormularioGaleria
          galeria={editando === 'nova' ? null : editando}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            galerias.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removendo !== null}
        title="Remover esta galeria?"
        message="O conjunto deixa de existir no site. As imagens continuam na Biblioteca de imagens, disponiveis para outros usos."
        confirmLabel="Remover"
        tone="danger"
        loading={remover.loading}
        onCancel={() => setRemovendo(null)}
        onConfirm={() => {
          if (removendo) void remover.run(removendo.id);
        }}
      />
    </div>
  );
}

function FormularioGaleria({
  galeria,
  onClose,
  onSaved,
}: {
  galeria: GalleryRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const politica = useModulePolicy('galerias');

  const { values, errors, setField, applyApiError } = useForm({
    title: galeria?.title ?? '',
    description: galeria?.description ?? '',
    imageIds: galeria?.images.map((img) => img.id) ?? [],
    publicationStatus: galeria?.publicationStatus ?? 'published',
    sortOrder: String(galeria?.sortOrder ?? 0),
  });

  const salvar = useMutation(
    () => {
      const corpo = {
        title: values.title,
        description: values.description,
        imageIds: values.imageIds,
        publicationStatus: values.publicationStatus,
        sortOrder: Number(values.sortOrder) || 0,
      };
      return galeria
        ? catalogApi.updateGallery(tenantId, galeria.id, politica.semTravados(corpo))
        : catalogApi.createGallery(tenantId, politica.semTravados(corpo));
    },
    {
      onSuccess: () => {
        toast.success(galeria ? 'Galeria atualizada' : 'Galeria criada');
        onSaved();
      },
      onError: (error) => {
        applyApiError(error);
        toast.error('Nao foi possivel salvar', error.message);
      },
    },
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={galeria ? `Editar ${galeria.title}` : 'Nova galeria'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar.run(undefined)} disabled={salvar.loading}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextInput
          label="Nome da galeria"
          required
          value={values.title}
          error={errors.title}
          readOnly={!politica.editavel('title')}
          onChange={(event) => setField('title', event.target.value)}
        />

        <TextArea
          label="Descricao"
          rows={2}
          value={values.description}
          error={errors.description}
          readOnly={!politica.editavel('description')}
          onChange={(event) => setField('description', event.target.value)}
        />

        <GalleryField
          label="Imagens"
          hint="A primeira da ordem e a capa."
          value={values.imageIds}
          previews={galeria?.images ?? []}
          onChange={(ids) => setField('imageIds', ids)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Publicacao"
            value={values.publicationStatus}
            onChange={(event) =>
              setField('publicationStatus', event.target.value as typeof values.publicationStatus)
            }
            options={toOptions(labels.publication, PUBLICATION_STATUSES)}
          />
          <TextInput
            label="Ordem"
            inputMode="numeric"
            value={values.sortOrder}
            error={errors.sortOrder}
            onChange={(event) => setField('sortOrder', event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
