/**
 * Geolocalizacao: contrato, normalizacao e apresentacao.
 *
 * O que NAO esta aqui: qualquer adaptador concreto. Nominatim, ViaCEP e
 * BrasilAPI vivem no servidor (`apps/api/src/lib/geo`), porque falam rede --
 * e porque o navegador nunca deve falar com eles direto.
 */
export * from './tipos.js';
export * from './normalizar.js';
export * from './tiles.js';
export * from './map-settings.js';
