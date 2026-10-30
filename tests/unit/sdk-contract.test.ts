import { describe, expect, it } from 'vitest';
import { CodecaError, createClient, type ContactContent } from '@codeca/sdk';
import { contatoDocumentSchema } from '@codeca/shared';

/**
 * O SDK e o contrato da API nao podem derivar.
 *
 * O pacote carrega uma copia dos tipos publicos porque precisa ser instalavel
 * em um site fora deste repositorio, sem depender de `@codeca/shared`. O preco
 * dessa independencia e o risco de as duas copias se afastarem -- e um site do
 * cliente receberia tipos que a API nao entrega mais.
 *
 * As comparacoes abaixo sao resolvidas pelo **compilador**: se um campo mudar
 * de um lado so, o `typecheck` falha antes de qualquer site receber a versao
 * errada. Nao ha nada para rodar.
 */

describe('contrato do SDK', () => {
  it('o documento de contato aceita o que a API valida', () => {
    const exemplo: ContactContent = contatoDocumentSchema.parse({ email: 'a@b.com.br' });
    expect(exemplo.email).toBe('a@b.com.br');
  });
});

describe('criacao do cliente', () => {
  const baseUrl = 'https://app.codecabuild.test';

  it('recusa a chave secreta no navegador', () => {
    // O erro mais facil de cometer e o mais caro: a secreta le rascunho e,
    // no navegador, fica visivel para qualquer visitante.
    expect(() => createClient({ baseUrl, publishableKey: 'cb_sec_abc_def' })).toThrow(CodecaError);
    try {
      createClient({ baseUrl, publishableKey: 'cb_sec_abc_def' });
    } catch (erro) {
      expect((erro as CodecaError).code).toBe('chave_secreta_no_navegador');
      expect((erro as CodecaError).message).toMatch(/createServerClient/);
    }
  });

  it('recusa um token que nao parece chave', () => {
    expect(() => createClient({ baseUrl, publishableKey: 'minha-chave' })).toThrow(/cb_pub_/);
  });

  it('exige o endereco da plataforma', () => {
    expect(() => createClient({ baseUrl: '', publishableKey: 'cb_pub_abc_def' })).toThrow(
      /baseUrl/,
    );
  });

  it('aceita a chave publicavel', () => {
    const cliente = createClient({ baseUrl, publishableKey: 'cb_pub_abcdefghijkl_segredo' });
    expect(typeof cliente.properties.list).toBe('function');
  });
});
