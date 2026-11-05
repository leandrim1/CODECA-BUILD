import { Link } from 'react-router-dom';
import { Container, Logo } from './ui.js';

const COLUNAS = [
  {
    titulo: 'Plataforma',
    itens: [
      { rotulo: 'Visão da plataforma', href: '#plataforma' },
      { rotulo: 'Como funciona', href: '#como-funciona' },
      { rotulo: 'Recursos', href: '#recursos' },
      { rotulo: 'Planos', href: '#planos' },
    ],
  },
  {
    titulo: 'Acesso',
    itens: [
      { rotulo: 'Entrar', to: '/entrar' },
      { rotulo: 'Criar conta', to: '/criar-conta' },
    ],
  },
  {
    titulo: 'Legal',
    itens: [
      { rotulo: 'Termos de uso', to: '/termos' },
      { rotulo: 'Política de privacidade', to: '/privacidade' },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-300">
      <Container className="py-16 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <div>
            <Link to="/" aria-label="CODECA Build, página inicial">
              <Logo tone="dark" className="h-11" />
            </Link>
            <p className="mt-6 max-w-sm leading-relaxed text-slate-400">
              Plataforma de gestão de conteúdo para sites empresariais personalizados. Sua empresa organiza e
              atualiza as informações do site em um só lugar.
            </p>
          </div>

          <nav aria-label="Rodapé" className="grid gap-10 sm:grid-cols-3">
            {COLUNAS.map((coluna) => (
              <div key={coluna.titulo}>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{coluna.titulo}</p>
                <ul className="mt-5 grid gap-3">
                  {coluna.itens.map((item) => (
                    <li key={item.rotulo}>
                      {'to' in item ? (
                        <Link to={item.to} className="text-[0.95rem] text-slate-300 transition-colors hover:text-white">
                          {item.rotulo}
                        </Link>
                      ) : (
                        <a href={item.href} className="text-[0.95rem] text-slate-300 transition-colors hover:text-white">
                          {item.rotulo}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t border-white/10 pt-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} CODECA Build. Todos os direitos reservados.</p>
          <p>Plataforma desenvolvida pela CODECA IA.</p>
        </div>
      </Container>
    </footer>
  );
}
