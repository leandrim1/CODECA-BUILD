import { ApiError } from './api.js';
import { subscribeToWrites } from './api.js';

/**
 * Cache de consultas do painel.
 *
 * ## Por que existe
 *
 * Antes, cada tela guardava a propria resposta num `useState`. Sair da tela
 * descartava o dado, e voltar a ela comecava de zero: esqueleto, requisicao,
 * conteudo. Era isso que fazia o painel "piscar" a cada clique -- nao um bug
 * de CSS, e sim uma tela que ignorava ter ja visto aquela resposta.
 *
 * ## O contrato (stale-while-revalidate)
 *
 * - Com dado em cache, a tela o mostra **na hora**, sem esqueleto.
 * - Se o dado ja passou do tempo de frescor (`staleTime`), uma consulta corre
 *   **por tras**, e o conteudo e trocado quando ela chega -- sem apagar nada
 *   antes.
 * - Duas telas que pedem a mesma chave dividem **uma** requisicao.
 * - Toda escrita bem-sucedida marca tudo como velho: o dado continua na tela,
 *   mas a proxima visita o confere. Um cache que nao sabe que o cliente acabou
 *   de salvar um imovel mostra, na visao geral, uma contagem errada -- e
 *   informacao errada e pior que um esqueleto.
 *
 * ## O que este modulo nao faz
 *
 * Nao guarda nada no disco. A resposta de um painel multiempresa tem dado de
 * cliente; `localStorage` sobreviveria ao logout e a troca de usuario no mesmo
 * navegador. Memoria morre com a aba, e `clear()` a esvazia no logout.
 */

export interface Entry<T = unknown> {
  readonly data: T | undefined;
  readonly error: ApiError | null;
  /** Quando `data` chegou; 0 se nunca chegou. */
  readonly updatedAt: number;
  /** Uma escrita aconteceu depois que `data` chegou. */
  readonly invalidated: boolean;
  /** Ha uma consulta em curso para esta chave. */
  readonly fetching: boolean;
}

export const EMPTY: Entry = Object.freeze({
  data: undefined,
  error: null,
  updatedAt: 0,
  invalidated: false,
  fetching: false,
});

interface Inflight {
  controller: AbortController;
  /** Quantas telas esperam esta consulta; zero e a ordem de cancelar. */
  holders: number;
  /** Uma escrita aconteceu enquanto ela corria: a resposta ja nasce velha. */
  tainted: boolean;
  abortTimer: ReturnType<typeof setTimeout> | null;
}

export interface Lease {
  release: () => void;
}

export interface AcquireOptions {
  /** Ignora o frescor e busca de novo (recarga manual, depois de uma escrita). */
  force?: boolean;
  /** Por quanto tempo uma resposta vale sem ser conferida. */
  staleTime?: number;
}

/** Tempo padrao de frescor. Curto: o cliente edita e espera ver o resultado. */
export const DEFAULT_STALE_TIME_MS = 15_000;

const NOOP_LEASE: Lease = { release: () => undefined };

export class QueryCache {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly inflight = new Map<string, Inflight>();
  private readonly epochListeners = new Set<() => void>();
  private epochValue = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  // ---- leitura ----------------------------------------------------------

  read<T>(key: string): Entry<T> {
    return (this.entries.get(key) as Entry<T> | undefined) ?? (EMPTY as Entry<T>);
  }

  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(key);
    };
  }

  /** Muda quando o cache inteiro e esvaziado: quem ouve precisa buscar de novo. */
  get epoch(): number {
    return this.epochValue;
  }

  subscribeEpoch(listener: () => void): () => void {
    this.epochListeners.add(listener);
    return () => this.epochListeners.delete(listener);
  }

  // ---- escrita direta ---------------------------------------------------

  /** Grava um valor sem consultar a API (atualizacao otimista de uma tela). */
  write<T>(key: string, updater: T | ((current: T | undefined) => T | undefined)): void {
    const current = this.read<T>(key);
    const next = typeof updater === 'function'
      ? (updater as (c: T | undefined) => T | undefined)(current.data)
      : updater;
    if (next === undefined) return;
    this.set(key, { ...current, data: next, error: null, updatedAt: this.now() });
  }

  // ---- consulta ---------------------------------------------------------

  /**
   * Garante que a chave esta sendo buscada, se precisar.
   *
   * Devolve um `Lease`: enquanto houver quem segure um, a consulta segue; sem
   * ninguem, ela e cancelada. Uma resposta que ninguem espera mais nao deve
   * ocupar a conexao nem chegar depois de uma mais nova.
   */
  acquire<T>(
    key: string,
    fetcher: (signal: AbortSignal) => Promise<T>,
    options: AcquireOptions = {},
  ): Lease {
    const staleTime = options.staleTime ?? DEFAULT_STALE_TIME_MS;
    const entry = this.read<T>(key);
    let running = this.inflight.get(key);

    if (options.force && running) {
      // Uma recarga pedida de proposito nao pode ser atendida por uma consulta
      // que comecou antes da escrita que a motivou.
      running.controller.abort();
      if (running.abortTimer) clearTimeout(running.abortTimer);
      this.inflight.delete(key);
      const holders = running.holders;
      running = this.start(key, fetcher);
      running.holders = holders;
    }

    if (running) {
      running.holders += 1;
      if (running.abortTimer) {
        clearTimeout(running.abortTimer);
        running.abortTimer = null;
      }
      return this.lease(key, running);
    }

    const fresh =
      entry.data !== undefined
      && entry.error === null
      && !entry.invalidated
      && this.now() - entry.updatedAt < staleTime;
    if (fresh && !options.force) return NOOP_LEASE;

    const created = this.start(key, fetcher);
    created.holders = 1;
    return this.lease(key, created);
  }

  private start<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>): Inflight {
    const controller = new AbortController();
    const mine: Inflight = { controller, holders: 0, tainted: false, abortTimer: null };
    this.inflight.set(key, mine);
    this.set(key, { ...this.read(key), fetching: true });

    void fetcher(controller.signal).then(
      (result) => {
        if (this.inflight.get(key) !== mine) return;
        this.inflight.delete(key);
        const previous = this.read<T>(key);
        this.set(key, {
          data: replaceEqualDeep(previous.data, result),
          error: null,
          updatedAt: this.now(),
          invalidated: mine.tainted,
          fetching: false,
        });
      },
      (caught: unknown) => {
        if (this.inflight.get(key) !== mine) return;
        this.inflight.delete(key);
        const previous = this.read<T>(key);
        if (caught instanceof DOMException && caught.name === 'AbortError') {
          this.set(key, { ...previous, fetching: false });
          return;
        }
        const error = caught instanceof ApiError
          ? caught
          : new ApiError(0, 'internal_error', 'Erro inesperado.');
        // Mantem o dado antigo: uma falha ao atualizar nao apaga o que ja foi
        // visto, mas o erro fica registrado para a tela mostrar.
        this.set(key, { ...previous, error, fetching: false });
      },
    );

    return mine;
  }

  private lease(key: string, running: Inflight): Lease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        running.holders -= 1;
        if (running.holders > 0) return;
        // Cancela no proximo ciclo, e nao agora: o React em modo estrito
        // desmonta e remonta o efeito de imediato, e cancelar na hora
        // dobraria toda requisicao em desenvolvimento.
        running.abortTimer = setTimeout(() => {
          running.abortTimer = null;
          if (running.holders > 0 || this.inflight.get(key) !== running) return;
          this.inflight.delete(key);
          running.controller.abort();
          this.set(key, { ...this.read(key), fetching: false });
        }, 0);
      },
    };
  }

  // ---- invalidacao ------------------------------------------------------

  /** Uma escrita aconteceu: o que esta guardado pode estar velho. */
  invalidateAll(): void {
    for (const [key, entry] of this.entries) {
      if (entry.data !== undefined && !entry.invalidated) {
        this.entries.set(key, { ...entry, invalidated: true });
        // Sem avisar quem ouve: nada na tela muda por isso, so a proxima visita.
      }
    }
    for (const running of this.inflight.values()) running.tainted = true;
  }

  /** Esvazia tudo: logout, sessao expirada, troca de empresa. */
  clear(): void {
    for (const running of this.inflight.values()) {
      if (running.abortTimer) clearTimeout(running.abortTimer);
      running.controller.abort();
    }
    this.inflight.clear();
    const keys = [...this.entries.keys()];
    this.entries.clear();
    this.epochValue += 1;
    for (const key of keys) this.notify(key);
    for (const listener of this.epochListeners) listener();
  }

  // ---- interno ----------------------------------------------------------

  private set(key: string, entry: Entry): void {
    this.entries.set(key, entry);
    this.notify(key);
  }

  private notify(key: string): void {
    const set = this.listeners.get(key);
    if (!set) return;
    for (const listener of [...set]) listener();
  }
}

/**
 * Mantem a referencia antiga quando a nova resposta e igual.
 *
 * Sem isto, toda revalidacao em segundo plano trocaria o objeto da tela por um
 * identico e refaria a arvore inteira -- a conferencia silenciosa viraria uma
 * piscada. Com isto, uma resposta igual nao muda nada.
 */
export function replaceEqualDeep<T>(previous: unknown, next: T): T {
  if (previous === next) return next;
  if (Array.isArray(previous) && Array.isArray(next)) {
    let equal = previous.length === next.length;
    const merged = next.map((item, index) => {
      const reused = replaceEqualDeep(previous[index], item);
      if (reused !== previous[index]) equal = false;
      return reused;
    });
    return (equal ? previous : merged) as T;
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    const nextKeys = Object.keys(next);
    let equal = Object.keys(previous).length === nextKeys.length;
    const merged: Record<string, unknown> = {};
    for (const key of nextKeys) {
      const reused = replaceEqualDeep(previous[key], next[key]);
      merged[key] = reused;
      if (reused !== previous[key]) equal = false;
    }
    return (equal ? previous : merged) as T;
  }
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Chave estavel: o escopo da consulta mais seus parametros. */
export function makeKey(scope: string, deps: readonly unknown[]): string {
  return `${scope}|${JSON.stringify(deps)}`;
}

/** Instancia unica do painel. */
export const queryCache = new QueryCache();

// Toda escrita bem-sucedida envelhece o que esta guardado.
subscribeToWrites(() => queryCache.invalidateAll());
