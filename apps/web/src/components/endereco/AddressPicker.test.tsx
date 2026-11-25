// @vitest-environment happy-dom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NormalizedAddress } from '@codeca/shared';
import { AddressPicker } from './AddressPicker.js';

/**
 * O formulario de endereco.
 *
 * Todos os testes rodam SEM MAPA (`semMapa`), de proposito: e a prova de que
 * o formulario sozinho preenche tudo -- que e a alternativa acessivel
 * prometida a quem navega por teclado ou bloqueia scripts.
 *
 * A rede e dublada no `fetch`: o componente nao conhece provedor, so as rotas
 * `/api/geo`.
 */

const ENCONTRADO: NormalizedAddress = {
  street: 'Rua Francisco Glicério',
  neighborhood: 'Centro',
  city: 'Campinas',
  state: 'SP',
  postalCode: '13010000',
  country: 'BR',
  lat: -22.9071,
  lng: -47.0632,
};

function responder(mapa: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL) => {
    const endereco = String(url);
    const chave = Object.keys(mapa).find((parte) => endereco.includes(parte));
    return {
      ok: true,
      json: async () => (chave ? mapa[chave] : { ok: true, data: [] }),
    } as Response;
  }) as typeof fetch);
}

function Tela({ inicial }: { inicial?: Partial<NormalizedAddress> }) {
  const [valor, setValor] = useState<NormalizedAddress>({
    street: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'BR',
    ...inicial,
  });
  return (
    <>
      <AddressPicker value={valor} onChange={setValor} semMapa />
      <output>{JSON.stringify(valor)}</output>
    </>
  );
}

const guardado = () => JSON.parse(screen.getByRole('status').textContent ?? '{}') as NormalizedAddress;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CEP', () => {
  it('aplica a mascara e guarda so os digitos', async () => {
    responder({ '/api/geo/cep/': { ok: true, data: ENCONTRADO } });
    const usuario = userEvent.setup();
    render(<Tela />);
    const campo = screen.getByLabelText('CEP') as HTMLInputElement;
    await usuario.type(campo, '13010000');
    expect(campo.value).toBe('13010-000');
    expect(guardado().postalCode).toBe('13010000');
  });

  it('ao completar oito digitos preenche rua, bairro, cidade e UF', async () => {
    responder({ '/api/geo/cep/': { ok: true, data: ENCONTRADO } });
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.type(screen.getByLabelText('CEP'), '13010000');

    await waitFor(() => expect(guardado().city).toBe('Campinas'));
    const atual = guardado();
    expect(atual.street).toBe('Rua Francisco Glicério');
    expect(atual.neighborhood).toBe('Centro');
    expect(atual.state).toBe('SP');
    expect(atual.lat).toBe(-22.9071);
  });

  it('o que foi preenchido continua editavel', async () => {
    responder({ '/api/geo/cep/': { ok: true, data: ENCONTRADO } });
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.type(screen.getByLabelText('CEP'), '13010000');
    await waitFor(() => expect(guardado().city).toBe('Campinas'));

    const cidade = screen.getByLabelText('Cidade');
    await usuario.clear(cidade);
    await usuario.type(cidade, 'Valinhos');
    expect(guardado().city).toBe('Valinhos');
  });

  /*
    O provedor nao conhece complemento nem numero, e erra numero com
    frequencia: sobrescrever o que a pessoa digitou trocaria dado bom por dado
    generico.
  */
  it('a consulta nao apaga numero e complemento ja digitados', async () => {
    responder({ '/api/geo/cep/': { ok: true, data: { ...ENCONTRADO, number: '1' } } });
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.type(screen.getByLabelText('Número'), '935');
    await usuario.type(screen.getByLabelText('Complemento'), 'Sala 4');
    await usuario.type(screen.getByLabelText('CEP'), '13010000');

    await waitFor(() => expect(guardado().city).toBe('Campinas'));
    expect(guardado().number).toBe('935');
    expect(guardado().complement).toBe('Sala 4');
  });

  it('CEP inexistente vira aviso, e o formulario segue utilizavel', async () => {
    responder({ '/api/geo/cep/': { ok: false, error: { code: 'not_found', message: 'CEP não encontrado.' } } });
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.type(screen.getByLabelText('CEP'), '99999999');

    await waitFor(() => expect(screen.getByText(/CEP não encontrado/)).toBeTruthy());
    const rua = screen.getByLabelText('Endereço');
    await usuario.type(rua, 'Rua à mão');
    expect(guardado().street).toBe('Rua à mão');
  });

  it('acusa CEP incompleto so depois do blur', async () => {
    responder({});
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.type(screen.getByLabelText('CEP'), '1301');
    expect(screen.queryByText(/8 dígitos/)).toBeNull();
    await usuario.tab();
    expect(screen.getByText(/8 dígitos/)).toBeTruthy();
  });
});

describe('UF', () => {
  it('e uma lista fechada com as 27 siglas', () => {
    responder({});
    render(<Tela />);
    const uf = screen.getByLabelText('Estado') as HTMLSelectElement;
    expect(uf.tagName).toBe('SELECT');
    // 27 UFs + o rotulo vazio.
    expect(uf.querySelectorAll('option')).toHaveLength(28);
  });

  it('guarda a sigla escolhida', async () => {
    responder({});
    const usuario = userEvent.setup();
    render(<Tela />);
    await usuario.selectOptions(screen.getByLabelText('Estado'), 'MG');
    expect(guardado().state).toBe('MG');
  });
});

describe('sem mapa, o formulario sozinho da conta', () => {
  it('preenche o endereco inteiro por teclado', async () => {
    responder({});
    const usuario = userEvent.setup();
    render(<Tela />);

    await usuario.type(screen.getByLabelText('Endereço'), 'Rua das Flores');
    await usuario.type(screen.getByLabelText('Número'), '123');
    await usuario.type(screen.getByLabelText('Bairro'), 'Centro');
    await usuario.type(screen.getByLabelText('Cidade'), 'Curitiba');
    await usuario.selectOptions(screen.getByLabelText('Estado'), 'PR');

    expect(guardado()).toMatchObject({
      street: 'Rua das Flores',
      number: '123',
      neighborhood: 'Centro',
      city: 'Curitiba',
      state: 'PR',
      country: 'BR',
    });
  });

  it('nao carrega mapa nenhum', () => {
    responder({});
    render(<Tela />);
    expect(screen.queryByLabelText('Mapa do endereço')).toBeNull();
    expect(screen.queryByPlaceholderText('Digite um endereço')).toBeNull();
  });
});
