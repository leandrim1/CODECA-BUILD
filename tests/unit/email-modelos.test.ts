import { describe, expect, it } from 'vitest';
import { EMAIL_KINDS, parseEnv, renderEmail, signSvix, verifySvixSignature, type EmailVars } from '@codeca/api';

const base: EmailVars = {
  firstName: 'Marina',
  companyName: 'Padaria Aurora',
  appUrl: 'https://codecabuild.vercel.app/',
  trialEndDate: '16/03/2027',
  trialDays: 14,
  hasDemoSite: true,
  planName: 'Profissional',
  amount: 'R$ 59,90',
  confirmedAt: '07/03/2027',
  nextChargeDate: '07/04/2027',
  accessUntilDate: '20/03/2027',
  suspensionReason: 'overdue',
  cancelMode: 'scheduled',
  hadSubscription: true,
  date: '02/03/2027',
};

describe('modelos dos avisos', () => {
  it.each(EMAIL_KINDS)('%s: HTML e texto simples com o mesmo conteudo e a moldura comum', (kind) => {
    const email = renderEmail(kind, base);
    expect(email.subject.length).toBeGreaterThan(5);
    expect(email.preview.length).toBeGreaterThan(5);
    for (const versao of [email.text, email.html]) {
      expect(versao).toContain('Olá, Marina.');
      expect(versao).toContain('Você recebeu este e-mail porque tem uma conta na CODECA Build, em nome de Padaria Aurora.');
      expect(versao).toContain('Este é um aviso sobre a sua conta, e não uma mensagem de divulgação.');
      expect(versao).toContain('CODECA Build é uma plataforma da CODECA IA.');
      // Nada ficou por preencher.
      expect(versao).not.toMatch(/undefined|null|\{[a-z ]+\}/i);
    }
    // Sem imagem, sem pixel, sem recurso externo: o unico endereco e o do painel.
    expect(email.html).not.toMatch(/<img|<script|<link|<iframe/i);
    for (const url of email.html.match(/https?:\/\/[^"'\s<]+/g) ?? []) {
      expect(url.startsWith('https://codecabuild.vercel.app/painel')).toBe(true);
    }
  });

  it('dados da conta nao viram HTML: o nome da empresa e escapado', () => {
    const email = renderEmail('welcome', { ...base, companyName: '<script>alert(1)</script> & Cia' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Cia');
    expect(email.text).toContain('<script>alert(1)</script> & Cia');
  });

  it('linha de suporte: so aparece quando ha um contato configurado', () => {
    const sem = renderEmail('payment_failed', base);
    expect(sem.text).not.toContain('Suporte:');
    expect(sem.text).toContain('fale com o banco ou a operadora do cartão.');
    const com = renderEmail('payment_failed', { ...base, supportEmail: 'ajuda@exemplo.com.br' });
    expect(com.text).toContain('Suporte: ajuda@exemplo.com.br');
    expect(com.text).toContain('— ou com a gente, em ajuda@exemplo.com.br.');
  });

  it('acesso suspenso: so o atraso leva o botao de regularizar', () => {
    expect(renderEmail('access_suspended', base).text).toContain('Regularizar agora: https://codecabuild.vercel.app/painel/plano');
    for (const motivo of ['dispute', 'admin'] as const) {
      const email = renderEmail('access_suspended', { ...base, suspensionReason: motivo });
      expect(email.text).not.toContain('Regularizar agora');
      expect(email.html).not.toContain('<a ');
    }
  });

  it('boas-vindas sem site de demonstracao nao fala dele', () => {
    const email = renderEmail('welcome', { ...base, hasDemoSite: false });
    expect(`${email.preview}${email.text}`).not.toContain('demonstração');
  });

  it('cancelamento imediato nao promete acesso', () => {
    const email = renderEmail('subscription_canceled', { ...base, cancelMode: 'immediate', accessUntilDate: null });
    expect(email.text).toContain('A assinatura foi encerrada e não haverá novas cobranças.');
    expect(email.text).not.toContain('continua liberado');
  });

  it('nenhum modelo cita preco de plano: so o valor efetivamente pago', () => {
    for (const kind of EMAIL_KINDS) {
      const { text } = renderEmail(kind, { ...base, amount: 'VALOR' });
      expect(text).not.toMatch(/R\$/);
    }
  });
});

describe('assinatura do webhook do Resend (padrao Svix)', () => {
  const secret = `whsec_${Buffer.from('um-segredo-de-teste-qualquer').toString('base64')}`;
  const now = new Date('2027-03-02T15:00:00.000Z');
  const ts = Math.floor(now.getTime() / 1000);
  const corpo = '{"type":"email.delivered"}';
  const valida = { rawBody: corpo, id: 'msg_1', timestamp: String(ts), signature: `v1,${signSvix(secret, 'msg_1', ts, corpo)}`, secret, now };

  it('aceita a assinatura certa, inclusive entre varias no cabecalho', () => {
    expect(verifySvixSignature(valida)).toEqual({ valid: true });
    expect(verifySvixSignature({ ...valida, signature: `v1,AAAA ${valida.signature}` })).toEqual({ valid: true });
  });

  it('recusa corpo alterado, id trocado, segredo errado, cabecalho ausente e tempo fora da janela', () => {
    expect(verifySvixSignature({ ...valida, rawBody: `${corpo} ` })).toMatchObject({ failure: 'invalid_signature' });
    expect(verifySvixSignature({ ...valida, id: 'msg_2' })).toMatchObject({ failure: 'invalid_signature' });
    expect(verifySvixSignature({ ...valida, secret: 'whsec_b3V0cm8=' })).toMatchObject({ failure: 'invalid_signature' });
    expect(verifySvixSignature({ ...valida, signature: undefined })).toMatchObject({ failure: 'missing_headers' });
    expect(verifySvixSignature({ ...valida, timestamp: 'ontem' })).toMatchObject({ failure: 'invalid_timestamp' });
    expect(verifySvixSignature({ ...valida, now: new Date(now.getTime() + 6 * 60_000) })).toMatchObject({
      failure: 'timestamp_out_of_tolerance',
    });
  });
});

describe('configuracao dos avisos', () => {
  const minimo = { NODE_ENV: 'test', DATABASE_URL: 'postgres://x/y', AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres' };

  it('os avisos nascem desligados, e so "true" os liga', () => {
    expect(parseEnv(minimo).BILLING_EMAILS_ENABLED).toBe(false);
    expect(parseEnv({ ...minimo, BILLING_EMAILS_ENABLED: '' }).BILLING_EMAILS_ENABLED).toBe(false);
    expect(parseEnv({ ...minimo, BILLING_EMAILS_ENABLED: 'sim' }).BILLING_EMAILS_ENABLED).toBe(false);
    expect(parseEnv({ ...minimo, BILLING_EMAILS_ENABLED: 'TRUE' }).BILLING_EMAILS_ENABLED).toBe(true);
  });

  it('contato de suporte vazio ou invalido e ignorado, sem derrubar a API', () => {
    expect(parseEnv({ ...minimo, SUPPORT_EMAIL: '' }).SUPPORT_EMAIL).toBeUndefined();
    expect(parseEnv({ ...minimo, SUPPORT_EMAIL: 'nao-e-email' }).SUPPORT_EMAIL).toBeUndefined();
    expect(parseEnv({ ...minimo, SUPPORT_EMAIL: 'ajuda@exemplo.com.br' }).SUPPORT_EMAIL).toBe('ajuda@exemplo.com.br');
  });
});
