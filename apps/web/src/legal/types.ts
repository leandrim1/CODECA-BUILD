/**
 * Estrutura dos documentos legais exibidos em `/termos` e `/privacidade`.
 *
 * O texto vive em `privacidade.ts` e `termos.ts`; a pagina (`LegalPage`) so o
 * desenha. Manter os dois separados deixa a revisao juridica olhar so o texto.
 */
export type Bloco =
  | { tipo: 'p'; texto: string }
  | { tipo: 'subtitulo'; texto: string }
  | { tipo: 'lista'; itens: readonly string[] }
  | { tipo: 'tabela'; colunas: readonly string[]; linhas: ReadonlyArray<readonly string[]> }
  | { tipo: 'aviso'; texto: string }
  /** Identificacao e canal de contato da CODECA IA, a partir de `empresa.ts`. */
  | { tipo: 'contato' };

export interface Secao {
  /** Ancora do sumario. */
  id: string;
  titulo: string;
  blocos: readonly Bloco[];
}

export interface Documento {
  titulo: string;
  /** Uma frase abaixo do titulo. */
  resumo: string;
  secoes: readonly Secao[];
}

export const p = (texto: string): Bloco => ({ tipo: 'p', texto });
export const sub = (texto: string): Bloco => ({ tipo: 'subtitulo', texto });
export const lista = (...itens: string[]): Bloco => ({ tipo: 'lista', itens });
export const aviso = (texto: string): Bloco => ({ tipo: 'aviso', texto });
export const tabela = (colunas: string[], ...linhas: string[][]): Bloco => ({ tipo: 'tabela', colunas, linhas });
