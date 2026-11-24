import { describe, expect, it } from 'vitest';
import {
  REGRAS_DE_SENHA,
  forcaDaSenha,
  mensagemDeSenhaInvalida,
  regrasDeSenhaPendentes,
  validarSenha,
  registerSchema,
} from '@codeca/shared';

/**
 * As regras de senha, conferidas na funcao que tela e servidor compartilham.
 *
 * Os quatro primeiros casos sao os da especificacao: cada um isola UMA regra
 * que falta, para que uma expressao quebrada apareca como a regra errada e nao
 * como um "invalida" generico.
 */

describe('validarSenha', () => {
  it('"abc" atende so a minuscula', () => {
    expect(validarSenha('abc')).toEqual({
      min10: false,
      maiuscula: false,
      minuscula: true,
      numero: false,
      especial: false,
      valida: false,
    });
  });

  it('"Abcdefghij1" so fica devendo o caractere especial', () => {
    const status = validarSenha('Abcdefghij1');
    expect(regrasDeSenhaPendentes(status)).toEqual(['especial']);
    expect(status.valida).toBe(false);
  });

  it('"Abcdefgh1!" e valida com exatamente 10 caracteres', () => {
    expect('Abcdefgh1!').toHaveLength(10);
    expect(validarSenha('Abcdefgh1!').valida).toBe(true);
  });

  it('"abcdefgh1!" so fica devendo a maiuscula', () => {
    expect(regrasDeSenhaPendentes(validarSenha('abcdefgh1!'))).toEqual(['maiuscula']);
  });

  /*
    O portugues e o motivo de as classes serem Unicode: com `[^A-Za-z0-9]`, o
    "ç" contaria como simbolo e esta senha passaria sem nenhum caractere
    especial de verdade.
  */
  it('letra acentuada e letra -- nao conta como caractere especial', () => {
    const status = validarSenha('Coraçãozinho1');
    expect(status.especial).toBe(false);
    expect(status.maiuscula).toBe(true);
    expect(status.minuscula).toBe(true);
    expect(validarSenha('Coraçãozinho1!').especial).toBe(true);
  });

  it('acento sozinho ja serve de maiuscula ou minuscula', () => {
    expect(validarSenha('ÉPOCADOANO1!').maiuscula).toBe(true);
    expect(validarSenha('ÉPOCADOANO1!').minuscula).toBe(false);
  });

  it('conta simbolos, e nao unidades UTF-16', () => {
    // Nove emojis sao 18 unidades UTF-16: contar `.length` aceitaria a senha.
    expect(validarSenha('😀'.repeat(9)).min10).toBe(false);
    expect(validarSenha('😀'.repeat(10)).min10).toBe(true);
  });

  it('nao quebra com valor ausente ou de outro tipo', () => {
    expect(validarSenha(undefined).valida).toBe(false);
    expect(validarSenha(null).valida).toBe(false);
    expect(validarSenha(12345678901).valida).toBe(false);
  });

  it('a forca acompanha a contagem de regras atendidas', () => {
    expect(forcaDaSenha(validarSenha(''))).toBe(0);
    expect(forcaDaSenha(validarSenha('abc'))).toBe(1);
    expect(forcaDaSenha(validarSenha('Abcdefghij1'))).toBe(4);
    expect(forcaDaSenha(validarSenha('Abcdefgh1!'))).toBe(REGRAS_DE_SENHA.length);
  });
});

describe('mensagem de recusa', () => {
  it('lista apenas o que falta, com "e" antes do ultimo', () => {
    expect(mensagemDeSenhaInvalida('abcdefgh1!')).toBe('A senha precisa de: uma letra maiúscula.');
    expect(mensagemDeSenhaInvalida('abcdefghij')).toBe('A senha precisa de: uma letra maiúscula, um número e um caractere especial.');
  });

  it('senha valida nao gera mensagem', () => {
    expect(mensagemDeSenhaInvalida('Abcdefgh1!')).toBe('');
  });
});

describe('o schema do cadastro cobra as mesmas regras', () => {
  const base = {
    name: 'Maria Souza',
    email: 'maria@empresa.com.br',
    companyName: 'Empresa da Maria',
    acceptedTerms: true as const,
  };

  it('recusa a senha fraca dizendo o que faltou', () => {
    const resultado = registerSchema.safeParse({ ...base, password: 'Abcdefghij1' });
    expect(resultado.success).toBe(false);
    const problema = resultado.error?.issues.find((issue) => issue.path[0] === 'password');
    expect(problema?.message).toBe('A senha precisa de: um caractere especial.');
  });

  it('aceita a senha que cumpre as cinco regras', () => {
    expect(registerSchema.safeParse({ ...base, password: 'Abcdefgh1!' }).success).toBe(true);
  });

  it('continua recusando senha acima do teto', () => {
    const resultado = registerSchema.safeParse({ ...base, password: `A1!${'a'.repeat(300)}` });
    expect(resultado.success).toBe(false);
  });
});
