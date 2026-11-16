import { schema, asc } from '@codeca/database';
import type { MailMessage, MailResult, Mailer } from '@codeca/api';
import { TEST_JOB_SECRET, type TestApi } from './api.js';

/**
 * Provedor de e-mail roteirizado.
 *
 * Aceita tudo por padrao, devolvendo um id como o provedor de verdade. Um
 * teste pode enfileirar respostas para os proximos AVISOS (`account_notice`):
 * falha passageira, recusa definitiva. Os outros e-mails (confirmacao, codigo)
 * passam sempre, para o cadastro do cenario nao depender do roteiro.
 *
 * `calls` guarda toda chamada de aviso, inclusive as que falharam; `outbox`,
 * so o que foi aceito.
 */
export function createScriptedMailer() {
  const outbox: MailMessage[] = [];
  const calls: MailMessage[] = [];
  const script: MailResult[] = [];
  let seq = 0;
  const mailer: Mailer & {
    outbox: MailMessage[];
    calls: MailMessage[];
    failNext: (...results: MailResult[]) => void;
    lastId: () => string;
  } = {
    configured: true,
    outbox,
    calls,
    failNext: (...results) => void script.push(...results),
    lastId: () => `msg_${seq}`,
    async send(message) {
      if (message.kind === 'account_notice') {
        calls.push(message);
        const roteiro = script.shift();
        if (roteiro) return roteiro;
      }
      outbox.push(message);
      seq += 1;
      return { delivered: true, provider: 'resend', providerMessageId: `msg_${seq}`, attempts: 1 };
    },
  };
  return mailer;
}

export const TRANSIENT: MailResult = { delivered: false, reason: 'Resend respondeu 503.', provider: 'resend', attempts: 2 };
export const PERMANENT: MailResult = {
  delivered: false,
  reason: 'Resend respondeu 422: destinatário inválido.',
  provider: 'resend',
  attempts: 1,
  permanent: true,
};

/** Dispara uma das duas tarefas agendadas, como o agendador faria. */
export async function runJob(api: TestApi, job: 'reconcile' | 'sync') {
  const path = job === 'reconcile' ? '/api/billing/reconcile' : '/api/sync/run';
  const response = await api.app.request(`http://app.localhost:5173${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TEST_JOB_SECRET}` },
  });
  await api.settle();
  return { status: response.status, body: (await response.json()) as { data?: Record<string, any> } };
}

export function outboxRows(api: TestApi) {
  return api.db.select().from(schema.emailOutbox).orderBy(asc(schema.emailOutbox.createdAt));
}

/** Avisos aceitos pelo provedor, opcionalmente so os de um assunto. */
export function notices(api: TestApi, subject?: string | RegExp) {
  return api.outbox.filter(
    (m) =>
      m.kind === 'account_notice' &&
      (subject === undefined || (typeof subject === 'string' ? m.subject === subject : subject.test(m.subject))),
  );
}
