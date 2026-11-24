/**
 * Telefone brasileiro: digitos para guardar, mascara para mostrar.
 *
 * Uma regra so, usada pela tela e pelo servidor. O que vai para o banco sao
 * **somente os digitos** (`19999990000`): mascara e assunto de exibicao, e
 * guardar `(19) 99999-0000` obriga toda consulta futura a adivinhar a
 * pontuacao de quem digitou.
 */

/** Dois do DDD + nove do numero. Fixo tem oito e cabe no mesmo teto. */
export const TELEFONE_MAX_DIGITOS = 11;
/** `(19) 99999-0000` -- o maior resultado possivel de `formatarTelefone`. */
export const TELEFONE_MAX_MASCARA = 15;

/**
 * O que ja e um numero nacional completo: DDD existente, dez ou onze digitos,
 * e o nono digito no celular.
 *
 * Serve de criterio para duas coisas -- validar e decidir se um prefixo pode
 * cair.
 */
function pareceNumeroNacional(d: string): boolean {
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = Number(d.slice(0, 2));
  if (!Number.isInteger(ddd) || ddd < 11 || ddd > 99) return false;
  return d.length === 10 || d[2] === '9';
}

/**
 * Reduz qualquer entrada aos digitos do numero nacional.
 *
 * Tira o que nao e digito, o prefixo de pais, o zero de operadora e o excesso.
 * Os dois prefixos so caem quando o que SOBRA e um numero plausivel -- e essa
 * condicao nao e zelo, e o que separa um prefixo de um numero:
 *
 * - `(55) 99999-0000` e Santa Maria, nao Brasil: cortar o `55` apagaria o DDD
 *   de quem mora no Rio Grande do Sul.
 * - `(00) 99999-0000` nao tem prefixo nenhum: tem DDD inexistente. Comendo o
 *   zero, o campo mostrava `(99) 9990-000` -- um numero que ninguem digitou,
 *   escondendo o erro em vez de aponta-lo. Agora os digitos ficam como vieram
 *   e a validacao reprova, que e o que a pessoa precisa ver.
 */
export function digitosDeTelefone(entrada: unknown): string {
  const bruto = typeof entrada === 'string' ? entrada : typeof entrada === 'number' ? String(entrada) : '';
  let d = bruto.replace(/\D+/g, '');
  if (d.length > TELEFONE_MAX_DIGITOS && d.startsWith('55') && pareceNumeroNacional(d.slice(2))) {
    d = d.slice(2);
  }
  while (d.startsWith('0') && (d.length > TELEFONE_MAX_DIGITOS || pareceNumeroNacional(d.slice(1)))) {
    d = d.slice(1);
  }
  if (d.length > TELEFONE_MAX_DIGITOS && d.startsWith('55')) d = d.slice(2);
  return d.slice(0, TELEFONE_MAX_DIGITOS);
}

/**
 * Mascara progressiva: acompanha a digitacao em vez de esperar o numero ficar
 * completo.
 *
 * Com dez digitos e fixo (`(19) 3333-0000`); no decimo primeiro vira celular
 * (`(19) 99999-0000`). A troca acontece sozinha porque o formato depende de
 * quantos digitos existem, e nao de uma escolha feita antes de digitar.
 */
export function formatarTelefone(entrada: unknown): string {
  const d = digitosDeTelefone(entrada);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  if (resto.length <= 4) return `(${ddd}) ${resto}`;
  const corte = d.length <= 10 ? 4 : 5;
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

/**
 * Telefone preenchido e utilizavel.
 *
 * Tres conferencias, todas em `pareceNumeroNacional`: DDD existente (11 a 99
 * -- nao ha DDD comecando em zero ou em um), dez ou onze digitos, e o nono
 * digito obrigatorio no celular. Vazio nao passa por aqui: o campo e opcional,
 * e quem decide isso e o schema.
 */
export function telefoneValido(entrada: unknown): boolean {
  return pareceNumeroNacional(digitosDeTelefone(entrada));
}

/** Mensagem unica: a tela e o servidor dizem a mesma coisa. */
export const TELEFONE_INVALIDO = 'Informe um telefone válido com DDD';
