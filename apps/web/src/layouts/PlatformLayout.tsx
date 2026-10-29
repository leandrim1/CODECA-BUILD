import { Suspense } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { ArrowLeft, Building2, FileClock, Globe, LayoutDashboard, LifeBuoy, Package } from 'lucide-react';
import { Spinner, cx } from '@codeca/ui';

/** Moldura do painel mestre, restrito a administradores da plataforma. */
const ITEMS = [
  { to: '/plataforma', label: 'Visao geral', icon: LayoutDashboard, end: true },
  { to: '/plataforma/empresas', label: 'Empresas', icon: Building2 },
  { to: '/plataforma/planos', label: 'Planos', icon: Package },
  { to: '/plataforma/dominios', label: 'Dominios', icon: Globe },
  { to: '/plataforma/suporte', label: 'Acesso de suporte', icon: LifeBuoy },
  { to: '/plataforma/auditoria', label: 'Auditoria', icon: FileClock },
];

export function PlatformLayout() {
  return (
    <div className="min-h-dvh bg-slate-900">
      <header className="border-b border-slate-700 bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/painel" className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Voltar ao painel
          </Link>
          <span className="ml-auto rounded-full bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-300">
            Area restrita da plataforma
          </span>
        </div>
        <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-label="Menu da plataforma">
          <ul className="flex flex-wrap gap-1 pb-2">
            {ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx(
                      'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive ? 'bg-white/10 font-medium text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white',
                    )
                  }
                >
                  <item.icon aria-hidden="true" className="size-4" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="bg-slate-50">
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
  );
}
