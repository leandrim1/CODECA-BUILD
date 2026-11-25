import { AppError, arredondarCoordenada, cepValido, digitosDeCep } from '@codeca/shared';

/**
 * CEP e geocodificacao, pelo servidor.
 *
 * As duas consultas sao publicas e dariam para fazer do navegador. Nao dao,
 * por duas razoes concretas:
 *
 * 1. A CSP do painel e `connect-src 'self'`. Afrouxa-la para dois dominios de
 *    terceiros vale para a pagina INTEIRA, inclusive para um script que entre
 *    ali por outro caminho. O proxy mantem a politica fechada.
 * 2. O Nominatim exige `User-Agent` identificando a aplicacao, e navegador
 *    nenhum deixa o JavaScript definir esse cabecalho. Do servidor, ele vai
 *    como a politica deles pede.
 *
 * De quebra, o limite de uso deixa de depender de quantas abas o cliente tem
 * abertas: quem conta e a nossa cota, por empresa.
 */

const VIACEP = 'https://viacep.com.br/ws';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

/** Identificacao pedida pela politica de uso do Nominatim. */
const AGENTE = 'CODECA-Build/1.0 (painel de conteudo; contato: suporte@codecaia.com.br)';

/** Sete segundos: o painel espera com um indicador, e nao para sempre. */
const TEMPO_LIMITE_MS = 7_000;

export interface EnderecoEncontrado {
  cep: string;
  addressLine: string;
  city: string;
  state: string;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
}

async function buscarComLimite(
  buscar: typeof globalThis.fetch,
  url: string,
  cabecalhos: Record<string, string>,
): Promise<Response> {
  const aborto = new AbortController();
  const relogio = setTimeout(() => aborto.abort(), TEMPO_LIMITE_MS);
  try {
    return await buscar(url, { headers: cabecalhos, signal: aborto.signal });
  } catch {
    // Rede fora, DNS, tempo esgotado: para quem esta na tela e tudo a mesma
    // coisa -- o servico nao respondeu, e o formulario continua editavel.
    throw new AppError('upstream_error', 'O serviço de endereços não respondeu. Preencha os campos à mão.');
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * CEP no ViaCEP.
 *
 * O ViaCEP responde 200 com `{ erro: true }` para CEP inexistente -- e por
 * isso que a conferencia olha o corpo, e nao so o status.
 */
export async function buscarCep(
  cep: string,
  buscar: typeof globalThis.fetch = globalThis.fetch,
): Promise<EnderecoEncontrado> {
  const digitos = digitosDeCep(cep);
  if (!cepValido(digitos)) throw AppError.badRequest('Informe um CEP com 8 dígitos.');

  const resposta = await buscarComLimite(buscar, `${VIACEP}/${digitos}/json/`, { accept: 'application/json' });
  if (!resposta.ok) {
    throw new AppError('upstream_error', 'O serviço de CEP não respondeu. Preencha os campos à mão.');
  }
  const corpo = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo || corpo['erro'] === true || corpo['erro'] === 'true') {
    throw AppError.notFound('CEP não encontrado. Confira o número ou preencha o endereço à mão.');
  }

  const texto = (chave: string) => (typeof corpo[chave] === 'string' ? (corpo[chave] as string).trim() : '');
  return {
    cep: digitos,
    addressLine: texto('logradouro'),
    neighborhood: texto('bairro'),
    city: texto('localidade'),
    state: texto('uf').toUpperCase(),
    latitude: null,
    longitude: null,
  };
}

/** Monta "Rua tal, 100" a partir do que o Nominatim devolve em partes. */
function ruaDoNominatim(endereco: Record<string, unknown>): string {
  const parte = (chave: string) => (typeof endereco[chave] === 'string' ? (endereco[chave] as string).trim() : '');
  const rua = parte('road') || parte('pedestrian') || parte('footway');
  const numero = parte('house_number');
  return [rua, numero].filter(Boolean).join(', ');
}

function cidadeDoNominatim(endereco: Record<string, unknown>): string {
  const parte = (chave: string) => (typeof endereco[chave] === 'string' ? (endereco[chave] as string).trim() : '');
  // A ordem importa: `city` existe nas capitais, `town`/`village` no interior,
  // e `municipality` e o nome oficial quando nenhum dos tres veio.
  return parte('city') || parte('town') || parte('village') || parte('municipality') || '';
}

/** A sigla da UF vem em `ISO3166-2-lvl4` como `BR-SP`. */
function ufDoNominatim(endereco: Record<string, unknown>): string {
  const iso = typeof endereco['ISO3166-2-lvl4'] === 'string' ? endereco['ISO3166-2-lvl4'] : '';
  const sigla = iso.split('-')[1] ?? '';
  return sigla.toUpperCase();
}

function paraEndereco(item: Record<string, unknown>): EnderecoEncontrado {
  const endereco = (item['address'] ?? {}) as Record<string, unknown>;
  const lat = Number(item['lat']);
  const lon = Number(item['lon']);
  const parte = (chave: string) => (typeof endereco[chave] === 'string' ? (endereco[chave] as string).trim() : '');
  return {
    cep: digitosDeCep(parte('postcode')),
    addressLine: ruaDoNominatim(endereco),
    neighborhood: parte('suburb') || parte('neighbourhood') || '',
    city: cidadeDoNominatim(endereco),
    state: ufDoNominatim(endereco),
    latitude: Number.isFinite(lat) ? arredondarCoordenada(lat) : null,
    longitude: Number.isFinite(lon) ? arredondarCoordenada(lon) : null,
  };
}

/** Coordenada -> endereco (o pino do mapa e o "usar minha localizacao"). */
export async function enderecoPorCoordenada(
  latitude: number,
  longitude: number,
  buscar: typeof globalThis.fetch = globalThis.fetch,
): Promise<EnderecoEncontrado> {
  const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1&accept-language=pt-BR`;
  const resposta = await buscarComLimite(buscar, url, { accept: 'application/json', 'user-agent': AGENTE });
  if (!resposta.ok) {
    throw new AppError('upstream_error', 'O serviço de mapas não respondeu. Preencha os campos à mão.');
  }
  const corpo = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo || corpo['error']) {
    throw AppError.notFound('Não encontramos um endereço neste ponto. Arraste o pino ou preencha à mão.');
  }
  return paraEndereco(corpo);
}

export interface SugestaoDeEndereco extends EnderecoEncontrado {
  /** Linha pronta para a lista de sugestoes. */
  descricao: string;
}

/** Texto -> lista de enderecos (a barra de busca do mapa). */
export async function buscarEnderecos(
  termo: string,
  buscar: typeof globalThis.fetch = globalThis.fetch,
): Promise<SugestaoDeEndereco[]> {
  const consulta = termo.trim();
  if (consulta.length < 3) return [];

  const url = `${NOMINATIM}/search?format=jsonv2&q=${encodeURIComponent(consulta)}`
    + '&countrycodes=br&limit=5&addressdetails=1&accept-language=pt-BR';
  const resposta = await buscarComLimite(buscar, url, { accept: 'application/json', 'user-agent': AGENTE });
  if (!resposta.ok) {
    throw new AppError('upstream_error', 'O serviço de mapas não respondeu. Tente de novo em instantes.');
  }
  const corpo = (await resposta.json().catch(() => null)) as unknown;
  if (!Array.isArray(corpo)) return [];

  return corpo.slice(0, 5).map((item) => {
    const registro = item as Record<string, unknown>;
    const endereco = paraEndereco(registro);
    const descricao = typeof registro['display_name'] === 'string' ? registro['display_name'] : '';
    return { ...endereco, descricao };
  });
}
