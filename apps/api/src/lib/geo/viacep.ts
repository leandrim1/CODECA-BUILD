import {
  cepValido,
  digitosDeCep,
  normalizarEndereco,
  type NormalizedAddress,
  type PostalCodeProvider,
} from '@codeca/shared';
import { AppError } from '@codeca/shared';
import { buscarJson } from './http.js';

/**
 * CEP, com dois servicos e uma ordem.
 *
 * O ViaCEP e o padrao de fato no Brasil e responde rapido, mas sai do ar com
 * alguma frequencia. A BrasilAPI atende o mesmo dado por outra
 * infraestrutura, entao serve de segunda tentativa -- e o cliente, que so quer
 * o endereco dele, nao fica sabendo que o primeiro caiu.
 *
 * As duas respostas viram `NormalizedAddress` aqui dentro. A diferenca entre
 * os formatos (`localidade` x `city`, `uf` x `state`) morre neste arquivo.
 */

export interface CepOptions {
  buscar?: typeof globalThis.fetch;
  viaCepUrl?: string;
  brasilApiUrl?: string;
}

const VIACEP = 'https://viacep.com.br/ws';
const BRASILAPI = 'https://brasilapi.com.br/api/cep/v2';

const CABECALHOS = { accept: 'application/json' };

export const CEP_NAO_ENCONTRADO =
  'CEP não encontrado. Confira o número ou preencha o endereço à mão.';

function texto(corpo: Record<string, unknown>, chave: string): string {
  const valor = corpo[chave];
  return typeof valor === 'string' ? valor.trim() : '';
}

/** ViaCEP: responde 200 com `{ erro: true }` para CEP inexistente. */
function doViaCep(corpo: unknown, cep: string): NormalizedAddress | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const registro = corpo as Record<string, unknown>;
  if (registro['erro'] === true || registro['erro'] === 'true') return null;

  return normalizarEndereco({
    street: texto(registro, 'logradouro'),
    neighborhood: texto(registro, 'bairro'),
    city: texto(registro, 'localidade'),
    state: texto(registro, 'uf'),
    postalCode: cep,
  });
}

/**
 * BrasilAPI v2: mesmo dado, outros nomes -- e, as vezes, coordenada junto
 * (`location.coordinates`), que poupa uma ida ao geocodificador.
 */
function daBrasilApi(corpo: unknown, cep: string): NormalizedAddress | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const registro = corpo as Record<string, unknown>;
  if (registro['name'] === 'CepPromiseError' || registro['errors']) return null;

  const local = (registro['location'] ?? {}) as Record<string, unknown>;
  const coordenadas = (local['coordinates'] ?? {}) as Record<string, unknown>;
  const lat = Number(coordenadas['latitude']);
  const lng = Number(coordenadas['longitude']);

  return normalizarEndereco({
    street: texto(registro, 'street'),
    neighborhood: texto(registro, 'neighborhood'),
    city: texto(registro, 'city'),
    state: texto(registro, 'state'),
    postalCode: cep,
    ...(Number.isFinite(lat) && lat !== 0 ? { lat } : {}),
    ...(Number.isFinite(lng) && lng !== 0 ? { lng } : {}),
  });
}

export function criarProvedorDeCep(opcoes: CepOptions = {}): PostalCodeProvider {
  const buscar = opcoes.buscar ?? globalThis.fetch;
  const viaCep = (opcoes.viaCepUrl ?? VIACEP).replace(/\/$/, '');
  const brasilApi = (opcoes.brasilApiUrl ?? BRASILAPI).replace(/\/$/, '');

  return {
    id: 'viacep+brasilapi',

    async lookup(cepBruto, opts = {}) {
      const cep = digitosDeCep(cepBruto);
      if (!cepValido(cep)) throw AppError.badRequest('Informe um CEP com 8 dígitos.');
      const assinatura = { cabecalhos: CABECALHOS, buscar, ...(opts.signal ? { signal: opts.signal } : {}) };

      try {
        const encontrado = doViaCep(await buscarJson(`${viaCep}/${cep}/json/`, assinatura), cep);
        if (encontrado) return encontrado;
        /*
          CEP recusado pelo ViaCEP ainda vai a BrasilAPI antes de virar "nao
          existe": as duas bases divergem em CEP novo, e o cliente que acabou
          de receber o dele nao deve ouvir que o endereco nao existe.
        */
      } catch {
        // Falha do primeiro servico nao e resposta: tenta o segundo.
      }

      const alternativo = daBrasilApi(await buscarJson(`${brasilApi}/${cep}`, assinatura), cep);
      return alternativo;
    },
  };
}
