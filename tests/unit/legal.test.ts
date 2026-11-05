import { describe, expect, it } from 'vitest';
import { DEFAULT_GRACE_PERIOD_DAYS, LEGAL_VERSION, TRIAL_PERIOD_DAYS } from '@codeca/shared';
import { ANALYTICS_SCOPE } from '../../apps/api/src/lib/analytics/google.js';
import { EMPRESA } from '../../apps/web/src/legal/empresa.js';
import { PRIVACIDADE } from '../../apps/web/src/legal/privacidade.js';
import { TERMOS } from '../../apps/web/src/legal/termos.js';
import type { Bloco, Documento } from '../../apps/web/src/legal/types.js';

/**
 * Os documentos legais nao podem divergir do que o codigo faz.
 *
 * Estes testes amarram o texto a constantes reais (periodo de avaliacao,
 * tolerancia, escopo do Analytics) e barram o que nao pode aparecer: dado
 * inventado, pendencia visivel, promessa que o codigo nao cumpre.
 */

function textoDe(documento: Documento): string {
  const partes: string[] = [documento.titulo, documento.resumo];
  const bloco = (b: Bloco) => {
    if (b.tipo === 'p' || b.tipo === 'subtitulo' || b.tipo === 'aviso') partes.push(b.texto);
    if (b.tipo === 'lista') partes.push(...b.itens);
    if (b.tipo === 'tabela') partes.push(...b.colunas, ...b.linhas.flat());
  };
  for (const secao of documento.secoes) {
    partes.push(secao.titulo);
    secao.blocos.forEach(bloco);
  }
  return partes.join('\n');
}

describe.each([
  ['Política de privacidade', PRIVACIDADE],
  ['Termos de uso', TERMOS],
])('%s', (_nome, documento) => {
  const texto = textoDe(documento);

  it('tem secoes com ancoras unicas e conteudo', () => {
    const ids = documento.secoes.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const secao of documento.secoes) expect(secao.blocos.length).toBeGreaterThan(0);
  });

  it('nao traz pendencia visivel nem dado inventado', () => {
    expect(texto).not.toMatch(/a preencher|\[.*preencher|lorem|\bxxx\b/i);
    expect(texto).not.toMatch(/\bTODO\b/);
    // Nenhum CNPJ, e-mail ou telefone escrito no texto.
    expect(texto).not.toMatch(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
    expect(texto).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(texto).not.toMatch(/\(\d{2}\)\s?\d{4,5}-?\d{4}/);
  });

  it('nao menciona servicos que a plataforma nao usa', () => {
    expect(texto).not.toMatch(/supabase/i);
  });

  it('nao promete seguranca absoluta', () => {
    expect(texto).not.toMatch(/100% seguro|totalmente seguro|seguranca absoluta|segurança absoluta/i);
  });
});

describe('empresa', () => {
  it('so exibe o que foi informado: sem CNPJ nem endereco inventados', () => {
    expect(EMPRESA.cnpj).toBeNull();
    expect(EMPRESA.endereco).toBeNull();
  });

  it('o canal de privacidade e o informado pela CODECA IA', () => {
    expect(EMPRESA.emailPrivacidade).toBe('codecabuild@gmail.com');
  });

  it('o canal de contato aparece nas duas paginas', () => {
    for (const documento of [PRIVACIDADE, TERMOS]) {
      expect(documento.secoes.some((s) => s.blocos.some((b) => b.tipo === 'contato'))).toBe(true);
    }
  });
});

describe('a Politica de privacidade acompanha o codigo', () => {
  const texto = textoDe(PRIVACIDADE);

  it('cobre o que a LGPD e o pedido exigem', () => {
    for (const trecho of [
      'Lei nº 13.709/2018',
      'controladora',
      'operadora',
      'Login com Google',
      'Integração com o Google Analytics 4',
      'revogar',
      'Seus direitos',
      'portabilidade',
      'ANPD',
      'AES-256-GCM',
    ]) {
      expect(texto, trecho).toContain(trecho);
    }
  });

  it('cita exatamente o escopo de leitura do Analytics que o servidor pede', () => {
    expect(texto).toContain(ANALYTICS_SCOPE);
    expect(ANALYTICS_SCOPE).toBe('https://www.googleapis.com/auth/analytics.readonly');
  });

  it('diz que o Analytics e opcional e pode nao estar disponivel para todos', () => {
    expect(texto).toMatch(/opcional/);
    expect(texto).toMatch(/pode não estar disponível/);
  });

  it('os prazos de limpeza batem com os do job diario (30 dias e 1 dia)', () => {
    expect(texto).toContain('30 dias depois');
    expect(texto).toContain('1 dia depois de vencerem');
  });

  it('nao afirma que guarda token do login com Google', () => {
    expect(texto).toContain('não guardamos tokens de acesso do Google');
  });
});

describe('os Termos acompanham o codigo', () => {
  const texto = textoDe(TERMOS);

  it('periodo de avaliacao e tolerancia vem das constantes reais', () => {
    expect(texto).toContain(`${TRIAL_PERIOD_DAYS} dias`);
    expect(texto).toContain(`${DEFAULT_GRACE_PERIOD_DAYS} dias`);
  });

  it('nao crava valor de plano, foro nem prazo de reembolso', () => {
    expect(texto).not.toMatch(/R\$\s?\d/);
    expect(texto).not.toMatch(/foro/i);
    expect(texto).not.toMatch(/reembolso/i);
  });

  it('remete a Politica de privacidade', () => {
    expect(texto).toContain('Política de privacidade');
  });
});

describe('versao dos documentos', () => {
  it('e uma data AAAA-MM-DD valida', () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(new Date(LEGAL_VERSION).getTime())).toBe(false);
  });
});
