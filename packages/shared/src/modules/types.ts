/**
 * Contrato dos modulos editaveis.
 *
 * Cada site da CODECA IA tem estrutura propria, e o painel precisa se adaptar
 * a ela. A alternativa literal -- campos dinamicos em entidade-atributo-valor
 * -- entregaria flexibilidade total ao custo da validacao por tipo, dos
 * indices e da tipagem do SDK; para um catalogo de imoveis com busca por preco
 * e cidade isso e perda liquida.
 *
 * Entao o **modulo e declarado aqui, em codigo**, com tipo e validacao, e o
 * banco guarda apenas o que varia por projeto: quais modulos o site tem e
 * quais campos o cliente pode editar.
 */

/** Tipo de um campo. Define a validacao e o controle que o painel desenha. */
export const FIELD_TYPES = [
  'text',
  'longText',
  'url',
  'email',
  'phone',
  'number',
  'money',
  'boolean',
  'date',
  'image',
  'imageList',
  'select',
  'tags',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface ModuleField {
  key: string;
  label: string;
  type: FieldType;
  /**
   * O cliente pode editar este campo sem a CODECA IA?
   *
   * E so o **padrao**: a politica por site sobrepoe. Campos cuja alteracao
   * quebraria o layout do site nascem travados.
   */
  editableByDefault: boolean;
  required?: boolean;
  help?: string;
  /**
   * `true` quando o campo foi definido para este site, nao pelo registro.
   *
   * A escrita usa este sinal para saber que o valor vai para a coluna
   * `custom_fields`, e nao para uma coluna propria. Fora disso, o resto da
   * plataforma trata os dois iguais -- que e o ponto.
   */
  custom?: boolean;
  /** Opcoes de um campo de escolha personalizado. */
  options?: readonly string[];
}

/**
 * Como o conteudo do modulo e guardado.
 *
 * - `document`: uma instancia por site, em JSONB validado (institucional,
 *   contato). Sao dados de cardinalidade um, sem busca nem paginacao.
 * - `collection`: muitos registros, em tabela tipada com indice (imoveis,
 *   obras, servicos, banners).
 */
export type ModuleKind = 'document' | 'collection';

export interface ModuleDefinition {
  key: string;
  name: string;
  description: string;
  kind: ModuleKind;
  /**
   * Este modulo aceita campos personalizados por site?
   *
   * Declarado aqui, e nao numa lista paralela, para a resposta ficar junto do
   * modulo. A regra que decide: so e `true` onde o formulario do painel
   * **renderiza** os campos. Permitir definir um campo que nenhuma tela mostra
   * recriaria o furo da etapa B -- o cliente editaria no vazio, ou pior, a
   * CODECA IA configuraria algo que nunca aparece.
   */
  customFields?: boolean;
  /** Tabela que guarda os registros. Somente para `collection`. */
  table?: string;
  fields: readonly ModuleField[];
}
