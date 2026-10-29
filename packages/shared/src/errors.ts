/**
 * Erros padronizados da aplicacao. O `code` e estavel e pode ser usado pela
 * interface; a `message` e segura para exibir ao usuario final.
 */
export type AppErrorCode =
  | 'bad_request'
  | 'validation_error'
  | 'unauthenticated'
  | 'email_not_verified'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'plan_limit_reached'
  | 'storage_limit_reached'
  | 'rate_limited'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'integration_not_configured'
  | 'upstream_error'
  | 'internal_error';

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  bad_request: 400,
  validation_error: 422,
  unauthenticated: 401,
  email_not_verified: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  plan_limit_reached: 402,
  storage_limit_reached: 402,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  integration_not_configured: 501,
  upstream_error: 502,
  internal_error: 500,
};

export interface AppErrorBody {
  error: {
    code: AppErrorCode;
    message: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Quando true, o erro nao deve ser registrado como falha do servidor. */
  readonly expected: boolean;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
    this.expected = this.status < 500;
  }

  toBody(): AppErrorBody {
    return this.details === undefined
      ? { error: { code: this.code, message: this.message } }
      : { error: { code: this.code, message: this.message, details: this.details } };
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError('bad_request', message, details);
  }
  static validation(message: string, details?: unknown): AppError {
    return new AppError('validation_error', message, details);
  }
  static unauthenticated(message = 'Autenticacao necessaria.'): AppError {
    return new AppError('unauthenticated', message);
  }
  static forbidden(message = 'Voce nao tem permissao para esta operacao.'): AppError {
    return new AppError('forbidden', message);
  }
  static notFound(message = 'Registro nao encontrado.'): AppError {
    return new AppError('not_found', message);
  }
  static conflict(message: string, details?: unknown): AppError {
    return new AppError('conflict', message, details);
  }
  static planLimit(message: string, details?: unknown): AppError {
    return new AppError('plan_limit_reached', message, details);
  }
  static rateLimited(message = 'Muitas tentativas. Tente novamente em alguns instantes.'): AppError {
    return new AppError('rate_limited', message);
  }
  static notConfigured(message: string): AppError {
    return new AppError('integration_not_configured', message);
  }
  static internal(message = 'Erro interno. Tente novamente.'): AppError {
    return new AppError('internal_error', message);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
