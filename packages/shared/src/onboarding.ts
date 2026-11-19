/**
 * Guia de primeiro acesso: o que conta como "ja feito".
 *
 * O progresso NAO e guardado. Ele e lido dos dados reais do site a cada
 * carregamento, e a razao e concreta: um progresso gravado descola do mundo no
 * primeiro conteudo apagado, e passa a dizer "feito" sobre um site vazio. O
 * que se guarda, em `users`, e so o que a pessoa dispensou.
 *
 * As duas perguntas abaixo nao se respondem com uma contagem, e por isso
 * vivem aqui: "preenchido" depende de QUAIS campos tem conteudo.
 */

/** Sinais que a contagem de registros nao da. */
export interface OnboardingSignals {
  /** O documento institucional tem conteudo alem do nome da empresa. */
  institutionalFilled: boolean;
  /** Ha pelo menos uma forma de falar com a empresa. */
  contactFilled: boolean;
}

/** Texto com conteudo de verdade, e nao so espaco. */
function temTexto(valor: unknown): boolean {
  return typeof valor === 'string' && valor.trim().length > 0;
}

function temLista(valor: unknown): boolean {
  return Array.isArray(valor) && valor.length > 0;
}

/**
 * O institucional conta como preenchido?
 *
 * `companyName` e DE PROPOSITO ignorado: ele ja vem preenchido com o nome da
 * empresa quando o site e criado. Conta-lo marcaria o passo como concluido
 * antes de a pessoa escrever a primeira linha -- e o primeiro passo do guia
 * apareceria pronto, sem ela ter feito nada.
 */
export function institucionalPreenchido(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  return (
    temTexto(data.tagline)
    || temTexto(data.shortDescription)
    || temTexto(data.history)
    || temTexto(data.mission)
    || temTexto(data.vision)
    || temLista(data.values)
    || temTexto(data.logoImageId)
    || temTexto(data.coverImageId)
    || temLista(data.galleryImageIds)
    || typeof data.foundedYear === 'number'
  );
}

/**
 * O contato conta como preenchido?
 *
 * So as formas de FALAR com a empresa. Endereco e horario sozinhos nao
 * atendem a quem quer pedir um orcamento, e o passo se chama "cadastrar
 * informacoes de contato" -- marcar como feito um cadastro sem telefone nem
 * e-mail seria dizer ao cliente que ele terminou algo que nao terminou.
 */
export function contatoPreenchido(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  return temTexto(data.email) || temTexto(data.phone) || temTexto(data.whatsapp);
}
