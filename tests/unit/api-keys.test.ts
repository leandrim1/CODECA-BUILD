import { describe, expect, it } from 'vitest';
import {
  API_KEY_PREFIXES,
  DEFAULT_SCOPES,
  maskApiKey,
  normalizeOrigin,
  originAllowed,
  parseApiKey,
} from '@codeca/shared';

/**
 * Formato das credenciais e autorizacao por origem.
 *
 * Estas funcoes recebem entrada da internet. Nenhuma delas pode lancar com
 * lixo: uma excecao aqui vira 500 e entrega a quem sonda um sinal diferente
 * do que recebe com uma chave so invalida.
 */

const publicavel = `${API_KEY_PREFIXES.publishable}_abcdefghijkl_${'s'.repeat(32)}`;
const secreta = `${API_KEY_PREFIXES.secret}_abcdefghijkl_${'s'.repeat(32)}`;

describe('formato do token', () => {
  it('separa tipo, localizador e segredo', () => {
    expect(parseApiKey(publicavel)).toEqual({
      kind: 'publishable',
      lookup: 'abcdefghijkl',
      secret: 's'.repeat(32),
    });
    expect(parseApiKey(secreta)?.kind).toBe('secret');
  });

  it.each([
    ['vazio', ''],
    ['so o prefixo', 'cb_pub_'],
    ['prefixo desconhecido', 'cb_adm_abcdefghijkl_ssssssssssssssssssssssssssssssss'],
    ['localizador curto', 'cb_pub_abc_ssssssssssssssssssssssssssssssss'],
    ['segredo curto', 'cb_pub_abcdefghijkl_curto'],
    ['caractere fora do alfabeto', 'cb_pub_abcdefghij$$_ssssssssssssssssssssssssssssssss'],
    ['json', '{"token":"x"}'],
    ['sql', "' or 1=1 --"],
  ])('recusa sem lancar: %s', (_nome, entrada) => {
    expect(() => parseApiKey(entrada)).not.toThrow();
    expect(parseApiKey(entrada)).toBeNull();
  });

  it('aceita localizador e segredo com os caracteres do base64url', () => {
    // `_` e `-` fazem parte do alfabeto. Procurar o separador com `indexOf`
    // cortava no lugar errado e a chave, existente no banco, virava invalida.
    const token = `${API_KEY_PREFIXES.secret}_ab_cd-efghij_${'x'.repeat(16)}_${'y'.repeat(16)}`;
    expect(parseApiKey(token)).toEqual({
      kind: 'secret',
      lookup: 'ab_cd-efghij',
      secret: `${'x'.repeat(16)}_${'y'.repeat(16)}`,
    });
  });

  it('a mascara nunca mostra o segredo', () => {
    const mascara = maskApiKey('secret', 'abcdefghijkl');
    expect(mascara).toContain('abcdefghijkl');
    expect(mascara).not.toContain('s'.repeat(8));
  });

  it('a chave publicavel nao recebe escopo de rascunho', () => {
    // Ela viaja no navegador: so o que ja e publico.
    expect(DEFAULT_SCOPES.publishable).not.toContain('content:draft');
    expect(DEFAULT_SCOPES.secret).toContain('content:draft');
  });
});

describe('normalizacao de origem', () => {
  it.each([
    ['https://exemplo.com.br', 'https://exemplo.com.br'],
    ['https://exemplo.com.br/', 'https://exemplo.com.br'],
    ['https://exemplo.com.br/pagina?x=1', 'https://exemplo.com.br'],
    ['https://EXEMPLO.com.br', 'https://exemplo.com.br'],
    ['https://exemplo.com.br:443', 'https://exemplo.com.br'],
    ['https://exemplo.com.br:8443', 'https://exemplo.com.br:8443'],
    ['http://localhost:5173', 'http://localhost:5173'],
  ])('%s -> %s', (entrada, esperado) => {
    expect(normalizeOrigin(entrada)).toBe(esperado);
  });

  it.each([
    ['sem esquema', 'exemplo.com.br'],
    ['http em producao', 'http://exemplo.com.br'],
    ['esquema nao web', 'javascript:alert(1)'],
    ['vazio', '   '],
  ])('recusa: %s', (_nome, entrada) => {
    expect(normalizeOrigin(entrada)).toBeNull();
  });
});

describe('autorizacao por origem', () => {
  const autorizadas = ['https://construtora.com.br', 'https://www.construtora.com.br'];

  it('aceita a origem exata, com ou sem barra final', () => {
    expect(originAllowed('https://construtora.com.br', autorizadas)).toBe(true);
    expect(originAllowed('https://construtora.com.br/', autorizadas)).toBe(true);
  });

  it('nao aceita sufixo: o truque classico de dominio', () => {
    // Comparacao por "termina com" autorizaria isto. Por isso e exata.
    expect(originAllowed('https://construtora.com.br.invasor.com', autorizadas)).toBe(false);
    expect(originAllowed('https://evilconstrutora.com.br', autorizadas)).toBe(false);
  });

  it('nao aceita subdominio nao cadastrado', () => {
    expect(originAllowed('https://teste.construtora.com.br', autorizadas)).toBe(false);
  });

  it('nao aceita http quando o cadastro e https', () => {
    expect(originAllowed('http://construtora.com.br', autorizadas)).toBe(false);
  });

  it('sem origem, nao autoriza', () => {
    expect(originAllowed(null, autorizadas)).toBe(false);
    expect(originAllowed(undefined, autorizadas)).toBe(false);
    expect(originAllowed('', autorizadas)).toBe(false);
  });

  it('site sem origem cadastrada nao autoriza ninguem', () => {
    expect(originAllowed('https://construtora.com.br', [])).toBe(false);
  });
});
