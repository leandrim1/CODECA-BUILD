import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, formatStorage, planBenefits, type PlanLimits } from '@codeca/shared';

/**
 * O texto de beneficios e a mesma funcao para a pagina inicial, a tela de plano
 * do cliente e o painel mestre. Estes testes seguram duas coisas: que, com os
 * planos de fabrica, ele diz exatamente o que foi combinado comercialmente; e
 * que tudo vem dos dados -- nenhum numero e escrito a mao.
 */

const plano = (codigo: string) => {
  const p = DEFAULT_PLANS.find((x) => x.code === codigo)!;
  return { priceCents: p.priceCents, limits: { ...p.limits, features: [...p.limits.features] } };
};

describe('planBenefits: a proposta comercial, a partir dos dados', () => {
  it('Avaliacao', () => {
    expect(planBenefits(plano('trial'))).toEqual([
      'Até 5 conteúdos cadastrados',
      'Até 2 usuários vinculados',
      '200 MB de armazenamento',
      'Sem domínio próprio',
      'Painel administrativo CODECA Build',
      'Gestão de textos, imagens e módulos',
    ]);
  });

  it('Essencial: sem painel, o conteudo e gerido pela CODECA IA', () => {
    expect(planBenefits(plano('essencial'))).toEqual([
      'Até 20 conteúdos cadastrados',
      'Até 2 usuários vinculados',
      '500 MB de armazenamento',
      '1 domínio próprio',
      'Site personalizado',
      'Gestão de conteúdo pela CODECA IA',
    ]);
  });

  it('Profissional', () => {
    expect(planBenefits(plano('profissional'))).toEqual([
      'Até 100 conteúdos cadastrados',
      'Até 5 usuários vinculados',
      '2 GB de armazenamento',
      '1 domínio próprio',
      'Site personalizado',
      'Painel administrativo CODECA Build',
      'Gestão de textos, imagens e módulos',
      'Exportação de interessados',
    ]);
  });

  it('Empresas', () => {
    expect(planBenefits(plano('empresas'))).toEqual([
      'Até 400 conteúdos cadastrados',
      'Até 15 usuários vinculados',
      '10 GB de armazenamento',
      'Até 3 domínios próprios',
      'Site personalizado',
      'Painel administrativo CODECA Build',
      'Gestão de textos, imagens e módulos',
      'Exportação de interessados',
      'Hospedagem incluída',
    ]);
  });

  it('nenhum beneficio fala de um segmento: o texto vale para qualquer ramo', () => {
    for (const p of DEFAULT_PLANS) {
      const texto = planBenefits(p).join(' | ').toLowerCase();
      for (const proibido of ['imóve', 'imove', 'obra', 'construt', 'imobili']) {
        expect(texto, `${p.code} cita "${proibido}"`).not.toContain(proibido);
      }
    }
  });

  it('muda quando o plano muda: nada e escrito a mao', () => {
    const p = plano('profissional');
    p.limits.maxUsers = 9;
    p.limits.maxContentRecords = 250;
    p.limits.maxDomains = 2;
    p.limits.features = ['cms_panel'];
    const itens = planBenefits(p);
    expect(itens).toContain('Até 250 conteúdos cadastrados');
    expect(itens).toContain('Até 9 usuários vinculados');
    expect(itens).toContain('Até 2 domínios próprios');
    expect(itens).not.toContain('Exportação de interessados');
  });

  it('o singular e o plural estao certos', () => {
    const p = plano('essencial');
    p.limits.maxUsers = 1;
    p.limits.maxContentRecords = 1;
    const itens = planBenefits(p);
    expect(itens).toContain('Até 1 conteúdo cadastrado');
    expect(itens).toContain('Até 1 usuário vinculado');
  });

  it('"Site personalizado" so aparece em plano pago', () => {
    expect(planBenefits(plano('trial'))).not.toContain('Site personalizado');
    expect(planBenefits({ priceCents: 1, limits: plano('trial').limits as PlanLimits })).toContain(
      'Site personalizado',
    );
  });

  it('o numero formatado usa separador de milhar brasileiro', () => {
    const p = plano('empresas');
    p.limits.maxContentRecords = 12000;
    expect(planBenefits(p)[0]).toBe('Até 12.000 conteúdos cadastrados');
  });
});

describe('formatStorage', () => {
  it('unidades legiveis, com virgula decimal e sem ".0" sobrando', () => {
    const MB = 1024 * 1024;
    expect(formatStorage(200 * MB)).toBe('200 MB');
    expect(formatStorage(500 * MB)).toBe('500 MB');
    expect(formatStorage(2 * 1024 * MB)).toBe('2 GB');
    expect(formatStorage(10 * 1024 * MB)).toBe('10 GB');
    expect(formatStorage(1.5 * 1024 * MB)).toBe('1,5 GB');
  });
});

describe('os planos de fabrica: a regra comercial', () => {
  it('limite geral de conteudos e crescente e igual ao combinado', () => {
    const por = Object.fromEntries(DEFAULT_PLANS.map((p) => [p.code, p.limits.maxContentRecords]));
    expect(por).toEqual({ trial: 5, essencial: 20, profissional: 100, empresas: 400 });
  });

  it('os precos nao mudaram', () => {
    const por = Object.fromEntries(DEFAULT_PLANS.map((p) => [p.code, p.priceCents]));
    expect(por).toEqual({ trial: 0, essencial: 1590, profissional: 5990, empresas: 11990 });
  });

  it('as descricoes comerciais nao citam um segmento', () => {
    for (const p of DEFAULT_PLANS) {
      expect(p.description.toLowerCase(), p.code).not.toMatch(/im[oó]ve|obra|construt|imobili/);
    }
  });
});
