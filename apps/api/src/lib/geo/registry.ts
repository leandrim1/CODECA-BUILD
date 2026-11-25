import { AppError, type GeocodingProvider, type PostalCodeProvider } from '@codeca/shared';
import type { Env } from '../../env.js';
import { criarNominatim } from './nominatim.js';
import { criarProvedorDeCep } from './viacep.js';

/**
 * Quem responde, decidido por configuracao.
 *
 * Este arquivo e o unico lugar da plataforma que conhece nomes de provedores.
 * Rotas e telas pedem `GeocodingProvider` e `PostalCodeProvider`, e nao sabem
 * quem apareceu.
 *
 * ## Como entra um provedor novo (sem tocar em UI)
 *
 * 1. Escreva o adaptador ao lado deste arquivo, devolvendo as mesmas
 *    interfaces e sempre `NormalizedAddress`.
 * 2. Acrescente uma linha no `switch` correspondente.
 * 3. Aponte `GEO_PROVIDER` (ou `GEO_CEP_PROVIDER`) para o id novo.
 *
 * O formato gravado nao muda, entao os enderecos ja salvos continuam valendo.
 */

export interface ProvedoresDeGeo {
  geocoding: GeocodingProvider;
  cep: PostalCodeProvider;
}

export interface OpcoesDoRegistry {
  /** Injetado nos testes; em producao e o `fetch` do ambiente. */
  buscar?: typeof globalThis.fetch;
}

function contatoDe(env: Env): string {
  /*
    A politica do Nominatim exige um contato identificavel. Sem nenhum
    configurado vai o endereco institucional -- melhor um contato generico do
    que nenhum, que e motivo de bloqueio do lado deles.
  */
  return env.GEO_CONTACT_EMAIL ?? env.SUPPORT_EMAIL ?? 'suporte@codecaia.com.br';
}

export function criarProvedoresDeGeo(env: Env, opcoes: OpcoesDoRegistry = {}): ProvedoresDeGeo {
  const buscar = opcoes.buscar ?? globalThis.fetch;

  const geocoding = (() => {
    switch (env.GEO_PROVIDER) {
      case 'nominatim':
        return criarNominatim({
          contato: contatoDe(env),
          buscar,
          ...(env.GEO_NOMINATIM_URL ? { baseUrl: env.GEO_NOMINATIM_URL } : {}),
        });
      default:
        /*
          Nome desconhecido e erro de configuracao, e nao motivo para cair no
          padrao em silencio: quem escreveu `GEO_PROVIDER=mapbox` esperando
          Mapbox precisa saber que ninguem implementou isso, em vez de
          descobrir pela conta do mes que continuou tudo no OpenStreetMap.
        */
        throw AppError.notConfigured(
          `Provedor de geocodificação desconhecido: "${env.GEO_PROVIDER}". Veja docs/geo.md.`,
        );
    }
  })();

  const cep = (() => {
    switch (env.GEO_CEP_PROVIDER) {
      case 'viacep':
        return criarProvedorDeCep({ buscar });
      default:
        throw AppError.notConfigured(
          `Provedor de CEP desconhecido: "${env.GEO_CEP_PROVIDER}". Veja docs/geo.md.`,
        );
    }
  })();

  return { geocoding, cep };
}
