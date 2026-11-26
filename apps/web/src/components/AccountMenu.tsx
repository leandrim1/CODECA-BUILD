import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useConsentimento } from '../consentimento/ConsentimentoProvider.js';
import {
  ChevronDown,
  CircleHelp,
  Cookie,
  ExternalLink,
  Home,
  LifeBuoy,
  ListChecks,
  LogOut,
  Play,
  Settings,
  Sparkles,
} from 'lucide-react';
import { Badge, cx } from '@codeca/ui';
import { useAuth } from '../hooks/useAuth.js';
import { useConsultaDeMidia } from '../hooks/useConsultaDeMidia.js';
import { useGuiaDePrimeiroAcesso } from '../hooks/useGuiaDePrimeiroAcesso.js';
import { useNavigate } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle.js';
import { api } from '../services/api.js';
import { labels, tenantTone } from '../utils/labels.js';

/**
 * Menu de conta do painel, ancorado no seletor de empresa.
 *
 * Reaproveita o seletor que ja existia no topo da barra lateral em vez de
 * acrescentar um segundo controle: eram dois cliques para a mesma regiao da
 * tela, e o seletor ja era o lugar onde a pessoa procura "quem sou eu, onde
 * estou".
 *
 * Os itens sao os que a CODECA Build TEM. Feedback, Changelog e Ajuda, que
 * existem no menu da Vercel, ficaram de fora porque nao ha pagina nem endereco
 * para nenhum dos tres -- um item de menu que nao leva a lugar nenhum e pior
 * do que item nenhum.
 */

/** Situacao da plataforma, pelo mesmo `/api/health` usado na operacao. */
type Situacao = 'carregando' | 'normal' | 'instavel' | 'indisponivel';

function useSituacaoDaPlataforma(ativo: boolean): Situacao {
  const [situacao, setSituacao] = useState<Situacao>('carregando');

  useEffect(() => {
    if (!ativo) return undefined;
    let vivo = true;
    void api
      .get<{ status: string }>('/api/health')
      .then((corpo) => {
        if (vivo) setSituacao(corpo.status === 'ok' ? 'normal' : 'instavel');
      })
      .catch(() => {
        // Nao da para afirmar que esta tudo bem quando nem a sonda respondeu.
        if (vivo) setSituacao('indisponivel');
      });
    return () => {
      vivo = false;
    };
  }, [ativo]);

  return situacao;
}

/**
 * Largura de celular, pela mesma fronteira do `sm:` do Tailwind.
 *
 * Precisa ser JavaScript, e nao so CSS: no celular a folha e levada para fora
 * da barra lateral com um portal, e isso nao da para decidir em media query.
 */
function useEhCelular(): boolean {
  return useConsultaDeMidia('(max-width: 639px)');
}

const TEXTO_DA_SITUACAO: Record<Situacao, string> = {
  carregando: 'Verificando os sistemas...',
  normal: 'Todos os sistemas normais.',
  instavel: 'Alguns sistemas instáveis.',
  indisponivel: 'Não foi possível verificar.',
};

const COR_DA_SITUACAO: Record<Situacao, string> = {
  carregando: 'text-slate-500',
  normal: 'text-brand-600',
  instavel: 'text-amber-700',
  indisponivel: 'text-slate-500',
};

const PONTO_DA_SITUACAO: Record<Situacao, string> = {
  carregando: 'bg-slate-300',
  normal: 'bg-brand-600',
  instavel: 'bg-amber-500',
  indisponivel: 'bg-slate-300',
};

export function AccountMenu({ planName }: { planName: string }) {
  const { tenant, memberships, user, selectTenant, logout, platform, can } = useAuth();
  const { refazerTour, reabrirChecklist } = useGuiaDePrimeiroAcesso();
  const { abrirPreferencias } = useConsentimento();
  const navegar = useNavigate();
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const veuRef = useRef<HTMLButtonElement>(null);
  const idDoMenu = useId();
  const { pathname } = useLocation();
  const situacao = useSituacaoDaPlataforma(aberto);
  const ehCelular = useEhCelular();

  const fechar = useCallback(
    (devolverFoco = false) => {
      setAberto(false);
      if (devolverFoco) gatilhoRef.current?.focus();
    },
    [],
  );

  // Fecha ao navegar: o menu nao pode sobreviver a troca de tela.
  useEffect(() => {
    setAberto(false);
  }, [pathname]);

  // Fecha ao clicar fora e no Esc.
  useEffect(() => {
    if (!aberto) return undefined;
    const aoApontar = (evento: PointerEvent) => {
      const alvo = evento.target as Node;
      // No celular a folha vive num portal, fora do container: sem conferir as
      // duas referencias, tocar na propria folha a fecharia.
      if (containerRef.current?.contains(alvo)) return;
      if (menuRef.current?.contains(alvo)) return;
      /**
       * O veu fecha no CLIQUE dele, nao aqui.
       *
       * No celular o veu cobre a tela inteira -- inclusive o gatilho. Fechando
       * no `pointerdown`, o veu desmontava ANTES do `click`, e o clique caia no
       * gatilho que estava embaixo, reabrindo o menu no mesmo toque: a pessoa
       * tocava a seta e nada parecia acontecer. Ignorando o veu aqui, ele
       * continua montado ate o `click`, que entao e dele e de mais ninguem.
       */
      if (veuRef.current?.contains(alvo)) return;
      fechar();
    };
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        fechar(true);
      }
    };
    document.addEventListener('pointerdown', aoApontar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('pointerdown', aoApontar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto, fechar]);

  /**
   * Setas andam pelos itens; Home e End vao aos extremos.
   *
   * O seletor pega qualquer coisa focavel do menu, na ordem do documento, para
   * o grupo de tema e o botao de upgrade entrarem na mesma volta que os links.
   */
  const aoTeclarNoMenu = (evento: React.KeyboardEvent<HTMLDivElement>) => {
    if (!aberto) return;
    const passo =
      evento.key === 'ArrowDown' ? 1 : evento.key === 'ArrowUp' ? -1 : evento.key === 'Home' ? 0 : evento.key === 'End' ? 0 : null;
    if (passo === null) return;
    const focaveis = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[data-item-do-menu]:not([disabled])') ?? [],
    );
    if (focaveis.length === 0) return;
    evento.preventDefault();
    if (evento.key === 'Home') {
      focaveis[0]?.focus();
      return;
    }
    if (evento.key === 'End') {
      focaveis[focaveis.length - 1]?.focus();
      return;
    }
    const atual = focaveis.indexOf(document.activeElement as HTMLElement);
    // Com o foco ainda no gatilho (`atual === -1`), descer vai ao primeiro item
    // e subir ao ultimo -- o que todo menu de sistema faz.
    const alvo =
      atual === -1
        ? (passo === 1 ? focaveis[0] : focaveis[focaveis.length - 1])
        : focaveis[(atual + passo + focaveis.length) % focaveis.length];
    alvo?.focus();
  };

  if (!tenant) return null;

  /**
   * Quem ja esta no plano mais alto nao tem para onde subir: o botao vira
   * "Gerenciar plano". Oferecer upgrade a quem ja pagou o teto e constrangedor
   * e nao leva a lugar nenhum.
   */
  const noPlanoMaisAlto = /empresas/i.test(planName);
  const podeVerPlano = can('billing:read');

  const itemClasse =
    'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors duration-200 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

  /**
   * No celular a folha vai para o `body`; no computador fica onde esta.
   *
   * A barra lateral tem `transition-transform`, e um elemento com `transform`
   * vira bloco de contencao para os `fixed` de dentro dele. Sem o portal, a
   * folha se ancorava na barra de 288px em vez da janela -- medido: 287px de
   * largura numa tela de 390px, quando devia ocupar a tela toda.
   *
   * O evento de teclado continua chegando: o React faz eventos de portal
   * subirem pela arvore de COMPONENTES, nao pela do documento.
   */
  const envolver = (conteudo: React.ReactNode) =>
    ehCelular ? createPortal(conteudo, document.body) : conteudo;

  return (
    <div className="relative" ref={containerRef} onKeyDown={aoTeclarNoMenu} data-tour="menu-da-conta">
      <button
        ref={gatilhoRef}
        type="button"
        onClick={() => setAberto((valor) => !valor)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        aria-controls={aberto ? idDoMenu : undefined}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-900">{tenant.tenantName}</span>
          <span className="block text-xs text-slate-500">{labels.tenantRole[tenant.role]}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cx('size-4 flex-none text-slate-500 transition-transform duration-200', aberto && 'rotate-180')}
        />
      </button>

      {aberto ? envolver(
        <>
          {/* No celular o menu sobe do rodape: um painel de 264px ancorado no
              alto da tela ficaria longe do polegar e cortado pela dobra. */}
          <button
            ref={veuRef}
            type="button"
            aria-label="Fechar menu da conta"
            onClick={() => fechar()}
            className="fixed inset-0 z-40 bg-scrim/40 sm:hidden"
          />

          <div
            ref={menuRef}
            id={idDoMenu}
            role="menu"
            aria-label="Conta e preferências"
            className={cx(
              'z-50 overflow-hidden border border-slate-200 bg-white shadow-overlay',
              // Celular: folha presa ao rodape, com area de respiro do gesto.
              'fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[env(safe-area-inset-bottom)]',
              // A partir de `sm`: ancorado sob o gatilho, mesma largura dele.
              'sm:absolute sm:inset-x-0 sm:bottom-auto sm:top-full sm:mt-1.5 sm:max-h-none sm:rounded-xl sm:pb-0',
            )}
          >
            {/* ---------------------------------------------- empresas */}
            <div className="p-1.5">
              <p className="px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                {memberships.length > 1 ? 'Suas empresas' : 'Empresa'}
              </p>
              {memberships.map((membership) => (
                <button
                  key={membership.tenantId}
                  type="button"
                  role="menuitem"
                  data-item-do-menu
                  onClick={() => {
                    selectTenant(membership.tenantId);
                    fechar();
                  }}
                  className={cx(
                    itemClasse,
                    membership.tenantId === tenant.tenantId && 'bg-brand-50/60 font-medium',
                  )}
                >
                  <span className="min-w-0 truncate">{membership.tenantName}</span>
                  <Badge tone={tenantTone(membership.tenantStatus)}>
                    {labels.tenantStatus[membership.tenantStatus]}
                  </Badge>
                </button>
              ))}
            </div>

            <hr className="border-slate-200" />

            {/* ----------------------------------------------- a pessoa */}
            <div className="flex items-start justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{user?.name}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
              </div>
              <Link
                to="/painel/seguranca"
                role="menuitem"
                data-item-do-menu
                aria-label="Segurança da conta"
                title="Segurança da conta"
                onClick={() => fechar()}
                className="grid size-8 flex-none place-items-center rounded-lg text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <Settings aria-hidden="true" className="size-4" />
              </Link>
            </div>

            <hr className="border-slate-200" />

            {/* ------------------------------------------------- opcoes */}
            <div className="p-1.5">
              {/* O tema e uma escolha, nao um destino: linha com o seletor
                  dentro, sem `menuitem` por cima do `radiogroup`. */}
              <div className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5">
                <span className="text-sm text-slate-700">Tema</span>
                <ThemeToggle />
              </div>

              {/*
                ------------------------------------------------- ajuda
                O guia nao termina quando a pessoa fecha o tour: daqui ela o
                refaz e traz os primeiros passos de volta. Os dois voltam para
                a visao geral porque e la que eles existem -- refazer o tour na
                tela de midia mostraria passos apontando para o nada.
              */}
              <div className="my-1 flex items-center gap-2 px-2.5 pt-1.5">
                <CircleHelp aria-hidden="true" className="size-3.5 flex-none text-slate-500" />
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">
                  Ajuda
                </span>
              </div>

              <button
                type="button"
                role="menuitem"
                data-item-do-menu
                onClick={() => {
                  fechar();
                  refazerTour();
                  navegar('/painel');
                }}
                className={itemClasse}
              >
                <span className="flex items-center gap-2.5">
                  <Play aria-hidden="true" className="size-4 flex-none text-slate-500" />
                  Refazer tour
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                data-item-do-menu
                onClick={() => {
                  fechar();
                  reabrirChecklist();
                  navegar('/painel');
                }}
                className={itemClasse}
              >
                <span className="flex items-center gap-2.5">
                  <ListChecks aria-hidden="true" className="size-4 flex-none text-slate-500" />
                  Ver primeiros passos
                </span>
              </button>

              {platform.supportEmail ? (
                <a
                  href={`mailto:${platform.supportEmail}`}
                  role="menuitem"
                  data-item-do-menu
                  onClick={() => fechar()}
                  className={itemClasse}
                >
                  <span className="flex items-center gap-2.5">
                    <LifeBuoy aria-hidden="true" className="size-4 flex-none text-slate-500" />
                    Falar com o suporte
                  </span>
                </a>
              ) : null}

              <hr className="my-1.5 border-slate-200" />

              {/*
                A LGPD pede que revogar seja tao facil quanto consentir. Um
                aviso que aparece uma vez e some nao atende a isso: a porta de
                volta tem de ficar onde a pessoa procura ajustes da conta.
              */}
              <button
                type="button"
                role="menuitem"
                data-item-do-menu
                onClick={() => {
                  fechar();
                  abrirPreferencias();
                }}
                className={itemClasse}
              >
                <span className="flex items-center gap-2.5">
                  <Cookie aria-hidden="true" className="size-4 flex-none text-slate-500" />
                  Preferências de cookies
                </span>
              </button>

              <a
                href={platform.url}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                data-item-do-menu
                onClick={() => fechar()}
                className={itemClasse}
              >
                <span className="flex items-center gap-2.5">
                  <Home aria-hidden="true" className="size-4 flex-none text-slate-500" />
                  Página inicial
                </span>
                <ExternalLink aria-hidden="true" className="size-3.5 flex-none text-slate-500" />
              </a>

              <button
                type="button"
                role="menuitem"
                data-item-do-menu
                onClick={() => {
                  fechar();
                  void logout();
                }}
                className={itemClasse}
              >
                <span className="flex items-center gap-2.5">
                  <LogOut aria-hidden="true" className="size-4 flex-none text-slate-500" />
                  Sair
                </span>
              </button>
            </div>

            {/* -------------------------------------------------- plano */}
            {podeVerPlano ? (
              <div className="px-3 pb-3">
                <Link
                  to="/painel/plano"
                  role="menuitem"
                  data-item-do-menu
                  onClick={() => fechar()}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-slate-100 text-sm font-medium text-slate-900 transition-colors duration-200 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                >
                  {noPlanoMaisAlto ? null : <Sparkles aria-hidden="true" className="size-4" />}
                  {noPlanoMaisAlto ? 'Gerenciar plano' : 'Fazer upgrade'}
                </Link>
              </div>
            ) : null}

            <hr className="border-slate-200" />

            {/* ------------------------------------------------ situacao */}
            <p
              className={cx(
                'flex items-center justify-between gap-2 px-4 py-2.5 text-xs',
                COR_DA_SITUACAO[situacao],
              )}
            >
              {TEXTO_DA_SITUACAO[situacao]}
              <span
                aria-hidden="true"
                className={cx('size-2 flex-none rounded-full', PONTO_DA_SITUACAO[situacao])}
              />
            </p>
          </div>
        </>,
      ) : null}
    </div>
  );
}
