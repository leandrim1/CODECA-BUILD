import { AppError } from '@codeca/shared';

/**
 * Uma chamada HTTP de saida, com tempo limite e erro traduzido.
 *
 * Existe para que cada adaptador nao repita `AbortController`, `try/catch` e
 * a mesma mensagem em portugues -- e para que "o provedor caiu" chegue a tela
 * como uma frase que diz o que fazer, e nao como um stack trace.
 */

/** Sete segundos: a tela espera com indicador, nao para sempre. */
const TEMPO_LIMITE_MS = 7_000;

export const GEO_INDISPONIVEL =
  'O serviço de endereços não respondeu. Você pode preencher os campos à mão.';

export interface BuscaOptions {
  cabecalhos: Record<string, string>;
  buscar?: typeof globalThis.fetch;
  signal?: AbortSignal;
  tempoLimiteMs?: number;
}

export async function buscarJson(url: string, opcoes: BuscaOptions): Promise<unknown> {
  const buscar = opcoes.buscar ?? globalThis.fetch;
  const aborto = new AbortController();
  const relogio = setTimeout(() => aborto.abort(), opcoes.tempoLimiteMs ?? TEMPO_LIMITE_MS);
  // O cancelamento de quem chamou tambem derruba o pedido: a tela desiste de
  // uma busca antiga assim que a pessoa digita de novo.
  const externo = opcoes.signal;
  const aoCancelar = () => aborto.abort();
  externo?.addEventListener('abort', aoCancelar);

  try {
    const resposta = await buscar(url, { headers: opcoes.cabecalhos, signal: aborto.signal });
    if (!resposta.ok) {
      throw new AppError('upstream_error', GEO_INDISPONIVEL, { status: resposta.status });
    }
    return await resposta.json();
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    // Rede fora, DNS, tempo esgotado, JSON quebrado: para quem esta na tela e
    // tudo a mesma coisa -- nao respondeu, e o formulario continua editavel.
    throw new AppError('upstream_error', GEO_INDISPONIVEL);
  } finally {
    clearTimeout(relogio);
    externo?.removeEventListener('abort', aoCancelar);
  }
}
