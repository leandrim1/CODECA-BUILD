import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  Building2,
  ChevronDown,
  CreditCard,
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
  Settings,
  ShoppingBag,
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
import { useSiteModules } from '../hooks/useSiteModules.js';
import { SafeIcon } from '../components/SafeIcon.js';
import { NavigationProgress, PageArea } from '../components/PageFeedback.js';
import { preloadRoute, preloadWhenIdle } from '../lib/routePreload.js';
import { labels, tenantTone } from '../utils/labels.js';

/**
 * Moldura do painel da empresa.
 *
 * O menu lateral reune todos os modulos pedidos pelo produto. Itens que o papel
 * do usuario nao alcanca ficam escondidos -- mas a decisao que vale e a do
 * servidor, que recusa a operacao de qualquer forma.
 */

interface NavItem {
  to: string;
  label: string;
  /** Ausente nos modulos criados para o site, que trazem `iconName`. */
  icon?: LucideIcon;
  capability?: Parameters<ReturnType<typeof useAuth>['can']>[0];
  /**
   * Modulo que precisa estar habilitado para este site.
   *
   * Sem modulo, o item vale para todo site: midia, interessados, dominio,
   * equipe, plano e empresa nao dependem de como o projeto foi montado.
   */
  module?: ModuleKey;
  /**
   * Continua disponivel quando o plano nao inclui o painel de conteudo.
   *
   * Marcado so no que e **conta**, nao conteudo: plano e cadastro da empresa.
   * O servidor recusa o resto de qualquer forma, e um menu que oferece telas
   * que respondem 402 parece quebrado.
   */
  semPainel?: boolean;
  end?: boolean;
  /**
   * Icone de um modulo criado para o site, pelo nome.
   *
   * Os itens fixos trazem o componente em `icon`; os deste site vem do banco,
   * onde so cabe o nome. `SafeIcon` desenha, e nao desenha nada quando o nome
   * nao e de um icone que o painel conhece.
   */
  iconName?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Menu do painel.
 *
 * Dois filtros, e eles respondem a perguntas diferentes: `capability` e sobre
 * o **papel de quem entrou**, `module` e sobre o **site da empresa**. Um
 * editor nao ve a equipe; um site institucional sem carteira nao ve imoveis.
 * Nenhum dos dois protege nada por si -- o servidor recusa a operacao de
 * qualquer forma -- mas um menu que oferece o que nao existe e um painel que
 * parece quebrado.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Visao geral',
    items: [{ to: '/painel', label: 'Visao geral', icon: LayoutDashboard, end: true, semPainel: true }],
  },
  {
    title: 'Conteudo do site',
    items: [
      {
        to: '/painel/institucional',
        label: 'Institucional',
        icon: Store,
        capability: 'content:read',
        module: 'institucional',
      },
      {
        to: '/painel/contato',
        label: 'Contato',
        icon: Mail,
        capability: 'content:read',
        module: 'contato',
      },
      {
        to: '/painel/banners',
        label: 'Banners',
        icon: GalleryHorizontalEnd,
        capability: 'content:read',
        module: 'banners',
      },
      {
        to: '/painel/imoveis',
        label: 'Imoveis',
        icon: Building2,
        capability: 'content:read',
        module: 'imoveis',
      },
      {
        to: '/painel/obras',
        label: 'Obras e projetos',
        icon: HardHat,
        capability: 'content:read',
        module: 'obras',
      },
      {
        to: '/painel/servicos',
        label: 'Servicos',
        icon: Wrench,
        capability: 'content:read',
        module: 'servicos',
      },
      {
        to: '/painel/produtos',
        label: 'Produtos',
        icon: ShoppingBag,
        capability: 'content:read',
        module: 'produtos',
      },
      {
        to: '/painel/categorias',
        label: 'Categorias',
        icon: Tags,
        capability: 'content:read',
        module: 'categorias',
      },
      {
        to: '/painel/galerias',
        label: 'Galerias',
        icon: Images,
        capability: 'content:read',
        module: 'galerias',
      },
      {
        to: '/painel/depoimentos',
        label: 'Depoimentos',
        icon: Sparkles,
        capability: 'content:read',
        module: 'depoimentos',
      },
      {
        to: '/painel/equipe',
        label: 'Equipe do site',
        icon: Users,
        capability: 'content:read',
        module: 'equipe',
      },
      {
        to: '/painel/perguntas',
        label: 'Perguntas frequentes',
        icon: MessageCircleQuestion,
        capability: 'content:read',
        module: 'faq',
      },
      { to: '/painel/midia', label: 'Biblioteca de imagens', icon: Image, capability: 'media:read' },
    ],
  },
  {
    title: 'Relacionamento',
    items: [{ to: '/painel/interessados', label: 'Interessados', icon: Users, capability: 'leads:read' }],
  },
  {
    title: 'Configuracoes',
    items: [
      { to: '/painel/dominio', label: 'Dominio proprio', icon: Globe, capability: 'domains:read' },
      // "Usuarios", e nao "Equipe": isto e quem acessa o painel. A equipe
      // exibida no site e o modulo `equipe`, em Conteudo do site.
      { to: '/painel/usuarios', label: 'Usuarios e permissoes', icon: ShieldCheck, capability: 'members:read' },
      { to: '/painel/plano', label: 'Plano e assinatura', icon: CreditCard, capability: 'billing:read', semPainel: true },
      { to: '/painel/empresa', label: 'Configuracoes da empresa', icon: Settings, capability: 'tenant:read', semPainel: true },
    ],
  },
];

export function DashboardLayout() {
  const { tenant, memberships, user, selectTenant, logout, isPlatformAdmin, can } = useAuth();
  const { enabled, loading: modulesLoading, readOnly, blocked, panelIncluded, planName, customModules } =
    useSiteModules();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

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

    return NAV_GROUPS.map((group) => ({
      ...group,
      items: [
        ...group.items,
        ...(group.title === 'Conteudo do site' ? itensProprios : []),
      ].filter((item) => {
        if (item.capability && !can(item.capability)) return false;
        // O plano sem painel esconde conteudo inteiro; o que e conta permanece.
        if (!panelIncluded) return item.semPainel === true;
        if (!item.module) return true;
        // Enquanto a configuracao nao chega, o item de modulo fica fora e o
        // grupo mostra marcadores de espera no lugar: o menu nao cresce
        // aos poucos nem oferece uma tela que nao existe.
        return enabled(item.module);
      }),
    })).filter((group) => group.items.length > 0);
  }, [can, enabled, panelIncluded, customModules]);

  // Baixa o codigo das telas do menu em horas vagas: o clique nao espera rede.
  const rotasDoMenu = useMemo(
    () => visibleGroups.flatMap((group) => group.items.map((item) => item.to)),
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      {/* Barra lateral */}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r border-slate-200/70 bg-white',
          'transition-transform lg:static lg:translate-x-0',
          menuOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full',
        )}
        aria-label="Menu do painel"
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          <Link to="/painel" className="flex items-center gap-2 font-semibold text-slate-900">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
              <Building2 aria-hidden="true" className="size-4" />
            </span>
            Codeca Build
          </Link>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Fechar menu">
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>

        {/* Seletor de empresa */}
        <div className="border-b border-slate-200 p-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setSwitcherOpen((open) => !open)}
              aria-expanded={switcherOpen}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-left hover:bg-slate-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900">{tenant.tenantName}</span>
                <span className="block text-xs text-slate-500">{labels.tenantRole[tenant.role]}</span>
              </span>
              <ChevronDown aria-hidden="true" className="size-4 flex-none text-slate-400" />
            </button>

            {switcherOpen ? (
              <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {memberships.map((membership) => (
                  <button
                    key={membership.tenantId}
                    type="button"
                    onClick={() => {
                      selectTenant(membership.tenantId);
                      setSwitcherOpen(false);
                    }}
                    className={cx(
                      'flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-slate-50',
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
            ) : null}
          </div>
        </div>

        <nav className="p-4">
          {visibleGroups.map((group) => (
            <div key={group.title} className="mb-6 last:mb-0">
              {/*
                Rotulo de grupo em peso medio e cor fraca: ele organiza a lista
                sem disputar atencao com os itens, que sao o que se clica.
              */}
              <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                {group.title}
              </p>
              <ul className="grid gap-0.5">
                {group.title === 'Conteudo do site' && modulesLoading && panelIncluded ? (
                  <MarcadoresDoMenu />
                ) : null}
                {group.items.map((item) => (
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
                ))}
              </ul>
            </div>
          ))}

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

      {/* Conteudo */}
      <div className="flex min-w-0 flex-col">
        <NavigationProgress />
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/70 bg-white/80 px-4 backdrop-blur-xl sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Abrir menu">
            <Menu aria-hidden="true" className="size-5" />
          </Button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{tenant.tenantName}</p>
            <p className="truncate text-xs text-slate-500">
              {user?.email}
              {!user?.emailVerified ? ' - e-mail nao confirmado' : ''}
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
            {planName ? `O plano ${planName} nao inclui o painel de conteudo` : 'Seu plano nao inclui o painel de conteudo'}
          </p>
          <p className="mt-0.5 text-sm text-brand-800">
            O conteudo do seu site e mantido pela CODECA IA. Para editar textos, imagens e
            produtos por conta propria, contrate o plano Profissional.
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
              ? 'O painel esta indisponivel por pendencia da assinatura'
              : 'O painel esta em somente leitura por pendencia da assinatura'}
          </p>
          <p className="mt-0.5 text-sm text-amber-800">
            Nada foi apagado: imoveis, obras, imagens e configuracoes continuam salvos e voltam a
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
