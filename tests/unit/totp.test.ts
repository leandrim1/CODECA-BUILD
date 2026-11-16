import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCode,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
  TOTP_STEP_SECONDS,
} from '@codeca/api';

/**
 * O algoritmo do segundo fator.
 *
 * O teste que importa e o primeiro: os vetores oficiais da RFC 6238. Se eles
 * passam, qualquer aplicativo autenticador do mercado conversa com a
 * plataforma -- e e exatamente isso que nao da para verificar "testando com o
 * proprio codigo que acabei de gerar", porque um erro no algoritmo passaria
 * despercebido nos dois lados.
 */

describe('RFC 6238: os vetores oficiais', () => {
  /** A chave de teste da RFC e a ASCII "12345678901234567890" (20 bytes). */
  const segredo = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

  /**
   * A RFC publica codigos de 8 digitos; a plataforma usa 6, que e o que os
   * aplicativos assumem. Os 6 digitos sao os ultimos dos 8 -- o truncamento e
   * o mesmo, so muda o modulo.
   */
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('t=%i produz o código oficial', (segundos, esperado8) => {
    const step = Math.floor(segundos / TOTP_STEP_SECONDS);
    expect(totpCode(segredo, step)).toBe(esperado8.slice(-6));
  });
});

describe('base32', () => {
  it('vai e volta sem perder byte', () => {
    for (const texto of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', '12345678901234567890']) {
      expect(base32Decode(base32Encode(Buffer.from(texto, 'ascii'))).toString('ascii')).toBe(texto);
    }
  });

  it('ignora espaço, hífen e minúscula: a pessoa digita o segredo à mão', () => {
    const segredo = generateTotpSecret();
    const bagunçado = `${segredo.slice(0, 4)} ${segredo.slice(4, 8)}-${segredo.slice(8)}`.toLowerCase();
    expect(base32Decode(bagunçado)).toEqual(base32Decode(segredo));
  });

  it('o segredo gerado tem 160 bits, como manda a RFC 4226', () => {
    const segredo = generateTotpSecret();
    expect(segredo).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(segredo)).toHaveLength(20);
  });
});

describe('conferência de código', () => {
  const segredo = generateTotpSecret();
  const agora = new Date('2027-06-01T10:00:00.000Z');
  const passo = totpStep(agora);

  it('aceita o código da janela atual', () => {
    expect(verifyTotp(segredo, totpCode(segredo, passo), agora)).toMatchObject({ valid: true, step: passo });
  });

  it('aceita uma janela para cada lado: relógio adiantado ou atrasado', () => {
    for (const delta of [-1, 1]) {
      expect(verifyTotp(segredo, totpCode(segredo, passo + delta), agora).valid).toBe(true);
    }
  });

  it('recusa duas janelas de distância', () => {
    for (const delta of [-2, 2, 10, -10]) {
      expect(verifyTotp(segredo, totpCode(segredo, passo + delta), agora).valid).toBe(false);
    }
  });

  it('recusa um passo já usado: o mesmo código não serve duas vezes', () => {
    const codigo = totpCode(segredo, passo);
    expect(verifyTotp(segredo, codigo, agora, passo).valid).toBe(false);
    // E um passo anterior ao último usado também não.
    expect(verifyTotp(segredo, totpCode(segredo, passo - 1), agora, passo).valid).toBe(false);
    // O seguinte continua valendo.
    expect(verifyTotp(segredo, totpCode(segredo, passo + 1), agora, passo).valid).toBe(true);
  });

  it('recusa o que não tem cara de código', () => {
    for (const lixo of ['', '12345', '1234567', 'abcdef', '12 34 56', '000000000']) {
      expect(verifyTotp(segredo, lixo, agora).valid, lixo).toBe(false);
    }
  });

  it('o código de um segredo não vale em outro', () => {
    const outro = generateTotpSecret();
    expect(verifyTotp(outro, totpCode(segredo, passo), agora).valid).toBe(false);
  });
});

describe('endereço do QR Code', () => {
  it('leva o que o aplicativo precisa, e nada além', () => {
    const uri = otpauthUri({ secret: 'ABCDEFGHIJKLMNOP', email: 'dona@padaria.com.br', issuer: 'Codeca Build' });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('secret=ABCDEFGHIJKLMNOP');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
    expect(uri).toContain(encodeURIComponent('Codeca Build:dona@padaria.com.br'));
  });
});

describe('códigos de recuperação', () => {
  it('são legíveis: sem caracteres que se confundem no papel', () => {
    for (let i = 0; i < 200; i += 1) {
      const codigo = generateRecoveryCode();
      expect(codigo).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
      // I, L, O, U, 0 e 1 ficam de fora: a pessoa copia da tela para um papel.
      expect(codigo).not.toMatch(/[ILOU01]/);
    }
  });

  it('não se repetem', () => {
    const vistos = new Set(Array.from({ length: 500 }, () => generateRecoveryCode()));
    expect(vistos.size).toBe(500);
  });
});
