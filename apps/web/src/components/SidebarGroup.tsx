import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cx } from '@codeca/ui';
import type { NavGroup } from '../lib/menuDoPainel.js';

/**
 * Grupo do menu lateral, fixo ou colapsavel.
 *
 * Nao usa Radix nem shadcn: nenhum dos dois esta no projeto, e trazer uma
 * dependencia para abrir e fechar uma lista custaria mais do que as vinte
 * linhas abaixo. O que o Radix daria de util aqui -- `aria-expanded`,
 * `aria-controls`, teclado -- esta feito a mao, e o resto (portal, foco preso)
 * nao se aplica a um grupo de navegacao.
 *
 * A animacao e de `grid-template-rows`, de `0fr` para `1fr`, com
 * `overflow-hidden` por dentro. E o unico jeito de animar "ate a altura que o
 * conteudo tiver" sem medir nada em JavaScript -- `max-height` com um chute
 * grande anima rapido demais ao abrir e deixa um atraso ao fechar.
 */
export function SidebarGroup({
  group,
  aberto,
  temRotaAtiva,
  onAlternar,
  children,
}: {
  group: NavGroup;
  /** So faz sentido em grupo colapsavel. */
  aberto: boolean;
  /** A rota atual pertence a este grupo. */
  temRotaAtiva: boolean;
  onAlternar: () => void;
  children: ReactNode;
}) {
  const idDoConteudo = useId();

  if (!group.colapsavel) {
    return (
      // `data-tour` sai do id do grupo: um alvo novo nao precisa ser
      // declarado em dois lugares, e renomear o titulo nao quebra o tour.
      <div className="mb-6 last:mb-0" data-tour={`grupo-${group.id}`}>
        {/*
          Rotulo de grupo em peso medio e cor fraca: ele organiza a lista sem
          disputar atencao com os itens, que sao o que se clica.
        */}
        <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
          {group.title}
        </p>
        {children}
      </div>
    );
  }

  return (
    <div className="mb-6 last:mb-0" data-tour={`grupo-${group.id}`}>
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        aria-controls={idDoConteudo}
        className={cx(
          'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm',
          'transition-all duration-200 ease-[var(--ease-out-soft)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
          // Fechado com a rota ativa dentro, o cabecalho assume o destaque: do
          // contrario nada na barra diria onde a pessoa esta.
          temRotaAtiva && !aberto
            ? 'bg-brand-50 font-medium text-brand-700'
            : 'font-medium text-slate-600 hover:bg-slate-100/80 hover:text-slate-900',
        )}
      >
        {group.icon ? <group.icon aria-hidden="true" className="size-4 flex-none" /> : null}
        <span className="flex-1 text-left">{group.title}</span>
        <ChevronRight
          aria-hidden="true"
          className={cx(
            'size-4 flex-none text-slate-500 transition-transform duration-200 ease-[var(--ease-out-soft)]',
            aberto && 'rotate-90',
          )}
        />
      </button>

      <div
        id={idDoConteudo}
        className={cx(
          'grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out-soft)]',
          aberto ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        {/*
          `inert` enquanto fechado: com altura zero os links continuariam
          focaveis pelo Tab e anunciados pelo leitor de tela -- a pessoa
          tabularia para dentro de um grupo que ela fechou e que nao se ve.
        */}
        <div className="overflow-hidden" {...(aberto ? {} : { inert: true })}>
          <div className="pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Subtitulo dentro de um grupo (Paginas, Conteudo, Midia, Ferramentas).
 *
 * E rotulo, nao controle: nao recebe clique, nao entra na ordem do Tab e nao
 * tem papel ARIA proprio -- quem da a estrutura ao leitor de tela e a lista.
 */
export function SidebarSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.1em] text-slate-500">
      {children}
    </p>
  );
}

/**
 * Trilho dos subitens.
 *
 * A linha vertical a esquerda e o que diz "isto esta dentro daquilo". So o
 * recuo nao basta: numa lista longa, sem o fio, o olho perde de qual grupo o
 * item desceu.
 */
export function SidebarSubList({ children }: { children: ReactNode }) {
  return (
    <ul className="ml-[1.0625rem] grid gap-0.5 border-l border-slate-200 pl-2.5">{children}</ul>
  );
}
