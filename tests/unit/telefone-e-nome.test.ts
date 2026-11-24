import { describe, expect, it } from 'vitest';
import {
  digitosDeTelefone,
  formatarTelefone,
  nomeFinal,
  nomeValido,
  registerSchema,
  sanitizarNome,
  telefoneValido,
} from '@codeca/shared';

/**
 * Telefone e nome: a mesma funcao que o campo usa na tela e o servidor cobra.
 *
 * Os casos da especificacao estao todos aqui, um por linha, para que uma
 * expressao quebrada apareca como o caso que ela quebrou.
 */

describe('telefone: digitos e mascara', () => {
  const casos: Array<[string, string, string]> = [
    // entrada               digitos          exibicao
    ['abc', '', ''],
    ['19999990000', '19999990000', '(19) 99999-0000'],
    ['1933330000', '1933330000', '(19) 3333-0000'],
    ['+55 19 99999-0000', '19999990000', '(19) 99999-0000'],
    ['(19) 99999-00001234', '19999990000', '(19) 99999-0000'],
    ['0 19 3333-0000', '1933330000', '(19) 3333-0000'],
  ];

  for (const [entrada, digitos, exibicao] of casos) {
    it(`"${entrada}" -> "${exibicao || '(vazio)'}"`, () => {
      expect(digitosDeTelefone(entrada)).toBe(digitos);
      expect(formatarTelefone(entrada)).toBe(exibicao);
    });
  }

  it('a mascara acompanha a digitacao, digito a digito', () => {
    const passos = ['', '(1', '(19', '(19) 9', '(19) 99', '(19) 999', '(19) 9999'];
    for (let i = 0; i < passos.length; i += 1) {
      expect(formatarTelefone('199999'.slice(0, i))).toBe(passos[i]);
    }
    // Dez digitos sao fixo; o decimo primeiro vira celular, sozinho.
    expect(formatarTelefone('1933330000')).toBe('(19) 3333-0000');
    expect(formatarTelefone('19333300001')).toBe('(19) 33330-0001');
  });

  it('o zero de operadora so cai quando o resto e um numero de verdade', () => {
    // `0 19 3333-0000`: o zero e prefixo, e o que sobra e um fixo completo.
    expect(digitosDeTelefone('0 19 3333-0000')).toBe('1933330000');
    // `(00) 99999-0000` nao tem prefixo: tem DDD inexistente. Os digitos ficam
    // como vieram, e quem reprova e a validacao -- comer o zero mostraria
    // `(99) 9990-000`, um numero que ninguem digitou.
    expect(digitosDeTelefone('(00) 99999-0000')).toBe('00999990000');
    expect(formatarTelefone('(00) 99999-0000')).toBe('(00) 99999-0000');
    expect(telefoneValido('(00) 99999-0000')).toBe(false);
  });

  it('DDD 55 e Santa Maria, e nao prefixo de pais', () => {
    expect(digitosDeTelefone('(55) 99999-0000')).toBe('55999990000');
    expect(telefoneValido('(55) 99999-0000')).toBe(true);
  });
});

describe('telefone: o que vale', () => {
  it('aceita fixo e celular com DDD existente', () => {
    expect(telefoneValido('1933330000')).toBe(true);
    expect(telefoneValido('19999990000')).toBe(true);
  });

  it('recusa DDD inexistente', () => {
    expect(telefoneValido('(00) 99999-0000')).toBe(false);
    expect(telefoneValido('(10) 99999-0000')).toBe(false);
  });

  it('recusa comprimento errado e celular sem o nono digito', () => {
    expect(telefoneValido('199999900')).toBe(false);
    expect(telefoneValido('19899990000')).toBe(false);
  });
});

describe('nome: limpeza', () => {
  const casos: Array<[string, string]> = [
    ["oajdwkoand1'313414", "oajdwkoand'"],
    ['João da Silva', 'João da Silva'],
    ["Ana-Maria D'Ávila", "Ana-Maria D'Ávila"],
    ['Maria 123 @#', 'Maria '],
    ['Maria 😀', 'Maria '],
  ];

  for (const [entrada, saida] of casos) {
    it(`"${entrada}" -> "${saida}"`, () => {
      expect(sanitizarNome(entrada)).toBe(saida);
    });
  }

  it('o blur apara as pontas e junta os espacos do meio', () => {
    expect(nomeFinal('   Pedro   Lima ')).toBe('Pedro Lima');
    expect(nomeFinal('Maria 123 @#')).toBe('Maria');
  });

  it('corta em 80 caracteres', () => {
    expect(sanitizarNome('a'.repeat(200))).toHaveLength(80);
  });
});

describe('nome: o que vale', () => {
  it('exige duas letras', () => {
    expect(nomeValido('Bo')).toBe(true);
    expect(nomeValido('B')).toBe(false);
    expect(nomeValido('')).toBe(false);
    expect(nomeValido("'-")).toBe(false);
  });
});

describe('o cadastro aplica as duas regras no servidor', () => {
  const base = {
    email: 'maria@empresa.com.br',
    password: 'Abcdefgh1!',
    companyName: '3M Soluções & Cia',
    acceptedTerms: true as const,
  };

  it('limpa o nome antes de guardar, em vez de recusar', () => {
    const r = registerSchema.safeParse({ ...base, name: '  Maria 123 @# ' });
    expect(r.success).toBe(true);
    expect(r.data?.name).toBe('Maria');
  });

  it('recusa nome sem duas letras', () => {
    const r = registerSchema.safeParse({ ...base, name: 'M1' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.find((i) => i.path[0] === 'name')?.message)
      .toBe('Informe seu nome usando apenas letras');
  });

  it('guarda o telefone so em digitos, venha como vier', () => {
    const r = registerSchema.safeParse({ ...base, name: 'Maria Souza', phone: '+55 (19) 99999-0000' });
    expect(r.success).toBe(true);
    expect(r.data?.phone).toBe('19999990000');
  });

  it('recusa DDD inexistente e aceita telefone vazio', () => {
    const ruim = registerSchema.safeParse({ ...base, name: 'Maria Souza', phone: '(00) 99999-0000' });
    expect(ruim.success).toBe(false);
    expect(ruim.error?.issues.find((i) => i.path[0] === 'phone')?.message)
      .toBe('Informe um telefone válido com DDD');

    const sem = registerSchema.safeParse({ ...base, name: 'Maria Souza', phone: '' });
    expect(sem.success).toBe(true);
    expect(sem.data?.phone).toBe('');
  });

  it('o nome da EMPRESA continua aceitando numero e simbolo', () => {
    const r = registerSchema.safeParse({ ...base, name: 'Maria Souza' });
    expect(r.success).toBe(true);
    expect(r.data?.companyName).toBe('3M Soluções & Cia');
  });
});
