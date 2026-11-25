import { describe, expect, it, vi } from 'vitest';
import {
  TILE_PROVIDERS,
  chaveDeBusca,
  chaveDeCoordenada,
  enderecoEmUmaLinha,
  lerMapSettings,
  linksDeRota,
  mapSettingsPadrao,
  normalizarEndereco,
  normalizarUf,
  tileProvider,
  tileUrlDoTema,
} from '@codeca/shared';
import { criarNominatim } from '../../apps/api/src/lib/geo/nominatim.js';
import { criarProvedorDeCep } from '../../apps/api/src/lib/geo/viacep.js';

/**
 * Adaptadores e normalizacao.
 *
 * A rede nao entra: o `fetch` e dublado. O que se testa e o que esta sob
 * nosso controle -- o pedido (inclusive o `User-Agent` que a politica do
 * Nominatim exige) e a traducao da resposta para `NormalizedAddress`.
 */

function respondendo(...corpos: unknown[]) {
  const chamadas: Array<{ url: string; cabecalhos: Record<string, string> }> = [];
  let i = 0;
  const buscar = vi.fn(async (url: string | URL, init?: RequestInit) => {
    chamadas.push({ url: String(url), cabecalhos: (init?.headers ?? {}) as Record<string, string> });
    const corpo = corpos[Math.min(i, corpos.length - 1)];
    i += 1;
    if (corpo instanceof Error) throw corpo;
    return { ok: true, json: async () => corpo } as Response;
  }) as unknown as typeof globalThis.fetch;
  return { buscar, chamadas };
}

const RESPOSTA_NOMINATIM = {
  lat: '-22.9071',
  lon: '-47.0632',
  display_name: 'Rua Francisco Glicério, 935, Centro, Campinas, SP',
  address: {
    road: 'Rua Francisco Glicério',
    house_number: '935',
    suburb: 'Centro',
    city: 'Campinas',
    'ISO3166-2-lvl4': 'BR-SP',
    postcode: '13012-100',
  },
};

describe('adaptador do Nominatim', () => {
  it('identifica a aplicacao, como a politica de uso exige', async () => {
    const { buscar, chamadas } = respondendo(RESPOSTA_NOMINATIM);
    const provedor = criarNominatim({ contato: 'suporte@exemplo.com.br', buscar });
    await provedor.reverse(-22.9071, -47.0632);
    expect(chamadas[0]?.cabecalhos['user-agent']).toContain('CODECA-Build');
    expect(chamadas[0]?.cabecalhos['user-agent']).toContain('suporte@exemplo.com.br');
  });

  it('traduz as partes soltas para o endereco normalizado', async () => {
    const { buscar } = respondendo(RESPOSTA_NOMINATIM);
    const provedor = criarNominatim({ contato: 'a@b.com', buscar });
    expect(await provedor.reverse(-22.9071, -47.0632)).toEqual({
      street: 'Rua Francisco Glicério',
      number: '935',
      neighborhood: 'Centro',
      city: 'Campinas',
      state: 'SP',
      postalCode: '13012100',
      country: 'BR',
      lat: -22.9071,
      lng: -47.0632,
    });
  });

  it('busca so no Brasil e devolve o rotulo da lista', async () => {
    const { buscar, chamadas } = respondendo([RESPOSTA_NOMINATIM, RESPOSTA_NOMINATIM]);
    const provedor = criarNominatim({ contato: 'a@b.com', buscar });
    const encontrados = await provedor.search('francisco glicerio', { limit: 2 });
    expect(chamadas[0]?.url).toContain('countrycodes=br');
    expect(encontrados).toHaveLength(2);
    expect(encontrados[0]?.label).toContain('Francisco Glicério');
    expect(encontrados[0]?.address.city).toBe('Campinas');
  });

  it('ponto sem endereco conhecido devolve null, e nao erro', async () => {
    const { buscar } = respondendo({ error: 'Unable to geocode' });
    const provedor = criarNominatim({ contato: 'a@b.com', buscar });
    expect(await provedor.reverse(0, 0)).toBeNull();
  });

  it('instancia propria troca a URL sem tocar no resto', async () => {
    const { buscar, chamadas } = respondendo(RESPOSTA_NOMINATIM);
    const provedor = criarNominatim({ contato: 'a@b.com', buscar, baseUrl: 'https://geo.interno.exemplo' });
    await provedor.search('rua x');
    expect(chamadas[0]?.url.startsWith('https://geo.interno.exemplo/search')).toBe(true);
  });
});

describe('adaptador de CEP', () => {
  const VIACEP = {
    cep: '13010-000',
    logradouro: 'Rua Francisco Glicério',
    bairro: 'Centro',
    localidade: 'Campinas',
    uf: 'sp',
  };

  it('normaliza a resposta do ViaCEP', async () => {
    const { buscar, chamadas } = respondendo(VIACEP);
    const encontrado = await criarProvedorDeCep({ buscar }).lookup('13010-000');
    expect(chamadas[0]?.url).toBe('https://viacep.com.br/ws/13010000/json/');
    expect(encontrado).toMatchObject({ city: 'Campinas', state: 'SP', postalCode: '13010000' });
  });

  /*
    O ViaCEP sai do ar com alguma frequencia, e o cliente que acabou de digitar
    o CEP dele nao deve pagar por isso: a BrasilAPI atende o mesmo dado por
    outra infraestrutura.
  */
  it('cai para a BrasilAPI quando o ViaCEP falha', async () => {
    const { buscar, chamadas } = respondendo(new Error('fora do ar'), {
      street: 'Rua Francisco Glicério',
      neighborhood: 'Centro',
      city: 'Campinas',
      state: 'SP',
      location: { coordinates: { latitude: -22.9, longitude: -47.06 } },
    });
    const encontrado = await criarProvedorDeCep({ buscar }).lookup('13010000');
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]?.url).toContain('brasilapi.com.br');
    expect(encontrado).toMatchObject({ city: 'Campinas', state: 'SP', lat: -22.9, lng: -47.06 });
  });

  it('CEP inexistente no ViaCEP ainda tenta a segunda base', async () => {
    const { buscar, chamadas } = respondendo({ erro: true }, { errors: [{ message: 'nao encontrado' }] });
    expect(await criarProvedorDeCep({ buscar }).lookup('99999999')).toBeNull();
    expect(chamadas).toHaveLength(2);
  });

  it('recusa CEP malformado antes de sair para a rede', async () => {
    const { buscar, chamadas } = respondendo({});
    await expect(criarProvedorDeCep({ buscar }).lookup('1301')).rejects.toMatchObject({ code: 'bad_request' });
    expect(chamadas).toHaveLength(0);
  });
});

describe('normalizacao', () => {
  it('aceita a UF em qualquer forma que os provedores usam', () => {
    expect(normalizarUf('sp')).toBe('SP');
    expect(normalizarUf('BR-RS')).toBe('RS');
    expect(normalizarUf('Sao Paulo')).toBe('');
    expect(normalizarUf('XX')).toBe('');
  });

  it('campo ausente vira vazio, nunca undefined solto', () => {
    const endereco = normalizarEndereco({ street: ' Rua X ', city: 'Campinas', state: 'sp' });
    expect(endereco).toEqual({ street: 'Rua X', city: 'Campinas', state: 'SP', postalCode: '', country: 'BR' });
  });

  it('arredonda coordenada para seis casas', () => {
    expect(normalizarEndereco({ lat: -22.90712345678, lng: -47.0632 }).lat).toBe(-22.907123);
  });

  it('monta a linha legivel do endereco', () => {
    expect(
      enderecoEmUmaLinha({ street: 'Rua X', number: '100', neighborhood: 'Centro', city: 'Campinas', state: 'SP' }),
    ).toBe('Rua X, 100 - Centro, Campinas - SP');
  });

  it('a chave de cache ignora acento, caixa e espaco repetido', () => {
    expect(chaveDeBusca('  Rua  Francisco Glicério ')).toBe('rua francisco glicerio');
    expect(chaveDeBusca('RUA FRANCISCO GLICERIO')).toBe('rua francisco glicerio');
  });

  it('a chave de coordenada arredonda a cinco casas (~1 metro)', () => {
    expect(chaveDeCoordenada(-22.9071234, -47.0632987)).toBe('-22.90712,-47.06330');
  });
});

describe('camadas de mapa e configuracao', () => {
  it('todo preset declara atribuicao -- e exigencia de licenca', () => {
    for (const provider of Object.values(TILE_PROVIDERS)) {
      expect(provider.attribution, provider.id).toContain('OpenStreetMap');
      expect(provider.tileUrl.startsWith('https://'), provider.id).toBe(true);
    }
  });

  it('preset desconhecido cai no padrao em vez de quebrar o mapa', () => {
    expect(tileProvider('nao-existe').id).toBe('padrao');
    expect(tileProvider(null).id).toBe('padrao');
  });

  it('tema escuro usa a variante escura quando o preset tem uma', () => {
    expect(tileUrlDoTema(TILE_PROVIDERS.claro!, true)).toContain('dark_all');
    // Sem variante, volta a clara: melhor mapa claro do que quadrado cinza.
    expect(tileUrlDoTema(TILE_PROVIDERS.padrao!, true)).toBe(TILE_PROVIDERS.padrao!.tileUrl);
  });

  it('configuracao corrompida vira o padrao, sem derrubar a pagina', () => {
    expect(lerMapSettings({ estilo: 'inexistente', zoom: 99 })).toEqual(mapSettingsPadrao());
    expect(lerMapSettings(null)).toEqual(mapSettingsPadrao());
    expect(lerMapSettings({ zoom: 14 }).zoom).toBe(14);
  });

  it('links de rota saem so da coordenada, sem chave nem API', () => {
    const links = linksDeRota({ lat: -22.9, lng: -47.06 }, { google: true, waze: true, apple: true });
    expect(links.map((l) => l.id)).toEqual(['google', 'waze', 'apple']);
    expect(links[0]?.url).toBe('https://www.google.com/maps/dir/?api=1&destination=-22.9,-47.06');
    expect(linksDeRota({ lat: undefined, lng: undefined })).toEqual([]);
  });
});
