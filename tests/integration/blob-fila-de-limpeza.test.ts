import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, schema } from '@codeca/database';
import { agendarRemocaoDoBlob, drenarFilaDoBlob } from '../../apps/api/src/lib/blob-cleanup.js';
import type { BlobStorage } from '../../apps/api/src/lib/blob.js';
import { createTestApi, registerAccount, type RegisteredAccount, type TestApi } from '../helpers/api.js';

/**
 * Arquivo que nao sai do Blob nao pode sumir do mapa.
 *
 * A exclusao de midia tira a linha do banco antes de apagar o arquivo. A cota
 * e a soma do banco, entao a cota ja foi liberada: se a remocao falhar e o
 * erro so for para o log, o arquivo continua ocupando o balde e **deixa de ser
 * cobrado**. E o unico defeito desta auditoria que custa dinheiro nosso, nao
 * do cliente.
 */

let api: TestApi;
let conta: RegisteredAccount;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  conta = await registerAccount(api, { email: 'dona@empresa.com.br', companyName: 'Empresa Teste' });
});

/** Blob que recusa remover, como o provedor fora do ar faria. */
function blobQueRecusa(falhas: { [url: string]: number } = {}): BlobStorage & { removidos: string[] } {
  const removidos: string[] = [];
  return {
    configured: true,
    removidos,
    put: async () => {
      throw new Error('nao usado neste teste');
    },
    remove: async (url: string) => {
      const restantes = falhas[url] ?? 0;
      if (restantes > 0) {
        falhas[url] = restantes - 1;
        throw new Error('provedor indisponivel');
      }
      removidos.push(url);
    },
  };
}

async function naFila() {
  return api.db.select().from(schema.blobCleanupQueue);
}

describe('fila de limpeza do Blob', () => {
  it('a falha vira tarefa em vez de sumir no log', async () => {
    await agendarRemocaoDoBlob(api.db, {
      tenantId: conta.tenantId,
      blobUrl: 'https://blob.test/a.webp',
      pathname: `tenants/${conta.tenantId}/a.webp`,
      erro: new Error('provedor indisponivel'),
    });

    const fila = await naFila();
    expect(fila).toHaveLength(1);
    expect(fila[0]!.blobUrl).toBe('https://blob.test/a.webp');
    expect(fila[0]!.attempts).toBe(0);
    expect(fila[0]!.lastError).toContain('indisponivel');
  });

  it('o mesmo arquivo falhando de novo e a mesma tarefa', async () => {
    for (let i = 0; i < 3; i += 1) {
      await agendarRemocaoDoBlob(api.db, {
        tenantId: conta.tenantId,
        blobUrl: 'https://blob.test/a.webp',
        erro: new Error(`tentativa ${i}`),
      });
    }
    expect(await naFila()).toHaveLength(1);
  });

  it('o job remove o que voltou a responder e esvazia a fila', async () => {
    await agendarRemocaoDoBlob(api.db, { tenantId: conta.tenantId, blobUrl: 'https://blob.test/a.webp' });
    await agendarRemocaoDoBlob(api.db, { tenantId: conta.tenantId, blobUrl: 'https://blob.test/b.webp' });

    const blob = blobQueRecusa();
    const relatorio = await drenarFilaDoBlob(api.db, blob);

    expect(relatorio.removidos).toBe(2);
    expect(blob.removidos.sort()).toEqual(['https://blob.test/a.webp', 'https://blob.test/b.webp']);
    expect(await naFila()).toHaveLength(0);
  });

  it('o que continua falhando fica na fila, com a tentativa contada', async () => {
    await agendarRemocaoDoBlob(api.db, { tenantId: conta.tenantId, blobUrl: 'https://blob.test/teimoso.webp' });

    const blob = blobQueRecusa({ 'https://blob.test/teimoso.webp': 1 });
    const primeira = await drenarFilaDoBlob(api.db, blob);
    expect(primeira).toMatchObject({ removidos: 0, pendentes: 1, desistidas: 0 });

    const [tarefa] = await naFila();
    expect(tarefa!.attempts).toBe(1);
    expect(tarefa!.lastAttemptAt).not.toBeNull();

    // Na segunda passada o provedor ja responde.
    const segunda = await drenarFilaDoBlob(api.db, blob);
    expect(segunda.removidos).toBe(1);
    expect(await naFila()).toHaveLength(0);
  });

  it('para de tentar depois de dez falhas, mas guarda o registro', async () => {
    await agendarRemocaoDoBlob(api.db, { tenantId: conta.tenantId, blobUrl: 'https://blob.test/perdido.webp' });
    // Falha sempre.
    const blob = blobQueRecusa({ 'https://blob.test/perdido.webp': 999 });

    for (let i = 0; i < 10; i += 1) await drenarFilaDoBlob(api.db, blob);

    const [tarefa] = await naFila();
    expect(tarefa!.attempts).toBe(10);

    // A decima primeira passada nem tenta: a tarefa saiu do lote.
    const depois = await drenarFilaDoBlob(api.db, blob);
    expect(depois).toMatchObject({ removidos: 0, pendentes: 0, desistidas: 0 });
    // Mas continua registrada, para quem opera poder olhar.
    expect(await naFila()).toHaveLength(1);
  });

  it('sem Blob configurado o job nao faz nada, e nao apaga a fila', async () => {
    await agendarRemocaoDoBlob(api.db, { tenantId: conta.tenantId, blobUrl: 'https://blob.test/a.webp' });
    const desligado: BlobStorage = {
      configured: false,
      put: async () => { throw new Error('desligado'); },
      remove: async () => { throw new Error('desligado'); },
    };
    expect(await drenarFilaDoBlob(api.db, desligado)).toMatchObject({ removidos: 0 });
    expect(await naFila()).toHaveLength(1);
  });

  it('a tarefa sobrevive a exclusao da empresa', async () => {
    /*
      O ponto mais facil de errar aqui: uma chave estrangeira com cascade
      apagaria a tarefa junto com a empresa -- justamente quando os arquivos
      dela precisam sair do Blob.
    */
    await agendarRemocaoDoBlob(api.db, { tenantId: conta.tenantId, blobUrl: 'https://blob.test/a.webp' });
    await api.db.delete(schema.tenants).where(eq(schema.tenants.id, conta.tenantId));

    expect(await naFila()).toHaveLength(1);
  });
});
