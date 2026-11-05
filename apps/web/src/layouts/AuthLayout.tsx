import { Link, Outlet } from 'react-router-dom';
import { Logo } from '../components/Logo.js';
import { AuthShowcase } from './AuthShowcase.js';

/** Moldura das telas de acesso: cadastro, login e recuperacao de senha. */
export function AuthLayout() {
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr] lg:grid-cols-2 lg:grid-rows-none">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <Link to="/" className="mb-8 inline-block" aria-label="CODECA Build, página inicial">
            <Logo className="h-11" priority />
          </Link>
          <Outlet />
        </div>
      </div>

      {/* Apresentacao da plataforma: ao lado no desktop, abaixo do formulario no celular. */}
      <AuthShowcase />
    </div>
  );
}
