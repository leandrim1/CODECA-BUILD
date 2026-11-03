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
    <div role="tablist" className={cx('flex flex-wrap gap-1 border-b border-slate-200', className)}>
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
              '-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium',
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
    <div role="group" aria-label={label} className="inline-flex rounded-xl bg-slate-100 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          title={option.label}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200',
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
