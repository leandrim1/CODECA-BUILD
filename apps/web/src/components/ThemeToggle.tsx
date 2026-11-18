import { Monitor, Moon, Sun } from 'lucide-react';
import { cx } from '@codeca/ui';
import { useTheme, type PreferenciaDeTema } from '../hooks/useTheme.js';

const OPCOES: Array<{ valor: PreferenciaDeTema; rotulo: string; Icone: typeof Sun }> = [
  { valor: 'sistema', rotulo: 'Tema do sistema', Icone: Monitor },
  { valor: 'claro', rotulo: 'Tema claro', Icone: Sun },
  { valor: 'escuro', rotulo: 'Tema escuro', Icone: Moon },
];

/**
 * Seletor de tema em tres icones.
 *
 * Nao usa o `SegmentedControl` compartilhado de proposito: aquele mostra o
 * rotulo a partir de `sm`, o que aqui alargaria o menu de 264px. A linguagem
 * visual e a mesma -- trilho `slate-100`, pilula branca no selecionado.
 *
 * E um `radiogroup`, nao tres botoes soltos: para quem usa teclado ou leitor
 * de tela, as tres opcoes sao UMA escolha, e as setas andam entre elas.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preferencia, definir } = useTheme();

  const aoTeclar = (evento: React.KeyboardEvent<HTMLDivElement>) => {
    const direcao =
      evento.key === 'ArrowRight' || evento.key === 'ArrowDown'
        ? 1
        : evento.key === 'ArrowLeft' || evento.key === 'ArrowUp'
          ? -1
          : 0;
    if (direcao === 0) return;
    evento.preventDefault();
    // `+ OPCOES.length` antes do resto: em JavaScript, -1 % 3 e -1, nao 2.
    const atual = OPCOES.findIndex((o) => o.valor === preferencia);
    const proxima = OPCOES[(atual + direcao + OPCOES.length) % OPCOES.length];
    if (proxima) definir(proxima.valor);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Tema do painel"
      onKeyDown={aoTeclar}
      className={cx('inline-flex flex-none gap-0.5 rounded-lg bg-slate-100 p-0.5', className)}
    >
      {OPCOES.map(({ valor, rotulo, Icone }) => {
        const selecionado = preferencia === valor;
        return (
          <button
            key={valor}
            type="button"
            role="radio"
            aria-checked={selecionado}
            aria-label={rotulo}
            title={rotulo}
            // So o selecionado entra na ordem do Tab: o grupo e uma parada so,
            // e as setas andam por dentro. Com os tres em `tabIndex 0`, o Tab
            // pararia tres vezes no mesmo controle.
            tabIndex={selecionado ? 0 : -1}
            onClick={() => definir(valor)}
            className={cx(
              'grid size-7 place-items-center rounded-md transition-colors duration-200',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
              selecionado
                ? 'bg-white text-slate-900 shadow-card'
                : 'text-slate-500 hover:text-slate-800',
            )}
          >
            <Icone aria-hidden="true" className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
