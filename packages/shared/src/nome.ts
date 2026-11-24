/**
 * Nome de pessoa: so letras, espaco, hifen e apostrofo.
 *
 * Vale para o nome de QUEM se cadastra, nunca para o nome da EMPRESA: "3M
 * Soluções" e "Padaria & Cia" sao nomes legitimos e seriam mutilados por esta
 * regra.
 */

export const NOME_MAX = 80;
/** Duas letras: "Bo", "Li". Abaixo disso nao e nome, e digitacao interrompida. */
export const NOME_MIN_LETRAS = 2;

/**
 * `\p{L}` e nao `A-Za-z`: em portugues, recusar "José" ou "Conceição" seria o
 * proprio defeito. Hifen e apostrofo entram por "Ana-Maria" e "D'Ávila".
 *
 * A bandeira `u` e obrigatoria para `\p{L}` valer; sem ela a expressao nem
 * compila.
 */
const PROIBIDOS = /[^\p{L}\s'-]/gu;
const LETRA = /\p{L}/gu;

/**
 * Limpa o que foi digitado, colado ou preenchido pelo navegador.
 *
 * Nao recusa: **remove**. Quem cola "Maria 123" ve "Maria" aparecer, em vez de
 * um aviso para voltar e apagar o que o proprio campo podia ter apagado.
 *
 * O espaco do fim sobrevive de proposito -- quem acabou de digitar "Ana " esta
 * a caminho do sobrenome. Quem apara isso e o blur, por `nomeFinal`.
 */
export function sanitizarNome(entrada: unknown): string {
  const bruto = typeof entrada === 'string' ? entrada : '';
  return bruto
    .replace(PROIBIDOS, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s+/, '')
    .slice(0, NOME_MAX);
}

/** O mesmo, com as pontas aparadas: o que se guarda ao sair do campo. */
export function nomeFinal(entrada: unknown): string {
  return sanitizarNome(entrada).trim();
}

/** Conta letras, e nao caracteres: `'--'` tem dois caracteres e nenhum nome. */
export function nomeValido(entrada: unknown): boolean {
  const nome = nomeFinal(entrada);
  if (nome.length === 0 || nome.length > NOME_MAX) return false;
  return (nome.match(LETRA) ?? []).length >= NOME_MIN_LETRAS;
}

/** Mensagem unica: a tela e o servidor dizem a mesma coisa. */
export const NOME_INVALIDO = 'Informe seu nome usando apenas letras';
