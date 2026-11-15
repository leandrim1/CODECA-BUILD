import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '@codeca/api';

/**
 * Configuração de apoio não derruba a plataforma.
 *
 * As variáveis essenciais (banco, segredo de sessão) falham na inicialização
 * quando estão erradas, e é o certo: sem elas nada funciona. As de apoio
 * -- endereço de alertas, prazos de ajuste -- não podem ter esse poder: um
 * erro de digitação no endereço do canal de ALERTAS tiraria o ar de todos os
 * clientes, e sem alerta.
 */

const essenciais = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://injected/test',
  AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  APP_URL: 'http://app.localhost:5173',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('variáveis de apoio', () => {
  it('ausentes: recurso desligado e prazos no padrão', () => {
    const env = parseEnv(essenciais);
    expect(env.OPS_ALERT_WEBHOOK_URL).toBeUndefined();
    expect(env.OPS_ALERT_EMAIL).toBeUndefined();
    expect(env.OPS_ALERT_WINDOW_MINUTES).toBe(30);
    expect(env.VALIDAPAY_WEBHOOK_RESPONSE_BUDGET_MS).toBe(2500);
  });

  it('vazias (como ficam ao copiar o .env.example): valem como ausentes', () => {
    const env = parseEnv({
      ...essenciais,
      OPS_ALERT_WEBHOOK_URL: '',
      OPS_ALERT_EMAIL: '  ',
      OPS_ALERT_WINDOW_MINUTES: '',
      VALIDAPAY_WEBHOOK_RESPONSE_BUDGET_MS: '',
    });
    expect(env.OPS_ALERT_WEBHOOK_URL).toBeUndefined();
    expect(env.OPS_ALERT_EMAIL).toBeUndefined();
    expect(env.OPS_ALERT_WINDOW_MINUTES).toBe(30);
    expect(env.VALIDAPAY_WEBHOOK_RESPONSE_BUDGET_MS).toBe(2500);
  });

  it('inválidas: ignoradas com aviso, e a aplicação sobe', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const env = parseEnv({
      ...essenciais,
      OPS_ALERT_WEBHOOK_URL: 'hooks.slack.com/services/SEGREDO-DO-CANAL',
      OPS_ALERT_EMAIL: 'nao-e-um-email',
      OPS_ALERT_WINDOW_MINUTES: 'trinta',
      VALIDAPAY_WEBHOOK_RESPONSE_BUDGET_MS: '99999',
    });

    expect(env.OPS_ALERT_WEBHOOK_URL).toBeUndefined();
    expect(env.OPS_ALERT_EMAIL).toBeUndefined();
    expect(env.OPS_ALERT_WINDOW_MINUTES).toBe(30);
    expect(env.VALIDAPAY_WEBHOOK_RESPONSE_BUDGET_MS).toBe(2500);

    // Avisa qual variável, sem repetir o valor: o endereço de um webhook de
    // alertas é, ele mesmo, um segredo.
    const avisos = aviso.mock.calls.map((chamada) => chamada.join(' ')).join('\n');
    expect(avisos).toContain('OPS_ALERT_WEBHOOK_URL');
    expect(avisos).not.toContain('SEGREDO-DO-CANAL');
  });

  it('válidas: são usadas', () => {
    const env = parseEnv({
      ...essenciais,
      OPS_ALERT_WEBHOOK_URL: 'https://alertas.exemplo.test/entrada',
      OPS_ALERT_EMAIL: 'operacao@exemplo.test',
      OPS_ALERT_WINDOW_MINUTES: '10',
      VALIDAPAY_WEBHOOK_RESPONSE_BUDGET_MS: '0',
    });
    expect(env.OPS_ALERT_WEBHOOK_URL).toBe('https://alertas.exemplo.test/entrada');
    expect(env.OPS_ALERT_EMAIL).toBe('operacao@exemplo.test');
    expect(env.OPS_ALERT_WINDOW_MINUTES).toBe(10);
    expect(env.VALIDAPAY_WEBHOOK_RESPONSE_BUDGET_MS).toBe(0);
  });

  it('as essenciais continuam falhando alto quando faltam', () => {
    expect(() => parseEnv({ NODE_ENV: 'test' })).toThrow();
  });
});
