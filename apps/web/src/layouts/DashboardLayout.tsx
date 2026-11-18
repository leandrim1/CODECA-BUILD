import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Logo } from '../components/Logo.js';
import { Link, NavLink } from 'react-router-dom';
import {
  BarChart3,
  Building2,
  CreditCard,
  DownloadCloud,
  Globe,
  GalleryHorizontalEnd,
  HardHat,
  Image,
  Images,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Mail,
  Menu,
  MessageCircleQuestion,
  RefreshCw,
  Settings,
  ShoppingBag,
  KeyRound,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Store,
  Tags,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type { ModuleKey } from '@codeca/shared';
import { Badge, Button, Skeleton, cx } from '@codeca/ui';
import { useAuth } from '../hooks/useAuth.js';
import { AccountMenu } from '../components/AccountMenu.js';
import { useTheme } from '../hooks/useTheme.js';
import { useSiteModules } from '../hooks/useSiteModules.js';
import { SafeIcon } from '../components/SafeIcon.js';
import { NavigationProgress, PageArea } from '../components/PageFeedback.js';
import { preloadRoute, preloadWhenIdle } from '../lib/routePreload.js';
import { NAV_GROUPS, type NavItem } from '../lib/menuDoPainel.js';
import { SidebarGroup, SidebarSectionLabel, SidebarSubList } from '../components/SidebarGroup.js';
import { useGruposAbertos } from '../hooks/useGruposAbertos.js';

/**
 * Moldura do painel da empresa.
 *
 * O menu lateral reune todos os modulos pedidos pelo produto. Itens que o papel
 * do usuario nao alcanca ficam escondidos -- mas a decisao que vale e a do
 * servidor, que recusa a operacao de qualquer forma.
 */

export function DashboardLayout() {
  const { tenant, memberships, user, selectTenant, logout, isPlatformAdmin, can } = useAuth();
  const { enabled, loading: modulesLoading, readOnly, blocked, panelIncluded, planName, customModules } =
    useSiteModules();
  const { efetivo: tema } = useTheme();
  const { pathname } = useLocation();
  const { estaAberto, alternar, abrir } = useGruposAbertos();
  const [menuOpen, setMenuOpen] = useState(false);

  /**
   * O menu so muda quando muda o que o decide: papel, modulos, plano.
   *
   * Os modulos criados para este site entram ao fim do grupo de conteudo. O
   * menu junta as duas listas aqui -- e um dos dois lugares onde a separacao
   * entre `modules` e `customModules` cobra o seu preco, e esta e a conta que
   * se escolheu pagar para nao alargar `ModuleKey` para `string`.
   *
   * Ordem e icone vem da configuracao; `enabled` nao e conferido porque a API
   * so manda os habilitados nesta lista.
   */
  const visibleGroups = useMemo(() => {
    const itensProprios: NavItem[] = panelIncluded
      ? customModules.map((modulo) => ({
          to: `/painel/p/${modulo.key}`,
          label: modulo.name,
          iconName: modulo.icon,
          capability: 'content:read' as const,
        }))
      : [];

    const passa = (item: NavItem) => {
      if (item.capability && !can(item.capability)) return false;
      // O plano sem painel esconde conteudo inteiro; o que e conta permanece.
      if (!panelIncluded) return item.semPainel === true;
      if (!item.module) return true;
      // Enquanto a configuracao nao chega, o item de modulo fica fora e o
      // grupo mostra marcadores de espera no lugar: o menu nao cresce aos
      // poucos nem oferece uma tela que nao existe.
      return enabled(item.module);
    };

    return NAV_GROUPS.map((group) => ({
      ...group,
      sections: group.sections
        .map((section) => ({
          ...section,
          items: [
            ...section.items,
            ...(section.recebeModulosProprios ? itensProprios : []),
          ].filter(passa),
        }))
        .filter((section) => section.items.length > 0),
    })).filter((group) => group.sections.length > 0);
  }, [can, enabled, panelIncluded, customModules]);

  /**
   * A rota atual pertence a este grupo?
   *
   * Compara com a barra depois do endereco (`/painel/contato/` e filho de
   * `/painel/contato`, `/painel/contatos` nao e) para nao acender o grupo
   * errado quando dois enderecos comecam igual.
   */
  const grupoTemRotaAtiva = useCallback(
    (sections: ReadonlyArray<{ items: NavItem[] }>) =>
      sections.some((section) =>
        section.items.some(
          (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
        ),
      ),
    [pathname],
  );

  /**
   * Navegar para dentro de um grupo fechado o abre.
   *
   * So na troca de rota, nao a cada desenho: forcar aberto sempre tiraria da
   * pessoa o direito de fechar o grupo e continuar na tela em que esta -- caso
   * em que o proprio cabecalho assume o destaque.
   */
  useEffect(() => {
    for (const group of visibleGroups) {
      if (group.colapsavel && grupoTemRotaAtiva(group.sections)) abrir(group.id);
    }
    // `visibleGroups` muda quando os modulos chegam, e o grupo certo precisa
    // abrir tambem nesse momento.
  }, [pathname, visibleGroups, grupoTemRotaAtiva, abrir]);

  // Baixa o codigo das telas do menu em horas vagas: o clique nao espera rede.
  const rotasDoMenu = useMemo(
    () => visibleGroups.flatMap((group) => group.sections.flatMap((s) => s.items.map((i) => i.to))),
    [visibleGroups],
  );
  useEffect(() => preloadWhenIdle(rotasDoMenu), [rotasDoMenu]);

  // Gaveta aberta no celular: o fundo nao rola por baixo e Esc a fecha.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.body.style.overflow = anterior;
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [menuOpen]);

  if (!tenant) return null;

  return (
    <div className="min-h-dvh">
      {/*
       * Barra lateral presa a janela, em QUALQUER largura de tela.
       *
       * Antes ela era `lg:static` dentro de uma grade: no computador virava
       * uma celula comum e, por ser a pagina quem rola, subia junto com o
       * conteudo em telas longas, deixando um vazio no lugar dela. Agora
       * `fixed` vale sempre, e quem compensa a largura e o padding da coluna
       * de conteudo (`lg:pl-72`) -- a mesma medida do `w-72` daqui.
       *
       * `h-dvh` e a altura visivel de verdade no celular (acompanha a barra
       * de endereco do navegador); `overflow-y-auto` da ao menu a propria
       * rolagem quando as opcoes nao caberem. `inset-y-0` fica junto de
       * proposito: em navegador sem `dvh`, `h-dvh` seria descartado e a altura
       * viraria `auto` -- ai o `bottom: 0` segura a barra na janela.
       */}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 h-dvh w-72 overflow-y-auto overscroll-contain rolagem-fina',
          'border-r border-slate-200/70 bg-white',
          'transition-transform lg:translate-x-0',
          menuOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full',
        )}
        aria-label="Menu do painel"
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          <Link to="/painel" aria-label="CODECA Build, visão geral" className="flex items-center">
            {/* A logo padrao tem o texto escuro: sobre o painel escuro ela some. */}
            <Logo className="h-9" priority tone={tema === 'escuro' ? 'dark' : 'light'} />
          </Link>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Fechar menu">
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>

        {/* Seletor de empresa e menu de conta */}
        <div className="border-b border-slate-200 p-3">
          <AccountMenu planName={planName} />
        </div>

        <nav className="p-4">
          {visibleGroups.map((group) => {
            const temRotaAtiva = grupoTemRotaAtiva(group.sections);
            // Grupo fixo esta sempre "aberto": a propriedade so pesa no colapsavel.
            const aberto = !group.colapsavel || estaAberto(group.id);
            const esperandoModulos = Boolean(group.mostraEsperaDeModulos) && modulesLoading && panelIncluded;

            return (
              <SidebarGroup
                key={group.id}
                group={group}
                aberto={aberto}
                temRotaAtiva={temRotaAtiva}
                onAlternar={() => alternar(group.id)}
              >
                {esperandoModulos ? (
                  <SidebarSubList>
                    <MarcadoresDoMenu />
                  </SidebarSubList>
                ) : null}

                {group.sections.map((section, indice) => {
                  const itens = section.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onClick={() => setMenuOpen(false)}
                        onPointerEnter={() => preloadRoute(item.to)}
                        onFocus={() => preloadRoute(item.to)}
                        className={({ isActive }) =>
                          cx(
                            // O item ativo mantem exatamente o azul de antes
                            // (`brand-50` de fundo, `brand-700` de texto) e ganha
                            // um marcador vertical: a cor sozinha exige comparar
                            // dois itens para saber qual esta ativo; a barra
                            // responde sem comparacao.
                            'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm',
                            'transition-all duration-200 ease-[var(--ease-out-soft)]',
                            'before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5',
                            'before:-translate-y-1/2 before:rounded-full before:transition-colors',
                            isActive
                              ? 'bg-brand-50 font-medium text-brand-700 before:bg-brand-600'
                              : 'text-slate-600 before:bg-transparent hover:bg-slate-100/80 hover:text-slate-900',
                          )
                        }
                      >
                        {item.icon ? (
                          <item.icon aria-hidden="true" className="size-4 flex-none" />
                        ) : (
                          <SafeIcon name={item.iconName ?? ''} size={16} className="flex-none" />
                        )}
                        {item.label}
                      </NavLink>
                    </li>
                  ));

                  return (
                    <div key={section.title ?? `secao-${indice}`}>
                      {section.title ? <SidebarSectionLabel>{section.title}</SidebarSectionLabel> : null}
                      {/* Dentro de grupo colapsavel os itens ganham recuo e o
                          fio vertical; fora dele, a lista segue como sempre foi. */}
                      {group.colapsavel ? (
                        <SidebarSubList>{itens}</SidebarSubList>
                      ) : (
                        <ul className="grid gap-0.5">{itens}</ul>
                      )}
                    </div>
                  );
                })}
              </SidebarGroup>
            );
          })}

          {isPlatformAdmin ? (
            <div className="mb-4 border-t border-slate-200 pt-4">
              <NavLink
                to="/plataforma"
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-100"
              >
                <ShieldCheck aria-hidden="true" className="size-4" />
                Painel da plataforma
              </NavLink>
            </div>
          ) : null}
        </nav>
      </aside>

      {menuOpen ? (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden"
        />
      ) : null}

      {/* Conteudo: o padding reserva a faixa da barra fixa, que nao ocupa mais espaco no fluxo. */}
      <div className="flex min-w-0 flex-col lg:pl-72">
        <NavigationProgress />
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/70 bg-white/80 px-4 backdrop-blur-xl sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Abrir menu">
            <Menu aria-hidden="true" className="size-5" />
          </Button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{tenant.tenantName}</p>
            <p className="truncate text-xs text-slate-500">
              {user?.email}
              {!user?.emailVerified ? ' - e-mail não confirmado' : ''}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void logout()}
            icon={<LogOut aria-hidden="true" className="size-4" />}
          >
            <span className="hidden sm:inline">Sair</span>
          </Button>
        </header>

        {/*
          Dois avisos que nunca aparecem juntos, e nao podem ser confundidos:
          sem painel no plano, o cliente esta em dia e precisa de upgrade;
          suspenso, ele precisa pagar. Trocar as mensagens faria um cliente
          pagante achar que esta devendo.
        */}
        {!panelIncluded ? (
          <AvisoDePlanoSemPainel planName={planName} />
        ) : readOnly || blocked ? (
          <AvisoDeSuspensao bloqueado={blocked} />
        ) : null}

        <main className="flex-1">
          {/* As telas do painel chegam sob demanda; a anterior fica visivel ate la. */}
          <PageArea />
        </main>
      </div>
    </div>
  );
}

/**
 * Marcadores no lugar dos itens de modulo, ate a configuracao do site chegar.
 *
 * A altura de cada um e a de um item do menu, e a quantidade e a de um site
 * tipico: quando os itens reais chegam, o menu praticamente nao se mexe.
 */
function MarcadoresDoMenu() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((indice) => (
        <li key={indice} aria-hidden="true" className="flex h-10 items-center gap-3 px-3">
          <Skeleton className="size-4 flex-none" />
          <Skeleton className="h-3.5 w-28" />
        </li>
      ))}
    </>
  );
}

/**
 * Aviso de plano que nao inclui o painel de conteudo.
 *
 * Fala de upgrade e nomeia o plano atual. Nao fala em regularizar nem em
 * pendencia: o cliente esta em dia, e sugerir o contrario rende uma ligacao
 * para o suporte em vez de uma contratacao.
 */
function AvisoDePlanoSemPainel({ planName }: { planName: string }) {
  return (
    <div className="border-b border-brand-200 bg-brand-50 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-start gap-3">
        <Sparkles aria-hidden="true" className="mt-0.5 size-5 flex-none text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-brand-900">
            {planName ? `O plano ${planName} não inclui o painel de conteúdo` : 'Seu plano não inclui o painel de conteúdo'}
          </p>
          <p className="mt-0.5 text-sm text-brand-800">
            O conteúdo do seu site é mantido pela CODECA IA. Para editar textos, imagens e
            produtos por conta própria, contrate o plano Profissional.
          </p>
        </div>
        <Link
          to="/painel/plano"
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Ver planos
        </Link>
      </div>
    </div>
  );
}

/**
 * Aviso de assinatura pendente.
 *
 * Fica acima do conteudo, em toda tela do painel, por dois motivos: o cliente
 * precisa saber **antes** de preencher um formulario que nao vai salvar, e
 * precisa saber que nada foi perdido. O segundo e o que evita o pedido de
 * suporte em panico -- a reacao natural a um painel que parou de gravar e
 * supor que o conteudo foi apagado.
 */
function AvisoDeSuspensao({ bloqueado }: { bloqueado: boolean }) {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-start gap-3">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 flex-none text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900">
            {bloqueado
              ? 'O painel está indisponível por pendência da assinatura'
              : 'O painel está em somente leitura por pendência da assinatura'}
          </p>
          <p className="mt-0.5 text-sm text-amber-800">
            Nada foi apagado: imóveis, obras, imagens e configurações continuam salvos e voltam a
            aparecer assim que a assinatura for regularizada.
          </p>
        </div>
        <Link
          to="/painel/plano"
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
        >
          Regularizar
        </Link>
      </div>
    </div>
  );
}
