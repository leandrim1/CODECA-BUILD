import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { cx } from '@codeca/ui';
import { useAuth } from '../hooks/useAuth.js';
import { Container, LinkButton, Logo } from './ui.js';

export const NAVEGACAO = [
  { href: '#plataforma', label: 'Plataforma' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#recursos', label: 'Recursos' },
  { href: '#planos', label: 'Planos' },
  { href: '#perguntas', label: 'Perguntas' },
] as const;

/** Para onde o botao de acesso leva: o painel, se ja ha sessao. */
export function useDestino() {
  const { user, tenant } = useAuth();
  return {
    logado: Boolean(user),
    painel: tenant ? '/painel' : '/plataforma',
    cadastro: user ? (tenant ? '/painel' : '/plataforma') : '/criar-conta',
    planos: user && tenant ? '/painel/plano' : '/criar-conta',
  };
}

export function Header() {
  const destino = useDestino();
  const [aberto, setAberto] = useState(false);
  const [rolou, setRolou] = useState(false);

  useEffect(() => {
    const aoRolar = () => setRolou(window.scrollY > 8);
    aoRolar();
    window.addEventListener('scroll', aoRolar, { passive: true });
    return () => window.removeEventListener('scroll', aoRolar);
  }, []);

  useEffect(() => {
    if (!aberto) return undefined;
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberto]);

  return (
    <header
      className={cx(
        'sticky top-0 z-40 transition-colors duration-300',
        rolou || aberto
          ? 'border-b border-slate-200/80 bg-white/90 backdrop-blur-xl'
          : 'border-b border-transparent bg-white/0',
      )}
    >
      <Container className="flex h-[4.25rem] items-center gap-6">
        <Link to="/" aria-label="CODECA Build, página inicial">
          <Logo className="h-9 sm:h-10" priority />
        </Link>

        <nav className="ml-8 hidden items-center gap-1 lg:flex" aria-label="Seções da página">
          {NAVEGACAO.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          {destino.logado ? (
            <LinkButton to={destino.painel} className="h-10 px-5 text-sm">
              Ir para o painel
            </LinkButton>
          ) : (
            <>
              <Link
                to="/entrar"
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
              >
                Entrar
              </Link>
              <LinkButton to="/criar-conta" className="h-10 px-5 text-sm">
                Criar conta
              </LinkButton>
            </>
          )}
        </div>

        <button
          type="button"
          className="ml-auto grid size-11 place-items-center rounded-xl text-slate-700 hover:bg-slate-100 lg:hidden"
          aria-expanded={aberto}
          aria-controls="menu-movel"
          aria-label={aberto ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
        </button>
      </Container>

      {aberto ? (
        <div id="menu-movel" className="border-t border-slate-200/80 bg-white lg:hidden">
          <Container className="grid gap-1 py-4">
            {NAVEGACAO.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setAberto(false)}
                className="rounded-xl px-3 py-3 text-base font-medium text-slate-800 hover:bg-slate-100"
              >
                {item.label}
              </a>
            ))}
            <div className="mt-3 grid gap-2 border-t border-slate-200 pt-4">
              {destino.logado ? (
                <LinkButton to={destino.painel}>Ir para o painel</LinkButton>
              ) : (
                <>
                  <LinkButton to="/criar-conta">Criar conta</LinkButton>
                  <LinkButton to="/entrar" variant="outline">
                    Entrar
                  </LinkButton>
                </>
              )}
            </div>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
