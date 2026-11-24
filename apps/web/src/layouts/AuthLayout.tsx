import { Link, Outlet } from 'react-router-dom';
import { Logo } from '../components/Logo.js';
import { AuthShowcase } from './AuthShowcase.js';

/** Moldura das telas de acesso: cadastro, login e recuperacao de senha. */
export function AuthLayout() {
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr] lg:grid-cols-2 lg:grid-rows-none">
      {/*
        `justify-center` centraliza enquanto sobra espaco; `overflow-y-auto` e a
        rede de seguranca para quando nao sobra -- janela baixa, zoom alto ou
        todos os campos em erro. Sem ela, o conteudo que excede a celula fica
        inalcancavel, porque a pagina inteira ja tem a altura da janela.
      */}
      <div className="flex flex-col justify-center overflow-y-auto px-6 py-8 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <Link to="/" className="mb-4 inline-block" aria-label="CODECA Build, página inicial">
            <Logo className="h-10" priority />
          </Link>
          <Outlet />
        </div>
      </div>

      {/* Apresentacao da plataforma: ao lado no desktop, abaixo do formulario no celular. */}
      <AuthShowcase />
    </div>
  );
}
