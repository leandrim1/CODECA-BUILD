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
   * Pendencia da assinatura do site.
   *
   * Nao e problema do codigo do site e nao se resolve repetindo a chamada:
   * quem a resolve e a empresa, no painel. Separado de `isAuthError` por
   * isso -- a credencial esta correta. O conteudo continua guardado na
   * plataforma e volta a responder quando a pendencia se resolve, entao o
   * site faz melhor mostrando o que tem em cache do que uma pagina de erro.
   */
  get isSuspended(): boolean {
    return this.code === 'subscription_required';
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
