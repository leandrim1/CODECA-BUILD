/**
 * Regras dos campos de contato e do ano de fundacao.
 *
 * Mesma ideia dos campos do cadastro: UMA funcao por regra, usada pela tela e
 * cobrada pelo servidor. O painel desenha o controle e conserta o que da para
 * consertar; o schema do documento (`modules/documents.ts`) recusa o que
 * sobrar, porque quem chama a API direto nunca passou pelo painel.
 */

// ------------------------------------------------------------------ ano

/** Antes disso nao e empresa, e erro de digitacao (ou arqueologia). */
export const ANO_MINIMO = 1800;

/**
 * O teto e o ano de HOJE, lido na hora da validacao.
 *
 * Fixar o ano no codigo criaria uma data de validade: em 1 de janeiro o
 * formulario passaria a recusar o ano corrente ate alguem lembrar de mexer
 * aqui.
 */
export function anoAtual(agora: Date = new Date()): number {
  return agora.getUTCFullYear();
}

/** So quatro digitos: o campo nao aceita outra coisa, e isto confirma. */
export function digitosDeAno(entrada: unknown): string {
  const bruto = typeof entrada === 'string' ? entrada : typeof entrada === 'number' ? String(entrada) : '';
  return bruto.replace(/\D+/g, '').slice(0, 4);
}

export function anoDeFundacaoValido(entrada: unknown, agora?: Date): boolean {
  const digitos = digitosDeAno(entrada);
  if (digitos.length !== 4) return false;
  const ano = Number(digitos);
  return ano >= ANO_MINIMO && ano <= anoAtual(agora);
}

export function mensagemDeAnoInvalido(agora?: Date): string {
  return `Informe um ano entre ${ANO_MINIMO} e ${anoAtual(agora)}.`;
}

// ------------------------------------------------------------- whatsapp

/**
 * O formato aceito, e so ele: `https://wa.me/` seguido do numero com DDI.
 *
 * Dez a quinze digitos cobre do numero nacional mais curto ao limite do E.164.
 */
export const LINK_WHATSAPP = /^https:\/\/wa\.me\/\d{10,15}$/;
export const WHATSAPP_EXEMPLO = 'https://wa.me/5511999999999';
export const WHATSAPP_INVALIDO = `Informe um link no formato ${WHATSAPP_EXEMPLO}.`;

/**
 * Converte o que da para converter, e so recusa o resto.
 *
 * O campo guardava TELEFONE antes desta mudanca ("(19) 99999-0000"), e esses
 * valores continuam nos sites que ja existem. Recusar sem converter travaria
 * a tela inteira: o formulario envia o documento todo, entao um WhatsApp
 * antigo impediria de salvar qualquer outro campo.
 *
 * Por isso aqui: espaco some, numero vira link (com o 55 na frente quando e
 * numero nacional), link certo passa, e o que nao for nenhum dos tres e
 * recusado.
 */
export function normalizarWhatsApp(entrada: unknown): string {
  const bruto = (typeof entrada === 'string' ? entrada : '').replace(/\s+/g, '');
  if (bruto === '') return '';
  if (LINK_WHATSAPP.test(bruto)) return bruto;

  // `wa.me/5511...` e `https://wa.me/55 11 ...` ja viraram o caso acima depois
  // de tirar o espaco; aqui sobra o que veio como numero.
  const semLink = bruto.replace(/^https?:\/\//, '').replace(/^wa\.me\//, '');
  const digitos = semLink.replace(/\D+/g, '');
  if (digitos === '') return bruto;
  // Numero nacional (10 ou 11 digitos) ganha o DDI do Brasil; o resto ja veio
  // com DDI e so precisa do endereco na frente.
  const comDdi = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
  const candidato = `https://wa.me/${comDdi}`;
  return LINK_WHATSAPP.test(candidato) ? candidato : bruto;
}

export function whatsappValido(entrada: unknown): boolean {
  const normalizado = normalizarWhatsApp(entrada);
  return normalizado === '' || LINK_WHATSAPP.test(normalizado);
}

// ------------------------------------------------------------------ cep

export const CEP_INVALIDO = 'Informe um CEP com 8 dígitos.';

export function digitosDeCep(entrada: unknown): string {
  const bruto = typeof entrada === 'string' ? entrada : typeof entrada === 'number' ? String(entrada) : '';
  return bruto.replace(/\D+/g, '').slice(0, 8);
}

/** `00000-000`, com o hifen aparecendo so quando ha digito depois dele. */
export function formatarCep(entrada: unknown): string {
  const d = digitosDeCep(entrada);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function cepValido(entrada: unknown): boolean {
  return digitosDeCep(entrada).length === 8;
}

// ------------------------------------------------------------ coordenadas

export const COORDENADA_INVALIDA = 'Coordenada fora do intervalo válido.';

export function latitudeValida(valor: unknown): boolean {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= -90 && valor <= 90;
}

export function longitudeValida(valor: unknown): boolean {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= -180 && valor <= 180;
}

/**
 * Arredonda para seis casas -- cerca de 11 cm.
 *
 * A geocodificacao devolve quinze casas, que dizem respeito ao algoritmo e
 * nao ao lugar. Guardar tudo aquilo so engorda o documento e o diff.
 */
export function arredondarCoordenada(valor: number): number {
  return Math.round(valor * 1e6) / 1e6;
}
