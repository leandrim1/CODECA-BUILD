import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Telas por carregamento tardio, com a possibilidade de carregar antes do clique.
 *
 * O painel divide o codigo por tela para o primeiro acesso ser leve. O custo
 * dessa divisao e que o primeiro clique em cada item do menu espera um arquivo
 * da rede -- e e nessa espera que a tela "piscava" (um indicador de espera, e
 * so depois o conteudo). Como o menu ja diz quais telas esta pessoa alcanca, o
 * painel baixa essas telas quando o navegador esta ocioso, e na hora em que o
 * cursor chega a um item. Quando o clique acontece, o codigo ja esta la.
 */

type Loader = () => Promise<unknown>;

const registry = new Map<string, Loader>();

export function lazyRoute<T extends ComponentType<any>>(
  paths: readonly string[],
  loader: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  let pending: Promise<{ default: T }> | null = null;
  const load = (): Promise<{ default: T }> => {
    pending ??= loader().catch((error: unknown) => {
      // Uma falha de rede nao pode ficar guardada: a proxima tentativa precisa
      // poder buscar o arquivo de novo.
      pending = null;
      throw error;
    });
    return pending;
  };
  for (const path of paths) registry.set(path, load);
  return lazy(load);
}

/** `/painel/p/produtos-extra` e `/painel/p` carregam o mesmo codigo. */
function normalize(path: string): string {
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  return clean.startsWith('/painel/p/') ? '/painel/p' : clean;
}

/** Baixa o codigo da tela deste endereco, se houver; falhas ficam em silencio. */
export function preloadRoute(path: string): void {
  void registry.get(normalize(path))?.().catch(() => undefined);
}

/**
 * Baixa as telas da lista, uma a uma, quando o navegador esta ocioso.
 *
 * Uma de cada vez e sem pressa: isto nao pode competir com a tela que a pessoa
 * esta usando. Conexao economica (`saveData`) fica de fora -- ali o custo e do
 * usuario.
 */
export function preloadWhenIdle(paths: readonly string[]): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => undefined;

  const queue = [...new Set(paths)];
  let cancelled = false;
  let handle: number | ReturnType<typeof setTimeout> | undefined;
  const idle = (window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  });

  const next = () => {
    if (cancelled) return;
    const path = queue.shift();
    if (!path) return;
    preloadRoute(path);
    schedule();
  };
  const schedule = () => {
    handle = idle.requestIdleCallback
      ? idle.requestIdleCallback(next, { timeout: 2000 })
      : setTimeout(next, 150);
  };

  // Espera a tela atual assentar antes da primeira.
  handle = setTimeout(schedule, 600);

  return () => {
    cancelled = true;
    if (typeof handle === 'number' && idle.cancelIdleCallback) idle.cancelIdleCallback(handle);
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  };
}
