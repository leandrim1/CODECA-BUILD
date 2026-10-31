import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { PUBLICATION_STATUSES } from '@codeca/shared';
import {
  Alert,
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
import { Can } from '../components/Guards.js';
import { useForm } from '../utils/forms.js';
import { labels, publicationTone, toOptions } from '../utils/labels.js';
import type { CategoryRecord } from '../types/index.js';

/**
 * Categorias de produto.
 *
 * Planas, sem subcategoria: o caso que motivou o modulo -- o cardapio -- e
 * plano, e aninhamento traria ciclo, profundidade e arvore na tela.
 *
 * Remover uma categoria **nao apaga produto**: ele fica sem agrupamento. A
 * tela diz quantos antes de confirmar, porque e a pergunta que quem clica faz.
 */
export function CategoriesPage() {
  const tenantId = useTenantId();
  const [editando, setEditando] = useState<CategoryRecord | 'nova' | null>(null);
  const [removendo, setRemovendo] = useState<CategoryRecord | null>(null);
  const toast = useToast();
  const categorias = useResource(() => catalogApi.categories(tenantId), [tenantId]);

  const remover = useMutation((id: string) => catalogApi.removeCategory(tenantId, id), {
    onSuccess: () => {
      toast.success('Categoria removida');
      setRemovendo(null);
      categorias.reload();
    },
    onError: (error) => toast.error('Nao foi possivel remover', error.message),
  });

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Categorias"
        description="Como os seus produtos ficam agrupados no site."
        actions={
          <Can capability="content:write">
            <Button
              icon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setEditando('nova')}
            >
              Nova categoria
            </Button>
          </Can>
        }
      />

      <ResourcePanel resource={categorias}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              title="Nenhuma categoria cadastrada"
              description="Sem categorias os produtos aparecem em uma lista unica. Ex.: Entradas, Pratos, Sobremesas."
              action={
                <Can capability="content:write">
                  <Button onClick={() => setEditando('nova')}>Criar a primeira</Button>
                </Can>
              }
            />
          ) : (
            <div className="grid gap-3">
              {data.items.map((categoria) => (
                <Card key={categoria.id}>
                  <CardBody className="flex flex-wrap items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-900">{categoria.name}</p>
                        <Badge tone={publicationTone(categoria.publicationStatus)}>
                          {labels.publication[categoria.publicationStatus]}
                        </Badge>
                        <Badge tone="neutral">
                          {categoria.productCount} produto(s)
                        </Badge>
                        <Badge tone="neutral">ordem {categoria.sortOrder}</Badge>
                      </div>
                      {categoria.description ? (
                        <p className="mt-1 text-sm text-slate-600">{categoria.description}</p>
                      ) : null}
                    </div>

                    <Can capability="content:write">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditando(categoria)}>
                          <Pencil aria-hidden="true" className="size-4" />
                          <span className="sr-only">Editar</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemovendo(categoria)}>
                          <Trash2 aria-hidden="true" className="size-4" />
                          <span className="sr-only">Remover</span>
                        </Button>
                      </div>
                    </Can>
                  </CardBody>
                </Card>
              ))}
            </div>
          )
        }
      </ResourcePanel>

      {editando ? (
        <FormularioCategoria
          categoria={editando === 'nova' ? null : editando}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            categorias.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removendo !== null}
        title="Remover esta categoria?"
        message={
          removendo && removendo.productCount > 0
            ? `${removendo.productCount} produto(s) usam esta categoria. Nenhum sera apagado: eles ficam sem agrupamento, e voce pode escolher outra categoria depois.`
            : 'Nenhum produto usa esta categoria.'
        }
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

function FormularioCategoria({
  categoria,
  onClose,
  onSaved,
}: {
  categoria: CategoryRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const politica = useModulePolicy('categorias');

  const { values, errors, setField, applyApiError } = useForm({
    name: categoria?.name ?? '',
    description: categoria?.description ?? '',
    publicationStatus: categoria?.publicationStatus ?? 'published',
    sortOrder: String(categoria?.sortOrder ?? 0),
  });

  const salvar = useMutation(
    () => {
      const corpo = {
        name: values.name,
        description: values.description,
        publicationStatus: values.publicationStatus,
        sortOrder: Number(values.sortOrder) || 0,
      };
      return categoria
        ? catalogApi.updateCategory(tenantId, categoria.id, politica.semTravados(corpo))
        : catalogApi.createCategory(tenantId, politica.semTravados(corpo));
    },
    {
      onSuccess: () => {
        toast.success(categoria ? 'Categoria atualizada' : 'Categoria criada');
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
      title={categoria ? `Editar ${categoria.name}` : 'Nova categoria'}
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
        {categoria ? (
          <Alert tone="info" title="O endereco na URL nao muda">
            Ele pode estar em links divulgados e na indexacao do Google. Para usar outro, crie uma
            categoria nova.
          </Alert>
        ) : null}

        <TextInput
          label="Nome"
          required
          value={values.name}
          error={errors.name}
          readOnly={!politica.editavel('name')}
          onChange={(event) => setField('name', event.target.value)}
        />

        <TextArea
          label="Descricao"
          rows={2}
          value={values.description}
          error={errors.description}
          readOnly={!politica.editavel('description')}
          onChange={(event) => setField('description', event.target.value)}
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
