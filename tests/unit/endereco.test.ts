import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@codeca/shared';
import { buscarCep, buscarEnderecos, enderecoPorCoordenada } from '../../apps/api/src/lib/endereco.js';

/**
 * Consulta de endereco pelo servidor.
 *
 * A rede nao entra aqui: o `fetch` e dublado, e o que se testa e o que esta
 * sob nosso controle -- a forma do pedido (inclusive o `User-Agent` que a
 * politica do Nominatim exige) e a leitura da resposta, com o caso chato do
 * ViaCEP, que responde 200 para CEP inexistente.
 */

function respondendo(corpo: unknown, ok = true): { buscar: typeof globalThis.fetch; chamadas: Array<{ url: string; cabecalhos: Record<string, string> }> } {
  const chamadas: Array<{ url: string; cabecalhos: Record<string, string> }> = [];
  const buscar = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), cabecalhos: (init?.headers ?? {}) as Record<string, string> });
    return { ok, json: async () => corpo } as Response;
  }) as unknown as typeof globalThis.fetch;
  return { buscar, chamadas };
}

describe('CEP no ViaCEP', () => {
  it('devolve o endereco com a UF em maiuscula e o CEP em digitos', async () => {
    const { buscar, chamadas } = respondendo({
      cep: '13010-000',
      logradouro: 'Rua Francisco Glicério',
      bairro: 'Centro',
      localidade: 'Campinas',
      uf: 'sp',
    });

    const endereco = await buscarCep('13010-000', buscar);
    expect(chamadas[0]?.url).toBe('https://viacep.com.br/ws/13010000/json/');
    expect(endereco).toMatchObject({
      cep: '13010000',
      addressLine: 'Rua Francisco Glicério',
      neighborhood: 'Centro',
      city: 'Campinas',
      state: 'SP',
    });
  });

  /*
    O ViaCEP responde 200 com `{ erro: true }` quando o CEP nao existe. Olhar
    so o status daria "deu certo" com o formulario vazio.
  */
  it('trata CEP inexistente, que vem com status 200', async () => {
    const { buscar } = respondendo({ erro: true });
    await expect(buscarCep('99999999', buscar)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('recusa CEP malformado antes de sair para a rede', async () => {
    const { buscar, chamadas } = respondendo({});
    await expect(buscarCep('1301', buscar)).rejects.toBeInstanceOf(AppError);
    expect(chamadas).toHaveLength(0);
  });

  it('servico fora do ar vira mensagem de "preencha a mao"', async () => {
    const buscar = (async () => {
      throw new Error('rede fora');
    }) as unknown as typeof globalThis.fetch;
    await expect(buscarCep('13010000', buscar)).rejects.toMatchObject({ code: 'upstream_error' });
  });
});

describe('geocodificacao no Nominatim', () => {
  const resposta = {
    lat: '-22.9071',
    lon: '-47.0632',
    address: {
      road: 'Rua Francisco Glicério',
      house_number: '935',
      suburb: 'Centro',
      city: 'Campinas',
      'ISO3166-2-lvl4': 'BR-SP',
      postcode: '13012-100',
    },
  };

  it('manda o User-Agent que a politica de uso exige', async () => {
    const { buscar, chamadas } = respondendo(resposta);
    await enderecoPorCoordenada(-22.9071, -47.0632, buscar);
    expect(chamadas[0]?.cabecalhos['user-agent']).toContain('CODECA-Build');
  });

  it('monta rua com numero, cidade e UF a partir das partes', async () => {
    const { buscar } = respondendo(resposta);
    const endereco = await enderecoPorCoordenada(-22.9071, -47.0632, buscar);
    expect(endereco).toMatchObject({
      addressLine: 'Rua Francisco Glicério, 935',
      city: 'Campinas',
      state: 'SP',
      cep: '13012100',
      latitude: -22.9071,
      longitude: -47.0632,
    });
  });

  it('ponto sem endereco conhecido vira recusa clara', async () => {
    const { buscar } = respondendo({ error: 'Unable to geocode' });
    await expect(enderecoPorCoordenada(0, 0, buscar)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('busca por texto devolve ate cinco sugestoes, so do Brasil', async () => {
    const { buscar, chamadas } = respondendo(
      Array.from({ length: 8 }, (_, i) => ({ ...resposta, display_name: `Resultado ${i}` })),
    );
    const itens = await buscarEnderecos('rua francisco glicerio', buscar);
    expect(itens).toHaveLength(5);
    expect(itens[0]?.descricao).toBe('Resultado 0');
    expect(chamadas[0]?.url).toContain('countrycodes=br');
  });

  it('termo curto nao sai para a rede', async () => {
    const { buscar, chamadas } = respondendo([]);
    expect(await buscarEnderecos('ru', buscar)).toEqual([]);
    expect(chamadas).toHaveLength(0);
  });
});
