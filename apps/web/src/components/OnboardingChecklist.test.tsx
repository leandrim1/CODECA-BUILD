// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingChecklist } from './OnboardingChecklist.js';
import { progressoDosPassos, PASSOS_INICIAIS } from '../lib/primeirosPassos.js';
import type { OverviewResponse } from '../types/index.js';

/**
 * O checklist le os dados do site; nada aqui se marca a mao.
 *
 * Os testes cobrem as duas coisas que quebram sem aviso: um passo que a
 * pessoa nao alcanca continuar contando no total, e o progresso descolar da
 * lista.
 */

const VAZIO = {
  services: { total: 0, published: 0 },
  banners: { total: 0, active: 0 },
  domains: [],
  onboarding: { institutionalFilled: false, contactFilled: false },
} as unknown as OverviewResponse;

const COMPLETO = {
  services: { total: 2, published: 2 },
  banners: { total: 1, active: 1 },
  domains: [{ id: 'd1', hostname: 'x.com.br', status: 'active', isPrimary: true, sslStatus: 'active' }],
  onboarding: { institutionalFilled: true, contactFilled: true },
} as unknown as OverviewResponse;

const tudoPode = () => true;

function montar(visao: OverviewResponse, pode = tudoPode) {
  const onDispensar = vi.fn();
  render(
    <MemoryRouter>
      <OnboardingChecklist visao={visao} pode={pode} onDispensar={onDispensar} />
    </MemoryRouter>,
  );
  return { onDispensar };
}

/*
  Limpeza explicita, e nao a automatica da biblioteca.
  Os arquivos de teste rodam todos no MESMO processo (`singleFork`), e as
  arvores renderizadas se acumulavam no mesmo `document`: isolado o arquivo
  passava, na suite inteira `getByRole` encontrava dois botoes iguais.
*/
afterEach(cleanup);

describe('progressoDosPassos', () => {
  it('site vazio: nenhum passo concluido', () => {
    const p = progressoDosPassos(VAZIO, tudoPode);
    expect(p.feitos).toBe(0);
    expect(p.total).toBe(PASSOS_INICIAIS.length);
    expect(p.tudoFeito).toBe(false);
  });

  it('site completo: todos concluidos', () => {
    const p = progressoDosPassos(COMPLETO, tudoPode);
    expect(p.feitos).toBe(p.total);
    expect(p.tudoFeito).toBe(true);
  });

  it('dominio apenas cadastrado nao conta como conectado', () => {
    // Um dominio pendente de DNS nao poe o site no ar. Marcar o passo ali
    // faria a pessoa parar justamente quando falta a parte dela.
    const pendente = {
      ...COMPLETO,
      domains: [{ id: 'd1', hostname: 'x.com.br', status: 'pending', isPrimary: true, sslStatus: 'pending' }],
    } as unknown as OverviewResponse;
    const p = progressoDosPassos(pendente, tudoPode);
    expect(p.tudoFeito).toBe(false);
    expect(p.passos.find((x) => x.id === 'dominio')?.feito).toBe(false);
  });

  it('passo fora do alcance do papel sai do total, e nao conta como pendente', () => {
    // Um editor sem acesso a dominios veria "4 de 5" para sempre.
    const semDominio = progressoDosPassos(COMPLETO, (c) => c !== 'domains:read');
    expect(semDominio.total).toBe(PASSOS_INICIAIS.length - 1);
    expect(semDominio.tudoFeito).toBe(true);
  });
});

describe('OnboardingChecklist', () => {
  it('mostra o progresso e os passos pendentes', () => {
    montar(VAZIO);
    expect(screen.getByText('Primeiros passos')).toBeTruthy();
    const barra = screen.getByRole('progressbar', { name: 'Progresso dos primeiros passos' });
    expect(barra.getAttribute('aria-valuenow')).toBe('0');
    expect(barra.getAttribute('aria-valuemax')).toBe(String(PASSOS_INICIAIS.length));
  });

  it('cada passo leva para a sua tela', () => {
    montar(VAZIO);
    const ir = screen.getAllByRole('link');
    const destinos = ir.map((a) => a.getAttribute('href'));
    for (const passo of PASSOS_INICIAIS) expect(destinos).toContain(passo.para);
  });

  it('concluido tudo, parabeniza e deixa ocultar', async () => {
    const { onDispensar } = montar(COMPLETO);
    expect(screen.getByText('Tudo pronto por aqui')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(onDispensar).toHaveBeenCalledTimes(1);
  });

  it('dispensar nao depende de ter concluido', async () => {
    const { onDispensar } = montar(VAZIO);
    await userEvent.click(screen.getByRole('button', { name: /Dispensar/ }));
    expect(onDispensar).toHaveBeenCalledTimes(1);
  });

  it('o estado de cada passo tambem vai em palavras, e nao so em cor', () => {
    // Um unico desenho: `tudoFeito` troca a lista pela mensagem de parabens,
    // entao o caso que mostra os dois estados e o de um passo pendente.
    const umPendente = { ...COMPLETO, banners: { total: 0, active: 0 } } as unknown as OverviewResponse;
    montar(umPendente);
    expect(screen.getByText('- pendente', { exact: false })).toBeTruthy();
    expect(screen.getAllByText('- concluído', { exact: false }).length).toBeGreaterThan(0);
  });
});
