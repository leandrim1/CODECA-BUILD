import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../services/api.js';
import { makeKey, queryCache, type Entry } from '../services/queryCache.js';

/**
 * Carregamento de dados da API, sobre o cache de consultas.
 *
 * A assinatura pede um **escopo** (`'bannerApi.list'`) alem do que busca: o
 * escopo, junto dos parametros, e a chave do cache. Sem ele nao ha como saber
 * que duas telas pedem a mesma coisa -- e e isso que permite mostrar o dado
 * que ja chegou em vez de recomecar do esqueleto.
 *
 * - `initialLoading`: nao ha nada para mostrar ainda (esqueleto).
 * - `refreshing`: ha dado na tela e uma conferencia corre por tras.
 * - `error` com `data`: a conferencia falhou, mas o que foi visto continua ali.
 */

export interface ResourceState<T> {
  data: T | null;
  error: ApiError | null;
  /** Ha uma consulta em curso, haja ou nao dado na tela. */
  loading: boolean;
  /** Nao ha dado nenhum para mostrar: a tela deve exibir o esqueleto. */
  initialLoading: boolean;
  /** Ha dado na tela e uma conferencia corre por tras. */
  refreshing: boolean;
  /** Busca de novo, ignorando o frescor. */
  reload: () => void;
  setData: (updater: T | ((current: T | null) => T | null)) => void;
}

export interface ResourceOptions {
  enabled?: boolean;
  /** Quanto tempo a resposta vale sem ser conferida (ms). */
  staleTime?: number;
  /**
   * Enquanto os parametros mudam, mantem a resposta da chave anterior na tela.
   *
   * Certo para filtro e paginacao -- a lista nao some a cada tecla. Errado para
   * "o detalhe de outro registro", onde mostrar o anterior seria exibir a
   * informacao de um item sob o titulo de outro; la, passe `false`.
   */
  keepPrevious?: boolean;
  /**
   * Nunca mostra o que ja estava em cache: a tela comeca no esqueleto e espera
   * a resposta, como antes do cache existir.
   *
   * Para o que alimenta um **formulario de edicao** aberto sobre um registro
   * (um modal, um painel). Mostrar a copia guardada e conferi-la depois
   * trocaria os valores sob a mao de quem ja comecou a digitar. A resposta
   * ainda entra no cache -- outras telas se beneficiam dela.
   */
  fresh?: boolean;
}

export function useResource<T>(
  scope: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: ResourceOptions = {},
): ResourceState<T> {
  const enabled = options.enabled ?? true;
  const fresh = options.fresh ?? false;
  const keepPrevious = fresh ? false : (options.keepPrevious ?? true);
  const key = makeKey(scope, deps);

  const subscribe = useCallback((listener: () => void) => queryCache.subscribe(key, listener), [key]);
  const entry = useSyncExternalStore(
    subscribe,
    () => queryCache.read<T>(key),
    () => queryCache.read<T>(key),
  );
  const epoch = useSyncExternalStore(
    (listener) => queryCache.subscribeEpoch(listener),
    () => queryCache.epoch,
    () => queryCache.epoch,
  );

  // Quando este uso do hook nasceu: com `fresh`, so conta o dado que chegou depois.
  const mountedAt = useRef(Date.now());
  const firstRun = useRef(true);
  const usable: Entry<T> =
    fresh && entry.data !== undefined && entry.updatedAt < mountedAt.current
      ? { ...entry, data: undefined }
      : entry;

  const [nonce, setNonce] = useState(0);
  const forcedNonce = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const staleTimeRef = useRef(options.staleTime);
  staleTimeRef.current = options.staleTime;

  // A ultima resposta vista por este uso do hook, para `keepPrevious`.
  const previous = useRef<T | undefined>(undefined);
  if (usable.data !== undefined) previous.current = usable.data;

  useEffect(() => {
    if (!enabled) return undefined;
    const force = nonce !== forcedNonce.current || (fresh && firstRun.current);
    forcedNonce.current = nonce;
    firstRun.current = false;
    const lease = queryCache.acquire<T>(key, (signal) => fetcherRef.current(signal), {
      force,
      ...(staleTimeRef.current !== undefined ? { staleTime: staleTimeRef.current } : {}),
    });
    return lease.release;
  }, [key, enabled, nonce, epoch, fresh]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const setData = useCallback(
    (updater: T | ((current: T | null) => T | null)) => {
      queryCache.write<T>(key, (current) =>
        typeof updater === 'function'
          ? ((updater as (c: T | null) => T | null)(current ?? null) ?? undefined)
          : updater,
      );
    },
    [key],
  );

  return project(usable, enabled, keepPrevious ? previous.current : undefined, reload, setData);
}

function project<T>(
  entry: Entry<T>,
  enabled: boolean,
  placeholder: T | undefined,
  reload: () => void,
  setData: ResourceState<T>['setData'],
): ResourceState<T> {
  const shown = entry.data ?? placeholder;
  // Antes de o efeito iniciar a consulta nao ha dado nem erro nem `fetching`:
  // contar isso como "carregando" evita um quadro com a tela vazia.
  const pending = enabled && entry.data === undefined && entry.error === null;
  const loading = enabled && (entry.fetching || pending);
  return {
    data: shown ?? null,
    error: entry.error,
    loading,
    initialLoading: loading && shown === undefined,
    refreshing: enabled && entry.fetching && shown !== undefined,
    reload,
    setData,
  };
}

export interface MutationState<TInput, TOutput> {
  run: (input: TInput) => Promise<TOutput | null>;
  loading: boolean;
  error: ApiError | null;
  reset: () => void;
}

/**
 * Executa uma operacao de escrita, expondo carregamento e erro.
 * Devolve `null` quando a chamada falha, para o componente decidir o que fazer.
 */
export function useMutation<TInput, TOutput>(
  action: (input: TInput) => Promise<TOutput>,
  options: {
    onSuccess?: (result: TOutput, input: TInput) => void;
    onError?: (error: ApiError, input: TInput) => void;
  } = {},
): MutationState<TInput, TOutput> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const actionRef = useRef(action);
  actionRef.current = action;

  // Trava sincrona contra clique duplo: `loading` so muda no proximo render, e
  // dois cliques no mesmo tick enviariam a operacao duas vezes (duas empresas,
  // dois lancamentos...). Enquanto uma execucao esta em andamento, a seguinte
  // devolve `null` sem chamar a API.
  const inFlight = useRef(false);

  const run = useCallback(async (input: TInput) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await actionRef.current(input);
      optionsRef.current.onSuccess?.(result, input);
      return result;
    } catch (caught) {
      const apiError =
        caught instanceof ApiError ? caught : new ApiError(0, 'internal_error', 'Erro inesperado.');
      setError(apiError);
      optionsRef.current.onError?.(apiError, input);
      return null;
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => setError(null), []);

  return { run, loading, error, reset };
}

/** Valor atrasado, usado em campos de busca. */
export function useDebounced<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
