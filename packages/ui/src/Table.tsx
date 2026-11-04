import type { ReactNode } from 'react';
import { cx } from './utils.js';

/** Tabela responsiva com cabecalho fixo e estado vazio. */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Alinhamento do conteudo da celula. */
  align?: 'left' | 'right' | 'center';
  /** Oculta a coluna em telas pequenas. */
  hideOnMobile?: boolean;
  width?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
  onRowClick,
}: {
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  caption?: string;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    // `relative`: o `caption` e `sr-only` (posicao absoluta). Sem um ancestral
    // posicionado dentro da area que rola, ele ancora fora dela e alarga a
    // pagina inteira -- o celular ganhava rolagem lateral por um texto invisivel.
    <div className="relative overflow-x-auto">
      {/*
        No celular a tabela vira uma lista de cartoes.

        Uma tabela de cinco colunas em 375px so cabe rolando de lado, e a acao
        da linha (editar, remover) fica justamente na ultima coluna -- fora da
        tela. Cada linha vira um bloco: a primeira coluna e o titulo, as demais
        aparecem com o nome da coluna ao lado. A partir de `sm` e a tabela de
        sempre. O cabecalho continua no DOM (so some da vista) para leitores
        de tela seguirem lendo uma tabela.
      */}
      <table className="block w-full border-collapse text-sm sm:table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="sr-only sm:not-sr-only sm:table-header-group">
          <tr className="border-b border-slate-200/70 text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cx(
                  // Maiuscula com peso medio em vez de semibold: o cabecalho
                  // orienta sem competir com o conteudo da linha.
                  'px-5 py-3 text-xs font-medium uppercase tracking-wider text-slate-400',
                  column.align === 'right' && 'text-right',
                  column.align === 'center' && 'text-center',
                  column.hideOnMobile && 'hidden sm:table-cell',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block sm:table-row-group">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              {...(onRowClick
                ? {
                    onClick: () => onRowClick(row),
                    tabIndex: 0,
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') onRowClick(row);
                    },
                  }
                : {})}
              className={cx(
                'block border-b border-slate-100 px-4 py-3 transition-colors duration-150 last:border-0',
                'sm:table-row sm:p-0',
                onRowClick && 'cursor-pointer hover:bg-slate-50/80 focus-visible:bg-slate-50',
              )}
            >
              {columns.map((column, index) => {
                const label = index > 0 && typeof column.header === 'string' && column.header !== ''
                  ? column.header
                  : undefined;
                return (
                  <td
                    key={column.key}
                    {...(label ? { 'data-label': label } : {})}
                    className={cx(
                      'flex min-w-0 items-center gap-3 py-1.5 align-middle text-slate-700',
                      'sm:table-cell sm:px-5 sm:py-3.5',
                      // Com rotulo: nome da coluna a esquerda, valor a direita.
                      label &&
                        'justify-between before:text-xs before:font-medium before:uppercase before:tracking-wider before:text-slate-400 before:content-[attr(data-label)] sm:before:content-none',
                      column.align === 'right' && 'justify-end sm:text-right',
                      column.align === 'center' && 'justify-center sm:text-center',
                      column.hideOnMobile && 'hidden sm:table-cell',
                    )}
                  >
                    {column.render(row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return <p className="px-4 py-3 text-xs text-slate-500">{total} registro(s)</p>;
  }

  return (
    <nav className="flex items-center justify-between gap-3 px-4 py-3" aria-label="Paginação">
      <p className="text-xs text-slate-500">
        Página {page} de {totalPages} - {total} registro(s)
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-transparent"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-transparent"
        >
          Próxima
        </button>
      </div>
    </nav>
  );
}
