import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createApp,
  createMemoryBlobStorage,
  createMemoryMailer,
  createUnconfiguredDomainProvider,
  parseEnv,
  probeDatabase,
} from '@codeca/api';
import type { Database } from '@codeca/database';
import { createTestApi, type TestApi } from '../helpers/api.js';

/**
 * Sondagem do banco no health.
 *
 * O cenario que motivou isto apareceu em producao: consultas simples
 * respondiam e o cadastro estourava o tempo da funcao, devolvendo 504 sem
 * causa. O motivo e que o driver do Neon so abre WebSocket quando ha uma
 * transacao -- tudo que le passa por HTTP e continua funcionando.
 *
 * Sem separar as duas capacidades, a unica informacao disponivel era "as vezes
 * falha".
 */

/** Banco de mentira: responde a consulta simples e recusa a transacao. */
function bancoSemTransacao(erro: Error): Database {
  return {
    execute: async () => [],
    transaction: async () => {
      throw erro;
    },
  } as unknown as Database;
}

/** Banco de mentira que nao responde nada dentro do prazo. */
function bancoMudo(): Database {
  return {
    execute: () => new Promise(() => {}),
    transaction: () => new Promise(() => {}),
  } as unknown as Database;
}

describe('sondagem do banco', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await createTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  it('banco saudavel responde ok nas duas capacidades', async () => {
    const probe = await probeDatabase(api.db);
    expect(probe.query).toBe('ok');
    expect(probe.transaction).toBe('ok');
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
    expect(probe.cause).toBeNull();
  });

  it('separa transacao quebrada de banco fora do ar', async () => {
    // Exatamente o caso de producao: le, mas nao escreve em transacao.
    const probe = await probeDatabase(
      bancoSemTransacao(new Error('connection terminated unexpectedly')),
      200,
    );
    expect(probe.query).toBe('ok');
    expect(probe.transaction).toBe('falha');
    expect(probe.cause).toMatch(/WebSocket/i);
  });

  it('banco inalcancavel nem chega a testar a transacao', async () => {
    const probe = await probeDatabase(bancoMudo(), 50);
    expect(probe.query).toBe('falha');
    expect(probe.transaction).toBe('nao testada');
    expect(probe.latencyMs).toBeNull();
  });

  it('classifica credencial recusada com o codigo do PostgreSQL', async () => {
    const recusado = Object.assign(
      new Error('password authentication failed for user "neondb_owner"'),
      { code: '28P01' },
    );
    const probe = await probeDatabase(bancoSemTransacao(recusado), 200);
    expect(probe.code).toBe('28P01');
    expect(probe.cause).toMatch(/credenciais/i);
  });

  it('o health responde 503 e "degradado" quando a transacao nao passa', async () => {
    // A aplicacao sobe, le e mostra telas; o que falha e tudo que escreve.
    // Devolver 200 nesse estado foi o que escondeu a falha por horas.
    const app = createApp({
      env: parseEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://injected/test',
        AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
        APP_URL: 'http://app.localhost:5173',
        PLATFORM_HOSTS: 'app.localhost,localhost',
      }),
      db: bancoSemTransacao(new Error('connection terminated unexpectedly')),
      mailer: createMemoryMailer(),
      blob: createMemoryBlobStorage(),
      domains: createUnconfiguredDomainProvider(),
    });

    const response = await app.request('http://app.localhost/api/health');
    expect(response.status).toBe(503);

    const body = (await response.json()) as {
      data: { status: string; database: { query: string; transaction: string } };
    };
    expect(body.data.status).toBe('degradado');
    expect(body.data.database.query).toBe('ok');
    expect(body.data.database.transaction).toBe('falha');
  });
});
