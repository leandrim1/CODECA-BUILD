import type { ReactNode } from 'react';
import { cx } from './utils.js';

/** Abas com semantica de tablist e navegacao por teclado do navegador. */

export interface TabItem {
  id: string;
  label: string;
  badge?: ReactNode;
}

export function Tabs({
  items,
  active,
  onChange,
  className,
}: {
  items: readonly TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      // No celular as abas rolam numa linha so (quebrar em duas parece erro);
      // de `sm` em diante quebram como antes.
      className={cx(
        'flex gap-1 overflow-x-auto border-b border-slate-200 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.id)}
            className={cx(
              'inline-flex flex-none items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium sm:-mb-px',
              'transition-colors duration-200 ease-[var(--ease-out-soft)]',
              selected
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: string; icon?: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      // `w-fit max-w-full` + rolagem: com varias opcoes o controle e mais largo
      // que o celular, e rolar dentro dele e melhor que alargar a pagina.
      className="inline-flex w-fit max-w-full overflow-x-auto rounded-xl bg-slate-100 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          title={option.label}
          className={cx(
            'inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200',
            option.value === value ? 'bg-white text-slate-900 shadow-card' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {option.icon}
          <span className={option.icon ? 'sr-only sm:not-sr-only' : undefined}>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
