// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampoDeSenha } from './CampoDeSenha.js';

/**
 * A lista de conferencia da senha.
 *
 * O que os testes protegem: a lista nao pode ocupar altura antes da hora (a
 * tela de cadastro cabe em uma dobra), o x vermelho nao pode aparecer antes de
 * a pessoa sair do campo, e o campo precisa continuar apontando para a lista
 * por `aria-describedby` -- sem isso o leitor de tela le um campo sem regras.
 */

function Campo() {
  const [senha, setSenha] = useState('');
  return <CampoDeSenha value={senha} onChange={setSenha} required />;
}

afterEach(cleanup);

const REGRAS = [
  'Mínimo de 10 caracteres',
  'Uma letra maiúscula',
  'Uma letra minúscula',
  'Um número',
  'Um caractere especial',
];

describe('CampoDeSenha', () => {
  it('esconde a lista enquanto o campo esta vazio e fora de foco', () => {
    render(<Campo />);
    expect(screen.queryByText(REGRAS[0]!)).toBeNull();
  });

  it('mostra as cinco regras ao focar o campo', async () => {
    const usuario = userEvent.setup();
    render(<Campo />);
    await usuario.click(screen.getByLabelText(/Senha/));
    for (const regra of REGRAS) expect(screen.getByText(regra)).toBeTruthy();
  });

  it('marca cada regra conforme a digitacao', async () => {
    const usuario = userEvent.setup();
    render(<Campo />);
    await usuario.type(screen.getByLabelText(/Senha/), 'Abcdefghij1');

    const estado = (regra: string) =>
      screen.getByText(regra).closest('li')?.textContent?.split(': ').pop();
    expect(estado('Mínimo de 10 caracteres')).toBe('atendida');
    expect(estado('Uma letra maiúscula')).toBe('atendida');
    expect(estado('Um número')).toBe('atendida');
    expect(estado('Um caractere especial')).toBe('pendente');

    await usuario.type(screen.getByLabelText(/Senha/), '!');
    expect(estado('Um caractere especial')).toBe('atendida');
  });

  it('so acusa a regra como nao atendida depois do blur', async () => {
    const usuario = userEvent.setup();
    render(<Campo />);
    const campo = screen.getByLabelText(/Senha/);
    await usuario.type(campo, 'abc');
    expect(screen.getByText('Um número').closest('li')?.textContent).toContain('pendente');

    await usuario.tab();
    expect(screen.getByText('Um número').closest('li')?.textContent).toContain('não atendida');
  });

  it('o campo aponta para a lista por aria-describedby', async () => {
    const usuario = userEvent.setup();
    render(<Campo />);
    const campo = screen.getByLabelText(/Senha/);
    await usuario.type(campo, 'abc');

    const descricao = campo.getAttribute('aria-describedby');
    expect(descricao).toBeTruthy();
    const lista = document.getElementById(descricao!.split(' ').pop()!);
    expect(lista?.textContent).toContain('Mínimo de 10 caracteres');
  });

  it('o olho alterna entre esconder e mostrar, sem enviar o formulario', async () => {
    const usuario = userEvent.setup();
    render(<Campo />);
    const campo = screen.getByLabelText(/Senha/);
    expect(campo.getAttribute('type')).toBe('password');

    const botao = screen.getByRole('button', { name: 'Mostrar senha' });
    // `type="button"`: dentro do <form> do cadastro, o padrao enviaria o form.
    expect(botao.getAttribute('type')).toBe('button');
    await usuario.click(botao);
    expect(campo.getAttribute('type')).toBe('text');
    await usuario.click(screen.getByRole('button', { name: 'Ocultar senha' }));
    expect(campo.getAttribute('type')).toBe('password');
  });
});
