import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api.js';

/**
 * Carregamento de dados da API.
 *
 * Um hook pequeno em vez de uma biblioteca de cache: a aplicacao precisa de
 * estado de carregamento, erro e recarga manual, e nada mais. Requisicoes em
 * voo sao canceladas quando as dependencias mudam, evitando que uma resposta
 * antiga sobrescreva uma mais nova.
 */

export interface ResourceState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** `true` apenas no primeiro carregamento, para exibir esqueleto. */
  initialLoading: boolean;
  reload: () => void;
  setData: (updater: T | ((current: T | null) => T | null)) => void;
}

export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: { enabled?: boolean } = {},
): ResourceState<T> {
  const enabled = options.enabled ?? true;
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return;
        setDataState(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof ApiError ? caught : new ApiError(0, 'internal_error', 'Erro inesperado.'));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setLoadedOnce(true);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const setData = useCallback((updater: T | ((current: T | null) => T | null)) => {
    setDataState((current) =>
      typeof updater === 'function' ? (updater as (c: T | null) => T | null)(current) : updater,
    );
  }, []);

  return { data, error, loading, initialLoading: loading && !loadedOnce, reload, setData };
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

  const run = useCallback(async (input: TInput) => {
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
