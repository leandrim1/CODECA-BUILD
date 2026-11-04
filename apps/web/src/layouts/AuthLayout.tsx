import { Link, Outlet } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { AuthShowcase } from './AuthShowcase.js';

/** Moldura das telas de acesso: cadastro, login e recuperacao de senha. */
export function AuthLayout() {
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr] lg:grid-cols-2 lg:grid-rows-none">
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

      {/* Apresentacao da plataforma: ao lado no desktop, abaixo do formulario no celular. */}
      <AuthShowcase />
    </div>
  );
}
