import { useState } from 'react';
import { Filter, Trash2 } from 'lucide-react';
import { formatBytes, formatDateTime } from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Meter,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Switch,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useDebounced, useMutation, useResource } from '../hooks/useResource.js';
import { mediaApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { MediaThumb, UploadButton } from '../components/MediaPicker.js';
import type { MediaAssetRecord } from '../types/index.js';

/**
 * Biblioteca de imagens.
 *
 * Mostra tamanho, tipo e uso de cada arquivo. A exclusao e bloqueada enquanto
 * houver conteudo apontando para o arquivo, e a tela indica exatamente onde ele
 * esta sendo usado -- evitando imagens quebradas no site.
 */
export function MediaPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();

  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const [editing, setEditing] = useState<MediaAssetRecord | null>(null);
  const [removing, setRemoving] = useState<MediaAssetRecord | null>(null);
  const [removeBlockedBy, setRemoveBlockedBy] = useState<string[] | null>(null);

  const usage = useResource(() => mediaApi.usage(tenantId), [tenantId]);
  const list = useResource(
    () =>
      mediaApi.list(tenantId, {
        page,
        pageSize: 36,
        ...(debounced ? { search: debounced } : {}),
        ...(tag ? { tag } : {}),
        ...(unusedOnly ? { unusedOnly: true } : {}),
      }),
    [tenantId, page, debounced, tag, unusedOnly],
  );

  const update = useMutation(
    (input: { id: string; alt: string; title: string; tag: string }) =>
      mediaApi.update(tenantId, input.id, { alt: input.alt, title: input.title, tag: input.tag }),
    {
      onSuccess: () => {
        toast.success('Arquivo atualizado');
        setEditing(null);
        list.reload();
      },
      onError: (error) => toast.error('Nao foi possivel salvar', error.message),
    },
  );

  const remove = useMutation((id: string) => mediaApi.remove(tenantId, id), {
    onSuccess: () => {
      toast.success('Arquivo removido');
      setRemoving(null);
      list.reload();
      usage.reload();
    },
    onError: (error) => {
      const description = (error.details as { usage?: unknown } | undefined) ? error.message : error.message;
      toast.error('Nao foi possivel remover', description);
      setRemoving(null);
    },
  });

  async function confirmRemoval(asset: MediaAssetRecord) {
    try {
      const result = await mediaApi.assetUsage(tenantId, asset.id);
      setRemoveBlockedBy(result.usage.total > 0 ? result.description : null);
    } catch {
      setRemoveBlockedBy(null);
    }
    setRemoving(asset);
  }

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Biblioteca de imagens"
        description="Arquivos enviados ficam no armazenamento da plataforma e podem ser usados em qualquer conteudo da empresa."
        actions={
          can('media:upload') ? (
            <UploadButton
              label="Enviar arquivos"
              blobConfigured={usage.data?.blobConfigured ?? true}
              onUploaded={() => {
                list.reload();
                usage.reload();
                toast.success('Arquivo enviado');
              }}
            />
          ) : undefined
        }
      />

      {usage.data && !usage.data.blobConfigured ? (
        <Alert tone="warning" title="Armazenamento de arquivos nao configurado">
          O envio de imagens depende de um Blob store conectado ao projeto na Vercel, em
          <strong> Storage</strong>. Conectar define <code>BLOB_STORE_ID</code> sozinho; nenhuma
          variavel precisa ser criada a mao. Os demais recursos do painel seguem funcionando.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <Card>
          <CardHeader
            title="Arquivos"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-48">
                  <TextInput
                    label="Buscar"
                    className="[&>label]:sr-only"
                    placeholder="Buscar por nome"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <div className="w-40">
                  <Select
                    label="Etiqueta"
                    className="[&>label]:sr-only"
                    placeholder="Todas as etiquetas"
                    value={tag}
                    options={(list.data?.tags ?? []).map((item) => ({ value: item, label: item }))}
                    onChange={(event) => {
                      setTag(event.target.value);
                      setPage(1);
                    }}
                  />
                </div>
              </div>
            }
          />
          <CardBody className="grid gap-4">
            <Switch
              label="Mostrar apenas arquivos sem uso"
              hint="Arquivos que nenhum imovel, obra, servico ou pagina esta usando."
              checked={unusedOnly}
              onChange={(checked) => {
                setUnusedOnly(checked);
                setPage(1);
              }}
            />

            <ResourcePanel resource={list}>
              {(data) =>
                data.items.length === 0 ? (
                  <EmptyState
                    icon={<Filter aria-hidden="true" className="size-8" />}
                    title={unusedOnly ? 'Nenhum arquivo sem uso' : 'Nenhum arquivo ainda'}
                    description={
                      unusedOnly
                        ? 'Todos os arquivos da biblioteca estao sendo usados em algum conteudo.'
                        : 'Envie fotos de imoveis, obras e da empresa para usar nas paginas do site.'
                    }
                  />
                ) : (
                  <>
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {data.items.map((asset) => (
                        <li key={asset.id} className="overflow-hidden rounded-lg border border-slate-200">
                          <div className="aspect-4/3 bg-slate-50">
                            <MediaThumb asset={asset} />
                          </div>
                          <div className="grid gap-1.5 p-2.5">
                            <p className="truncate text-xs font-medium text-slate-800">{asset.fileName}</p>
                            <p className="text-[11px] text-slate-500">
                              {formatBytes(asset.sizeBytes)}
                              {asset.width && asset.height ? ` - ${asset.width}x${asset.height}` : ''}
                            </p>
                            <div className="flex flex-wrap items-center gap-1">
                              {asset.tag ? <Badge tone="neutral">{asset.tag}</Badge> : null}
                              {asset.alt ? null : <Badge tone="warning">sem texto alternativo</Badge>}
                            </div>
                            {can('media:upload') ? (
                              <div className="mt-1 flex gap-1">
                                <Button variant="outline" size="sm" onClick={() => setEditing(asset)}>
                                  Editar
                                </Button>
                                {can('media:delete') ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={`Remover ${asset.fileName}`}
                                    onClick={() => void confirmRemoval(asset)}
                                  >
                                    <Trash2 aria-hidden="true" className="size-3.5 text-rose-600" />
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <Pagination
                      page={data.page}
                      totalPages={data.totalPages}
                      total={data.total}
                      onChange={setPage}
                    />
                  </>
                )
              }
            </ResourcePanel>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Armazenamento" />
          <CardBody className="grid gap-4">
            <ResourcePanel resource={usage}>
              {(data) => (
                <>
                  <Meter
                    label="Uso do plano"
                    current={data.storageBytes}
                    limit={data.storageLimitBytes}
                    format={formatBytes}
                  />
                  <ul className="grid gap-1 text-xs text-slate-500">
                    <li>Limite por arquivo: {formatBytes(data.maxUploadBytes)}</li>
                    <li>Formatos aceitos: JPG, PNG, WEBP, AVIF, SVG, GIF e PDF</li>
                  </ul>
                  <p className="text-xs text-slate-500">
                    O texto alternativo descreve a imagem para leitores de tela e para os buscadores. Vale
                    preencher em todas as fotos de imoveis e obras.
                  </p>
                </>
              )}
            </ResourcePanel>
          </CardBody>
        </Card>
      </div>

      {editing ? (
        <EditAssetModal
          asset={editing}
          loading={update.loading}
          onClose={() => setEditing(null)}
          onSave={(values) => void update.run({ id: editing.id, ...values })}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title="Remover arquivo"
        message={
          removeBlockedBy && removeBlockedBy.length > 0 ? (
            <>
              <strong>{removing?.fileName}</strong> esta em uso em {removeBlockedBy.join(', ')}. Remova as
              referencias antes de excluir, para o site nao ficar com imagem quebrada.
            </>
          ) : (
            <>
              <strong>{removing?.fileName}</strong> sera removido da biblioteca e do armazenamento. Esta acao
              nao pode ser desfeita.
            </>
          )
        }
        confirmLabel="Remover"
        loading={remove.loading}
        onConfirm={() => removing && void remove.run(removing.id)}
        onCancel={() => {
          setRemoving(null);
          setRemoveBlockedBy(null);
        }}
      />
    </div>
  );
}

function EditAssetModal({
  asset,
  loading,
  onClose,
  onSave,
}: {
  asset: MediaAssetRecord;
  loading: boolean;
  onClose: () => void;
  onSave: (values: { alt: string; title: string; tag: string }) => void;
}) {
  const [alt, setAlt] = useState(asset.alt);
  const [title, setTitle] = useState(asset.title);
  const [tag, setTag] = useState(asset.tag);

  return (
    <Modal
      open
      onClose={onClose}
      title="Editar arquivo"
      description={asset.fileName}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={loading} onClick={() => onSave({ alt, title, tag })}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="aspect-video overflow-hidden rounded-lg bg-slate-50">
          <MediaThumb asset={asset} />
        </div>
        <TextInput
          label="Texto alternativo"
          value={alt}
          hint="Descreva a imagem em poucas palavras. Usado por leitores de tela e pelos buscadores."
          onChange={(event) => setAlt(event.target.value)}
        />
        <TextInput label="Titulo" value={title} onChange={(event) => setTitle(event.target.value)} />
        <TextInput
          label="Etiqueta"
          value={tag}
          hint="Agrupa imagens para usar no bloco de galeria, por exemplo: fachadas, plantas, obra-aurora."
          onChange={(event) => setTag(event.target.value)}
        />
        <dl className="grid grid-cols-2 gap-2 text-xs text-slate-500">
          <div>
            <dt className="font-medium text-slate-600">Tamanho</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-600">Tipo</dt>
            <dd>{asset.mimeType}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-600">Enviado em</dt>
            <dd>{formatDateTime(asset.createdAt)}</dd>
          </div>
          {asset.width && asset.height ? (
            <div>
              <dt className="font-medium text-slate-600">Dimensoes</dt>
              <dd>
                {asset.width} x {asset.height} px
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </Modal>
  );
}
