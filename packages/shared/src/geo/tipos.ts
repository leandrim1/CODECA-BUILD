/**
 * Contrato de geolocalizacao, independente de quem responde.
 *
 * A regra desta pasta: NENHUM componente de tela e NENHUMA rota conhece
 * Nominatim, ViaCEP ou OpenStreetMap. Todos falam com estas interfaces, e o
 * adaptador concreto e escolhido por configuracao (`registry`).
 *
 * O que isso compra, em concreto: trocar o provedor -- por Google, Mapbox,
 * MapTiler, Photon, ou uma instancia propria de Nominatim -- e escrever um
 * arquivo novo e mudar uma variavel de ambiente. Nenhum componente muda, e,
 * principalmente, **o que esta gravado continua valendo**, porque o formato
 * guardado e o normalizado daqui, nao o JSON que o provedor devolveu.
 */

/** UF em sigla; o pais e fixo porque a plataforma atende o Brasil. */
export interface NormalizedAddress {
  street: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city: string;
  /** Sigla da UF, em maiuscula. */
  state: string;
  /** So digitos. */
  postalCode: string;
  country: 'BR';
  lat?: number;
  lng?: number;
}

/** Um resultado de busca: o endereco normalizado mais o rotulo para a lista. */
export interface GeoResult {
  /** Linha pronta para mostrar na lista de sugestoes. */
  label: string;
  address: NormalizedAddress;
  lat: number;
  lng: number;
}

export interface GeocodingSearchOptions {
  /** Teto de resultados. O adaptador pode devolver menos. */
  limit?: number;
  /** Restringe a busca a um pais (ISO-2). Padrao: `BR`. */
  country?: string;
  /** Idioma preferido da resposta. Padrao: `pt-BR`. */
  language?: string;
  /** Cancelamento, para a tela poder desistir de uma busca antiga. */
  signal?: AbortSignal;
}

export interface GeocodingProvider {
  /** Nome curto e estavel; vai para `geocode_source` e para o log. */
  readonly id: string;
  search(query: string, opts?: GeocodingSearchOptions): Promise<GeoResult[]>;
  /** `null` quando o ponto nao tem endereco conhecido (mar, meio do campo). */
  reverse(lat: number, lng: number, opts?: GeocodingSearchOptions): Promise<NormalizedAddress | null>;
}

export interface PostalCodeProvider {
  readonly id: string;
  /** `null` quando o CEP nao existe. Erro de rede e excecao, nao `null`. */
  lookup(cep: string, opts?: { signal?: AbortSignal }): Promise<NormalizedAddress | null>;
}

/**
 * Camada de ladrilhos.
 *
 * E so dado -- URL, atribuicao e limites. Nenhum provedor de mapa precisa de
 * codigo nosso para entrar: um preset novo e um objeto novo.
 */
export interface MapTileProvider {
  readonly id: string;
  /** Nome para a tela de configuracao. */
  readonly label: string;
  readonly tileUrl: string;
  /**
   * Exigencia de licenca, nao enfeite: o OpenStreetMap pede o credito visivel,
   * e os mapas derivados tambem. Sai na tela, sempre.
   */
  readonly attribution: string;
  readonly maxZoom: number;
  /** Variante escura, quando o provedor tem uma. */
  readonly darkTileUrl?: string;
  /** `true` quando a URL exige chave; o registry recusa sem a variavel. */
  readonly requiresKey?: boolean;
}

/** De onde veio a ultima geocodificacao -- auditoria, nunca logica. */
export interface GeocodeAudit {
  geocodedAt?: string | null;
  geocodeSource?: string | null;
}
