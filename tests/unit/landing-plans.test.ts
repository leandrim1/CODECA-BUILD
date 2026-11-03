import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS } from '@codeca/shared';
import {
  apresentacao,
  beneficios,
  listar,
  nomeDoPlano,
  planosCom,
  preco,
  tamanho,
} from '../../apps/web/src/landing/plans.js';
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

describe('beneficios: a proposta comercial, a partir dos dados', () => {
  it('Avaliacao', () => {
    expect(beneficios(doBanco('trial'))).toEqual([
      '5 imóveis publicados',
      '3 obras cadastradas',
      '2 usuários',
      '200 MB de armazenamento',
      'Sem domínio próprio',
      'Painel de conteúdo para o cliente',
    ]);
  });

  it('Essencial: sem painel, o conteudo fica com a CODECA IA', () => {
    expect(beneficios(doBanco('essencial'))).toEqual([
      '20 imóveis publicados',
      '10 obras cadastradas',
      '2 usuários',
      '500 MB de armazenamento',
      '1 domínio próprio',
      'Conteúdo mantido pela CODECA IA',
    ]);
  });

  it('Profissional', () => {
    expect(beneficios(doBanco('profissional'))).toEqual([
      '100 imóveis publicados',
      '50 obras cadastradas',
      '5 usuários',
      '2 GB de armazenamento',
      '1 domínio próprio',
      'Painel de conteúdo para o cliente',
      'Exportação de interessados',
    ]);
  });

  it('Empresas', () => {
    expect(beneficios(doBanco('empresas'))).toEqual([
      '400 imóveis publicados',
      '200 obras cadastradas',
      '15 usuários',
      '10 GB de armazenamento',
      'Até 3 domínios próprios',
      'Painel de conteúdo para o cliente',
      'Exportação de interessados',
      'Hospedagem incluída',
    ]);
  });

  it('muda quando o plano muda: nada e escrito a mao', () => {
    const plano = doBanco('profissional');
    plano.limits.maxUsers = 9;
    plano.limits.maxDomains = 2;
    plano.limits.features = ['cms_panel'];
    const itens = beneficios(plano);
    expect(itens).toContain('9 usuários');
    expect(itens).toContain('Até 2 domínios próprios');
    expect(itens).not.toContain('Exportação de interessados');
  });

  it('o singular e o plural estao certos', () => {
    const plano = doBanco('essencial');
    plano.limits.maxUsers = 1;
    plano.limits.maxProjects = 1;
    plano.limits.maxPublishedProperties = 1;
    const itens = beneficios(plano);
    expect(itens).toContain('1 usuário');
    expect(itens).toContain('1 obra cadastrada');
    expect(itens).toContain('1 imóvel publicado');
  });
});

describe('preco e tamanho', () => {
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

  it('unidades legiveis, com virgula decimal e sem ".0" sobrando', () => {
    const MB = 1024 * 1024;
    expect(tamanho(200 * MB)).toBe('200 MB');
    expect(tamanho(500 * MB)).toBe('500 MB');
    expect(tamanho(2 * 1024 * MB)).toBe('2 GB');
    expect(tamanho(10 * 1024 * MB)).toBe('10 GB');
    expect(tamanho(1.5 * 1024 * MB)).toBe('1,5 GB');
  });
});

describe('apresentacao: o texto editorial so vale enquanto descreve o plano real', () => {
  it('usa a frase editorial quando o plano e o que a frase diz', () => {
    expect(apresentacao(doBanco('essencial'))).toMatch(/conteúdo mantida pela CODECA IA/);
    expect(apresentacao(doBanco('empresas'))).toMatch(/hospedagem incluída/);
  });

  it('se o Essencial ganhar o painel, a frase deixa de valer e entra a descricao cadastrada', () => {
    const plano = doBanco('essencial');
    plano.limits.features = ['custom_domain', 'cms_panel'];
    plano.description = 'Descricao escolhida pelo superadmin.';
    expect(apresentacao(plano)).toBe('Descricao escolhida pelo superadmin.');
  });

  it('se o Empresas perder a hospedagem, a frase editorial sai e a pagina nao promete hospedagem por conta propria', () => {
    const plano = doBanco('empresas');
    plano.limits.features = ['cms_panel', 'custom_domain'];
    plano.description = 'Texto atual do plano.';
    // A descricao cadastrada e do superadmin: e dele corrigi-la. O que a pagina
    // nao faz e continuar dizendo, por conta propria, "hospedagem incluida".
    expect(apresentacao(plano)).toBe('Texto atual do plano.');
    expect(beneficios(plano)).not.toContain('Hospedagem incluída');
  });

  it('plano criado depois, com outro codigo, usa a propria descricao', () => {
    const plano = { ...doBanco('profissional'), code: 'agencia', description: 'Para agencias.' };
    expect(apresentacao(plano)).toBe('Para agencias.');
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

  it('as dez perguntas pedidas estao la, na ordem', () => {
    expect(montarPerguntas(null).map((p) => p.pergunta)).toEqual([
      'O que é o CODECA Build?',
      'Preciso ter um site desenvolvido pela CODECA IA?',
      'Posso editar o conteúdo do meu site?',
      'Preciso saber programar?',
      'Posso utilizar meu próprio domínio?',
      'A hospedagem está incluída em todos os planos?',
      'Posso ter diferentes módulos no meu painel?',
      'Posso adicionar colaboradores?',
      'Como funciona a contratação?',
      'Posso trocar de plano?',
    ]);
  });
});
