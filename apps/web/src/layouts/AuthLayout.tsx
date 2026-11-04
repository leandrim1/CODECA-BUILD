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
            Plataforma para empresas
          </p>
          <h2 className="mt-4 text-3xl font-semibold leading-tight">
            Site profissional, domínio próprio e o conteúdo na sua mão.
          </h2>
          <ul className="mt-8 grid gap-3 text-slate-300">
            {/*
              A lista descreve o que a plataforma faz **hoje**. O primeiro item
              era "Editor visual por blocos", recurso removido na etapa 0 -- a
              tela de entrada vendia algo que nao existe mais.
            */}
            <li>Conteúdo do site editável sem novo deploy</li>
            <li>Módulos ligados conforme o ramo do seu projeto</li>
            <li>Campos próprios do seu negócio, sem programar</li>
            <li>Interessados organizados direto no painel</li>
            <li>Domínio próprio com HTTPS</li>
          </ul>
        </div>
        <p className="text-sm text-slate-400">
          Cada empresa tem seu site, seus dados e seus usuários, isolados das demais.
        </p>
      </aside>
    </div>
  );
}
