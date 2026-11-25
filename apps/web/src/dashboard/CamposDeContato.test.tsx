// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampoDeAno, CampoDeWhatsApp } from './CamposDeContato.js';
import { CampoDeHorarios } from './CampoDeHorarios.js';
import { horariosVazios, textoDosHorarios, type HorariosDeAtendimento } from '@codeca/shared';

afterEach(cleanup);

describe('CampoDeAno', () => {
  function Tela() {
    const [valor, setValor] = useState('');
    return (
      <>
        <CampoDeAno label="Ano de fundação" value={valor} onChange={setValor} />
        <output>{valor}</output>
      </>
    );
  }

  it('aceita so digitos e para em quatro', async () => {
    const usuario = userEvent.setup();
    render(<Tela />);
    const campo = screen.getByLabelText('Ano de fundação') as HTMLInputElement;
    await usuario.type(campo, '19a98765');
    expect(campo.value).toBe('1998');
    expect(screen.getByRole('status').textContent).toBe('1998');
  });

  it('é caixa de texto numérica, e não campo com setinhas', () => {
    render(<Tela />);
    const campo = screen.getByLabelText('Ano de fundação');
    expect(campo.getAttribute('type')).toBe('text');
    expect(campo.getAttribute('inputmode')).toBe('numeric');
    expect(campo.getAttribute('maxlength')).toBe('4');
  });

  it('só reclama depois do blur', async () => {
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.type(screen.getByLabelText('Ano de fundação'), '1700');
    expect(screen.queryByText(/Informe um ano entre/)).toBeNull();
    await usuario.tab();
    expect(screen.getByText(/Informe um ano entre 1800 e/)).toBeTruthy();
  });
});

describe('CampoDeWhatsApp', () => {
  function Tela() {
    const [valor, setValor] = useState('');
    return (
      <>
        <CampoDeWhatsApp label="WhatsApp" value={valor} onChange={setValor} />
        <output>{valor}</output>
      </>
    );
  }

  it('mostra o exemplo pedido no placeholder', () => {
    render(<Tela />);
    expect((screen.getByLabelText('WhatsApp') as HTMLInputElement).placeholder).toBe(
      'https://wa.me/5511999999999',
    );
  });

  it('converte telefone colado em link ao sair do campo', async () => {
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.click(screen.getByLabelText('WhatsApp'));
    await usuario.paste('(19) 99999-0000');
    await usuario.tab();
    expect(screen.getByRole('status').textContent).toBe('https://wa.me/5519999990000');
  });

  it('acusa outra URL depois do blur', async () => {
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.click(screen.getByLabelText('WhatsApp'));
    await usuario.paste('https://instagram.com/empresa');
    await usuario.tab();
    expect(screen.getByText(/Informe um link no formato/)).toBeTruthy();
  });
});

describe('CampoDeHorarios', () => {
  function Tela({ inicial }: { inicial?: HorariosDeAtendimento | null }) {
    const [valor, setValor] = useState<HorariosDeAtendimento | null>(inicial ?? null);
    return (
      <>
        <CampoDeHorarios label="Horário de atendimento" valor={valor} onChange={setValor} />
        <output>{textoDosHorarios(valor)}</output>
      </>
    );
  }

  it('abre um dia e gera o texto que o site exibe', async () => {
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.click(screen.getByRole('switch', { name: 'Segunda-feira' }));
    expect(screen.getByRole('status').textContent).toBe('Seg: 08:00–18:00 · Ter a Dom: Fechado');
  });

  it('copia um dia para os dias úteis', async () => {
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.click(screen.getByRole('switch', { name: 'Segunda-feira' }));
    await usuario.click(screen.getByRole('button', { name: 'Aplicar segunda a sexta' }));
    expect(screen.getByRole('status').textContent).toBe('Seg a Sex: 08:00–18:00 · Sáb a Dom: Fechado');
  });

  it('acusa fechamento antes da abertura no dia que errou', async () => {
    const usuario = userEvent.setup();
    const inicial = horariosVazios();
    inicial.seg = { aberto: true, vinteQuatroHoras: false, periodos: [{ abre: '18:00', fecha: '08:00' }] };
    render(<Tela inicial={inicial} />);
    expect(screen.getByText('O fechamento precisa ser depois da abertura.')).toBeTruthy();
  });

  it('24 horas esconde os seletores do dia', async () => {
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.click(screen.getByRole('switch', { name: 'Domingo' }));
    await usuario.click(screen.getAllByLabelText('24 horas')[0]!);
    expect(screen.getByText('Aberto 24 horas.')).toBeTruthy();
  });

  /*
    O intervalo parte o expediente em vez de acrescentar um periodo solto: um
    segundo periodo com horario fixo nasceria invadindo o primeiro, e o dia
    apareceria ja com erro.
  */
  it('intervalo parte o expediente, sem nascer com erro', async () => {
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.click(screen.getByRole('switch', { name: 'Segunda-feira' }));
    await usuario.click(screen.getAllByRole('button', { name: 'Intervalo' })[0]!);
    expect(screen.getByRole('status').textContent).toContain('Seg: 08:00–12:00 e 13:00–18:00');
    expect(screen.getByLabelText('Reabre às')).toBeTruthy();
    expect(screen.queryByText(/precisa começar depois/)).toBeNull();
  });
});
