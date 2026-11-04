/**
 * Cache em memoria, com validade curta, limite de tamanho e deduplicacao.
 *
 * ## Por que em memoria, e nao Redis
 *
 * O que se quer evitar e a ida ao banco em CADA requisicao para repetir a mesma
 * pergunta ("esta sessao vale? este usuario pertence a esta empresa? o plano
 * inclui o painel?"). Para isso, uma memoria por instancia com validade de
 * segundos ja tira a esmagadora maioria das consultas -- sem servico novo, sem
 * custo novo, sem mais um ponto de falha. Redis so compensaria se a
 * invalidacao precisasse ser instantanea ENTRE instancias, e nao precisa: ver
 * `caches.ts` para o que cada validade custa em desatualizacao.
 *
 * ## O que garante
 *
 * - **Validade**: uma entrada nunca e entregue depois de `ttlMs`.
 * - **Limite**: nunca passa de `maxEntries`; a mais antiga sai primeiro. Um
 *   atacante que varie as chaves nao faz a memoria crescer sem fim.
 * - **Deduplicacao**: cem requisicoes simultaneas pela mesma chave fazem UMA
 *   consulta; as outras esperam o mesmo resultado. Sem isso, o instante em que
 *   uma entrada vence viraria uma enxurrada ("thundering herd") ao banco.
 * - **Erro nao e guardado**: se a consulta falha, a proxima tenta de novo.
 * - **Desligavel**: `ttlMs <= 0` faz tudo passar direto, como se nao existisse.
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly loading = new Map<string, Promise<V>>();
  hits = 0;
  misses = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Valor guardado e ainda valido, ou `undefined`. */
  peek(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (!this.enabled) return;
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      // A mais antiga (ordem de insercao do Map) sai.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.delete(key); // reinserir move para o fim
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /**
   * Devolve o valor guardado ou carrega UMA vez, ainda que muitos peçam ao mesmo
   * tempo. Uma chave carregada durante uma invalidacao nao e guardada (a
   * invalidacao a descarta), para nao ressuscitar um dado ja velho.
   */
  async getOrLoad(key: string, loader: () => Promise<V>): Promise<V> {
    if (!this.enabled) return loader();

    const cached = this.entries.get(key);
    if (cached) {
      if (cached.expiresAt > this.now()) {
        this.hits += 1;
        return cached.value;
      }
      this.entries.delete(key);
    }

    const inflight = this.loading.get(key);
    if (inflight) {
      this.hits += 1;
      return inflight;
    }

    this.misses += 1;
    const generation = this.generation;
    const promise = loader()
      .then((value) => {
        // Se houve invalidacao enquanto carregava, o valor pode ja estar velho.
        if (generation === this.generation) this.set(key, value);
        return value;
      })
      .finally(() => {
        if (this.loading.get(key) === promise) this.loading.delete(key);
      });
    this.loading.set(key, promise);
    return promise;
  }

  /** Cada invalidacao avanca a geracao: carregamentos em voo deixam de guardar. */
  private generation = 0;

  delete(key: string): void {
    this.generation += 1;
    this.entries.delete(key);
    this.loading.delete(key);
  }

  deleteWhere(predicate: (key: string, value: V) => boolean): void {
    this.generation += 1;
    for (const [key, entry] of this.entries) {
      if (predicate(key, entry.value)) this.entries.delete(key);
    }
    // Carregamentos em voo podem trazer o dado antigo: descartados.
    this.loading.clear();
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.loading.clear();
  }
}
