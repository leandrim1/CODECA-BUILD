import { useRef, useState } from 'react';
import { ImagePlus, Trash2, Upload, X } from 'lucide-react';
import { MAX_UPLOAD_BYTES, formatBytes } from '@codeca/shared';
import { Alert, Badge, Button, Modal, Spinner, TextInput, cx, useToast } from '@codeca/ui';
import { useTenantId } from '../hooks/useAuth.js';
import { useDebounced, useResource } from '../hooks/useResource.js';
import { mediaApi } from '../services/endpoints.js';
import type { MediaAssetRecord, MediaRef } from '../types/index.js';

/**
 * Seletor de imagens da biblioteca da empresa.
 *
 * O envio passa pela API, que confere sessao, empresa, tipo, tamanho e limite
 * de armazenamento antes de gravar no Vercel Blob. O navegador nunca recebe o
 * token de escrita.
 */

export function useMediaLibrary(options: { kind?: 'image' | 'document' } = {}) {
  const tenantId = useTenantId();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);

  const resource = useResource(
    () =>
      mediaApi.list(tenantId, {
        pageSize: 60,
        ...(debounced ? { search: debounced } : {}),
        ...(options.kind ? { kind: options.kind } : {}),
      }),
    [tenantId, debounced, options.kind],
  );

  const usage = useResource(() => mediaApi.usage(tenantId), [tenantId]);

  return { resource, usage, search, setSearch, tenantId };
}

export interface UploadResult {
  asset: MediaAssetRecord;
}

/** Campo de envio de arquivo com validacao previa no navegador. */
export function UploadButton({
  onUploaded,
  label = 'Enviar imagem',
  tag = '',
  disabled = false,
  blobConfigured = true,
}: {
  onUploaded: (asset: MediaAssetRecord) => void;
  label?: string;
  tag?: string;
  disabled?: boolean;
  blobConfigured?: boolean;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);

    for (const file of Array.from(files)) {
      // Checagem local apenas para dar retorno rapido; o servidor decide.
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(
          `${file.name} e grande demais`,
          `O limite por arquivo e ${formatBytes(MAX_UPLOAD_BYTES)}.`,
        );
        continue;
      }

      const dimensions = await readImageSize(file);
      const form = new FormData();
      form.set('file', file);
      if (tag) form.set('tag', tag);
      if (dimensions) {
        form.set('width', String(dimensions.width));
        form.set('height', String(dimensions.height));
      }

      try {
        const result = await mediaApi.upload(tenantId, form);
        onUploaded(result.asset);
      } catch (error) {
        toast.error('Falha ao enviar', error instanceof Error ? error.message : 'Tente novamente.');
      }
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  if (!blobConfigured) {
    return (
      <Alert tone="warning" title="Envio de arquivos indisponivel">
        Defina <code>BLOB_READ_WRITE_TOKEN</code> no ambiente para habilitar a biblioteca de imagens.
      </Alert>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/svg+xml,image/gif,application/pdf"
        multiple
        className="sr-only"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <Button
        variant="outline"
        loading={uploading}
        disabled={disabled}
        icon={<Upload aria-hidden="true" className="size-4" />}
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </Button>
    </>
  );
}

/** Le largura e altura no navegador para armazenar junto do arquivo. */
async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/** Miniatura com proporcao fixa e fundo xadrez para transparencia. */
export function MediaThumb({
  asset,
  className,
}: {
  asset: Pick<MediaAssetRecord, 'blobUrl' | 'alt' | 'fileName' | 'kind'> | MediaRef;
  className?: string;
}) {
  const url = 'blobUrl' in asset ? asset.blobUrl : asset.url;
  const alt = asset.alt || ('fileName' in asset ? asset.fileName : '');
  const isDocument = 'kind' in asset && asset.kind === 'document';

  if (isDocument) {
    return (
      <div className={cx('grid place-items-center bg-slate-100 text-xs font-medium text-slate-500', className)}>
        PDF
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cx('checkerboard size-full object-cover', className)}
    />
  );
}

/**
 * Campo de imagem unica: abre a biblioteca, permite enviar um arquivo novo e
 * guarda o identificador do arquivo escolhido.
 */
export function ImageField({
  label,
  value,
  preview,
  onChange,
  hint,
  tag,
}: {
  label: string;
  value: string | null;
  preview?: MediaRef | null;
  onChange: (mediaId: string | null, asset?: MediaAssetRecord) => void;
  hint?: string;
  tag?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>

      <div className="flex items-center gap-3">
        <div className="size-20 flex-none overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          {preview?.url ? (
            <MediaThumb asset={preview} />
          ) : (
            <div className="grid size-full place-items-center text-slate-300">
              <ImagePlus aria-hidden="true" className="size-6" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            {value ? 'Trocar' : 'Escolher da biblioteca'}
          </Button>
          {value ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(null)}
              icon={<X aria-hidden="true" className="size-4" />}
            >
              Remover
            </Button>
          ) : null}
        </div>
      </div>

      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}

      <MediaLibraryModal
        open={open}
        onClose={() => setOpen(false)}
        tag={tag}
        onSelect={(asset) => {
          onChange(asset.id, asset);
          setOpen(false);
        }}
      />
    </div>
  );
}

/** Campo de galeria: lista ordenada de imagens da biblioteca. */
export function GalleryField({
  label,
  value,
  previews,
  onChange,
  hint,
}: {
  label: string;
  value: string[];
  previews: MediaRef[];
  onChange: (ids: string[], assets?: MediaAssetRecord[]) => void;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const byId = new Map(previews.map((item) => [item.id, item]));

  function move(index: number, direction: -1 | 1) {
    const next = [...value];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const current = next[index];
    const swap = next[target];
    if (!current || !swap) return;
    next[index] = swap;
    next[target] = current;
    onChange(next);
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Adicionar imagens
        </Button>
      </div>

      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
          Nenhuma imagem na galeria.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {value.map((id, index) => {
            const asset = byId.get(id);
            return (
              <li key={id} className="group relative overflow-hidden rounded-lg border border-slate-200">
                <div className="aspect-square bg-slate-50">
                  {asset ? <MediaThumb asset={asset} /> : <div className="size-full bg-slate-100" />}
                </div>
                <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-slate-900/70 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    aria-label="Mover para a esquerda"
                    onClick={() => move(index, -1)}
                    className="rounded px-1.5 text-xs text-white hover:bg-white/20"
                  >
                    &larr;
                  </button>
                  <button
                    type="button"
                    aria-label="Remover da galeria"
                    onClick={() => onChange(value.filter((item) => item !== id))}
                    className="rounded px-1.5 text-white hover:bg-white/20"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Mover para a direita"
                    onClick={() => move(index, 1)}
                    className="rounded px-1.5 text-xs text-white hover:bg-white/20"
                  >
                    &rarr;
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}

      <MediaLibraryModal
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(asset) => {
          if (!value.includes(asset.id)) onChange([...value, asset.id], [asset]);
        }}
        multiple
      />
    </div>
  );
}

/** Dialogo com a biblioteca de midia da empresa. */
export function MediaLibraryModal({
  open,
  onClose,
  onSelect,
  multiple = false,
  tag,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (asset: MediaAssetRecord) => void;
  multiple?: boolean;
  tag?: string;
}) {
  const { resource, usage, search, setSearch } = useMediaLibrary();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Biblioteca de imagens"
      description={usage.data ? usage.data.storageLabel : undefined}
      size="xl"
      footer={
        <>
          <UploadButton
            label="Enviar nova imagem"
            tag={tag ?? ''}
            blobConfigured={usage.data?.blobConfigured ?? true}
            onUploaded={(asset) => {
              resource.reload();
              usage.reload();
              onSelect(asset);
            }}
          />
          <Button onClick={onClose}>{multiple ? 'Concluir' : 'Fechar'}</Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextInput
          label="Buscar por nome do arquivo"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="fachada, planta, piscina..."
        />

        {resource.initialLoading ? (
          <Spinner label="Carregando biblioteca" />
        ) : resource.data && resource.data.items.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {resource.data.items.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => onSelect(asset)}
                  className="group grid w-full gap-1.5 rounded-lg border border-slate-200 p-1.5 text-left hover:border-brand-400 hover:bg-brand-50/40"
                >
                  <div className="aspect-4/3 overflow-hidden rounded bg-slate-50">
                    <MediaThumb asset={asset} />
                  </div>
                  <span className="truncate px-0.5 text-xs text-slate-600">{asset.fileName}</span>
                  <span className="flex items-center justify-between gap-1 px-0.5">
                    <span className="text-[11px] text-slate-400">{formatBytes(asset.sizeBytes)}</span>
                    {asset.alt ? null : <Badge tone="warning">sem alt</Badge>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Nenhum arquivo na biblioteca ainda. Envie a primeira imagem pelo botao abaixo.
          </p>
        )}
      </div>
    </Modal>
  );
}
