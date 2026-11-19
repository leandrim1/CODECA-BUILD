// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SidebarPlataforma } from './SidebarPlataforma.js';
import { MENU_DA_PLATAFORMA } from '../lib/menuDaPlataforma.js';
import type { SessionUser } from '../types/index.js';

/**
 * A barra do painel mestre.
 *
 * O que estes testes protegem nao e a aparencia -- e o que some quando alguem
 * mexe nas classes sem olhar o resto: o rotulo que vira `sr-only` e precisa
 * continuar sendo o nome do link, o `inert` da gaveta fora da tela, e o
 * `aria-pressed` do recolher.
 */

const USUARIO: SessionUser = {
  id: 'u1',
  email: 'operacao@codecaia.test',
  name: 'Operação CODECA IA',
  phone: '',
  platformRole: 'platform_admin',
  emailVerified: true,
  hasPassword: true,
  google: null,
};

function montar(extra: Partial<Parameters<typeof SidebarPlataforma>[0]> = {}) {
  const props = {
    itens: MENU_DA_PLATAFORMA,
    aberta: false,
    fora: false,
    fecharRef: createRef<HTMLButtonElement>(),
    onFechar: vi.fn(),
    soIcones: false,
    recolhido: false,
    onAlternarRecolhido: vi.fn(),
    user: USUARIO,
    onSair: vi.fn(),
    ...extra,
  };
  const resultado = render(
    <MemoryRouter initialEntries={['/plataforma/empresas']}>
      <SidebarPlataforma {...props} />
    </MemoryRouter>,
  );
  return { ...resultado, props };
}

describe('SidebarPlataforma', () => {
  it('desenha os nove destinos da plataforma, com os enderecos de sempre', () => {
    montar();
    const links = screen
      .getByRole('navigation', { name: 'Menu da plataforma' })
      .querySelectorAll('a');
    expect([...links].map((a) => a.getAttribute('href'))).toEqual([
      '/plataforma',
      '/plataforma/empresas',
      '/plataforma/sites',
      '/plataforma/segmentos',
      '/plataforma/planos',
      '/plataforma/cobranca',
      '/plataforma/dominios',
      '/plataforma/suporte',
      '/plataforma/auditoria',
    ]);
  });

  it('recolhida, o rotulo continua sendo o nome do link', () => {
    montar({ soIcones: true, recolhido: true });
    // Visualmente some; para o leitor de tela, nao. Se alguem trocar o
    // `sr-only` por `hidden`, o menu vira nove icones sem nome.
    for (const item of MENU_DA_PLATAFORMA) {
      expect(screen.getByRole('link', { name: item.label })).toBeTruthy();
    }
  });

  it('marca o estado do recolher em aria-pressed', async () => {
    const { props } = montar({ recolhido: true, soIcones: true });
    const botao = screen.getByRole('button', { name: 'Expandir menu' });
    expect(botao.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(botao);
    expect(props.onAlternarRecolhido).toHaveBeenCalledTimes(1);
  });

  it('escolher um destino fecha a gaveta', async () => {
    const { props } = montar();
    await userEvent.click(screen.getByRole('link', { name: 'Empresas' }));
    expect(props.onFechar).toHaveBeenCalled();
  });

  it('fora da tela, a barra inteira sai do caminho do teclado', () => {
    const { container, rerender, props } = montar({ fora: true });
    expect(container.querySelector('aside')?.hasAttribute('inert')).toBe(true);
    rerender(
      <MemoryRouter initialEntries={['/plataforma/empresas']}>
        <SidebarPlataforma {...props} fora={false} />
      </MemoryRouter>,
    );
    expect(container.querySelector('aside')?.hasAttribute('inert')).toBe(false);
  });

  it('mostra quem entrou, e as iniciais vem da primeira e da ultima palavra', () => {
    montar();
    expect(screen.getByText('Operação CODECA IA')).toBeTruthy();
    expect(screen.getByText('operacao@codecaia.test')).toBeTruthy();
    expect(screen.getByText('OI')).toBeTruthy();
  });

  it('sem nome, cai na inicial do e-mail em vez de inventar um rotulo', () => {
    montar({ user: { ...USUARIO, name: '' } });
    expect(screen.getByText('O')).toBeTruthy();
  });

  it('mantem o caminho de volta ao painel da empresa', () => {
    montar();
    expect(screen.getByRole('link', { name: 'Voltar ao painel' }).getAttribute('href')).toBe('/painel');
  });

  it('o aviso de area restrita e rotulo, e nao um destino que nao existe', () => {
    montar();
    const aviso = screen.getByText('Área restrita da plataforma');
    expect(aviso.closest('a')).toBeNull();
    expect(aviso.closest('button')).toBeNull();
  });
});
