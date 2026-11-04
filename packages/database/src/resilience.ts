/**
 * Resiliencia de acesso ao banco: classificacao de erros e repeticao segura.
 *
 * ## O que e (e o que NAO e) repetido
 *
 * Repetir uma escrita que falhou no meio pode grava-la duas vezes. Por isso so
 * se repete o que **comprovadamente nao chegou ao banco**:
 *
 * - falha de rede ao estabelecer a conexao (`ECONNREFUSED`, `ENOTFOUND`,
 *   `EAI_AGAIN`, `ECONNRESET` antes da resposta);
 * - resposta 429/503 do gateway do Neon, que recusa antes de executar.
 *
 * Um tempo esgotado depois de enviada a consulta NAO e repetido: nao ha como
 * saber se ela foi aplicada.
 *
 * A espera cresce de forma exponencial e recebe sorteio ("jitter" total): sem
 * ele, todas as instancias que falharam juntas voltam juntas e derrubam o
 * banco de novo (efeito manada).
 */

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** SQLSTATE de "banco indisponivel / sobrecarregado / reiniciando". */
const TRANSIENT_SQLSTATE = new Set([
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
]);

function codeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: unknown }).cause;
  return cause ? codeOf(cause) : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

/**
 * O erro indica que o banco (ou o caminho ate ele) esta indisponivel agora?
 * Usado para responder 503 com `Retry-After` em vez de 500.
 */
export function isTransientDbError(error: unknown): boolean {
  const code = codeOf(error);
  if (code && (TRANSIENT_NETWORK_CODES.has(code) || TRANSIENT_SQLSTATE.has(code))) return true;
  const message = messageOf(error);
  return (
    /timeout exceeded when trying to connect/i.test(message) ||
    /connection terminated/i.test(message) ||
    /Connection terminated unexpectedly/i.test(message) ||
    /too many (clients|connections)/i.test(message) ||
    /the database system is (starting up|shutting down)/i.test(message) ||
    /fetch failed/i.test(message) ||
    /The operation was aborted due to timeout/i.test(message) ||
    (error instanceof Error && error.name === 'TimeoutError')
  );
}

/**
 * A falha ocorreu ANTES de a consulta chegar ao banco? Somente nesses casos a
 * repeticao e segura, mesmo para escrita.
 */
export function isSafeToRetry(error: unknown): boolean {
  const code = codeOf(error);
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return true;
  if (code === 'UND_ERR_CONNECT_TIMEOUT') return true;
  return false;
}

/** Espera com "full jitter": sorteio entre 0 e o teto exponencial. */
export function backoffDelayMs(attempt: number, baseMs = 100, capMs = 2_000, random = Math.random): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  capMs?: number;
  /** Decide se a falha pode ser repetida. Padrao: so se nada chegou ao banco. */
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export async function withRetry<T>(run: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const shouldRetry = options.shouldRetry ?? isSafeToRetry;
  const wait = options.sleep ?? sleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const delayMs = backoffDelayMs(attempt, options.baseMs, options.capMs, options.random);
      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await wait(delayMs);
    }
  }
}

/**
 * Disjuntor ("circuit breaker").
 *
 * Quando um servico externo falha varias vezes seguidas, continuar chamando so
 * consome o tempo da funcao esperando um prazo que vai estourar. O disjuntor
 * abre, recusa as chamadas na hora por `cooldownMs` e depois deixa passar UMA
 * tentativa de teste ("meio aberto"); se ela der certo, fecha.
 *
 * Estado por instancia: suficiente para proteger a funcao em que roda, sem
 * exigir armazenamento compartilhado.
 */
export class CircuitOpenError extends Error {
  constructor(readonly name_: string) {
    super(`Circuito aberto: ${name_} indisponível no momento.`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;

  constructor(
    readonly name: string,
    private readonly options: {
      failureThreshold?: number;
      cooldownMs?: number;
      now?: () => number;
      /** Quais erros contam como falha do servico (padrao: todos). */
      isFailure?: (error: unknown) => boolean;
    } = {},
  ) {}

  get state(): 'closed' | 'open' | 'half-open' {
    if (this.openedAt === null) return 'closed';
    const now = (this.options.now ?? Date.now)();
    return now - this.openedAt >= (this.options.cooldownMs ?? 30_000) ? 'half-open' : 'open';
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'open' || (state === 'half-open' && this.probing)) {
      throw new CircuitOpenError(this.name);
    }
    if (state === 'half-open') this.probing = true;
    try {
      const result = await fn();
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (error) {
      if (this.options.isFailure ? this.options.isFailure(error) : true) {
        this.failures += 1;
        if (state === 'half-open' || this.failures >= (this.options.failureThreshold ?? 5)) {
          this.openedAt = (this.options.now ?? Date.now)();
        }
      }
      throw error;
    } finally {
      this.probing = false;
    }
  }
}
