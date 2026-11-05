import { cx } from '@codeca/ui';

/**
 * Logotipo oficial do CODECA Build.
 *
 * Os arquivos saem de `apps/web/brand-source/logo-original.webp` por
 * `scripts/brand/build-logos.py`. Duas versoes da logo completa: a padrao, para
 * fundo claro, e a branca (texto escuro trocado por branco), para fundo escuro.
 * O simbolo azul e o mesmo nas duas.
 *
 * `width`/`height` reservam o espaco antes de a imagem carregar (sem salto de
 * layout); o tamanho visivel vem da altura em `className` (a largura segue a
 * proporcao).
 */

/** Proporcao da logo completa (largura / altura). */
const RATIO = 960 / 235;

export function Logo({
  tone = 'light',
  className = 'h-10',
  priority = false,
}: {
  /** `light`: fundo claro. `dark`: fundo escuro (texto em branco). */
  tone?: 'light' | 'dark';
  /** Controla o tamanho pela altura, por exemplo `h-9`. */
  className?: string;
  /** Logo acima da dobra: carrega primeiro. */
  priority?: boolean;
}) {
  return (
    <img
      src={tone === 'dark' ? '/brand/logo-branca.webp' : '/brand/logo.webp'}
      alt="CODECA Build"
      width={Math.round(40 * RATIO)}
      height={40}
      decoding="async"
      {...(priority ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })}
      className={cx('block w-auto select-none', className)}
      draggable={false}
    />
  );
}

/** Apenas o simbolo (hexagono em C), para espacos pequenos e quadrados. */
export function LogoIcon({ className = 'size-8' }: { className?: string }) {
  return (
    <img
      src="/brand/logo-icone.webp"
      alt="CODECA Build"
      width={32}
      height={32}
      decoding="async"
      className={cx('block select-none object-contain', className)}
      draggable={false}
    />
  );
}
