import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cx } from './utils.js';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

/**
 * O azul da marca permanece exatamente o mesmo -- `brand-600` no primario,
 * `brand-700` no hover. O que mudou e o acabamento: sombra que pertence a
 * paleta (ver `--shadow-brand`), raio maior e a transicao cobrindo tambem a
 * sombra, para o botao parecer subir ao receber o ponteiro.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-brand hover:bg-brand-700 focus-visible:outline-brand-600',
  secondary: 'bg-slate-900 text-white shadow-raised hover:bg-slate-800 focus-visible:outline-slate-900',
  outline:
    'border border-slate-200 bg-white text-slate-700 shadow-card hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-brand-600',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-brand-600',
  danger: 'bg-rose-600 text-white shadow-raised hover:bg-rose-700 focus-visible:outline-rose-600',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3.5 text-sm',
  md: 'h-10 gap-2 px-4.5 text-sm',
  lg: 'h-12 gap-2.5 px-6 text-base',
  icon: 'h-9 w-9 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center rounded-xl font-medium',
        // `transition-all` e nao `transition-colors`: a sombra tambem anima.
        // A microinteracao e o leve recuo ao pressionar -- 1% e quase
        // imperceptivel de olhar e perceptivel de usar.
        'transition-all duration-200 ease-[var(--ease-out-soft)] active:scale-[0.99]',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
