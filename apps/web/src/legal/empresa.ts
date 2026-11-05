/**
 * Identificacao da CODECA IA nos documentos legais.
 *
 * **So entra aqui o que e verdade e esta confirmado.** Cada campo `null` e
 * omitido da pagina: nada e inventado nem aparece como pendencia. Quando a
 * informacao existir, preencha o campo e ele passa a ser exibido.
 *
 * - `cnpj`: a empresa ainda nao tem CNPJ; fica nulo ate haver.
 * - `endereco`: endereco para correspondencia.
 * - `emailPrivacidade`: canal para assuntos de privacidade e direitos dos
 *   titulares (informado pela CODECA IA). Se for esvaziado, a pagina volta a
 *   informar que o canal sera divulgado.
 */
export const EMPRESA = {
  nome: 'CODECA IA',
  produto: 'CODECA Build',
  cnpj: null as string | null,
  endereco: null as string | null,
  emailPrivacidade: 'codecabuild@gmail.com' as string | null,
};
