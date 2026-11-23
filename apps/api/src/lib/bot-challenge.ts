import { AppError } from '@codeca/shared';
import type { Env } from '../env.js';

/**
 * Desafio de bot nos formularios publicos (Cloudflare Turnstile).
 *
 * ## Por que existe
 *
 * O cadastro estava protegido so por limite de taxa por IP: 5 por hora. Isso
 * barra forca bruta de um endereco, e nao barra cadastro em massa distribuido
 * -- que consome banco, cota de e-mail e, pior, a reputacao do remetente, que
 * leva semanas para recuperar.
 *
 * ## Desligado por padrao
 *
 * Sem as duas chaves no ambiente, `verificarDesafioDeBot` nao faz nada e a
 * plataforma se comporta exatamente como antes. E deliberado: ligar um desafio
 * sem as chaves certas trancaria o cadastro de todo mundo.
 *
 * ## O token e conferido no SERVIDOR
 *
 * Um desafio resolvido so no navegador nao prova nada: o token tem de voltar
 * ao provedor com a chave secreta para valer. Quem monta a requisicao a mao
 * pode mandar qualquer coisa no campo -- e e por isso que a conferencia nao
 * pode morar no mesmo lugar que a interface.
 */

const VERIFICACAO = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Teto de espera. O provedor fora do ar nao pode travar o cadastro para sempre. */
const PRAZO_MS = 5_000;

export interface ResultadoDoDesafio {
  /** `false` so quando o desafio esta ligado e o token nao vale. */
  ok: boolean;
  /** Codigos devolvidos pelo provedor, para o log. Nunca vao para o cliente. */
  motivos: string[];
}

/**
 * Confere o token do desafio. Lanca quando ele nao vale.
 *
 * `buscar` existe para o teste: ele substitui a rede sem precisar de chave de
 * verdade nem de internet.
 */
export async function verificarDesafioDeBot(
  env: Env,
  token: string | undefined,
  ip: string,
  buscar: typeof globalThis.fetch = globalThis.fetch,
): Promise<ResultadoDoDesafio> {
  const segredo = env.TURNSTILE_SECRET_KEY;
  if (!segredo || !env.TURNSTILE_SITE_KEY) return { ok: true, motivos: [] };

  if (!token) {
    throw new AppError(
      'bot_challenge_required',
      'Confirme que você não é um robô e envie de novo.',
      { reason: 'token_ausente' },
    );
  }

  const corpo = new URLSearchParams({ secret: segredo, response: token });
  if (ip) corpo.set('remoteip', ip);

  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), PRAZO_MS);
  let dados: { success?: boolean; 'error-codes'?: string[] };
  try {
    const resposta = await buscar(VERIFICACAO, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: corpo,
      signal: controle.signal,
    });
    dados = (await resposta.json()) as typeof dados;
  } catch (error) {
    /*
      Provedor fora do ar ou lento demais.

      A escolha aqui e entre deixar passar e barrar todo mundo. Deixa passar:
      o limite de taxa por IP continua valendo, e trancar o cadastro da
      plataforma inteira porque um terceiro caiu seria um estrago maior do que
      o que o desafio evita. Fica no log, para quem opera ver.
    */
    console.error(
      '[bot] desafio indisponivel, seguindo sem ele:',
      error instanceof Error ? error.message : error,
    );
    return { ok: true, motivos: ['verificacao_indisponivel'] };
  } finally {
    clearTimeout(limite);
  }

  const motivos = dados['error-codes'] ?? [];
  if (!dados.success) {
    throw new AppError(
      'bot_challenge_required',
      'Não foi possível confirmar que você não é um robô. Recarregue a página e tente de novo.',
      { reason: 'token_invalido' },
    );
  }
  return { ok: true, motivos };
}
