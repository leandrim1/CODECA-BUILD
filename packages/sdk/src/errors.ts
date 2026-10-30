/**
 * Falhas que o site precisa distinguir.
 *
 * Um site que trata tudo como "deu erro" nao consegue decidir entre mostrar
 * 404, tentar de novo ou avisar que esta fora do ar. Por isso o erro carrega o
 * codigo da plataforma e o status HTTP.
 */
export class CodecaError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'CodecaError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** O recurso nao existe neste site. Renderize 404. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Credencial ausente, invalida, revogada ou origem nao autorizada. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** Limite de requisicoes. Vale esperar e tentar de novo. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /**
   * Falha de rede ou de transporte: a plataforma nao chegou a responder.
   *
   * Diferente de um erro da plataforma: aqui vale repetir a chamada, enquanto
   * um 422 repetido daria o mesmo resultado.
   */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}
