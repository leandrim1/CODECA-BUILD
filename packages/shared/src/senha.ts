/**
 * Regras de forca da senha -- a MESMA funcao na tela e no servidor.
 *
 * A tela usa o status regra a regra para desenhar a lista de conferencia em
 * tempo real; o servidor usa o mesmo resultado para recusar o cadastro. Uma
 * funcao so, e nao duas copias, porque o dia em que as regras divergirem a
 * tela promete o que o servidor recusa (ou, pior, o contrario).
 *
 * Nada aqui registra, devolve ou guarda a senha: as funcoes recebem o texto,
 * respondem booleanos e esquecem.
 */

/** Identificadores das regras, na ordem em que aparecem na tela. */
export const IDS_DE_REGRA_DE_SENHA = ['min10', 'maiuscula', 'minuscula', 'numero', 'especial'] as const;
export type IdDeRegraDeSenha = (typeof IDS_DE_REGRA_DE_SENHA)[number];

export interface StatusDaSenha extends Record<IdDeRegraDeSenha, boolean> {
  /** Verdadeiro so quando TODAS as regras passam. */
  valida: boolean;
}

/** Comprimento minimo, exposto para quem precisa do numero (e nao do texto). */
export const SENHA_MIN = 10;
/** Teto, para nao gastar CPU de hash com um corpo gigante. */
export const SENHA_MAX = 200;

/**
 * Texto de cada regra.
 *
 * `rotulo` e o que a lista de conferencia mostra; `falta` e a mesma regra
 * escrita para caber na frase do servidor ("A senha precisa de: ...").
 */
export const REGRAS_DE_SENHA: ReadonlyArray<{
  id: IdDeRegraDeSenha;
  rotulo: string;
  falta: string;
}> = [
  { id: 'min10', rotulo: `Mínimo de ${SENHA_MIN} caracteres`, falta: `ao menos ${SENHA_MIN} caracteres` },
  { id: 'maiuscula', rotulo: 'Uma letra maiúscula', falta: 'uma letra maiúscula' },
  { id: 'minuscula', rotulo: 'Uma letra minúscula', falta: 'uma letra minúscula' },
  { id: 'numero', rotulo: 'Um número', falta: 'um número' },
  { id: 'especial', rotulo: 'Um caractere especial', falta: 'um caractere especial' },
];

/**
 * As mesmas regras em UMA frase, para os campos que nao desenham a lista.
 *
 * Existe para que a dica de "nova senha" (redefinicao, troca) nao prometa
 * menos do que o servidor cobra -- era o caso da antiga "Ao menos 10
 * caracteres, com letras e números".
 */
export const TEXTO_DAS_REGRAS_DE_SENHA =
  `Mínimo de ${SENHA_MIN} caracteres, com letra maiúscula, minúscula, número e caractere especial.`;

/*
  Uma expressao por regra, e nao uma unica expressao gigante com olhares a
  frente: assim cada linha diz o que cobra, e a tela consegue dizer QUAL regra
  falta -- o que uma expressao unica so saberia responder com "invalida".

  As classes sao Unicode (`\p{...}` com a bandeira `u`) por causa do portugues:
  com `[^A-Za-z0-9]`, o "ç" de "Coração" contaria como caractere especial e a
  senha passaria sem nenhum simbolo de verdade. Aqui letra acentuada e letra
  (maiuscula ou minuscula, conforme o caso) e nunca especial.
*/
const MAIUSCULA = /\p{Lu}/u;
const MINUSCULA = /\p{Ll}/u;
const NUMERO = /[0-9]/;
/** Especial = o que nao e letra (de qualquer idioma) nem digito. Espaco conta. */
const ESPECIAL = /[^\p{L}0-9]/u;

/**
 * Status de cada regra para a senha informada.
 *
 * Aceita `unknown` com folga (`''` para qualquer coisa que nao seja texto)
 * porque o servidor a chama sobre corpo de requisicao, onde o campo pode vir
 * nulo, numero ou ausente.
 */
export function validarSenha(senha: unknown): StatusDaSenha {
  const valor = typeof senha === 'string' ? senha : '';
  const status = {
    // `Array.from` e nao `.length`: "a😀" tem 2 unidades UTF-16 e 2 "letras"
    // para quem digitou, mas um emoji sozinho tem 2 unidades e um caractere.
    // Contar simbolos evita aceitar uma senha mais curta do que ela parece.
    min10: Array.from(valor).length >= SENHA_MIN,
    maiuscula: MAIUSCULA.test(valor),
    minuscula: MINUSCULA.test(valor),
    numero: NUMERO.test(valor),
    especial: ESPECIAL.test(valor),
  };
  return { ...status, valida: IDS_DE_REGRA_DE_SENHA.every((id) => status[id]) };
}

/** Regras que ainda faltam, na ordem da lista de conferencia. */
export function regrasDeSenhaPendentes(status: StatusDaSenha): IdDeRegraDeSenha[] {
  return IDS_DE_REGRA_DE_SENHA.filter((id) => !status[id]);
}

/**
 * Frase unica dizendo o que falta -- e so o que falta.
 *
 * "A senha precisa de: uma letra maiúscula e um caractere especial." diz mais
 * do que "senha fraca" e nao obriga a pessoa a adivinhar qual das cinco regras
 * tropecou.
 */
export function mensagemDeSenhaInvalida(senha: unknown): string {
  const pendentes = regrasDeSenhaPendentes(validarSenha(senha));
  if (pendentes.length === 0) return '';
  const textos = pendentes.map((id) => REGRAS_DE_SENHA.find((regra) => regra.id === id)?.falta ?? id);
  const lista = textos.length === 1
    ? textos[0]
    : `${textos.slice(0, -1).join(', ')} e ${textos[textos.length - 1]}`;
  return `A senha precisa de: ${lista}.`;
}

/**
 * Quantas regras ja passaram (0 a 5), para a barra de forca.
 *
 * E contagem de regras, e nao entropia: a barra acompanha exatamente a mesma
 * lista que esta logo abaixo dela, sem prometer uma medida que a validacao nao
 * usa.
 */
export function forcaDaSenha(status: StatusDaSenha): number {
  return IDS_DE_REGRA_DE_SENHA.filter((id) => status[id]).length;
}
