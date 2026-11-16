import { CircuitBreaker, CircuitOpenError } from '@codeca/database';
import { randomUUID } from 'node:crypto';
import type { Env } from '../env.js';

/**
 * Envio de e-mail transacional.
 *
 * Com `RESEND_API_KEY` configurada o envio e real. Sem a chave, as mensagens
 * vao para o log do servidor com o link de acao -- util em desenvolvimento e
 * honesto quanto ao fato de que o envio ainda depende de configuracao externa.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Rotulo usado nos logs; nunca inclui o token em claro. */
  kind:
    | 'verify_email'
    | 'reset_password'
    | 'invitation'
    | 'lead_notification'
    | 'login_code'
    /** Aviso operacional para quem opera a plataforma; nunca para cliente. */
    | 'ops_alert'
    /** Aviso sobre a conta, vindo da fila (`lib/mail/outbox.ts`). */
    | 'account_notice';
  /** Versao HTML. O texto simples vai sempre junto. */
  html?: string;
  /**
   * Chave de idempotencia no provedor. Quem envia da fila passa o id do
   * registro: uma nova tentativa do mesmo registro nao vira outro e-mail.
   */
  idempotencyKey?: string;
}

/**
 * Resultado de um envio.
 *
 * **`delivered` quer dizer "o provedor aceitou a mensagem", e nada alem
 * disso.** Nao e prova de que ela chegou a caixa de entrada: entrega,
 * devolucao e reclamacao de spam acontecem depois, e so o provedor sabe (ele
 * avisa por webhook, que esta plataforma ainda nao recebe -- ver
 * `docs/email.md`). O nome ficou por compatibilidade com quem ja o le.
 */
export interface MailResult {
  delivered: boolean;
  reason?: string;
  /** Quem aceitou a mensagem. */
  provider?: string;
  /** Identificador da mensagem no provedor, para procura-la no painel dele. */
  providerMessageId?: string;
  /** Quantas tentativas foram feitas. */
  attempts?: number;
  /**
   * `true` quando o provedor recusou ESTA mensagem (destinatario ou conteudo
   * invalido): repetir daria a mesma resposta. `false` na recusa por chave ou
   * dominio, que se resolve na configuracao. Ausente em falha passageira.
   */
  permanent?: boolean;
}

export interface Mailer {
  readonly configured: boolean;
  send: (message: MailMessage) => Promise<MailResult>;
}

export function createConsoleMailer(): Mailer {
  return {
    configured: false,
    async send(message) {
      // O codigo de acesso NUNCA vai para o log: quem lesse o log entraria na conta.
      const body = message.kind === 'login_code' ? '(conteúdo omitido: contém o código de acesso)' : message.text;
      console.info(
        `[mailer:console] ${message.kind} -> ${message.to}\n`
          + `assunto: ${message.subject}\n${body}`,
      );
      return { delivered: false, reason: 'RESEND_API_KEY não configurada; mensagem registrada no log.' };
    },
  };
}

/**
 * Prazo do provedor de e-mail.
 *
 * O envio acontece dentro da requisicao de cadastro. Sem prazo, um provedor
 * que nao responde prende a funcao ate o limite da plataforma e derruba um
 * cadastro que ja tinha dado certo no banco. A confirmacao pode ser reenviada;
 * a conta criada nao pode ser perdida.
 */
const MAIL_TIMEOUT_MS = 8_000;

/**
 * Nova tentativa em falha passageira.
 *
 * Uma unica repeticao, e so quando a falha voltou rapido (rede que caiu, 5xx,
 * 429). Depois de um estouro de prazo nao ha repeticao: a requisicao de quem
 * esta esperando o codigo de acesso ja consumiu o tempo que tinha.
 *
 * As duas tentativas levam a MESMA chave de idempotencia. Se a primeira chegou
 * ao provedor e so a resposta se perdeu, a segunda nao gera outro e-mail --
 * que e a diferenca entre repetir com seguranca e mandar o codigo duas vezes.
 */
const MAX_SEND_ATTEMPTS = 2;
const RETRY_WINDOW_MS = 3_000;
const RETRY_DELAY_MS = 400;

export function createResendMailer(apiKey: string, from: string): Mailer {
  /**
   * Disjuntor: depois de 5 falhas seguidas (rede ou 5xx) o provedor e dado como
   * fora por 30 s. Sem isto, cada cadastro/login durante a queda esperaria os 8 s
   * do prazo; com ele, a recusa e imediata e o usuario pode reenviar o codigo.
   * Respostas 4xx (chave, remetente) nao contam: nao indicam queda.
   */
  const breaker = new CircuitBreaker('resend', {
    failureThreshold: 5,
    cooldownMs: 30_000,
    isFailure: (error) => !(error instanceof ProviderRejected),
  });
  return {
    configured: true,
    async send(message) {
      // Uma chave por mensagem, igual em todas as tentativas dela.
      const idempotencyKey = message.idempotencyKey ?? randomUUID();
      const startedAt = Date.now();

      for (let attempt = 1; ; attempt += 1) {
        try {
          const aceito = await breaker.run(() => sendOnce(message, idempotencyKey));
          // Registro do envio: o tipo e o identificador no provedor. Nunca o
          // destinatario nem o conteudo.
          console.info(
            JSON.stringify({
              level: 'info',
              event: 'email_accepted',
              provider: 'resend',
              mailKind: message.kind,
              providerMessageId: aceito.providerMessageId ?? null,
              attempt,
            }),
          );
          return { ...aceito, attempts: attempt };
        } catch (error) {
          if (error instanceof CircuitOpenError) {
            return {
              delivered: false,
              reason: 'Provedor de e-mail indisponível no momento; tente reenviar em instantes.',
              provider: 'resend',
              attempts: attempt,
            };
          }
          if (error instanceof ProviderRejected) {
            // Recusa desta mensagem (chave, remetente, destinatario): repetir
            // daria a mesma resposta.
            return {
              delivered: false,
              reason: error.message,
              provider: 'resend',
              attempts: attempt,
              // 401/403 sao da NOSSA configuracao (chave, dominio nao verificado):
              // corrigida, a mesma mensagem passa. So o resto condena a mensagem.
              permanent: error.status !== 401 && error.status !== 403,
            };
          }

          const rapido = Date.now() - startedAt < RETRY_WINDOW_MS;
          if (attempt < MAX_SEND_ATTEMPTS && rapido) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            continue;
          }

          console.error('[mailer:resend] erro de rede', error instanceof Error ? error.message : error);
          return {
            delivered: false,
            reason:
              error instanceof TransientProviderError
                ? error.message
                : 'Falha de rede ao contatar o provedor de e-mail.',
            provider: 'resend',
            attempts: attempt,
          };
        }
      }
    },
  };

  async function sendOnce(
    message: MailMessage,
    idempotencyKey: string,
  ): Promise<{ delivered: true; provider: string; providerMessageId?: string }> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text();
      // O corpo da resposta nao contem segredos nossos, mas limitamos o log.
      console.error(`[mailer:resend] falha ${response.status}: ${detail.slice(0, 300)}`);
      const reason = `Provedor de e-mail respondeu ${response.status}.`;
      // 5xx e 429 indicam provedor com problema (conta para o disjuntor e
      // admite nova tentativa); os demais 4xx sao recusa desta mensagem.
      if (response.status >= 500 || response.status === 429) throw new TransientProviderError(reason);
      throw new ProviderRejected(reason, response.status);
    }
    const corpo = (await response.json().catch(() => null)) as { id?: unknown } | null;
    return {
      delivered: true,
      provider: 'resend',
      ...(typeof corpo?.id === 'string' ? { providerMessageId: corpo.id } : {}),
    };
  }
}

/** Falha passageira do provedor (5xx, 429): admite nova tentativa. */
class TransientProviderError extends Error {}

/** Recusa do provedor a esta mensagem; nao indica que ele esteja fora do ar. */
class ProviderRejected extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createMailer(env: Env): Mailer {
  if (env.RESEND_API_KEY) return createResendMailer(env.RESEND_API_KEY, env.MAIL_FROM);
  return createConsoleMailer();
}

/** Coleta mensagens em memoria; usado nos testes. */
export function createMemoryMailer(): Mailer & { outbox: MailMessage[] } {
  const outbox: MailMessage[] = [];
  return {
    configured: true,
    outbox,
    async send(message) {
      outbox.push(message);
      return { delivered: true };
    },
  };
}

// ------------------------------------------------- sonda do provedor

/**
 * Situacao do provedor de e-mail, como o painel mestre a mostra.
 *
 * Nenhum campo carrega a chave: a sonda devolve so o veredito e os dominios
 * cadastrados, que sao dados publicos do remetente.
 */
export interface MailProviderProbe {
  /** `true` quando a chave foi aceita pelo provedor. */
  ok: boolean;
  /** Motivo legivel quando nao esta ok. Nunca inclui a chave. */
  reason?: string;
  /** Codigo HTTP da resposta do provedor, quando houve resposta. */
  status?: number;
  /** Dominios cadastrados no provedor, com a situacao de verificacao. */
  domains?: Array<{ name: string; status: string; region?: string }>;
}

/**
 * Pergunta ao provedor se a chave vale e quais dominios estao verificados.
 *
 * E a unica forma honesta de responder "o envio funciona?" sem disparar um
 * e-mail de verdade: uma chave invalida, uma conta suspensa ou um dominio ainda
 * nao verificado aparecem aqui, antes de o primeiro cliente esquecer a senha.
 *
 * Usa uma rota de LEITURA do provedor (`GET /domains`), que nao envia nada e
 * nao cria nada.
 */
export async function probeMailProvider(
  apiKey: string,
  /** Cliente HTTP; os testes passam o deles, para nao tocar a rede. */
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<MailProviderProbe> {
  try {
    const response = await fetchImpl('https://api.resend.com/domains', {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason:
          response.status === 401 || response.status === 403
            ? 'O provedor recusou a chave (401/403). Confira RESEND_API_KEY.'
            : `O provedor respondeu ${response.status}.`,
      };
    }
    const payload = (await response.json()) as { data?: unknown };
    const lista = Array.isArray(payload.data) ? payload.data : [];
    return {
      ok: true,
      status: response.status,
      domains: lista.flatMap((item) => {
        if (typeof item !== 'object' || item === null) return [];
        const row = item as Record<string, unknown>;
        if (typeof row.name !== 'string') return [];
        return [
          {
            name: row.name,
            status: typeof row.status === 'string' ? row.status : 'desconhecido',
            ...(typeof row.region === 'string' ? { region: row.region } : {}),
          },
        ];
      }),
    };
  } catch (error) {
    // Prazo vencido ou rede: nao e veredito sobre a chave, e sobre o alcance.
    return {
      ok: false,
      reason:
        error instanceof Error && error.name === 'TimeoutError'
          ? `O provedor não respondeu em ${MAIL_TIMEOUT_MS / 1000}s.`
          : 'Não foi possível contatar o provedor de e-mail.',
    };
  }
}

/** Dominio do remetente configurado em `MAIL_FROM`, em minusculas. */
export function senderDomain(mailFrom: string): string | null {
  const match = mailFrom.match(/<([^>]+)>/);
  const address = (match?.[1] ?? mailFrom).trim();
  const domain = address.split('@')[1]?.trim().toLowerCase();
  return domain && domain.length > 0 ? domain : null;
}
