import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS } from '@codeca/shared';
import { listar, nomeDoPlano, planosCom, preco } from '../../apps/web/src/landing/plans.js';
import { montarPerguntas } from '../../apps/web/src/landing/faq-content.js';
import type { PublicPlan } from '../../apps/web/src/services/endpoints.js';

/**
 * Tudo que a pagina inicial diz sobre planos sai de dados. Estes testes seguram
 * duas coisas: que, com os planos da instalacao, a pagina diz exatamente o que
 * foi combinado comercialmente; e que, mudando o plano, o texto muda junto.
 */

const doBanco = (codigo: string): PublicPlan => {
  const p = DEFAULT_PLANS.find((x) => x.code === codigo)!;
  return {
    code: p.code,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    trialDays: p.billing.trialDays ?? null,
    limits: { ...p.limits, features: [...p.limits.features] },
  };
};
const todos = () => DEFAULT_PLANS.map((p) => doBanco(p.code));
const nbsp = (s: string) => s.replace(/ /g, ' ');

describe('preco', () => {
  it('formata o valor mensal em reais e o plano gratuito pela duracao da avaliacao', () => {
    expect(nbsp(preco(doBanco('essencial')).valor)).toBe('R$ 15,90');
    expect(preco(doBanco('essencial')).periodo).toBe('/mês');
    expect(nbsp(preco(doBanco('empresas')).valor)).toBe('R$ 119,90');
    expect(preco(doBanco('trial'))).toEqual({ valor: 'Gratuito', periodo: 'por 14 dias' });
  });

  it('um preco alterado no painel mestre aparece como esta', () => {
    const plano = doBanco('profissional');
    plano.priceCents = 7777;
    expect(nbsp(preco(plano).valor)).toBe('R$ 77,77');
  });
});

describe('nomeDoPlano', () => {
  it('acentua so o valor de semente; um nome trocado pelo superadmin fica como esta', () => {
    expect(nomeDoPlano(doBanco('trial'))).toBe('Avaliação');
    expect(nomeDoPlano({ ...doBanco('trial'), name: 'Teste gratis' })).toBe('Teste gratis');
    expect(nomeDoPlano(doBanco('empresas'))).toBe('Empresas');
  });
});

describe('FAQ: respostas que citam plano vem dos planos', () => {
  const resposta = (planos: PublicPlan[] | null, inicio: string) =>
    montarPerguntas(planos).find((p) => p.pergunta.startsWith(inicio))!.resposta;

  it('hospedagem: cita o plano que a inclui, e so ele', () => {
    const r = resposta(todos(), 'A hospedagem');
    expect(r).toContain('plano Empresas');
    expect(r).not.toContain('Essencial');
  });

  it('se outro plano passar a incluir hospedagem, a resposta acompanha', () => {
    const planos = todos();
    planos.find((p) => p.code === 'profissional')!.limits.features.push('included_hosting');
    const r = resposta(planos, 'A hospedagem');
    expect(r).toContain('Profissional e Empresas');
  });

  it('edicao do conteudo: lista os planos com painel e diz qual deixa o conteudo com a CODECA IA', () => {
    const r = resposta(todos(), 'Posso editar');
    expect(r).toContain(listar(planosCom(todos(), 'cms_panel')));
    expect(r).toContain('No plano Essencial, o conteúdo é mantido pela CODECA IA');
  });

  it('colaboradores: o teto vem do maior limite de usuarios', () => {
    expect(resposta(todos(), 'Posso adicionar')).toContain('de 2 até 15');
  });

  it('contratacao: a duracao da avaliacao vem do plano gratuito', () => {
    expect(resposta(todos(), 'Como funciona a contratação')).toContain('por 14 dias');
    const sem = todos().map((p) => ({ ...p, trialDays: null }));
    expect(resposta(sem, 'Como funciona a contratação')).not.toContain('dias');
  });

  it('sem os dados dos planos, as respostas ficam gerais e nunca com numero ou nome escrito a mao', () => {
    const todas = montarPerguntas(null).map((p) => p.resposta).join(' ');
    for (const proibido of ['Empresas', 'Essencial', 'Profissional', '15', '14 dias', 'R$']) {
      expect(todas).not.toContain(proibido);
    }
  });

  it('conteudos cadastrados: a definicao e universal e diz como rascunho e arquivado contam', () => {
    const r = resposta(null, 'O que são conteúdos');
    expect(r).toContain('produtos');
    expect(r).toContain('serviços');
    expect(r).toContain('imóveis');
    expect(r).toContain('portfólio');
    expect(r).toContain('geral, não por tipo');
    expect(r).toMatch(/Rascunhos e arquivados também contam/);
  });

  it('as perguntas pedidas estao la, na ordem, mais a que define conteudo cadastrado', () => {
    expect(montarPerguntas(null).map((p) => p.pergunta)).toEqual([
      'O que é o CODECA Build?',
      'Preciso ter um site desenvolvido pela CODECA IA?',
      'Posso editar o conteúdo do meu site?',
      'Preciso saber programar?',
      'Posso utilizar meu próprio domínio?',
      'A hospedagem está incluída em todos os planos?',
      'Posso ter diferentes módulos no meu painel?',
      'O que são conteúdos cadastrados?',
      'Posso adicionar colaboradores?',
      'Como funciona a contratação?',
      'Posso trocar de plano?',
    ]);
  });
});
