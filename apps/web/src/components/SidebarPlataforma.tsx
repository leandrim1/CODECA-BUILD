import type { RefObject } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  ArrowLeft,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldAlert,
  X,
} from 'lucide-react';
import { cx } from '@codeca/ui';
import { Logo, LogoIcon } from './Logo.js';
import { preloadRoute } from '../lib/routePreload.js';
import type { ItemDaPlataforma } from '../lib/menuDaPlataforma.js';
import type { SessionUser } from '../types/index.js';

/**
 * Barra lateral do painel mestre.
 *
 * Tres formas, um componente: gaveta no celular, trilho de icones no tablet e
 * barra inteira no computador. Sao estados do mesmo elemento, e nao copias --
 * duas marcacoes separadas significariam dois lugares para esquecer de
 * acrescentar um item de menu.
 *
 * O fundo escuro continua sendo a identidade do painel mestre: e o que impede
 * de confundir, num relance, a administracao da plataforma com o painel de uma
 * empresa cliente. O azul da marca segue como unico destaque, agora cheio no
 * item ativo.
 *
 * `soIcones` nao sai de uma media query porque nao e so aparencia: o rotulo
 * passa a `sr-only` e a logo troca de arquivo -- decisoes de arvore, que o CSS
 * nao toma.
 */
export function SidebarPlataforma({
  itens,
  aberta,
  fora,
  fecharRef,
  onFechar,
  soIcones,
  recolhido,
  onAlternarRecolhido,
  user,
  onSair,
}: {
  itens: ItemDaPlataforma[];
  /** Gaveta aberta no celular. Acima de `md` a barra esta sempre visivel. */
  aberta: boolean;
  /**
   * A barra esta fora da janela: gaveta fechada, no celular.
   *
   * Nao da para deduzir de `aberta`, porque no computador a gaveta tambem
   * esta "fechada" e a barra continua visivel.
   */
  fora: boolean;
  /**
   * O botao de fechar, para o layout levar o foco ate aqui ao abrir a gaveta.
   *
   * Sem isso o teclado nao entra: a barra vem ANTES do conteudo no documento,
   * entao o Tab seguinte ao hamburguer pula a gaveta inteira e cai no
   * conteudo que esta atras do veu.
   */
  fecharRef: RefObject<HTMLButtonElement | null>;
  onFechar: () => void;
  /** Trilho de icones: `recolhido`, mas nunca no celular. */
  soIcones: boolean;
  recolhido: boolean;
  onAlternarRecolhido: () => void;
  user: SessionUser | null;
  onSair: () => void;
}) {
  return (
    <aside
      className={cx(
        // `inset-y-0` junto de `h-dvh` de proposito: em navegador sem `dvh` a
        // altura viraria `auto` e e o `bottom: 0` que segura a barra na janela.
        'fixed inset-y-0 left-0 z-40 flex h-dvh flex-col bg-slate-900 text-slate-300',
        'border-r border-slate-800',
        'transition-[transform,width] duration-200 ease-[var(--ease-out-soft)]',
        'md:translate-x-0',
        soIcones ? 'w-[4.5rem]' : 'w-72',
        aberta ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
      )}
      aria-label="Navegação da plataforma"
      /*
        Fora da janela, os links continuariam focaveis pelo Tab e anunciados
        pelo leitor de tela: a pessoa tabularia para dentro de um menu que ela
        nao ve. `inert` tira a barra inteira do caminho enquanto ela nao esta
        na tela.
      */
      {...(fora ? { inert: true } : {})}
    >
      <div
        className={cx(
          'flex h-16 flex-none items-center border-b border-slate-800',
          soIcones ? 'justify-center px-2' : 'gap-2 px-4',
        )}
      >
        <Link
          to="/plataforma"
          aria-label="CODECA Build, painel da plataforma"
          onClick={onFechar}
          className="flex items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400"
        >
          {/* A logo completa nao cabe no trilho: ali fica so o simbolo. */}
          {soIcones ? <LogoIcon className="size-8" /> : <Logo tone="dark" className="h-8" priority />}
        </Link>
        {!soIcones ? (
          <button
            ref={fecharRef}
            type="button"
            onClick={onFechar}
            aria-label="Fechar menu"
            className="ml-auto flex size-9 flex-none items-center justify-center rounded-lg text-slate-400 transition-colors duration-200 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 md:hidden"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>

      {/*
        A navegacao e a unica parte que rola: cabecalho e rodape ficam presos.
        Sem isso, numa tela baixa o perfil e o "Sair" sumiriam abaixo da dobra
        da propria barra.
      */}
      <nav
        aria-label="Menu da plataforma"
        className={cx(
          'flex-1 overflow-y-auto overscroll-contain rolagem-fina rolagem-escura py-4',
          // O trilho tem 72px e o item 44px: 14px de cada lado centram o icone.
          soIcones ? 'px-3.5' : 'px-3',
        )}
      >
        <ul className="grid gap-1">
          {itens.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                // No celular a gaveta se fecha ao escolher; no computador o
                // clique no proprio item ja aberto nao muda nada.
                onClick={onFechar}
                onPointerEnter={() => preloadRoute(item.to)}
                onFocus={() => preloadRoute(item.to)}
                title={soIcones ? item.label : undefined}
                className={({ isActive }) =>
                  cx(
                    'flex items-center rounded-xl text-sm',
                    'transition-all duration-200 ease-[var(--ease-out-soft)]',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400',
                    soIcones ? 'size-11 justify-center' : 'gap-3 px-3 py-2.5',
                    isActive
                      ? 'bg-brand-600 font-medium text-white shadow-brand'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white',
                  )
                }
              >
                <item.icon aria-hidden="true" className="size-4 flex-none" />
                {/* O rotulo nunca desaparece da arvore: recolhido, ele vira o
                    nome acessivel do link em vez de um icone mudo. */}
                <span className={soIcones ? 'sr-only' : 'truncate'}>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className={cx('flex-none border-t border-slate-800 py-3', soIcones ? 'px-3.5' : 'px-3')}>
        {/*
          O recolher e so do tablet para cima: no celular a barra ja e uma
          gaveta, e um trilho de icones por cima da gaveta nao significa nada.
        */}
        <button
          type="button"
          onClick={onAlternarRecolhido}
          aria-pressed={recolhido}
          aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'}
          title={recolhido ? 'Expandir menu' : 'Recolher menu'}
          className={cx(
            'hidden items-center rounded-xl text-sm text-slate-400 md:flex',
            'transition-colors duration-200 hover:bg-white/5 hover:text-white',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400',
            soIcones ? 'size-11 justify-center' : 'w-full gap-3 px-3 py-2.5',
          )}
        >
          {recolhido ? (
            <PanelLeftOpen aria-hidden="true" className="size-4 flex-none" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-4 flex-none" />
          )}
          {!soIcones ? <span>Recolher menu</span> : null}
        </button>

        {/*
          Selo, e nao botao: ele informa onde a pessoa esta, e nao leva a lugar
          nenhum. Um galao com seta sugeriria um destino que nao existe.
        */}
        <div
          title={soIcones ? 'Área restrita da plataforma' : undefined}
          className={cx(
            'mt-1 flex items-center rounded-xl bg-amber-400/10 ring-1 ring-inset ring-amber-400/20',
            soIcones ? 'size-11 justify-center' : 'gap-2.5 px-3 py-2.5',
          )}
        >
          <ShieldAlert aria-hidden="true" className="size-4 flex-none text-amber-300" />
          <span className={cx('text-xs font-medium tracking-wide text-amber-300', soIcones && 'sr-only')}>
            Área restrita da plataforma
          </span>
        </div>

        {/* Caminho de volta ao painel da empresa: estava no cabecalho antigo. */}
        <Link
          to="/painel"
          onClick={onFechar}
          title={soIcones ? 'Voltar ao painel' : undefined}
          className={cx(
            'mt-1 flex items-center rounded-xl text-sm text-slate-400',
            'transition-colors duration-200 hover:bg-white/5 hover:text-white',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400',
            soIcones ? 'size-11 justify-center' : 'gap-3 px-3 py-2.5',
          )}
        >
          <ArrowLeft aria-hidden="true" className="size-4 flex-none" />
          <span className={soIcones ? 'sr-only' : 'truncate'}>Voltar ao painel</span>
        </Link>

        <div className="my-3 border-t border-slate-800" />

        <div
          className={cx('flex items-center', soIcones ? 'justify-center' : 'gap-3 px-1')}
          title={soIcones ? (user?.name ?? user?.email ?? undefined) : undefined}
        >
          <span
            aria-hidden="true"
            className="flex size-9 flex-none items-center justify-center rounded-full bg-brand-600/20 text-xs font-semibold text-brand-200 ring-1 ring-inset ring-brand-500/30"
          >
            {iniciais(user)}
          </span>
          {!soIcones ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user?.name ?? 'Administrador'}</p>
              <p className="truncate text-xs text-slate-400">{user?.email}</p>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onSair}
          title={soIcones ? 'Sair' : undefined}
          className={cx(
            'mt-2 flex items-center rounded-xl text-sm text-slate-400',
            'transition-colors duration-200 hover:bg-white/5 hover:text-white',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400',
            soIcones ? 'size-11 justify-center' : 'w-full gap-3 px-3 py-2.5',
          )}
        >
          <LogOut aria-hidden="true" className="size-4 flex-none" />
          <span className={soIcones ? 'sr-only' : undefined}>Sair</span>
        </button>
      </div>
    </aside>
  );
}

/**
 * Iniciais para o circulo do perfil.
 *
 * Primeira e ultima palavra do nome, porque "Leandrim Rodrigues Silva" e
 * reconhecido como LS e nao como LR. Sem nome, a primeira letra do e-mail; sem
 * nenhum dos dois, nada -- um placeholder inventado seria pior que um circulo
 * vazio.
 */
function iniciais(user: SessionUser | null): string {
  const partes = (user?.name ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return (user?.email ?? '').charAt(0).toUpperCase();
  if (partes.length === 1) return partes[0]!.charAt(0).toUpperCase();
  return (partes[0]!.charAt(0) + partes[partes.length - 1]!.charAt(0)).toUpperCase();
}
