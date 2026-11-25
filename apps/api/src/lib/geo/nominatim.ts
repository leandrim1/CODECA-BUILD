import {
  arredondarCoordenada,
  digitosDeCep,
  normalizarEndereco,
  normalizarUf,
  type GeoResult,
  type GeocodingProvider,
  type GeocodingSearchOptions,
  type NormalizedAddress,
} from '@codeca/shared';
import { buscarJson } from './http.js';

/**
 * Adaptador do Nominatim (OpenStreetMap).
 *
 * E o padrao da plataforma por um motivo so: nao exige chave nem cartao. O
 * preco disso e a politica de uso deles, que esta codificada aqui e na fila
 * (`fila.ts`) -- um pedido por segundo, `User-Agent` identificando quem chama
 * e nada de autocomplete a cada tecla.
 *
 * Nada do formato deles vaza daqui: entra JSON do Nominatim, sai
 * `NormalizedAddress`.
 */

export interface NominatimOptions {
  /** Instancia propria, quando houver. Sem barra no fim. */
  baseUrl?: string;
  /** Contato exigido pela politica de uso; vem do ambiente. */
  contato: string;
  buscar?: typeof globalThis.fetch;
}

const PADRAO = 'https://nominatim.openstreetmap.org';

function parte(endereco: Record<string, unknown>, chave: string): string {
  const valor = endereco[chave];
  return typeof valor === 'string' ? valor.trim() : '';
}

/** O Nominatim quebra o endereco em dezenas de chaves; estas sao as que valem. */
function paraEndereco(item: Record<string, unknown>): NormalizedAddress {
  const endereco = (item['address'] ?? {}) as Record<string, unknown>;
  const lat = Number(item['lat']);
  const lng = Number(item['lon']);

  return normalizarEndereco({
    street: parte(endereco, 'road') || parte(endereco, 'pedestrian') || parte(endereco, 'footway'),
    number: parte(endereco, 'house_number'),
    neighborhood: parte(endereco, 'suburb') || parte(endereco, 'neighbourhood') || parte(endereco, 'quarter'),
    // A ordem importa: `city` existe nas capitais, `town`/`village` no
    // interior, e `municipality` e o nome oficial quando nenhum dos tres veio.
    city:
      parte(endereco, 'city')
      || parte(endereco, 'town')
      || parte(endereco, 'village')
      || parte(endereco, 'municipality'),
    state: normalizarUf(parte(endereco, 'ISO3166-2-lvl4') || parte(endereco, 'state')),
    postalCode: digitosDeCep(parte(endereco, 'postcode')),
    ...(Number.isFinite(lat) ? { lat: arredondarCoordenada(lat) } : {}),
    ...(Number.isFinite(lng) ? { lng: arredondarCoordenada(lng) } : {}),
  });
}

export function criarNominatim(opcoes: NominatimOptions): GeocodingProvider {
  const base = (opcoes.baseUrl ?? PADRAO).replace(/\/$/, '');
  const buscar = opcoes.buscar ?? globalThis.fetch;
  /*
    Identificacao exigida pela politica de uso do Nominatim. Vai do SERVIDOR,
    e nao do navegador, porque `User-Agent` e cabecalho proibido ao JavaScript
    -- e e essa a razao tecnica de o proxy existir, alem do custo.
  */
  const cabecalhos = {
    accept: 'application/json',
    'user-agent': `CODECA-Build/1.0 (+https://codecabuild.vercel.app; ${opcoes.contato})`,
  };

  return {
    id: 'nominatim',

    async search(consulta, opts: GeocodingSearchOptions = {}) {
      const limite = Math.min(Math.max(opts.limit ?? 5, 1), 10);
      const url = new URL(`${base}/search`);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('q', consulta);
      url.searchParams.set('limit', String(limite));
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('countrycodes', (opts.country ?? 'BR').toLowerCase());
      url.searchParams.set('accept-language', opts.language ?? 'pt-BR');

      const corpo = await buscarJson(url.toString(), { cabecalhos, buscar, ...(opts.signal ? { signal: opts.signal } : {}) });
      if (!Array.isArray(corpo)) return [];

      return corpo.slice(0, limite).map((bruto): GeoResult => {
        const item = bruto as Record<string, unknown>;
        const endereco = paraEndereco(item);
        return {
          label: typeof item['display_name'] === 'string' ? item['display_name'] : '',
          address: endereco,
          lat: endereco.lat ?? Number(item['lat']),
          lng: endereco.lng ?? Number(item['lon']),
        };
      });
    },

    async reverse(lat, lng, opts: GeocodingSearchOptions = {}) {
      const url = new URL(`${base}/reverse`);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      // 18 e a rua com numero; mais do que isso devolve o predio, e menos
      // devolve o bairro.
      url.searchParams.set('zoom', '18');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('accept-language', opts.language ?? 'pt-BR');

      const corpo = await buscarJson(url.toString(), { cabecalhos, buscar, ...(opts.signal ? { signal: opts.signal } : {}) });
      if (!corpo || typeof corpo !== 'object' || (corpo as Record<string, unknown>)['error']) return null;
      return paraEndereco(corpo as Record<string, unknown>);
    },
  };
}
