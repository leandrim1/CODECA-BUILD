import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { cx } from '@codeca/ui';

/**
 * Faz o bloco aparecer quando entra na tela.
 *
 * So opacidade e posicao: nenhuma delas muda o tamanho, entao nao desloca o
 * layout. Sem `IntersectionObserver`, ou com "reduzir movimento", o bloco ja
 * nasce visivel.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  /** Atraso em ms, para escalonar itens vizinhos. */
  delay?: number;
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement>(null);
  const [pendente, setPendente] = useState(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return false;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const el = ref.current;
    if (!pendente || !el) return undefined;
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setPendente(false);
          observador.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    observador.observe(el);
    return () => observador.disconnect();
  }, [pendente]);

  return (
    <Tag
      ref={ref}
      data-pending={pendente}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cx('lp-reveal', className)}
    >
      {children}
    </Tag>
  );
}
