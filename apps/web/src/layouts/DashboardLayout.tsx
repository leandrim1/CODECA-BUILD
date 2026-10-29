import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Building2,
  ChevronDown,
  CircleHelp,
  Globe,
  HardHat,
  Image,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  type LucideIcon,
  Menu,
  Palette,
  PanelsTopLeft,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { Badge, Button, Spinner, cx } from '@codeca/ui';
import { useAuth } from '../hooks/useAuth.js';
import { labels, tenantTone } from '../utils/labels.js';

/**
 * Moldura do painel da construtora.
 *
 * O menu lateral reune todos os modulos pedidos pelo produto. Itens que o papel
 * do usuario nao alcanca ficam escondidos -- mas a decisao que vale e a do
 * servidor, que recusa a operacao de qualquer forma.
 */

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  capability?: Parameters<ReturnType<typeof useAuth>['can']>[0];
  end?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Visao geral',
    items: [{ to: '/painel', label: 'Visao geral', icon: LayoutDashboard, end: true }],
  },
  {
    title: 'Site',
    items: [
      { to: '/painel/editor', label: 'Editor do site', icon: LayoutTemplate, capability: 'site:edit' },
      { to: '/painel/paginas', label: 'Paginas', icon: PanelsTopLeft, capability: 'site:read' },
      { to: '/painel/personalizacao', label: 'Personalizacao', icon: Palette, capability: 'site:read' },
      { to: '/painel/midia', label: 'Biblioteca de imagens', icon: Image, capability: 'media:read' },
    ],
  },
  {
    title: 'Conteudo',
    items: [
      { to: '/painel/imoveis', label: 'Imoveis', icon: Building2, capability: 'content:read' },
      { to: '/painel/obras', label: 'Obras e projetos', icon: HardHat, capability: 'content:read' },
      { to: '/painel/servicos', label: 'Servicos', icon: Wrench, capability: 'content:read' },
      { to: '/painel/galeria', label: 'Galeria e depoimentos', icon: Sparkles, capability: 'content:read' },
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
      { to: '/painel/seo', label: 'SEO', icon: Search, capability: 'seo:read' },
      { to: '/painel/equipe', label: 'Equipe e usuarios', icon: ShieldCheck, capability: 'members:read' },
      { to: '/painel/plano', label: 'Plano e assinatura', icon: CircleHelp, capability: 'billing:read' },
      { to: '/painel/empresa', label: 'Configuracoes da empresa', icon: Settings, capability: 'tenant:read' },
    ],
  },
];

export function DashboardLayout() {
  const { tenant, memberships, user, selectTenant, logout, isPlatformAdmin, can } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const location = useLocation();

  if (!tenant) return null;

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.capability || can(item.capability)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      {/* Barra lateral */}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r border-slate-200 bg-white',
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

        <nav className="p-3">
          {visibleGroups.map((group) => (
            <div key={group.title} className="mb-4">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {group.title}
              </p>
              <ul className="grid gap-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        cx(
                          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                          isActive
                            ? 'bg-brand-50 font-medium text-brand-700'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                        )
                      }
                    >
                      <item.icon aria-hidden="true" className="size-4 flex-none" />
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
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
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
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
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

        <main className="flex-1" key={location.pathname.split('/').slice(0, 3).join('/')}>
          {/* As telas do painel sao carregadas sob demanda. */}
          <Suspense
            fallback={
              <div className="panel-shell">
                <Spinner label="Carregando tela" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
