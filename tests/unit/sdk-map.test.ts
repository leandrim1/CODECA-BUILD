// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TILE_PROVIDERS, linksDeRota as linksDaPlataforma } from '@codeca/shared';
import { TILES, enderecoEmTexto, linksDeRota, montarMapa } from '../../packages/sdk/src/map.js';

/**
 * O mapa que vai para o site do cliente.
 *
 * O que importa aqui e o que acontece ANTES de qualquer carregamento: o
 * cartao com endereco e "Como chegar" e o conteudo real do componente, e
 * precisa existir sem Leaflet, sem rede e sem coordenada.
 */

const ENDERECO = {
  street: 'Rua Francisco Glicério',
  number: '935',
  neighborhood: 'Centro',
  city: 'Campinas',
  state: 'SP',
  lat: -22.907123,
  lng: -47.063298,
};

describe('cartao, que e o que sobrevive a tudo', () => {
  it('desenha endereco e rotas sem carregar mapa nenhum', () => {
    const alvo = document.createElement('div');
    montarMapa(alvo, { address: ENDERECO, settings: { carregarAoClicar: true } });

    expect(alvo.textContent).toContain('Rua Francisco Glicério, 935 - Centro, Campinas - SP');
    const links = [...alvo.querySelectorAll('a')].map((a) => a.textContent);
    expect(links).toContain('Google Maps');
    expect(links).toContain('Waze');
    // Nada de Leaflet foi buscado: o modo "clique para carregar" esta ligado.
    expect(document.querySelector('script[src*="leaflet"]')).toBeNull();
  });

  it('sem coordenada mostra so o endereco, sem espaco vazio de mapa', () => {
    const alvo = document.createElement('div');
    montarMapa(alvo, { address: { ...ENDERECO, lat: null, lng: null } });
    expect(alvo.textContent).toContain('Campinas');
    expect(alvo.querySelector('[role="region"]')).toBeNull();
    expect(alvo.querySelectorAll('a')).toHaveLength(0);
  });

  it('endereco vazio nao vira cartao em branco', () => {
    const alvo = document.createElement('div');
    montarMapa(alvo, { address: {} });
    expect(alvo.textContent).toContain('Endereço não informado.');
  });

  it('a limpeza devolve o elemento ao estado anterior', () => {
    const alvo = document.createElement('div');
    const limpar = montarMapa(alvo, { address: ENDERECO });
    expect(alvo.children.length).toBeGreaterThan(0);
    limpar();
    expect(alvo.innerHTML).toBe('');
  });
});

describe('links de rota', () => {
  it('saem so da coordenada, sem chave e sem API', () => {
    const links = linksDeRota(ENDERECO, { google: true, waze: true, apple: true });
    expect(links.map((l) => l.id)).toEqual(['google', 'waze', 'apple']);
    expect(links[0]?.url).toContain('destination=-22.907123,-47.063298');
  });

  it('respeitam o que o cliente desligou no painel', () => {
    expect(linksDeRota(ENDERECO, { google: false, waze: true }).map((l) => l.id)).toEqual(['waze']);
  });

  /*
    O SDK nao importa `@codeca/shared` -- a plataforma nao se instala no site
    do cliente. Este teste trava as duas implementacoes juntas, para a
    duplicacao de DADO nao virar divergencia de comportamento.
  */
  it('geram a mesma URL que a plataforma gera', () => {
    const doSdk = linksDeRota(ENDERECO, { google: true, waze: true, apple: true });
    const daPlataforma = linksDaPlataforma(
      { lat: ENDERECO.lat, lng: ENDERECO.lng },
      { google: true, waze: true, apple: true },
    );
    expect(doSdk.map((l) => l.url)).toEqual(daPlataforma.map((l) => l.url));
  });
});

describe('presets de mapa: SDK e plataforma nao podem divergir', () => {
  /*
    O SDK nao importa `@codeca/shared` -- a plataforma nao se instala no site
    do cliente --, entao a lista de camadas existe nos dois lugares. A
    duplicacao e de DADO, e estes dois testes sao o que impedem que ela vire
    divergencia: um estilo escolhido no painel tem de existir no site.
  */
  it('os mesmos ids existem dos dois lados', () => {
    expect(Object.keys(TILES).sort()).toEqual(Object.keys(TILE_PROVIDERS).sort());
  });

  it('as URLs e o zoom maximo batem', () => {
    for (const [id, doSdk] of Object.entries(TILES)) {
      const daPlataforma = TILE_PROVIDERS[id]!;
      expect(doSdk.url, id).toBe(daPlataforma.tileUrl);
      expect(doSdk.maxZoom, id).toBe(daPlataforma.maxZoom);
    }
  });

  it('todo preset credita o OpenStreetMap -- exigencia de licenca', () => {
    for (const [id, preset] of Object.entries(TILES)) {
      expect(preset.attribution, id).toContain('OpenStreetMap');
      expect(preset.url.startsWith('https://'), id).toBe(true);
    }
  });
});

describe('enderecoEmTexto', () => {
  it('junta so o que existe', () => {
    expect(enderecoEmTexto({ city: 'Campinas', state: 'SP' })).toBe('Campinas - SP');
    expect(enderecoEmTexto({ street: 'Rua X' })).toBe('Rua X');
    expect(enderecoEmTexto({})).toBe('');
  });
});
