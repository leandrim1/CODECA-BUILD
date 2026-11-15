import type { Database } from '@codeca/database';
import { consumeRateLimit } from '../ratelimit.js';

/**
 * Registro de falhas operacionais e alertas.
 *
 * ## Por que existe
 *
 * A plataforma so tinha `console` e contadores em memoria. Um webhook de
 * pagamento falhando, o e-mail recusado pelo provedor ou a conciliacao que
 * nao rodou ficavam num log que ninguem estava olhando -- e o primeiro a
 * descobrir era o cliente.
 *
 * ## O que e, e o que nao e
 *
 * E um ponto unico por onde as falhas passam, com duas saidas:
 *
 * 1. **uma linha estruturada no log**, sempre, sem dado sensivel;
 * 2. **um alerta** para quem opera, quando a falha pede acao: uma chamada HTTP
 *    para um endereco configurado (Slack, Discord, Teams ou qualquer receptor
 *    de webhook) e, opcionalmente, um e-mail.
 *
 * Nao e um rastreador de erros: nao agrupa ocorrencias, nao guarda historico
 * nem mostra pilha de chamadas num painel. Quando um servico desses for
 * escolhido (ver `docs/monitoramento.md`), ele entra como mais um destino em
 * `sinks` -- as chamadas espalhadas pelo codigo nao mudam.
 *
 * ## O que nunca sai daqui
 *
 * Senha, token, chave, segredo, codigo de acesso, cabecalho de autorizacao,
 * corpo de requisicao, e-mail completo de cliente. O contexto de um evento
 * aceita so valores simples, e passa por `redact` antes de qualquer saida:
 * chaves com nome suspeito sao trocadas por `[removido]`, e textos que parecem
 * e-mail, token ou chave sao mascarados.
 */

export type OpsSeverity = 'info' | 'warning' | 'critical';

/** Tipos de evento. Lista fechada: um nome novo e uma decisao, nao um descuido. */
export type OpsEventKind =
  | 'api_error'
  | 'unhandled_error'
  | 'db_unavailable'
  | 'auth_lockout'
  | 'email_failed'
  | 'webhook_rejected'
  | 'webhook_failed'
  | 'webhook_stuck'
  | 'webhook_deferred'
  | 'webhook_duplicate'
  | 'billing_provider_error'
  | 'reconcile_failed'
  | 'job_failed'
  | 'job_missed'
  | 'storage_error';

export type OpsContext = Record<string, string | number | boolean | null | undefined>;

export interface OpsEvent {
  kind: OpsEventKind;
  severity: OpsSeverity;
  /** Frase curta, legivel por quem opera. Sem dado de cliente. */
  message: string;
  /** Identificadores tecnicos: id de evento, rota, tentativa, codigo de erro. */
  context?: OpsContext;
  /** Erro original; so `name` e `message` sao aproveitados, ja mascarados. */
  error?: unknown;
  /**
   * Chave que agrupa alertas repetidos. O mesmo problema acontecendo mil
   * vezes vira um alerta por janela, nao mil. Padrao: o `kind`.
   */
  alertKey?: string;
}

/** Destino adicional de eventos (por exemplo, um rastreador de erros). */
export type OpsSink = (event: SanitizedOpsEvent) => void | Promise<void>;

export interface SanitizedOpsEvent {
  kind: OpsEventKind;
  severity: OpsSeverity;
  message: string;
  context: Record<string, string | number | boolean | null>;
  error: { name: string; message: string } | null;
  alertKey: string;
  at: string;
}

export interface Monitor {
  /**
   * Registra o evento e, se for o caso, alerta.
   *
   * **Nunca lanca.** Um defeito no monitoramento nao pode derrubar o pagamento
   * que ele estava observando. Devolve se um alerta saiu, para os testes.
   */
  report: (event: OpsEvent) => Promise<{ alerted: boolean }>;
}

export interface MonitorOptions {
  /** Endereco que recebe os alertas por HTTP. Sem ele, so o log. */
  alertWebhookUrl?: string | undefined;
  /** Envia o alerta por e-mail. Sem ele, so o webhook. */
  sendAlertEmail?: ((alert: { subject: string; text: string }) => Promise<void>) | undefined;
  /** Janela em que o mesmo alerta nao se repete, em segundos. */
  alertWindowSeconds?: number;
  /** Nome do ambiente, para o alerta dizer de onde veio. */
  environment?: string;
  fetch: typeof globalThis.fetch;
  now: () => Date;
  /** Banco, para o limite de repeticao valer entre instancias. */
  db?: Database | undefined;
  /** Destinos adicionais. */
  sinks?: OpsSink[];
  /** Saida do log; substituivel nos testes. */
  log?: (line: string, severity: OpsSeverity) => void;
}

const ALERT_TIMEOUT_MS = 4_000;
const DEFAULT_ALERT_WINDOW_SECONDS = 30 * 60;

/** Nomes de campo que nunca tem o valor registrado, seja qual for. */
const SENSITIVE_KEY =
  /pass(word)?|senha|secret|segredo|token|authorization|cookie|api[-_]?key|chave|credential|credencial|(login|access|auth|verification)[-_]?code|codigo[-_]?de[-_]?acesso|cvv|card|cartao|signature/i;

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
/**
 * Sequencias que parecem segredo: prefixos conhecidos de chave e blocos de 40+
 * caracteres. O limite fica acima de 36 de proposito: um UUID (id de evento,
 * de empresa) e identificador tecnico util, e nao pode ser mascarado.
 */
const LONG_SECRET = /\b(?:re|sk|pk|whsec)_[A-Za-z0-9_\-.]{8,}|\bBearer\s+[A-Za-z0-9_\-.]{8,}|\b[A-Za-z0-9_\-]{40,}\b/g;

/** Mascara o que parece dado pessoal ou segredo dentro de um texto livre. */
export function redactText(text: string): string {
  return text
    .replace(EMAIL, (_inteiro, dominio: string) => `***@${dominio}`)
    .replace(LONG_SECRET, '[removido]')
    .slice(0, 500);
}

/** Aplica as regras de mascaramento a um contexto. */
export function redact(context: OpsContext | undefined): Record<string, string | number | boolean | null> {
  const limpo: Record<string, string | number | boolean | null> = {};
  for (const [chave, valor] of Object.entries(context ?? {})) {
    if (valor === undefined) continue;
    if (SENSITIVE_KEY.test(chave)) {
      limpo[chave] = '[removido]';
      continue;
    }
    limpo[chave] = typeof valor === 'string' ? redactText(valor) : valor;
  }
  return limpo;
}

function sanitize(event: OpsEvent, now: Date): SanitizedOpsEvent {
  const erro = event.error;
  return {
    kind: event.kind,
    severity: event.severity,
    message: redactText(event.message),
    context: redact(event.context),
    error:
      erro === undefined || erro === null
        ? null
        : erro instanceof Error
          ? { name: erro.name, message: redactText(erro.message) }
          : { name: 'Erro', message: redactText(String(erro)) },
    alertKey: event.alertKey ?? event.kind,
    at: now.toISOString(),
  };
}

const defaultLog = (line: string, severity: OpsSeverity): void => {
  if (severity === 'info') console.info(line);
  else if (severity === 'warning') console.warn(line);
  else console.error(line);
};

export function createMonitor(options: MonitorOptions): Monitor {
  const windowSeconds = options.alertWindowSeconds ?? DEFAULT_ALERT_WINDOW_SECONDS;
  const log = options.log ?? defaultLog;
  /** Reserva para quando o banco nao responde -- que e justo quando mais se alerta. */
  const lastAlertAt = new Map<string, number>();

  /** `true` quando este alerta ainda nao saiu nesta janela. */
  async function firstInWindow(key: string, now: Date): Promise<boolean> {
    if (options.db) {
      try {
        const cota = await consumeRateLimit(
          options.db,
          { action: 'ops_alert', limit: 1, windowSeconds },
          key,
          now,
        );
        return cota.allowed;
      } catch {
        // Banco fora: cai para a memoria desta instancia. Pode repetir o
        // alerta entre instancias; melhor repetir do que calar.
      }
    }
    const ultimo = lastAlertAt.get(key);
    if (ultimo !== undefined && now.getTime() - ultimo < windowSeconds * 1000) return false;
    lastAlertAt.set(key, now.getTime());
    return true;
  }

  async function deliver(event: SanitizedOpsEvent): Promise<boolean> {
    const ambiente = options.environment ? ` [${options.environment}]` : '';
    const titulo = `CODECA Build${ambiente}: ${event.message}`;
    const detalhes = Object.entries(event.context)
      .map(([chave, valor]) => `${chave}: ${String(valor)}`)
      .join('\n');
    const corpo = [
      titulo,
      `Tipo: ${event.kind} · Gravidade: ${event.severity} · ${event.at}`,
      event.error ? `Erro: ${event.error.name}: ${event.error.message}` : '',
      detalhes,
      `Este aviso não se repete pelos próximos ${Math.round(windowSeconds / 60)} minutos, mesmo que o problema continue.`,
    ]
      .filter((linha) => linha !== '')
      .join('\n');

    let saiu = false;

    if (options.alertWebhookUrl) {
      try {
        const resposta = await options.fetch(options.alertWebhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // `text` e o campo do Slack e do Teams; `content`, o do Discord. Os
          // tres ignoram o campo que nao conhecem.
          body: JSON.stringify({ text: corpo, content: corpo, event }),
          signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
        });
        if (resposta.ok) saiu = true;
        else log(JSON.stringify({ level: 'error', event: 'ops_alert_undelivered', status: resposta.status }), 'critical');
      } catch (error) {
        log(
          JSON.stringify({
            level: 'error',
            event: 'ops_alert_undelivered',
            message: error instanceof Error ? redactText(error.message) : 'falha de rede',
          }),
          'critical',
        );
      }
    }

    // Avisar por e-mail que o e-mail nao funciona seria avisar ninguem.
    if (options.sendAlertEmail && event.kind !== 'email_failed') {
      try {
        await options.sendAlertEmail({ subject: titulo.slice(0, 180), text: corpo });
        saiu = true;
      } catch {
        log(JSON.stringify({ level: 'error', event: 'ops_alert_email_undelivered' }), 'critical');
      }
    }

    return saiu;
  }

  return {
    async report(event) {
      try {
        const now = options.now();
        const limpo = sanitize(event, now);

        log(
          JSON.stringify({
            level: limpo.severity === 'critical' ? 'error' : limpo.severity === 'warning' ? 'warn' : 'info',
            event: `ops.${limpo.kind}`,
            message: limpo.message,
            ...limpo.context,
            ...(limpo.error ? { errorName: limpo.error.name, errorMessage: limpo.error.message } : {}),
            at: limpo.at,
          }),
          limpo.severity,
        );

        for (const sink of options.sinks ?? []) {
          try {
            await sink(limpo);
          } catch {
            // Um destino quebrado nao impede os outros.
          }
        }

        if (limpo.severity !== 'critical') return { alerted: false };
        if (!options.alertWebhookUrl && !options.sendAlertEmail) return { alerted: false };
        if (!(await firstInWindow(limpo.alertKey, now))) return { alerted: false };

        return { alerted: await deliver(limpo) };
      } catch {
        // Ultima barreira: o monitoramento nunca derruba quem o chamou.
        return { alerted: false };
      }
    },
  };
}

/** Monitor que so descarta; para contextos montados sem configuracao. */
export function createSilentMonitor(): Monitor {
  return { report: async () => ({ alerted: false }) };
}
