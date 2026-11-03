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
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
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
        <tbody>
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
                'border-b border-slate-100 transition-colors duration-150 last:border-0',
                onRowClick && 'cursor-pointer hover:bg-slate-50/80 focus-visible:bg-slate-50',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(
                    'px-5 py-3.5 align-middle text-slate-700',
                    column.align === 'right' && 'text-right',
                    column.align === 'center' && 'text-center',
                    column.hideOnMobile && 'hidden sm:table-cell',
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
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
    <nav className="flex items-center justify-between gap-3 px-4 py-3" aria-label="Paginacao">
      <p className="text-xs text-slate-500">
        Pagina {page} de {totalPages} - {total} registro(s)
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
          Proxima
        </button>
      </div>
    </nav>
  );
}
