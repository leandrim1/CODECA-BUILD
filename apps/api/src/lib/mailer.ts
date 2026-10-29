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
  kind: 'verify_email' | 'reset_password' | 'invitation' | 'lead_notification';
}

export interface Mailer {
  readonly configured: boolean;
  send: (message: MailMessage) => Promise<{ delivered: boolean; reason?: string }>;
}

export function createConsoleMailer(): Mailer {
  return {
    configured: false,
    async send(message) {
      console.info(
        `[mailer:console] ${message.kind} -> ${message.to}\n`
          + `assunto: ${message.subject}\n${message.text}`,
      );
      return { delivered: false, reason: 'RESEND_API_KEY nao configurada; mensagem registrada no log.' };
    },
  };
}

export function createResendMailer(apiKey: string, from: string): Mailer {
  return {
    configured: true,
    async send(message) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
        });
        if (!response.ok) {
          const detail = await response.text();
          // O corpo da resposta nao contem segredos nossos, mas limitamos o log.
          console.error(`[mailer:resend] falha ${response.status}: ${detail.slice(0, 300)}`);
          return { delivered: false, reason: `Provedor de e-mail respondeu ${response.status}.` };
        }
        return { delivered: true };
      } catch (error) {
        console.error('[mailer:resend] erro de rede', error instanceof Error ? error.message : error);
        return { delivered: false, reason: 'Falha de rede ao contatar o provedor de e-mail.' };
      }
    },
  };
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
