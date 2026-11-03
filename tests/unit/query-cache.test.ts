import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../apps/web/src/services/api.js';
import {
  EMPTY,
  QueryCache,
  makeKey,
  replaceEqualDeep,
} from '../../apps/web/src/services/queryCache.js';

/**
 * O cache de consultas e o que impede o painel de piscar: ele decide quando uma
 * tela mostra o dado que ja tem, quando busca de novo e quando larga uma busca
 * que ninguem espera. Cada teste abaixo e uma promessa dessas.
 */

/** Uma consulta controlada pelo teste: resolve ou falha quando mandarmos. */
function controlada<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const fetcher = vi.fn((signal: AbortSignal) => {
    void signal;
    return promise;
  });
  return { fetcher, resolve, reject };
}

const espera = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('QueryCache: leitura e busca', () => {
  it('chave desconhecida devolve o valor vazio, sempre o mesmo objeto', () => {
    const cache = new QueryCache();
    expect(cache.read('x')).toBe(EMPTY);
    expect(cache.read('x')).toBe(cache.read('y'));
  });

  it('busca, guarda a resposta e avisa quem ouve', async () => {
    const cache = new QueryCache();
    const avisos: boolean[] = [];
    cache.subscribe('k', () => avisos.push(cache.read('k').fetching));

    const { fetcher, resolve } = controlada<{ n: number }>();
    cache.acquire('k', fetcher);
    expect(cache.read('k').fetching).toBe(true);
    expect(cache.read('k').data).toBeUndefined();

    resolve({ n: 1 });
    await espera();

    expect(cache.read<{ n: number }>('k').data).toEqual({ n: 1 });
    expect(cache.read('k').fetching).toBe(false);
    expect(cache.read('k').error).toBeNull();
    expect(avisos).toEqual([true, false]);
  });

  it('o snapshot so muda quando algo muda (requisito do useSyncExternalStore)', async () => {
    const cache = new QueryCache();
    const { fetcher, resolve } = controlada<number>();
    cache.acquire('k', fetcher);
    const durante = cache.read('k');
    expect(cache.read('k')).toBe(durante);
    resolve(1);
    await espera();
    expect(cache.read('k')).not.toBe(durante);
    expect(cache.read('k')).toBe(cache.read('k'));
  });
});

describe('QueryCache: frescor', () => {
  it('dentro do tempo de frescor nao busca de novo: a tela usa o que tem', async () => {
    let agora = 1_000;
    const cache = new QueryCache(() => agora);
    const a = controlada<number>();
    cache.acquire('k', a.fetcher, { staleTime: 10_000 });
    a.resolve(1);
    await espera();

    agora += 5_000;
    const b = vi.fn(() => Promise.resolve(2));
    cache.acquire('k', b, { staleTime: 10_000 });
    expect(b).not.toHaveBeenCalled();
    expect(cache.read('k').data).toBe(1);
  });

  it('passado o frescor, mostra o dado guardado E confere por tras', async () => {
    let agora = 1_000;
    const cache = new QueryCache(() => agora);
    const a = controlada<number>();
    cache.acquire('k', a.fetcher, { staleTime: 10_000 });
    a.resolve(1);
    await espera();

    agora += 20_000;
    const b = controlada<number>();
    cache.acquire('k', b.fetcher, { staleTime: 10_000 });

    expect(b.fetcher).toHaveBeenCalledTimes(1);
    // O ponto central: o dado antigo continua ali enquanto a conferencia corre.
    expect(cache.read('k').data).toBe(1);
    expect(cache.read('k').fetching).toBe(true);

    b.resolve(2);
    await espera();
    expect(cache.read('k').data).toBe(2);
  });

  it('staleTime zero confere a cada visita, sem nunca esvaziar a tela', async () => {
    const cache = new QueryCache();
    const a = controlada<number>();
    cache.acquire('k', a.fetcher, { staleTime: 0 });
    a.resolve(1);
    await espera();

    const b = controlada<number>();
    cache.acquire('k', b.fetcher, { staleTime: 0 });
    expect(b.fetcher).toHaveBeenCalledTimes(1);
    expect(cache.read('k').data).toBe(1);
  });

  it('uma resposta igual nao troca a referencia: revalidar nao refaz a tela', async () => {
    const cache = new QueryCache();
    const a = controlada<{ itens: Array<{ id: number }> }>();
    cache.acquire('k', a.fetcher, { staleTime: 0 });
    a.resolve({ itens: [{ id: 1 }, { id: 2 }] });
    await espera();
    const antes = cache.read('k').data;

    const b = controlada<{ itens: Array<{ id: number }> }>();
    cache.acquire('k', b.fetcher, { staleTime: 0 });
    b.resolve({ itens: [{ id: 1 }, { id: 2 }] });
    await espera();

    expect(cache.read('k').data).toBe(antes);
  });
});

describe('QueryCache: deduplicacao e cancelamento', () => {
  it('duas telas na mesma chave dividem UMA requisicao', async () => {
    const cache = new QueryCache();
    const { fetcher, resolve } = controlada<number>();
    cache.acquire('k', fetcher);
    cache.acquire('k', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(7);
    await espera();
    expect(cache.read('k').data).toBe(7);
  });

  it('sem ninguem esperando, a requisicao e cancelada e nada e gravado', async () => {
    const cache = new QueryCache();
    let sinal!: AbortSignal;
    const lease = cache.acquire('k', (s) => {
      sinal = s;
      return new Promise<number>(() => undefined);
    });
    lease.release();
    expect(sinal.aborted).toBe(false); // cancela no proximo ciclo, nao agora
    await espera();
    expect(sinal.aborted).toBe(true);
    expect(cache.read('k').fetching).toBe(false);
    expect(cache.read('k').data).toBeUndefined();
  });

  it('modo estrito: desmontar e remontar no mesmo ciclo nao cancela nem duplica', async () => {
    const cache = new QueryCache();
    const { fetcher, resolve } = controlada<number>();
    let sinal!: AbortSignal;
    const com = vi.fn((s: AbortSignal) => {
      sinal = s;
      return fetcher(s);
    });
    const primeira = cache.acquire('k', com);
    primeira.release();
    cache.acquire('k', com); // o efeito roda de novo
    await espera();

    expect(com).toHaveBeenCalledTimes(1);
    expect(sinal.aborted).toBe(false);
    resolve(3);
    await espera();
    expect(cache.read('k').data).toBe(3);
  });

  it('enquanto houver quem espere, a requisicao nao e cancelada', async () => {
    const cache = new QueryCache();
    let sinal!: AbortSignal;
    const fetcher = (s: AbortSignal) => {
      sinal = s;
      return new Promise<number>(() => undefined);
    };
    const a = cache.acquire('k', fetcher);
    cache.acquire('k', fetcher);
    a.release();
    await espera();
    expect(sinal.aborted).toBe(false);
  });

  it('soltar duas vezes o mesmo lease conta uma so', async () => {
    const cache = new QueryCache();
    let sinal!: AbortSignal;
    const fetcher = (s: AbortSignal) => {
      sinal = s;
      return new Promise<number>(() => undefined);
    };
    const a = cache.acquire('k', fetcher);
    cache.acquire('k', fetcher);
    a.release();
    a.release();
    await espera();
    expect(sinal.aborted).toBe(false);
  });

  it('recarga manual troca a consulta em voo; a resposta velha nao sobrescreve a nova', async () => {
    const cache = new QueryCache();
    const velha = controlada<string>();
    const nova = controlada<string>();
    cache.acquire('k', velha.fetcher);
    cache.acquire('k', nova.fetcher, { force: true });

    expect(nova.fetcher).toHaveBeenCalledTimes(1);
    nova.resolve('nova');
    await espera();
    velha.resolve('velha'); // chega depois, de uma consulta ja trocada
    await espera();

    expect(cache.read('k').data).toBe('nova');
  });
});

describe('QueryCache: escrita invalida o que esta guardado', () => {
  it('apos uma escrita, a proxima visita confere mesmo dentro do frescor', async () => {
    const cache = new QueryCache();
    const a = controlada<number>();
    cache.acquire('k', a.fetcher, { staleTime: 60_000 });
    a.resolve(1);
    await espera();

    cache.invalidateAll();
    // O dado continua na tela: so a proxima visita o confere.
    expect(cache.read('k').data).toBe(1);

    const b = controlada<number>();
    cache.acquire('k', b.fetcher, { staleTime: 60_000 });
    expect(b.fetcher).toHaveBeenCalledTimes(1);
    b.resolve(2);
    await espera();
    expect(cache.read('k').data).toBe(2);
    expect(cache.read('k').invalidated).toBe(false);
  });

  it('uma resposta que ja vinha em voo quando a escrita aconteceu nasce velha', async () => {
    const cache = new QueryCache();
    const a = controlada<number>();
    cache.acquire('k', a.fetcher, { staleTime: 60_000 });
    cache.invalidateAll(); // a escrita acontece no meio da consulta
    a.resolve(1);
    await espera();

    expect(cache.read('k').data).toBe(1);
    expect(cache.read('k').invalidated).toBe(true);

    const b = vi.fn(() => Promise.resolve(2));
    cache.acquire('k', b, { staleTime: 60_000 });
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('write() grava direto (atualizacao otimista) e conta como dado fresco', async () => {
    const cache = new QueryCache();
    cache.write('k', { n: 1 });
    expect(cache.read('k').data).toEqual({ n: 1 });
    cache.write<{ n: number }>('k', (atual) => ({ n: (atual?.n ?? 0) + 1 }));
    expect(cache.read('k').data).toEqual({ n: 2 });
    const b = vi.fn(() => Promise.resolve({ n: 9 }));
    cache.acquire('k', b);
    expect(b).not.toHaveBeenCalled();
  });
});

describe('QueryCache: erros', () => {
  it('falha ao atualizar mantem o dado antigo e registra o erro', async () => {
    const cache = new QueryCache();
    const a = controlada<number>();
    cache.acquire('k', a.fetcher, { staleTime: 0 });
    a.resolve(1);
    await espera();

    const b = controlada<number>();
    cache.acquire('k', b.fetcher, { staleTime: 0 });
    b.reject(new ApiError(503, 'internal_error', 'Servico indisponivel'));
    await espera();

    const entrada = cache.read<number>('k');
    expect(entrada.data).toBe(1); // o que a pessoa viu nao some
    expect(entrada.error?.status).toBe(503); // e o erro nao fica escondido
    expect(entrada.fetching).toBe(false);
  });

  it('um erro nao conta como dado fresco: a proxima visita tenta de novo', async () => {
    const cache = new QueryCache();
    const a = controlada<number>();
    cache.acquire('k', a.fetcher, { staleTime: 60_000 });
    a.reject(new ApiError(500, 'internal_error', 'falhou'));
    await espera();
    expect(cache.read('k').error).not.toBeNull();

    const b = controlada<number>();
    cache.acquire('k', b.fetcher, { staleTime: 60_000 });
    expect(b.fetcher).toHaveBeenCalledTimes(1);
    b.resolve(5);
    await espera();
    expect(cache.read('k').error).toBeNull();
    expect(cache.read('k').data).toBe(5);
  });

  it('um erro que nao e da API vira um erro generico, nunca uma excecao solta', async () => {
    const cache = new QueryCache();
    const a = controlada<number>();
    cache.acquire('k', a.fetcher);
    a.reject(new TypeError('boom'));
    await espera();
    expect(cache.read('k').error).toBeInstanceOf(ApiError);
  });
});

describe('QueryCache: esvaziar (logout, sessao expirada)', () => {
  it('descarta tudo, cancela o que esta em voo e avisa quem ouve', async () => {
    const cache = new QueryCache();
    const a = controlada<number>();
    cache.acquire('a', a.fetcher);
    a.resolve(1);
    await espera();

    let sinal!: AbortSignal;
    cache.acquire('b', (s) => {
      sinal = s;
      return new Promise<number>(() => undefined);
    });

    const avisos = vi.fn();
    const avisosEpoca = vi.fn();
    cache.subscribe('a', avisos);
    cache.subscribeEpoch(avisosEpoca);
    const antes = cache.epoch;

    cache.clear();

    expect(cache.read('a')).toBe(EMPTY);
    expect(cache.read('b')).toBe(EMPTY);
    expect(sinal.aborted).toBe(true);
    expect(cache.epoch).toBe(antes + 1);
    expect(avisos).toHaveBeenCalled();
    expect(avisosEpoca).toHaveBeenCalledTimes(1);
  });

  it('o dado de antes do logout nao volta nem por uma resposta tardia', async () => {
    const cache = new QueryCache();
    const tardia = controlada<string>();
    cache.acquire('k', tardia.fetcher);
    cache.clear();
    tardia.resolve('dado da pessoa anterior');
    await espera();
    expect(cache.read('k')).toBe(EMPTY);
  });
});

describe('replaceEqualDeep e makeKey', () => {
  it('reaproveita o que e igual, ate dentro de estruturas parcialmente iguais', () => {
    const antes = { a: [{ id: 1 }, { id: 2 }], b: { c: 1 } };
    const igual = replaceEqualDeep(antes, { a: [{ id: 1 }, { id: 2 }], b: { c: 1 } });
    expect(igual).toBe(antes);

    const parcial = replaceEqualDeep(antes, { a: [{ id: 1 }, { id: 3 }], b: { c: 1 } });
    expect(parcial).not.toBe(antes);
    expect(parcial.a[0]).toBe(antes.a[0]); // o item que nao mudou segue o mesmo
    expect(parcial.b).toBe(antes.b);
    expect(parcial.a[1]).toEqual({ id: 3 });
  });

  it('tipos diferentes, nulos e primitivos passam sem erro', () => {
    expect(replaceEqualDeep(undefined, { x: 1 })).toEqual({ x: 1 });
    expect(replaceEqualDeep(null, [1])).toEqual([1]);
    expect(replaceEqualDeep({ x: 1 }, [1])).toEqual([1]);
    expect(replaceEqualDeep(1, 2)).toBe(2);
    expect(replaceEqualDeep([1, 2], [1])).toEqual([1]);
  });

  it('a chave junta escopo e parametros, e parametros diferentes dao chaves diferentes', () => {
    expect(makeKey('x', ['t1', 1])).toBe(makeKey('x', ['t1', 1]));
    expect(makeKey('x', ['t1', 1])).not.toBe(makeKey('x', ['t1', 2]));
    expect(makeKey('x', ['t1'])).not.toBe(makeKey('y', ['t1']));
  });
});
