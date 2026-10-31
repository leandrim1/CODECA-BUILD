import { describe, expect, it } from 'vitest';
import { subPathAllowed } from '@codeca/api';

/**
 * Quem escapa das politicas do painel.
 *
 * Duas politicas dependem desta funcao -- plano sem painel e suspensao por
 * inadimplencia -- e as duas a usam para deixar passar a tela de cobranca.
 * Um acerto largo demais aqui nao quebra nada visivelmente: as rotas
 * respondem, a politica apenas deixa de valer, em silencio.
 *
 * Antes disto as politicas usavam `caminho.includes('/billing')`, que casa em
 * qualquer posicao; e a primeira versao com prefixos liberava tudo, porque
 * `''` concatenado com `/` vira `startsWith('/')`.
 */

const LIBERADOS = ['', '/contact', '/plan', '/billing', '/modules'];

describe('sufixo liberado', () => {
  it('libera a rota raiz da empresa e o que foi declarado', () => {
    expect(subPathAllowed('', LIBERADOS)).toBe(true);
    expect(subPathAllowed('/contact', LIBERADOS)).toBe(true);
    expect(subPathAllowed('/billing', LIBERADOS)).toBe(true);
    expect(subPathAllowed('/billing/charges', LIBERADOS)).toBe(true);
    expect(subPathAllowed('/modules/contato/document', LIBERADOS)).toBe(true);
  });

  it('nao libera o que nao foi declarado', () => {
    expect(subPathAllowed('/properties', LIBERADOS)).toBe(false);
    expect(subPathAllowed('/overview', LIBERADOS)).toBe(false);
    expect(subPathAllowed('/media', LIBERADOS)).toBe(false);
  });

  it('o prefixo vazio nao libera o resto', () => {
    // A falha que o teste de integracao pegou: `''` tratado como os outros
    // viraria `startsWith('/')` e deixaria passar todo caminho.
    expect(subPathAllowed('/properties', [''])).toBe(false);
    expect(subPathAllowed('/billing', [''])).toBe(false);
    expect(subPathAllowed('', [''])).toBe(true);
  });

  it('nao casa no meio do caminho', () => {
    // O problema do `includes`: um caminho de conteudo que contivesse o
    // trecho liberado escapava da politica.
    expect(subPathAllowed('/properties/billing', LIBERADOS)).toBe(false);
    expect(subPathAllowed('/leads/export/billing', LIBERADOS)).toBe(false);
  });

  it('nao confunde prefixo com inicio de outro nome', () => {
    // `/plano-antigo` nao e `/plan`: sem o separador, `startsWith` casaria.
    expect(subPathAllowed('/plano-antigo', LIBERADOS)).toBe(false);
    expect(subPathAllowed('/modules-internos', LIBERADOS)).toBe(false);
  });
});
