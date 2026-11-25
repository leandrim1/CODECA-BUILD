import { BRAZIL_STATES } from '../constants.js';
import { arredondarCoordenada, digitosDeCep } from '../contato.js';
import type { NormalizedAddress } from './tipos.js';

/**
 * Normalizacao do endereco e das chaves de cache.
 *
 * Tudo o que entra por um adaptador passa por aqui antes de virar dado. E o
 * ponto onde o formato do provedor morre: o que segue adiante e sempre o
 * `NormalizedAddress`.
 */

const SEM_ACENTO = /[̀-ͯ]/g;

export function normalizarUf(valor: unknown): string {
  const texto = (typeof valor === 'string' ? valor : '').trim().toUpperCase();
  if ((BRAZIL_STATES as readonly string[]).includes(texto)) return texto;
  // Alguns provedores devolvem `BR-SP`, outros o nome por extenso.
  const sigla = texto.includes('-') ? (texto.split('-').pop() ?? '') : '';
  if ((BRAZIL_STATES as readonly string[]).includes(sigla)) return sigla;
  return '';
}

export function enderecoVazio(): NormalizedAddress {
  return { street: '', city: '', state: '', postalCode: '', country: 'BR' };
}

/**
 * Monta o endereco normalizado a partir de partes soltas.
 *
 * Campo ausente vira string vazia, e nao `undefined`: o formulario e o banco
 * lidam com um formato so, e `undefined` em JSON some na serializacao.
 */
export function normalizarEndereco(parcial: Partial<NormalizedAddress>): NormalizedAddress {
  const texto = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '');
  const endereco: NormalizedAddress = {
    street: texto(parcial.street),
    city: texto(parcial.city),
    state: normalizarUf(parcial.state),
    postalCode: digitosDeCep(parcial.postalCode),
    country: 'BR',
  };
  const numero = texto(parcial.number);
  const complemento = texto(parcial.complement);
  const bairro = texto(parcial.neighborhood);
  if (numero) endereco.number = numero;
  if (complemento) endereco.complement = complemento;
  if (bairro) endereco.neighborhood = bairro;
  if (typeof parcial.lat === 'number' && Number.isFinite(parcial.lat)) {
    endereco.lat = arredondarCoordenada(parcial.lat);
  }
  if (typeof parcial.lng === 'number' && Number.isFinite(parcial.lng)) {
    endereco.lng = arredondarCoordenada(parcial.lng);
  }
  return endereco;
}

/** Uma linha legivel: "Rua X, 100 - Centro, Campinas - SP". */
export function enderecoEmUmaLinha(endereco: Partial<NormalizedAddress> | null | undefined): string {
  if (!endereco) return '';
  const rua = [endereco.street, endereco.number].filter(Boolean).join(', ');
  const comBairro = [rua, endereco.neighborhood].filter(Boolean).join(' - ');
  const cidade = [endereco.city, endereco.state].filter(Boolean).join(' - ');
  return [comBairro, cidade].filter(Boolean).join(', ');
}

/** O endereco tem o minimo para um mapa fazer sentido? */
export function enderecoTemCoordenada(endereco: Partial<NormalizedAddress> | null | undefined): boolean {
  return typeof endereco?.lat === 'number' && typeof endereco?.lng === 'number';
}

/**
 * Texto para mandar ao geocodificador a partir do que o CEP devolveu.
 *
 * Com numero, quando ha: `Rua X, 100, Campinas, SP` cai no quarteirao certo,
 * enquanto so a rua cai no meio dela.
 */
export function consultaDoEndereco(endereco: Partial<NormalizedAddress>): string {
  return [
    [endereco.street, endereco.number].filter(Boolean).join(', '),
    endereco.neighborhood,
    endereco.city,
    endereco.state,
    'Brasil',
  ]
    .filter(Boolean)
    .join(', ');
}

// ------------------------------------------------------------ chaves de cache

/**
 * Chave de busca: minuscula, sem acento, sem espaco repetido.
 *
 * "Rua Francisco Glicério" e "rua francisco glicerio " sao a mesma pergunta, e
 * duas chaves diferentes seriam duas idas ao provedor pela mesma resposta.
 */
/** Minimo de caracteres para valer uma consulta ao provedor. */
export const MINIMO_DA_BUSCA_TEXTO = 3;

export function chaveDeBusca(consulta: string): string {
  return consulta
    .normalize('NFD')
    .replace(SEM_ACENTO, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Chave de coordenada: cinco casas decimais, cerca de 1,1 m.
 *
 * Arredondar e o que torna o cache util: dois arrastes do pino para o mesmo
 * ponto da calcada nao sao duas perguntas. Menos casas juntariam enderecos
 * vizinhos; mais casas nunca reaproveitariam nada.
 */
export function chaveDeCoordenada(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function chaveDeCep(cep: string): string {
  return digitosDeCep(cep);
}
