import { AppError, type AllowedMimeType } from '@codeca/shared';
import type { Env } from '../env.js';

/**
 * Armazenamento de arquivos no Vercel Blob.
 *
 * O token de escrita existe apenas no servidor. O navegador envia o arquivo
 * para a nossa API, que valida autenticacao, empresa, tipo, tamanho e limite de
 * plano antes de gravar. O caminho e sempre prefixado por `tenants/<tenantId>/`,
 * o que impede que uma empresa escreva no espaco de outra.
 */

export interface StoredBlob {
  url: string;
  downloadUrl: string;
  pathname: string;
  size: number;
  contentType: string;
}

export interface BlobStorage {
  readonly configured: boolean;
  put: (input: {
    pathname: string;
    body: ArrayBuffer | Uint8Array;
    contentType: AllowedMimeType;
  }) => Promise<StoredBlob>;
  remove: (url: string) => Promise<void>;
}

export function tenantBlobPrefix(tenantId: string): string {
  return `tenants/${tenantId}/`;
}

export function buildBlobPathname(tenantId: string, fileName: string): string {
  return `${tenantBlobPrefix(tenantId)}${fileName}`;
}

/** `true` quando o caminho pertence ao espaco da empresa informada. */
export function blobPathBelongsToTenant(pathname: string, tenantId: string): boolean {
  return pathname.startsWith(tenantBlobPrefix(tenantId));
}

export function createVercelBlobStorage(token: string): BlobStorage {
  return {
    configured: true,
    async put({ pathname, body, contentType }) {
      const { put } = await import('@vercel/blob');
      const result = await put(pathname, body as Buffer, {
        access: 'public',
        token,
        contentType,
        // `addRandomSuffix` evita que dois envios com o mesmo nome se sobreponham.
        addRandomSuffix: true,
      });
      return {
        url: result.url,
        downloadUrl: result.downloadUrl ?? result.url,
        pathname: result.pathname,
        size: body instanceof Uint8Array ? body.byteLength : body.byteLength,
        contentType,
      };
    },
    async remove(url) {
      const { del } = await import('@vercel/blob');
      await del(url, { token });
    },
  };
}

/** Implementacao que falha de forma explicita quando o Blob nao esta configurado. */
export function createUnconfiguredBlobStorage(): BlobStorage {
  const fail = (): never => {
    throw AppError.notConfigured(
      'O armazenamento de arquivos nao esta configurado. Defina BLOB_READ_WRITE_TOKEN no ambiente '
        + 'para habilitar o envio de imagens.',
    );
  };
  return {
    configured: false,
    put: async () => fail(),
    remove: async () => fail(),
  };
}

export function createBlobStorage(env: Env): BlobStorage {
  return env.BLOB_READ_WRITE_TOKEN
    ? createVercelBlobStorage(env.BLOB_READ_WRITE_TOKEN)
    : createUnconfiguredBlobStorage();
}

/** Armazenamento em memoria para os testes. */
export function createMemoryBlobStorage(): BlobStorage & { files: Map<string, StoredBlob> } {
  const files = new Map<string, StoredBlob>();
  let counter = 0;
  return {
    configured: true,
    files,
    async put({ pathname, body, contentType }) {
      counter += 1;
      const finalPath = `${pathname}-${counter}`;
      const stored: StoredBlob = {
        url: `https://blob.test/${finalPath}`,
        downloadUrl: `https://blob.test/${finalPath}?download=1`,
        pathname: finalPath,
        size: body.byteLength,
        contentType,
      };
      files.set(stored.url, stored);
      return stored;
    },
    async remove(url) {
      files.delete(url);
    },
  };
}
