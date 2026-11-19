import { describe, expect, it } from 'vitest';
import { contatoPreenchido, institucionalPreenchido } from '@codeca/shared';

/**
 * As regras de "ja fez".
 *
 * E a parte que erra em silencio: um passo marcado como concluido sem a
 * pessoa ter feito nada nao quebra nada -- so ensina o caminho errado a quem
 * esta aprendendo a usar o painel.
 */

describe('institucional preenchido', () => {
  it('o nome da empresa sozinho NAO conta', () => {
    // Ele ja vem preenchido quando o site e criado. Conta-lo marcaria o
    // primeiro passo como feito antes do primeiro clique da pessoa.
    expect(institucionalPreenchido({ companyName: 'Clínica Sorriso' })).toBe(false);
  });

  it('qualquer campo escrito pela pessoa conta', () => {
    expect(institucionalPreenchido({ companyName: 'X', tagline: 'Sorrisos saudáveis' })).toBe(true);
    expect(institucionalPreenchido({ history: 'Fundada em 2003.' })).toBe(true);
    expect(institucionalPreenchido({ values: ['ética', 'cuidado'] })).toBe(true);
    expect(institucionalPreenchido({ foundedYear: 2003 })).toBe(true);
    expect(institucionalPreenchido({ coverImageId: 'img-1' })).toBe(true);
  });

  it('espaco em branco nao e conteudo', () => {
    expect(institucionalPreenchido({ tagline: '   ' })).toBe(false);
  });

  it('lista vazia nao e conteudo', () => {
    expect(institucionalPreenchido({ values: [], galleryImageIds: [] })).toBe(false);
  });

  it('documento ausente nao esta preenchido', () => {
    expect(institucionalPreenchido(null)).toBe(false);
    expect(institucionalPreenchido(undefined)).toBe(false);
    expect(institucionalPreenchido({})).toBe(false);
  });
});

describe('contato preenchido', () => {
  it('conta qualquer forma de falar com a empresa', () => {
    expect(contatoPreenchido({ email: 'contato@clinica.test' })).toBe(true);
    expect(contatoPreenchido({ phone: '(41) 3333-4444' })).toBe(true);
    expect(contatoPreenchido({ whatsapp: '41999990000' })).toBe(true);
  });

  it('endereco e horario sozinhos NAO contam', () => {
    // O passo se chama "diga como falar com voce". Um cadastro so com
    // endereco nao atende quem quer pedir um orcamento, e marca-lo como feito
    // faria a pessoa parar justamente antes da parte que importa.
    expect(
      contatoPreenchido({
        addressLine: 'Rua das Flores, 100',
        city: 'Curitiba',
        businessHours: 'Seg a sex, 9h as 18h',
        mapUrl: 'https://maps.example/abc',
      }),
    ).toBe(false);
  });

  it('espaco em branco nao e contato', () => {
    expect(contatoPreenchido({ email: '  ', phone: '' })).toBe(false);
  });

  it('documento ausente nao esta preenchido', () => {
    expect(contatoPreenchido(null)).toBe(false);
    expect(contatoPreenchido({})).toBe(false);
  });
});
