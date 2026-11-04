import { CircuitBreaker, CircuitOpenError } from '@codeca/database';
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
  kind: 'verify_email' | 'reset_password' | 'invitation' | 'lead_notification' | 'login_code';
}

export interface Mailer {
  readonly configured: boolean;
  send: (message: MailMessage) => Promise<{ delivered: boolean; reason?: string }>;
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
      try {
        return await breaker.run(() => sendOnce(message));
      } catch (error) {
        if (error instanceof CircuitOpenError) {
          return { delivered: false, reason: 'Provedor de e-mail indisponível no momento; tente reenviar em instantes.' };
        }
        if (error instanceof ProviderRejected) return { delivered: false, reason: error.message };
        console.error('[mailer:resend] erro de rede', error instanceof Error ? error.message : error);
        return { delivered: false, reason: 'Falha de rede ao contatar o provedor de e-mail.' };
      }
    },
  };

  async function sendOnce(message: MailMessage): Promise<{ delivered: true }> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text();
      // O corpo da resposta nao contem segredos nossos, mas limitamos o log.
      console.error(`[mailer:resend] falha ${response.status}: ${detail.slice(0, 300)}`);
      const reason = `Provedor de e-mail respondeu ${response.status}.`;
      // 5xx e 429 indicam provedor com problema (conta para o disjuntor); os
      // demais 4xx sao recusa desta mensagem.
      if (response.status >= 500 || response.status === 429) throw new Error(reason);
      throw new ProviderRejected(reason);
    }
    return { delivered: true };
  }
}

/** Recusa do provedor a esta mensagem; nao indica que ele esteja fora do ar. */
class ProviderRejected extends Error {}

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
