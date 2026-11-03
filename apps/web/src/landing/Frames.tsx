import type { ReactNode } from 'react';
import { cx } from '@codeca/ui';

/**
 * Molduras para as capturas reais do painel.
 *
 * A moldura e so apresentacao; o que aparece dentro e uma captura da interface
 * de verdade, com dados de demonstracao.
 */

export function BrowserFrame({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  /** Texto curto na barra, para dizer qual tela e. */
  label?: string;
}) {
  return (
    <div
      className={cx(
        'overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_4px_rgb(27_51_117/0.04),0_24px_60px_-12px_rgb(27_51_117/0.28)]',
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-slate-200/80 bg-slate-50 px-4 py-2.5">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
          <span className="size-2.5 rounded-full bg-slate-300" />
        </span>
        {label ? (
          <span className="mx-auto rounded-md bg-white px-3 py-0.5 text-[0.7rem] font-medium text-slate-500 ring-1 ring-slate-200">
            {label}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function PhoneFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'overflow-hidden rounded-[2rem] border-[7px] border-slate-900 bg-slate-900 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.55)]',
        className,
      )}
    >
      <div className="overflow-hidden rounded-[1.5rem] bg-white">{children}</div>
    </div>
  );
}
