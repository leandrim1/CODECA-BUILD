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

/**
 * Credencial do Blob.
 *
 * A Vercel tem duas formas de autenticar, e stores criados hoje usam a
 * segunda:
 *
 * - **Token de escrita** (`BLOB_READ_WRITE_TOKEN`), de vida longa, usado por
 *   stores antigos e por qualquer maquina fora da Vercel.
 * - **OIDC**, em que a plataforma injeta um token de vida curta que rotaciona
 *   sozinho. Conectar um store novo cria apenas `BLOB_STORE_ID`, e nenhum
 *   token aparece nas variaveis do projeto.
 *
 * Passar `token: undefined` nao e descuido: e o que faz o SDK resolver a
 * credencial sozinho, preferindo OIDC e caindo no token de ambiente quando ele
 * existe. Passar um token vazio quebraria as duas formas.
 */
export function createVercelBlobStorage(token?: string): BlobStorage {
  const auth = token ? { token } : {};
  return {
    configured: true,
    async put({ pathname, body, contentType }) {
      const { put } = await import('@vercel/blob');
      const result = await put(pathname, body as Buffer, {
        access: 'public',
        ...auth,
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
      await del(url, auth);
    },
  };
}

/** Implementacao que falha de forma explicita quando o Blob nao esta configurado. */
export function createUnconfiguredBlobStorage(): BlobStorage {
  const fail = (): never => {
    throw AppError.notConfigured(
      'O armazenamento de arquivos nao esta configurado. Conecte um Blob store ao projeto na '
        + 'Vercel -- isso define BLOB_STORE_ID -- ou defina BLOB_READ_WRITE_TOKEN no ambiente.',
    );
  };
  return {
    configured: false,
    put: async () => fail(),
    remove: async () => fail(),
  };
}

/** Como este ambiente se autentica no Blob. */
export type BlobCredential =
  | { kind: 'token'; token: string }
  | { kind: 'oidc' }
  | { kind: 'none' };

/**
 * Decide a credencial a partir do ambiente.
 *
 * Separado da criacao do armazenamento porque e aqui que mora a regra -- o
 * resto e chamada de SDK. O token tem precedencia: quando alguem o define
 * explicitamente, e porque quer aquele store, mesmo havendo um conectado.
 */
export function resolveBlobCredential(env: Env): BlobCredential {
  if (env.BLOB_READ_WRITE_TOKEN) return { kind: 'token', token: env.BLOB_READ_WRITE_TOKEN };
  // Store conectado por OIDC: o `BLOB_STORE_ID` basta, e o token de vida curta
  // vem da plataforma em tempo de execucao.
  if (env.BLOB_STORE_ID) return { kind: 'oidc' };
  return { kind: 'none' };
}

export function createBlobStorage(env: Env): BlobStorage {
  const credential = resolveBlobCredential(env);
  if (credential.kind === 'none') return createUnconfiguredBlobStorage();
  return createVercelBlobStorage(credential.kind === 'token' ? credential.token : undefined);
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
