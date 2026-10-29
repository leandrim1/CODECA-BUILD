import { Link, Outlet } from 'react-router-dom';
import { Building2 } from 'lucide-react';

/** Moldura das telas de acesso: cadastro, login e recuperacao de senha. */
export function AuthLayout() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <Link to="/" className="mb-8 inline-flex items-center gap-2 font-semibold text-slate-900">
            <span className="grid size-9 place-items-center rounded-lg bg-brand-600 text-white">
              <Building2 aria-hidden="true" className="size-5" />
            </span>
            Codeca Build
          </Link>
          <Outlet />
        </div>
      </div>

      {/* Painel lateral de apresentacao, apenas decorativo em telas grandes. */}
      <aside
        aria-hidden="true"
        className="hidden flex-col justify-between bg-slate-900 px-12 py-16 text-white lg:flex"
      >
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-brand-300">
            Plataforma para construtoras
          </p>
          <h2 className="mt-4 text-3xl font-semibold leading-tight">
            Site profissional, dominio proprio e carteira de imoveis em um so lugar.
          </h2>
          <ul className="mt-8 grid gap-3 text-slate-300">
            <li>Editor visual por blocos, sem precisar programar</li>
            <li>Imoveis a venda com pagina propria e busca</li>
            <li>Obras em andamento com evolucao e fotos</li>
            <li>Interessados organizados direto no painel</li>
            <li>Dominio proprio com HTTPS</li>
          </ul>
        </div>
        <p className="text-sm text-slate-400">
          Cada construtora tem seu site, seus dados e seus usuarios, isolados das demais.
        </p>
      </aside>
    </div>
  );
}
