import type { MapTileProvider } from './tipos.js';

/**
 * Camadas de mapa disponiveis, todas sem chave de API.
 *
 * Sao PRESETS, nao fornecedores no codigo: cada um e um objeto com URL,
 * atribuicao e limite de zoom. Entrar com Mapbox, MapTiler ou um servidor
 * proprio de ladrilhos e acrescentar um objeto aqui -- nenhum componente muda,
 * porque a tela le `MapTileProvider` e nao sabe de onde a imagem vem.
 *
 * A atribuicao nao e opcional em nenhum deles: e a condicao da licenca do
 * OpenStreetMap e dos mapas derivados dele.
 */

const OSM_CREDITO = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_CREDITO = `${OSM_CREDITO} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

export const TILE_PROVIDERS: Readonly<Record<string, MapTileProvider>> = {
  /** O mapa classico do OpenStreetMap: colorido, com tudo. */
  padrao: {
    id: 'padrao',
    label: 'Padrão',
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_CREDITO,
    maxZoom: 19,
  },
  /** Base clara, de pouco contraste: o pino e o endereco ficam em primeiro plano. */
  claro: {
    id: 'claro',
    label: 'Claro',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_CREDITO,
    maxZoom: 20,
    darkTileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  },
  /** Base escura, para sites de tema escuro. */
  escuro: {
    id: 'escuro',
    label: 'Escuro',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_CREDITO,
    maxZoom: 20,
  },
  /** So o essencial: ruas e agua, sem rotulos de comercio. */
  minimalista: {
    id: 'minimalista',
    label: 'Minimalista',
    tileUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
    attribution: CARTO_CREDITO,
    maxZoom: 20,
    darkTileUrl: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
  },
};

export const TILE_PROVIDER_IDS = Object.keys(TILE_PROVIDERS) as Array<keyof typeof TILE_PROVIDERS>;
export const TILE_PADRAO = 'padrao';

/** Preset pedido, ou o padrao -- id desconhecido nunca derruba o mapa. */
export function tileProvider(id: string | null | undefined): MapTileProvider {
  return TILE_PROVIDERS[id ?? ''] ?? TILE_PROVIDERS[TILE_PADRAO]!;
}

/**
 * A URL que vale agora, considerando o tema.
 *
 * Preset sem variante escura devolve a clara: e melhor um mapa claro num site
 * escuro do que um quadrado cinza.
 */
export function tileUrlDoTema(provider: MapTileProvider, escuro: boolean): string {
  return escuro && provider.darkTileUrl ? provider.darkTileUrl : provider.tileUrl;
}
