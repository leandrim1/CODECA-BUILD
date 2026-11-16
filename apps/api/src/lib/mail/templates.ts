/**
 * Modelos dos avisos por e-mail sobre a conta.
 *
 * Os textos aqui foram aprovados pelo proprietario do produto. **Mudar um
 * texto e uma decisao dele, nao um ajuste de codigo.**
 *
 * Cada aviso sai em duas versoes com o MESMO conteudo: HTML e texto simples.
 * As duas nascem da mesma descricao (`Conteudo`), para nunca divergirem.
 *
 * Sem imagem, sem pixel de rastreamento, sem link encurtado. O cabecalho e o
 * nome da plataforma em texto: os logotipos do projeto estao em WebP, que o
 * Outlook de computador nao exibe.
 *
 * Nenhum modelo recebe -- nem aceita -- senha, token, codigo de acesso, motivo
 * de recusa de cartao ou dado de cartao.
 */

export const EMAIL_KINDS = [
  'welcome',
  'trial_ending_3d',
  'trial_ending_1d',
  'trial_ended',
  'payment_confirmed',
  'payment_failed',
  'subscription_overdue',
  'access_suspended',
  'subscription_canceled',
  'account_deleted',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Fuso em que "amanha", "em 3 dias" e as datas mostradas sao calculados. */
export const NOTICE_TIME_ZONE = 'America/Sao_Paulo';

export interface EmailVars {
  firstName: string;
  companyName: string;
  appUrl: string;
  supportEmail?: string | null;
  /** Datas ja formatadas (dd/mm/aaaa), no fuso dos avisos. */
  trialEndDate?: string;
  trialDays?: number;
  hasDemoSite?: boolean;
  planName?: string;
  amount?: string;
  confirmedAt?: string;
  nextChargeDate?: string | null;
  accessUntilDate?: string | null;
  suspensionReason?: 'overdue' | 'dispute' | 'admin';
  cancelMode?: 'scheduled' | 'immediate';
  hadSubscription?: boolean;
  date?: string;
}

interface Conteudo {
  subject: string;
  preview: string;
  /** Paragrafos; uma lista vira linhas "rotulo: valor". */
  body: Array<string | Array<[string, string]>>;
  button?: { label: string; path: string };
}

export interface RenderedEmail {
  subject: string;
  preview: string;
  text: string;
  html: string;
}

const SUSPENSAO: Record<NonNullable<EmailVars['suspensionReason']>, string> = {
  overdue: 'há um pagamento em atraso e o prazo de regularização terminou.',
  dispute: 'há um estorno ou contestação de pagamento em análise.',
  admin: 'a suspensão foi feita pela equipe da CODECA Build.',
};

function conteudo(kind: EmailKind, v: EmailVars): Conteudo {
  const ola = v.firstName ? `Olá, ${v.firstName}.` : 'Olá.';
  const contato = v.supportEmail ? ` — ou com a gente, em ${v.supportEmail}` : '';
  const faleConosco = v.supportEmail
    ? `fale com a gente, em ${v.supportEmail}`
    : 'fale com a equipe da CODECA Build';

  switch (kind) {
    case 'welcome':
      return {
        subject: 'Sua conta na CODECA Build está pronta',
        preview: v.hasDemoSite
          ? 'Seu painel e seu site de demonstração já estão no ar.'
          : 'Seu painel já está no ar.',
        body: [
          ola,
          `A conta de ${v.companyName} na CODECA Build está pronta.`,
          `Você tem ${v.trialDays} dias de avaliação gratuita, até ${v.trialEndDate}, para experimentar o painel.`,
          ...(v.hasDemoSite
            ? [
                'Já deixamos um site de demonstração conectado à sua conta, com alguns conteúdos de exemplo. '
                  + 'Edite um deles no painel e veja a mudança no site em poucos segundos.',
              ]
            : []),
          'Durante a avaliação não há cobrança. Para continuar depois dela, é só contratar um plano no painel, em Plano e assinatura.',
        ],
        button: { label: 'Acessar o painel', path: '/painel' },
      };

    case 'trial_ending_3d':
      return {
        subject: 'Sua avaliação termina em 3 dias',
        preview: `Vai até ${v.trialEndDate}. Veja como continuar.`,
        body: [
          ola,
          `A avaliação gratuita de ${v.companyName} termina em 3 dias, em ${v.trialEndDate}.`,
          'Depois dessa data, o painel fica disponível só para consulta e o site deixa de receber o conteúdo. Nada do que você cadastrou é apagado.',
          'Para continuar sem interrupção, contrate um plano antes do fim da avaliação.',
        ],
        button: { label: 'Ver planos', path: '/painel/plano' },
      };

    case 'trial_ending_1d':
      return {
        subject: 'Sua avaliação termina amanhã',
        preview: 'Último dia para contratar sem interrupção.',
        body: [
          ola,
          `A avaliação gratuita de ${v.companyName} termina amanhã, ${v.trialEndDate}.`,
          'A partir de então, o painel fica só para consulta e o site deixa de receber o conteúdo. O que você cadastrou continua salvo.',
          'Para continuar usando normalmente, contrate um plano em Plano e assinatura.',
        ],
        button: { label: 'Contratar um plano', path: '/painel/plano' },
      };

    case 'trial_ended':
      return {
        subject: 'Sua avaliação gratuita terminou',
        preview: 'Seu conteúdo continua salvo. Veja como continuar.',
        body: [
          ola,
          `O período de avaliação gratuita de ${v.companyName} terminou em ${v.trialEndDate}.`,
          'Nenhuma cobrança foi feita.',
          'Neste momento, o painel está disponível apenas para consulta e o site não recebe mais o conteúdo. '
            + 'Tudo o que você cadastrou continua salvo e volta a funcionar assim que um plano for contratado.',
        ],
        button: { label: 'Contratar um plano', path: '/painel/plano' },
      };

    case 'payment_confirmed':
      return {
        subject: 'Pagamento confirmado',
        preview: `Plano ${v.planName} ativo. Obrigado!`,
        body: [
          ola,
          `Confirmamos o pagamento da assinatura de ${v.companyName}.`,
          [
            ['Plano', v.planName ?? ''],
            ['Valor pago', v.amount ?? ''],
            ['Confirmado em', v.confirmedAt ?? ''],
            ['Situação da assinatura', 'ativa'],
            ...(v.nextChargeDate ? ([['Próxima cobrança', v.nextChargeDate]] as Array<[string, string]>) : []),
          ],
        ],
        button: { label: 'Acessar o painel', path: '/painel' },
      };

    case 'payment_failed':
      return {
        subject: 'Não conseguimos confirmar seu pagamento',
        preview: 'Você pode tentar de novo pelo painel.',
        body: [
          ola,
          `O pagamento da assinatura de ${v.companyName} não foi aprovado.`,
          'Isso pode acontecer por vários motivos, e não significa problema com a sua conta. '
            + 'Você pode tentar novamente, com a mesma forma de pagamento ou com outra, na área de cobrança do painel.',
          `Se a recusa continuar, fale com o banco ou a operadora do cartão${contato}.`,
        ],
        button: { label: 'Ir para a cobrança', path: '/painel/plano' },
      };

    case 'subscription_overdue':
      return {
        subject: 'Há um pagamento em atraso na sua assinatura',
        preview: 'Regularize pelo painel para evitar a suspensão.',
        body: [
          ola,
          `Há um pagamento em atraso na assinatura de ${v.companyName} (plano ${v.planName}).`,
          v.accessUntilDate
            ? `Seu acesso continua liberado até ${v.accessUntilDate}. Depois disso, ele é suspenso até a regularização.`
            : 'Seu acesso continua liberado por enquanto, e pode ser suspenso se o pagamento não for regularizado.',
          'Para regularizar, acesse a área de cobrança do painel.',
        ],
        button: { label: 'Regularizar agora', path: '/painel/plano' },
      };

    case 'access_suspended': {
      const motivo = v.suspensionReason ?? 'overdue';
      return {
        subject: 'O acesso da sua conta foi suspenso',
        preview: 'Seu conteúdo continua salvo. Veja como regularizar.',
        body: [
          ola,
          `O acesso de ${v.companyName} à CODECA Build foi suspenso.`,
          `Motivo: ${SUSPENSAO[motivo]}`,
          'Seu conteúdo não foi apagado.',
          motivo === 'overdue'
            ? 'Para voltar a usar, regularize o pagamento na área de cobrança.'
            : `Para entender o que aconteceu e como resolver, ${faleConosco}.`,
        ],
        ...(motivo === 'overdue' ? { button: { label: 'Regularizar agora', path: '/painel/plano' } } : {}),
      };
    }

    case 'subscription_canceled':
      return {
        subject: 'Cancelamento da assinatura confirmado',
        preview:
          v.cancelMode === 'scheduled' && v.accessUntilDate
            ? `Seu acesso continua até ${v.accessUntilDate}.`
            : 'Seu conteúdo continua salvo.',
        body: [
          ola,
          `O cancelamento da assinatura de ${v.companyName} foi confirmado em ${v.confirmedAt}.`,
          v.cancelMode === 'scheduled' && v.accessUntilDate
            ? `Seu acesso continua liberado até ${v.accessUntilDate}, fim do período já pago. Não haverá novas cobranças.`
            : 'A assinatura foi encerrada e não haverá novas cobranças.',
          'Seu conteúdo continua salvo. Se mudar de ideia, é só contratar um plano de novo pelo painel.',
        ],
        button: { label: 'Acessar o painel', path: '/painel/plano' },
      };

    case 'account_deleted':
      return {
        subject: `A exclusão de ${v.companyName} foi concluída`,
        preview: 'Os dados da empresa foram removidos.',
        body: [
          ola,
          `A exclusão de ${v.companyName} na CODECA Build foi concluída em ${v.date}, a seu pedido.`,
          'O conteúdo, as imagens e os dados da empresa foram removidos.'
            + (v.hadSubscription ? ' A assinatura foi cancelada e não haverá novas cobranças.' : ''),
          'Mantemos apenas o registro de que a exclusão foi pedida e concluída, como exige a lei.',
          `Se você não pediu esta exclusão, ${faleConosco} imediatamente.`,
        ],
      };
  }
}

const escapar = (texto: string): string =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function rodape(v: EmailVars): string[] {
  return [
    `Você recebeu este e-mail porque tem uma conta na CODECA Build, em nome de ${v.companyName}.`,
    'Este é um aviso sobre a sua conta, e não uma mensagem de divulgação.',
    ...(v.supportEmail ? [`Suporte: ${v.supportEmail}`] : []),
    'CODECA Build é uma plataforma da CODECA IA.',
  ];
}

export function renderEmail(kind: EmailKind, vars: EmailVars): RenderedEmail {
  const c = conteudo(kind, vars);
  const base = vars.appUrl.replace(/\/$/, '');
  const link = c.button ? `${base}${c.button.path}` : null;

  // ------------------------------------------------------------ texto simples
  const linhas: string[] = [];
  for (const bloco of c.body) {
    linhas.push(typeof bloco === 'string' ? bloco : bloco.map(([r, valor]) => `${r}: ${valor}`).join('\n'));
  }
  if (c.button && link) linhas.push(`${c.button.label}: ${link}`);
  const text = `${linhas.join('\n\n')}\n\n--\n${rodape(vars).join('\n')}\n`;

  // --------------------------------------------------------------------- html
  const paragrafos = c.body
    .map((bloco) =>
      typeof bloco === 'string'
        ? `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#1e293b;">${escapar(bloco)}</p>`
        : `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:15px;line-height:22px;color:#1e293b;">${bloco
            .map(
              ([r, valor]) =>
                `<tr><td style="padding:2px 16px 2px 0;color:#64748b;">${escapar(r)}</td><td style="padding:2px 0;font-weight:600;">${escapar(valor)}</td></tr>`,
            )
            .join('')}</table>`,
    )
    .join('');
  const botao =
    c.button && link
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:8px;background:#1d4ed8;"><a href="${escapar(link)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapar(c.button.label)}</a></td></tr></table>`
      : '';
  const pe = rodape(vars)
    .map((linha) => `<p style="margin:0 0 4px;font-size:12px;line-height:18px;color:#64748b;">${escapar(linha)}</p>`)
    .join('');

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(c.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapar(c.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;">
<tr><td style="padding:24px 28px 8px;font-size:20px;font-weight:700;color:#1d4ed8;">CODECA Build</td></tr>
<tr><td style="padding:16px 28px 8px;">${paragrafos}${botao}</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;">${pe}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: c.subject, preview: c.preview, text, html };
}

// ------------------------------------------------------------------- datas

/** Data (dd/mm/aaaa) no fuso dos avisos. */
export function formatNoticeDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: NOTICE_TIME_ZONE, dateStyle: 'short' }).format(date);
}

/** Dia do calendario (aaaa-mm-dd) no fuso dos avisos. */
export function noticeDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NOTICE_TIME_ZONE, dateStyle: 'short' }).format(date);
}

/** Hora (0-23) no fuso dos avisos. */
export function noticeHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: NOTICE_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(date),
  );
}

/** Quantos dias de calendario separam `from` de `to`, no fuso dos avisos. */
export function noticeDaysBetween(from: Date, to: Date): number {
  const dia = (d: Date) => Date.parse(`${noticeDay(d)}T00:00:00Z`);
  return Math.round((dia(to) - dia(from)) / 86_400_000);
}
