import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_SCHEMAS,
  MODULE_KEYS,
  MODULE_REGISTRY,
  blockedFields,
  changedKeys,
  effectiveFields,
  isFieldEditable,
  isModuleKey,
  policyKey,
  type DocumentModuleKey,
} from '@codeca/shared';

/**
 * Registro de modulos e politica de campos.
 *
 * O risco maior aqui nao e um bug de logica, e a **deriva**: o registro
 * descreve os campos que o painel desenha e a politica governa, enquanto o
 * schema valida o que entra no banco. Se os dois se afastarem, um campo passa
 * a existir na tela sem validacao, ou a ser validado sem ninguem poder
 * edita-lo. Os dois primeiros testes existem so para impedir isso.
 */

const DOCUMENTOS: DocumentModuleKey[] = ['institucional', 'contato'];

describe('registro e validacao andam juntos', () => {
  it.each(DOCUMENTOS)('todo campo de %s declarado tem validacao', (key) => {
    const schema = DOCUMENT_SCHEMAS[key];
    const validados = Object.keys(schema.shape);
    const declarados = MODULE_REGISTRY[key].fields.map((f) => f.key);

    const semValidacao = declarados.filter((campo) => !validados.includes(campo));
    expect(semValidacao, `campos sem validacao em ${key}`).toEqual([]);
  });

  it.each(DOCUMENTOS)('toda validacao de %s tem campo declarado', (key) => {
    const schema = DOCUMENT_SCHEMAS[key];
    const validados = Object.keys(schema.shape);
    const declarados = MODULE_REGISTRY[key].fields.map((f) => f.key);

    // Validar um campo que o registro nao declara significa um dado que
    // nenhuma tela mostra e nenhuma politica governa.
    const invisiveis = validados.filter((campo) => !declarados.includes(campo));
    expect(invisiveis, `campos sem declaracao em ${key}`).toEqual([]);
  });

  it('todo modulo de colecao aponta para uma tabela', () => {
    for (const key of MODULE_KEYS) {
      const definicao = MODULE_REGISTRY[key];
      if (definicao.kind !== 'collection') continue;
      expect(definicao.table, `modulo ${key} sem tabela`).toBeTruthy();
    }
  });

  it('nenhum modulo tem campo repetido', () => {
    for (const key of MODULE_KEYS) {
      const chaves = MODULE_REGISTRY[key].fields.map((f) => f.key);
      expect(new Set(chaves).size, `campos repetidos em ${key}`).toBe(chaves.length);
    }
  });
});

describe('politica de campos', () => {
  it('o padrao do registro vale sem excecao gravada', () => {
    const campos = effectiveFields('imoveis');
    const titulo = campos.find((f) => f.key === 'title');
    const slug = campos.find((f) => f.key === 'slug');

    expect(titulo!.editable).toBe(true);
    expect(titulo!.overridden).toBe(false);
    // O endereco na URL nasce travado: alterar quebra links divulgados.
    expect(slug!.editable).toBe(false);
  });

  it('a excecao do site sobrepoe o padrao, nos dois sentidos', () => {
    const overrides = {
      [policyKey('imoveis', 'slug')]: true,
      [policyKey('imoveis', 'price')]: false,
    };
    const campos = effectiveFields('imoveis', overrides);

    expect(campos.find((f) => f.key === 'slug')!.editable).toBe(true);
    expect(campos.find((f) => f.key === 'slug')!.overridden).toBe(true);
    expect(campos.find((f) => f.key === 'price')!.editable).toBe(false);
  });

  it('campo fora do registro nao e editavel', () => {
    // O que nao foi declarado nao pode ser gravado por engano.
    expect(isFieldEditable('imoveis', 'campoInventado')).toBe(false);
  });

  it('reenviar o mesmo valor de um campo travado nao bloqueia', () => {
    // Um formulario reenvia tudo. Recusar por reenviar o valor igual tornaria
    // a tela impossivel de usar.
    const atual = { title: 'Casa', slug: 'casa' };
    const enviado = { title: 'Casa nova', slug: 'casa' };

    expect(changedKeys(atual, enviado)).toEqual(['title']);
    expect(blockedFields('imoveis', changedKeys(atual, enviado))).toEqual([]);
  });

  it('alterar de fato um campo travado e bloqueado', () => {
    const atual = { title: 'Casa', slug: 'casa' };
    const enviado = { title: 'Casa', slug: 'casa-nova' };

    expect(blockedFields('imoveis', changedKeys(atual, enviado))).toEqual(['slug']);
  });

  it('ausente e nulo contam como o mesmo valor', () => {
    // O painel envia null onde o banco tem ausencia; isso nao e alteracao.
    expect(changedKeys({ slug: null }, {})).toEqual([]);
  });
});

describe('chaves de modulo', () => {
  it('reconhece apenas as chaves do registro', () => {
    expect(isModuleKey('imoveis')).toBe(true);
    expect(isModuleKey('paginas')).toBe(false);
  });
});
