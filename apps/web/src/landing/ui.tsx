import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '@codeca/ui';

/** Pecas de composicao compartilhadas pelas secoes da pagina inicial. */

/** Largura e margens de todas as secoes: o alinhamento vem de um lugar so. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-7xl px-5 sm:px-8', className)}>{children}</div>;
}

/** Rotulo de secao: filete e texto em caixa alta, como numa folha de projeto. */
export function Eyebrow({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' }) {
  return (
    <p
      className={cx(
        'flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.18em]',
        tone === 'light' ? 'text-brand-700' : 'text-brand-300',
      )}
    >
      <span aria-hidden="true" className={cx('h-px w-8', tone === 'light' ? 'bg-brand-600' : 'bg-brand-300')} />
      {children}
    </p>
  );
}

/** Titulo de secao (h2). Um tamanho so, para a hierarquia ser previsivel. */
export function SectionTitle({
  children,
  tone = 'light',
  className,
  id,
}: {
  children: ReactNode;
  tone?: 'light' | 'dark';
  className?: string;
  id?: string;
}) {
  return (
    <h2
      id={id}
      className={cx(
        'text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.025em] sm:text-4xl lg:text-[2.75rem]',
        tone === 'light' ? 'text-slate-900' : 'text-white',
        className,
      )}
    >
      {children}
    </h2>
  );
}

type Variante = 'solid' | 'outline' | 'light' | 'outline-light';

const VARIANTES: Record<Variante, string> = {
  solid:
    'bg-brand-600 text-white shadow-brand hover:bg-brand-700 focus-visible:outline-brand-600',
  outline:
    'border border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-brand-600',
  light: 'bg-white text-brand-800 hover:bg-brand-50 focus-visible:outline-white',
  'outline-light':
    'border border-white/35 text-white hover:border-white/70 hover:bg-white/10 focus-visible:outline-white',
};

/**
 * Botao-link da pagina: `Link` do roteador para rotas e `<a>` para ancoras.
 * Altura fixa de 48px: alvo de toque confortavel no celular.
 */
export function LinkButton({
  to,
  children,
  variant = 'solid',
  className,
  icon,
}: {
  to: string;
  children: ReactNode;
  variant?: Variante;
  className?: string;
  icon?: ReactNode;
}) {
  const classes = cx(
    'inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[0.95rem] font-medium',
    'transition-all duration-200 ease-[var(--ease-out-soft)] active:scale-[0.99]',
    VARIANTES[variant],
    className,
  );
  if (to.startsWith('#')) {
    return (
      <a href={to} className={classes}>
        {children}
        {icon}
      </a>
    );
  }
  return (
    <Link to={to} className={classes}>
      {children}
      {icon}
    </Link>
  );
}

/** Logotipo: o mesmo quadrado azul do painel. */
export function Logo({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <span className="grid size-9 place-items-center rounded-[0.6rem] bg-brand-600 text-white shadow-brand">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[1.15rem]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
        </svg>
      </span>
      <span className={cx('text-[1.05rem] font-semibold tracking-tight', tone === 'light' ? 'text-slate-900' : 'text-white')}>
        CODECA <span className={tone === 'light' ? 'text-brand-700' : 'text-brand-300'}>Build</span>
      </span>
    </span>
  );
}
