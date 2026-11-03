import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  AppWindow,
  ArrowLeft,
  Building2,
  CreditCard,
  FileClock,
  Globe,
  LayoutDashboard,
  LifeBuoy,
  Package,
  Shapes,
} from 'lucide-react';
import { cx } from '@codeca/ui';
import { NavigationProgress, PageArea } from '../components/PageFeedback.js';
import { preloadRoute } from '../lib/routePreload.js';

/** Moldura do painel mestre, restrito a administradores da plataforma. */
const ITEMS = [
  { to: '/plataforma', label: 'Visao geral', icon: LayoutDashboard, end: true },
  { to: '/plataforma/empresas', label: 'Empresas', icon: Building2 },
  { to: '/plataforma/sites', label: 'Sites', icon: AppWindow },
  { to: '/plataforma/segmentos', label: 'Segmentos', icon: Shapes },
  { to: '/plataforma/planos', label: 'Planos', icon: Package },
  { to: '/plataforma/cobranca', label: 'Cobranca', icon: CreditCard },
  { to: '/plataforma/dominios', label: 'Dominios', icon: Globe },
  { to: '/plataforma/suporte', label: 'Acesso de suporte', icon: LifeBuoy },
  { to: '/plataforma/auditoria', label: 'Auditoria', icon: FileClock },
];

export function PlatformLayout() {
  return (
    // `flex-col` + `flex-1` no `main`: sem isso o `main` so cresce ate o
    // conteudo, e numa tela curta o fundo escuro do cabecalho reaparecia
    // embaixo, como se a pagina tivesse duas metades.
    <div className="flex min-h-dvh flex-col bg-slate-900">
      <NavigationProgress />
      {/*
        O painel mestre usa fundo escuro de proposito, para a CODECA IA nunca
        confundir em qual dos dois paineis esta. O escuro e neutro de apoio --
        o azul da marca segue sendo o unico destaque, agora tambem no item
        ativo do menu.
      */}
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/painel" className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Voltar ao painel
          </Link>
          <span className="ml-auto rounded-full bg-amber-400/15 px-3 py-1 text-xs font-medium tracking-wide text-amber-300 ring-1 ring-inset ring-amber-400/20">
            Area restrita da plataforma
          </span>
        </div>
        {/*
          No celular o menu vira uma unica faixa que rola de lado, em vez de
          quebrar em quatro linhas e comer metade da tela antes do conteudo. A
          partir de `md` volta a quebrar linha: ali ha espaco e ver tudo de
          uma vez e melhor que rolar.
        */}
        <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-label="Menu da plataforma">
          <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden">
            {ITEMS.map((item) => (
              <li key={item.to} className="flex-none">
                <NavLink
                  to={item.to}
                  end={item.end}
                  onPointerEnter={() => preloadRoute(item.to)}
                  onFocus={() => preloadRoute(item.to)}
                  className={({ isActive }) =>
                    cx(
                      'inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm',
                      'transition-all duration-200 ease-[var(--ease-out-soft)]',
                      isActive
                        // O ativo deixa de ser so "mais claro" e passa a
                        // carregar o azul da marca, como no painel do cliente.
                        ? 'bg-brand-600/15 font-medium text-white ring-1 ring-inset ring-brand-500/30'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white',
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

      <main className="flex-1 bg-slate-50">
        <PageArea />
      </main>
    </div>
  );
}
