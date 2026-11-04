import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANS,
  DEFAULT_SEGMENTS,
  MODULE_REGISTRY,
  PLAN_FEATURE_LABELS,
} from '@codeca/shared';

/**
 * Guarda de acentos nos textos de fabrica que o painel mostra.
 *
 * Nao e um corretor ortografico: so confere palavras que, escritas sem acento,
 * quase nunca sao outra palavra valida. O objetivo e impedir que um texto novo
 * volte a entrar sem acento sem ninguem perceber.
 */
const SEM_ACENTO = /\b(nao|sao|voce|servicos?|imoveis|imovel|conteudos?|dominio|proprio|descricao|publicacao|configuracoes|situacao|obrigatorio|catalogo|cardapio|titulo|endereco|area|modulos?|usuarios?)\b/i;

function textos(): string[] {
  const saida: string[] = [];
  for (const plano of DEFAULT_PLANS) saida.push(plano.name, plano.description);
  for (const segmento of DEFAULT_SEGMENTS) saida.push(segmento.name, segmento.description);
  saida.push(...Object.values(PLAN_FEATURE_LABELS));
  for (const modulo of Object.values(MODULE_REGISTRY)) {
    saida.push(modulo.name, modulo.description);
    for (const campo of modulo.fields) saida.push(campo.label, campo.help ?? '');
  }
  return saida.filter(Boolean);
}

describe('acentos nos textos de fabrica', () => {
  it('nenhum texto de plano, segmento ou modulo traz palavra comum sem acento', () => {
    const erros = textos().filter((t) => SEM_ACENTO.test(t));
    expect(erros).toEqual([]);
  });

  it('o plano de avaliacao tem o nome acentuado', () => {
    expect(DEFAULT_PLANS.find((p) => p.code === 'trial')?.name).toBe('Avaliação');
  });
});
