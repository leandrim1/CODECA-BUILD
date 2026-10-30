import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUSPENSION_POLICY,
  PANEL_ON_SUSPENSION,
  PUBLICATION_STATES,
  PUBLIC_SITE_ON_SUSPENSION,
  SUSPENSION_PUBLIC_NOTICE,
  panelFullyBlocked,
  panelWritesBlocked,
  suspensionEffect,
} from '@codeca/shared';

/**
 * Politica de suspensao.
 *
 * `suspensionEffect` e pura como `decidePublication`, e pela mesma razao: a
 * API publica, o painel e as telas decidem pela mesma regra. Se cada uma
 * reimplantasse a sua, divergiriam no primeiro caso de borda -- e aqui o caso
 * de borda custa o site de um cliente no ar, ou um cliente trancado fora do
 * painel.
 */

describe('assinatura em dia', () => {
  it('nao restringe nada, qualquer que seja a politica', () => {
    for (const publicSite of PUBLIC_SITE_ON_SUSPENSION) {
      for (const panel of PANEL_ON_SUSPENSION) {
        const efeito = suspensionEffect('allowed', { publicSite, panel });
        expect(efeito.current).toBe(true);
        expect(efeito.publicSite).toBe('serve');
        expect(efeito.panel).toBe('full');
      }
    }
  });

  it('a tolerancia conta como em dia', () => {
    // `decidePublication` devolve `allowed` durante a tolerancia, entao a
    // politica nem e consultada: uma fatura atrasada por dois dias nao pode
    // derrubar o site de ninguem.
    const efeito = suspensionEffect('allowed', { publicSite: 'stop', panel: 'blocked' });
    expect(efeito.current).toBe(true);
    expect(panelWritesBlocked(efeito)).toBe(false);
  });
});

describe('assinatura pendente', () => {
  const pendentes = PUBLICATION_STATES.filter((estado) => estado !== 'allowed');

  it.each(pendentes)('%s aplica a politica do plano', (estado) => {
    const efeito = suspensionEffect(estado, { publicSite: 'stop', panel: 'blocked' });
    expect(efeito.current).toBe(false);
    expect(efeito.publicSite).toBe('stop');
    expect(efeito.panel).toBe('blocked');
  });

  it('somente leitura bloqueia escrita e permite leitura', () => {
    const efeito = suspensionEffect('blocked_overdue', { publicSite: 'serve', panel: 'read_only' });
    expect(panelWritesBlocked(efeito)).toBe(true);
    expect(panelFullyBlocked(efeito)).toBe(false);
  });

  it('bloqueado impede tambem a leitura', () => {
    const efeito = suspensionEffect('blocked_overdue', { publicSite: 'serve', panel: 'blocked' });
    expect(panelWritesBlocked(efeito)).toBe(true);
    expect(panelFullyBlocked(efeito)).toBe(true);
  });
});

describe('o dado nunca e apagado', () => {
  it('nenhuma combinacao de politica e estado apaga dado', () => {
    for (const estado of PUBLICATION_STATES) {
      for (const publicSite of PUBLIC_SITE_ON_SUSPENSION) {
        for (const panel of PANEL_ON_SUSPENSION) {
          expect(suspensionEffect(estado, { publicSite, panel }).dataDeleted).toBe(false);
        }
      }
    }
  });

  it('o padrao e o mais conservador', () => {
    // Derrubar o site de quem atrasou uma fatura custa ao cliente final, que
    // nao tem parte no atraso, e costuma gerar cancelamento em vez de
    // pagamento.
    expect(DEFAULT_SUSPENSION_POLICY).toEqual({ publicSite: 'serve', panel: 'read_only' });
  });
});

describe('o aviso ao visitante', () => {
  it('nao revela a pendencia', () => {
    // Chega ao navegador por chave publicavel, que e publica por definicao:
    // o que entra neste texto entra na internet.
    const aviso = SUSPENSION_PUBLIC_NOTICE.toLowerCase();
    for (const proibido of ['inadimpl', 'pagamento', 'assinatura', 'fatura', 'divida', 'atraso']) {
      expect(aviso, `o aviso nao deve conter "${proibido}"`).not.toContain(proibido);
    }
    expect(aviso).not.toMatch(/r\$|\d{2}\/\d{2}/);
  });

  it('diz algo util ao visitante', () => {
    expect(SUSPENSION_PUBLIC_NOTICE.length).toBeGreaterThan(20);
  });
});
