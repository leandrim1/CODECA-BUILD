// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampoDeNome, CampoDeTelefone } from './CamposComMascara.js';

/**
 * Os campos vistos como a pessoa os usa: digitando, colando e apagando.
 *
 * O que estes testes protegem e o que so aparece no navegador -- o valor que
 * sai do campo (digitos, nunca mascara), o cursor que nao pode pular para o
 * fim, e o aviso que nao pode aparecer antes do blur.
 */

function Telefone() {
  const [valor, setValor] = useState('');
  return (
    <>
      <CampoDeTelefone value={valor} onChange={setValor} />
      <output>{valor}</output>
    </>
  );
}

function Nome() {
  const [valor, setValor] = useState('');
  return (
    <>
      <CampoDeNome value={valor} onChange={setValor} required />
      <output>{valor}</output>
    </>
  );
}

afterEach(cleanup);

const campoTelefone = () => screen.getByLabelText('Telefone') as HTMLInputElement;
const campoNome = () => screen.getByLabelText(/Seu nome/) as HTMLInputElement;
const guardado = () => screen.getByRole('status').textContent;

describe('CampoDeTelefone', () => {
  it('formata enquanto digita e guarda so os digitos', async () => {
    const usuario = userEvent.setup();
    render(<Telefone />);
    await usuario.type(campoTelefone(), '19999990000');
    expect(campoTelefone().value).toBe('(19) 99999-0000');
    expect(guardado()).toBe('19999990000');
  });

  it('usa o formato de fixo com dez digitos e troca sozinho no decimo primeiro', async () => {
    const usuario = userEvent.setup();
    render(<Telefone />);
    await usuario.type(campoTelefone(), '1933330000');
    expect(campoTelefone().value).toBe('(19) 3333-0000');
    await usuario.type(campoTelefone(), '1');
    expect(campoTelefone().value).toBe('(19) 33330-0001');
  });

  it('ignora letra digitada', async () => {
    const usuario = userEvent.setup();
    render(<Telefone />);
    await usuario.type(campoTelefone(), 'abc');
    expect(campoTelefone().value).toBe('');
    expect(guardado()).toBe('');
  });

  it('limpa o prefixo de pais ao colar e corta o excesso', async () => {
    const usuario = userEvent.setup();
    render(<Telefone />);
    await usuario.click(campoTelefone());
    await usuario.paste('+55 (19) 99999-00001234');
    expect(campoTelefone().value).toBe('(19) 99999-0000');
    expect(guardado()).toBe('19999990000');
  });

  /*
    Autofill e colagem entregam o valor INTEIRO num evento so -- e foi ai que o
    navegador pegou dois defeitos que a digitacao tecla a tecla escondia: um
    digito comido (a heuristica de backspace confundia "texto mais curto" com
    "apagou") e o `+55` cortado pelo `maxLength` antes do nosso codigo rodar.
  */
  it('o preenchimento automatico do navegador entra inteiro, sem perder digito', () => {
    render(<Telefone />);
    fireEvent.change(campoTelefone(), { target: { value: '19999990000' } });
    expect(campoTelefone().value).toBe('(19) 99999-0000');
    expect(guardado()).toBe('19999990000');

    // Sobrescrevendo um numero ja formatado: o texto encurta sem nada ter sido apagado.
    fireEvent.change(campoTelefone(), { target: { value: '1133330000' } });
    expect(campoTelefone().value).toBe('(11) 3333-0000');
    expect(guardado()).toBe('1133330000');
  });

  it('colar um numero com +55 nao e cortado pelo maxLength', async () => {
    const usuario = userEvent.setup();
    render(<Telefone />);
    await usuario.click(campoTelefone());
    await usuario.paste('+55 (19) 99999-0000');
    expect(campoTelefone().value).toBe('(19) 99999-0000');
    expect(guardado()).toBe('19999990000');
  });

  it('o cursor fica onde estava ao editar no meio', async () => {
    const usuario = userEvent.setup();
    render(<Telefone />);
    await usuario.type(campoTelefone(), '1999990000');
    // Entre o DDD e o numero: `(19) |99999-0000`
    campoTelefone().setSelectionRange(5, 5);
    await usuario.type(campoTelefone(), '9', { initialSelectionStart: 5, initialSelectionEnd: 5 });
    expect(campoTelefone().value).toBe('(19) 99999-0000');
    expect(campoTelefone().selectionStart).toBe(6);
  });

  it('o backspace sobre o hifen apaga o digito anterior, sem travar', async () => {
    const usuario = userEvent.setup();
    render(<Telefone />);
    await usuario.type(campoTelefone(), '19999990000');
    // Cursor logo depois do hifen de `(19) 99999-|0000`
    campoTelefone().setSelectionRange(11, 11);
    await usuario.keyboard('{Backspace}');
    expect(guardado()).toBe('1999990000');
    expect(campoTelefone().value).toBe('(19) 9999-0000');
  });

  it('so avisa depois do blur, e nunca quando esta vazio', async () => {
    const usuario = userEvent.setup();
    render(<Telefone />);
    await usuario.type(campoTelefone(), '0099999');
    expect(screen.queryByText('Informe um telefone válido com DDD')).toBeNull();

    await usuario.tab();
    expect(screen.getByText('Informe um telefone válido com DDD')).toBeTruthy();

    await usuario.clear(campoTelefone());
    await usuario.tab();
    expect(screen.queryByText('Informe um telefone válido com DDD')).toBeNull();
  });
});

describe('CampoDeNome', () => {
  it('aceita acento, hifen e apostrofo', async () => {
    const usuario = userEvent.setup();
    render(<Nome />);
    await usuario.type(campoNome(), "Ana-Maria D'Ávila");
    expect(campoNome().value).toBe("Ana-Maria D'Ávila");
  });

  it('remove numero, simbolo e emoji na digitacao', async () => {
    const usuario = userEvent.setup();
    render(<Nome />);
    await usuario.type(campoNome(), 'Maria 123 @#');
    expect(campoNome().value).toBe('Maria ');
  });

  it('remove ao colar, como na digitacao', async () => {
    const usuario = userEvent.setup();
    render(<Nome />);
    await usuario.click(campoNome());
    await usuario.paste("oajdwkoand1'313414");
    expect(campoNome().value).toBe("oajdwkoand'");
  });

  it('junta espacos e apara as pontas ao sair do campo', async () => {
    const usuario = userEvent.setup();
    render(<Nome />);
    await usuario.type(campoNome(), '   Pedro   Lima ');
    expect(campoNome().value).toBe('Pedro Lima ');
    await usuario.tab();
    expect(campoNome().value).toBe('Pedro Lima');
    expect(guardado()).toBe('Pedro Lima');
  });

  it('o preenchimento automatico tambem passa pela limpeza', () => {
    render(<Nome />);
    fireEvent.change(campoNome(), { target: { value: 'Maria 123 @#' } });
    expect(campoNome().value).toBe('Maria ');
    expect(guardado()).toBe('Maria ');
  });

  it('o cursor fica onde estava quando um caractere e recusado', async () => {
    const usuario = userEvent.setup();
    render(<Nome />);
    await usuario.type(campoNome(), 'Maria');
    campoNome().setSelectionRange(2, 2);
    await usuario.type(campoNome(), '7', { initialSelectionStart: 2, initialSelectionEnd: 2 });
    expect(campoNome().value).toBe('Maria');
    expect(campoNome().selectionStart).toBe(2);
  });

  it('so avisa depois do blur', async () => {
    const usuario = userEvent.setup();
    render(<Nome />);
    await usuario.type(campoNome(), 'M');
    expect(screen.queryByText('Informe seu nome usando apenas letras')).toBeNull();
    await usuario.tab();
    expect(screen.getByText('Informe seu nome usando apenas letras')).toBeTruthy();
  });
});
