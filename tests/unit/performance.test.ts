import { describe, expect, it, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitOpenError,
  backoffDelayMs,
  isSafeToRetry,
  isTransientDbError,
  withRetry,
} from '@codeca/database';
import { TtlCache } from '../../apps/api/src/lib/ttl-cache.js';
import { createCaches } from '../../apps/api/src/lib/caches.js';
import { percentile } from '../../apps/api/src/lib/runtime-metrics.js';
import { fitWithin, optimizedName } from '../../apps/web/src/lib/image-optimize.js';

/**
 * Pecas de desempenho e resiliencia, isoladas.
 *
 * Os efeitos delas na API inteira (isolamento entre empresas, invalidacao,
 * recusa por sobrecarga) estao em `tests/integration/performance.test.ts`.
 */

describe('TtlCache', () => {
  it('nao entrega entrada vencida', async () => {
    let agora = 1_000;
    const cache = new TtlCache<string>(10_000, 100, () => agora);
    cache.set('a', 'valor');
    expect(cache.peek('a')).toBe('valor');
    agora += 10_000;
    expect(cache.peek('a')).toBeUndefined();
  });

  it('cem pedidos simultaneos fazem uma unica carga', async () => {
    const cache = new TtlCache<number>(10_000, 100);
    const loader = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 42;
    });
    const results = await Promise.all(Array.from({ length: 100 }, () => cache.getOrLoad('k', loader)));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(new Set(results)).toEqual(new Set([42]));
  });

  it('erro de carga nao fica guardado', async () => {
    const cache = new TtlCache<number>(10_000, 100);
    await expect(cache.getOrLoad('k', async () => { throw new Error('falhou'); })).rejects.toThrow('falhou');
    await expect(cache.getOrLoad('k', async () => 7)).resolves.toBe(7);
  });

  it('respeita o limite de entradas: a mais antiga sai', () => {
    const cache = new TtlCache<number>(10_000, 3);
    for (const [i, key] of ['a', 'b', 'c', 'd'].entries()) cache.set(key, i);
    expect(cache.size).toBe(3);
    expect(cache.peek('a')).toBeUndefined();
    expect(cache.peek('d')).toBe(3);
  });

  it('carga em andamento durante uma invalidacao nao ressuscita o dado velho', async () => {
    const cache = new TtlCache<string>(10_000, 100);
    let liberar!: () => void;
    const lenta = cache.getOrLoad('k', () => new Promise<string>((r) => { liberar = () => r('velho'); }));
    cache.deleteWhere(() => true); // escrita no painel
    liberar();
    await lenta;
    expect(cache.peek('k')).toBeUndefined();
  });

  it('com validade 0 fica desligado e sempre consulta', async () => {
    const cache = new TtlCache<number>(0, 100);
    const loader = vi.fn(async () => 1);
    await cache.getOrLoad('k', loader);
    await cache.getOrLoad('k', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('createCaches', () => {
  it('invalidar uma empresa nao toca nas outras', () => {
    const caches = createCaches({ authTtlSeconds: 10, publicTtlSeconds: 10 });
    const ctx = (tenantId: string) => ({ tenantId }) as never;
    caches.tenant.set('A:u1', ctx('A'));
    caches.tenant.set('B:u2', ctx('B'));
    caches.invalidateTenant('A');
    expect(caches.tenant.peek('A:u1')).toBeUndefined();
    expect(caches.tenant.peek('B:u2')).toBeDefined();
  });

  it('invalidar um usuario remove so as entradas dele', () => {
    const caches = createCaches({ authTtlSeconds: 10, publicTtlSeconds: 10 });
    caches.tenant.set('A:u1', {} as never);
    caches.tenant.set('A:u2', {} as never);
    caches.invalidateUser('u1');
    expect(caches.tenant.peek('A:u1')).toBeUndefined();
    expect(caches.tenant.peek('A:u2')).toBeDefined();
  });

  it('com ambas as validades em 0, fica desligado', () => {
    expect(createCaches({ authTtlSeconds: 0, publicTtlSeconds: 0 }).enabled).toBe(false);
  });
});

describe('classificacao de erros do banco', () => {
  it('reconhece indisponibilidade transitoria', () => {
    expect(isTransientDbError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isTransientDbError(Object.assign(new Error('x'), { code: '53300' }))).toBe(true);
    expect(isTransientDbError(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(isTransientDbError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientDbError(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }))).toBe(true);
  });

  it('erro de dado ou de codigo NAO e tratado como indisponibilidade', () => {
    expect(isTransientDbError(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(false);
    expect(isTransientDbError(new Error('column "x" does not exist'))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });

  it('so repete o que comprovadamente nao chegou ao banco', () => {
    expect(isSafeToRetry(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(true);
    // Reset no meio da consulta: pode ter sido aplicada. Nunca repetir.
    expect(isSafeToRetry(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(false);
    expect(isSafeToRetry(new Error('timeout'))).toBe(false);
  });
});

describe('backoff e repeticao', () => {
  it('o teto cresce de forma exponencial e respeita o limite', () => {
    const maximo = () => 0.999999;
    expect(backoffDelayMs(0, 100, 2000, maximo)).toBeLessThan(100);
    expect(backoffDelayMs(2, 100, 2000, maximo)).toBeLessThan(400);
    expect(backoffDelayMs(10, 100, 2000, maximo)).toBeLessThan(2000);
  });

  it('jitter: esperas diferentes para a mesma tentativa', () => {
    const delays = new Set(Array.from({ length: 50 }, () => backoffDelayMs(3)));
    expect(delays.size).toBeGreaterThan(5);
  });

  it('repete ate o limite e depois propaga o erro', async () => {
    const erro = Object.assign(new Error('recusada'), { code: 'ECONNREFUSED' });
    const run = vi.fn(async () => { throw erro; });
    await expect(withRetry(run, { retries: 2, sleep: async () => undefined })).rejects.toBe(erro);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('nao repete erro que nao e seguro repetir', async () => {
    const run = vi.fn(async () => { throw new Error('violacao'); });
    await expect(withRetry(run, { sleep: async () => undefined })).rejects.toThrow('violacao');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('para de repetir quando a chamada passa a funcionar', async () => {
    let n = 0;
    const result = await withRetry(
      async () => {
        n += 1;
        if (n < 2) throw Object.assign(new Error('x'), { code: 'ENOTFOUND' });
        return 'ok';
      },
      { sleep: async () => undefined },
    );
    expect(result).toBe('ok');
    expect(n).toBe(2);
  });
});

describe('CircuitBreaker', () => {
  it('abre apos falhas seguidas, recusa na hora e testa de novo depois do intervalo', async () => {
    let agora = 0;
    const breaker = new CircuitBreaker('teste', { failureThreshold: 3, cooldownMs: 1000, now: () => agora });
    const falha = vi.fn(async () => { throw new Error('fora'); });

    for (let i = 0; i < 3; i += 1) await expect(breaker.run(falha)).rejects.toThrow('fora');
    expect(breaker.state).toBe('open');

    // Aberto: nem chama.
    await expect(breaker.run(falha)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(falha).toHaveBeenCalledTimes(3);

    agora = 1500;
    expect(breaker.state).toBe('half-open');
    await expect(breaker.run(async () => 'voltou')).resolves.toBe('voltou');
    expect(breaker.state).toBe('closed');
  });

  it('falha no teste reabre o circuito', async () => {
    let agora = 0;
    const breaker = new CircuitBreaker('teste', { failureThreshold: 1, cooldownMs: 1000, now: () => agora });
    await expect(breaker.run(async () => { throw new Error('x'); })).rejects.toThrow();
    agora = 2000;
    await expect(breaker.run(async () => { throw new Error('ainda fora'); })).rejects.toThrow('ainda fora');
    expect(breaker.state).toBe('open');
  });

  it('erro que nao indica queda nao conta', async () => {
    const breaker = new CircuitBreaker('teste', { failureThreshold: 2, isFailure: () => false });
    for (let i = 0; i < 5; i += 1) await expect(breaker.run(async () => { throw new Error('4xx'); })).rejects.toThrow();
    expect(breaker.state).toBe('closed');
  });
});

describe('medicao', () => {
  it('percentil', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 99)).toBe(99);
    expect(percentile([], 95)).toBe(0);
  });
});

describe('preparo de imagem no navegador', () => {
  it('reduz mantendo a proporcao e nunca amplia', () => {
    expect(fitWithin(5120, 2560)).toEqual({ width: 2560, height: 1280 });
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('troca a extensao para webp', () => {
    expect(optimizedName('foto.final.JPG')).toBe('foto.final.webp');
    expect(optimizedName('')).toBe('imagem.webp');
  });
});

describe('repeticao de leituras no painel', () => {
  it('respeita Retry-After (limitado a 5 s) e soma sorteio', async () => {
    const { retryDelayMs } = await import('../../apps/web/src/services/api.js');
    expect(retryDelayMs(0, '3', () => 0)).toBe(3000);
    expect(retryDelayMs(0, '999', () => 0)).toBe(5000);
    expect(retryDelayMs(1, null, () => 0)).toBe(500);
    expect(retryDelayMs(0, null, () => 0.999)).toBeLessThanOrEqual(250 + 400);
    expect(retryDelayMs(0, 'abc', () => 0)).toBe(250);
  });
});
