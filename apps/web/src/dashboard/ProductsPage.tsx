import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { PUBLICATION_STATUSES, formatPrice } from '@codeca/shared';
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
  Switch,
  TextArea,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useTenantId } from '../hooks/useAuth.js';
import { useModulePolicy, useSiteModules } from '../hooks/useSiteModules.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { catalogApi } from '../services/endpoints.js';
import {
  CamposPersonalizados,
  useCamposPersonalizados,
} from '../components/CustomFields.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { GalleryField, ImageField } from '../components/MediaPicker.js';
import { Can } from '../components/Guards.js';
import { useForm } from '../utils/forms.js';
import { labels, publicationTone, toOptions } from '../utils/labels.js';
import type { CategoryRecord, ProductRecord } from '../types/index.js';

/**
 * Catalogo da empresa: produtos, cardapio ou lista de itens.
 *
 * `isAvailable` e separado de `publicationStatus` de proposito: "acabou hoje"
 * nao e a mesma coisa que "nao esta mais no catalogo". Um prato esgotado
 * continua no site, marcado -- despublicar e esconder faria o cliente ter de
 * recadastrar amanha.
 */
export function ProductsPage() {
  const tenantId = useTenantId();
  const { enabled } = useSiteModules();
  const [editando, setEditando] = useState<ProductRecord | 'novo' | null>(null);
  const [removendo, setRemovendo] = useState<ProductRecord | null>(null);
  const [categoria, setCategoria] = useState('');
  const toast = useToast();

  const produtos = useResource(
    () => catalogApi.products(tenantId, { pageSize: 100, categoryId: categoria || undefined }),
    [tenantId, categoria],
  );
  // Sem o modulo de categorias nao ha o que filtrar nem onde escolher.
  const categorias = useResource(() => catalogApi.categories(tenantId), [tenantId], {
    enabled: enabled('categorias'),
  });

  const remover = useMutation((id: string) => catalogApi.removeProduct(tenantId, id), {
    onSuccess: () => {
      toast.success('Produto removido');
      setRemovendo(null);
      produtos.reload();
    },
    onError: (error) => toast.error('Nao foi possivel remover', error.message),
  });

  const lista = categorias.data?.items ?? [];

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Produtos"
        description="O que a sua empresa oferece. A ordem define a sequencia no site."
        actions={
          <Can capability="content:write">
            <Button
              icon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setEditando('novo')}
            >
              Novo produto
            </Button>
          </Can>
        }
      />

      {lista.length > 0 ? (
        <Select
          label="Filtrar por categoria"
          value={categoria}
          onChange={(event) => setCategoria(event.target.value)}
          options={[
            { value: '', label: 'Todas as categorias' },
            ...lista.map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
      ) : null}

      <ResourcePanel resource={produtos}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState
              title="Nenhum produto cadastrado"
              description="Um produto tem nome, preco e imagem. O preco pode ficar sob consulta."
              action={
                <Can capability="content:write">
                  <Button onClick={() => setEditando('novo')}>Criar o primeiro</Button>
                </Can>
              }
            />
          ) : (
            <div className="grid gap-3">
              {data.items.map((produto) => (
                <Card key={produto.id}>
                  <CardBody className="flex flex-wrap items-start gap-4">
                    {produto.cover?.url ? (
                      <img
                        src={produto.cover.url}
                        alt={produto.cover.alt || produto.title}
                        className="h-20 w-20 flex-none rounded-lg object-cover"
                      />
                    ) : (
                      <div className="grid h-20 w-20 flex-none place-items-center rounded-lg bg-slate-100 text-xs text-slate-500">
                        sem foto
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-900">{produto.title}</p>
                        <Badge tone={publicationTone(produto.publicationStatus)}>
                          {labels.publication[produto.publicationStatus]}
                        </Badge>
                        {produto.isAvailable ? null : <Badge tone="warning">esgotado</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-slate-700">
                        {formatPrice(produto.price, produto.currency, produto.priceOnRequest)}
                        {produto.unit && !produto.priceOnRequest ? ` / ${produto.unit}` : ''}
                      </p>
                      {produto.summary ? (
                        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{produto.summary}</p>
                      ) : null}
                      {produto.code ? (
                        <p className="mt-1 text-xs text-slate-500">Codigo: {produto.code}</p>
                      ) : null}
                    </div>

                    <Can capability="content:write">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditando(produto)}>
                          <Pencil aria-hidden="true" className="size-4" />
                          <span className="sr-only">Editar</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemovendo(produto)}>
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
        <FormularioProduto
          produto={editando === 'novo' ? null : editando}
          categorias={lista}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            produtos.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removendo !== null}
        title="Remover este produto?"
        message="Ele sai do seu site. As imagens continuam na Biblioteca de imagens."
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

function FormularioProduto({
  produto,
  categorias,
  onClose,
  onSaved,
}: {
  produto: ProductRecord | null;
  categorias: CategoryRecord[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const politica = useModulePolicy('produtos');
  const personalizados = useCamposPersonalizados('produtos', produto?.customFields);

  const { values, errors, setField, applyApiError } = useForm({
    title: produto?.title ?? '',
    summary: produto?.summary ?? '',
    description: produto?.description ?? '',
    code: produto?.code ?? '',
    categoryId: produto?.categoryId ?? '',
    // Texto no formulario, numero no corpo: um campo numerico vazio vira
    // `NaN` e enviaria valor invalido sem o cliente perceber.
    price: produto?.price !== null && produto?.price !== undefined ? String(produto.price) : '',
    priceOnRequest: produto?.priceOnRequest ?? false,
    unit: produto?.unit ?? '',
    isAvailable: produto?.isAvailable ?? true,
    coverImageId: produto?.coverImageId ?? null,
    galleryImageIds: produto?.gallery.map((img) => img.id) ?? [],
    publicationStatus: produto?.publicationStatus ?? 'draft',
    sortOrder: String(produto?.sortOrder ?? 0),
    seoTitle: produto?.seoTitle ?? '',
    seoDescription: produto?.seoDescription ?? '',
  });

  const salvar = useMutation(
    () => {
      const extras = personalizados.paraApi();
      const corpo = {
        ...(extras ? { customFields: extras } : {}),
        title: values.title,
        summary: values.summary,
        description: values.description,
        code: values.code,
        categoryId: values.categoryId === '' ? null : values.categoryId,
        price: values.price.trim() === '' ? null : Number(values.price.replace(',', '.')),
        priceOnRequest: values.priceOnRequest,
        unit: values.unit,
        isAvailable: values.isAvailable,
        coverImageId: values.coverImageId,
        galleryImageIds: values.galleryImageIds,
        publicationStatus: values.publicationStatus,
        sortOrder: Number(values.sortOrder) || 0,
        seoTitle: values.seoTitle,
        seoDescription: values.seoDescription,
      };
      // `semTravados` tira o que este site nao deixa o cliente definir: sem
      // isso o formulario reenviaria o campo travado e levaria 403.
      return produto
        ? catalogApi.updateProduct(tenantId, produto.id, politica.semTravados(corpo))
        : catalogApi.createProduct(tenantId, politica.semTravados(corpo));
    },
    {
      onSuccess: () => {
        toast.success(produto ? 'Produto atualizado' : 'Produto criado');
        onSaved();
      },
      onError: (error) => {
        applyApiError(error);
        toast.error('Nao foi possivel salvar', error.message);
      },
    },
  );

  const travado = (fieldKey: string) => !politica.editavel(fieldKey);
  const dica = (fieldKey: string) => politica.travaExplicada(fieldKey) ?? undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title={produto ? `Editar ${produto.title}` : 'Novo produto'}
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
          label="Nome"
          required
          value={values.title}
          error={errors.title}
          readOnly={travado('title')}
          {...(dica('title') ? { hint: dica('title') } : {})}
          onChange={(event) => setField('title', event.target.value)}
        />

        <TextArea
          label="Resumo"
          rows={2}
          hint="Uma linha que aparece na listagem."
          value={values.summary}
          error={errors.summary}
          readOnly={travado('summary')}
          onChange={(event) => setField('summary', event.target.value)}
        />

        <TextArea
          label="Descricao"
          rows={4}
          value={values.description}
          error={errors.description}
          readOnly={travado('description')}
          onChange={(event) => setField('description', event.target.value)}
        />

        {categorias.length > 0 ? (
          <Select
            label="Categoria"
            value={values.categoryId}
            error={errors.categoryId}
            disabled={travado('categoryId')}
            onChange={(event) => setField('categoryId', event.target.value)}
            options={[
              { value: '', label: 'Sem categoria' },
              ...categorias.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="Preco"
            inputMode="decimal"
            placeholder="0,00"
            value={values.price}
            error={errors.price}
            readOnly={travado('price') || values.priceOnRequest}
            {...(values.priceOnRequest ? { hint: 'Desmarque "sob consulta" para informar.' } : {})}
            onChange={(event) => setField('price', event.target.value)}
          />
          <TextInput
            label="Unidade"
            placeholder="un, kg, porcao"
            value={values.unit}
            error={errors.unit}
            readOnly={travado('unit')}
            onChange={(event) => setField('unit', event.target.value)}
          />
        </div>

        <Switch
          label="Preco sob consulta"
          hint="O site mostra 'sob consulta' em vez do valor."
          checked={values.priceOnRequest}
          onChange={(checked) => setField('priceOnRequest', checked)}
        />

        <Switch
          label="Disponivel"
          hint="Desmarque quando acabar. O produto continua no site, marcado como esgotado."
          checked={values.isAvailable}
          onChange={(checked) => setField('isAvailable', checked)}
        />

        <TextInput
          label="Codigo interno"
          hint="SKU ou referencia. Opcional."
          value={values.code}
          error={errors.code}
          readOnly={travado('code')}
          onChange={(event) => setField('code', event.target.value)}
        />

        <ImageField
          label="Imagem principal"
          value={values.coverImageId}
          preview={produto?.cover ?? null}
          onChange={(id) => setField('coverImageId', id)}
        />

        <GalleryField
          label="Mais imagens"
          value={values.galleryImageIds}
          previews={produto?.gallery ?? []}
          onChange={(ids) => setField('galleryImageIds', ids)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Publicacao"
            value={values.publicationStatus}
            onChange={(event) => setField('publicationStatus', event.target.value as typeof values.publicationStatus)}
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

        <CamposPersonalizados
          moduleKey="produtos"
          values={personalizados.valores}
          onChange={personalizados.definir}
          errors={errors}
        />
      </div>
    </Modal>
  );
}
