import { describe, expect, it } from 'vitest';
import { createBlobStorage, featureFlags, parseEnv, resolveBlobCredential } from '@codeca/api';

/**
 * Credencial do Vercel Blob.
 *
 * A Vercel mudou a forma de autenticar: um store conectado hoje usa OIDC, e a
 * plataforma define apenas `BLOB_STORE_ID` -- nenhum token de escrita aparece
 * nas variaveis do projeto. O codigo exigia o token, entao um store conectado
 * corretamente continuava aparecendo como "nao configurado" no painel, sem
 * nada que o operador pudesse fazer a respeito.
 */

/** Ambiente minimo, com as variaveis de Blob que o cenario exigir. */
function ambiente(blob: Record<string, string>) {
  return parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://injected/test',
    AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
    APP_URL: 'http://app.localhost:5173',
    PLATFORM_HOSTS: 'app.localhost',
    ...blob,
  });
}

describe('credencial do Blob', () => {
  it('store conectado por OIDC vale como configurado', () => {
    // O caso que estava quebrado: BLOB_STORE_ID sozinho, sem token nenhum.
    const env = ambiente({ BLOB_STORE_ID: 'store_abc123' });
    expect(resolveBlobCredential(env)).toEqual({ kind: 'oidc' });
    expect(createBlobStorage(env).configured).toBe(true);
    expect(featureFlags(env).blobStorage).toBe(true);
  });

  it('token de escrita continua valendo, para fora da Vercel', () => {
    const env = ambiente({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_exemplo' });
    expect(resolveBlobCredential(env)).toEqual({
      kind: 'token',
      token: 'vercel_blob_rw_exemplo',
    });
    expect(featureFlags(env).blobStorage).toBe(true);
  });

  it('o token tem precedencia quando as duas existem', () => {
    // Definir o token explicitamente e uma escolha: aponta para aquele store,
    // mesmo havendo outro conectado ao projeto.
    const env = ambiente({
      BLOB_STORE_ID: 'store_abc123',
      BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_exemplo',
    });
    expect(resolveBlobCredential(env).kind).toBe('token');
  });

  it('sem nenhuma das duas, falha com instrucao em vez de erro do SDK', async () => {
    const env = ambiente({});
    expect(resolveBlobCredential(env)).toEqual({ kind: 'none' });
    expect(featureFlags(env).blobStorage).toBe(false);

    const storage = createBlobStorage(env);
    expect(storage.configured).toBe(false);
    await expect(
      storage.put({
        pathname: 'tenants/t1/arquivo.png',
        body: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
      }),
    ).rejects.toThrow(/Blob store|BLOB_STORE_ID/);
  });
});
