import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Button, cx } from '@codeca/ui';
import { Logo } from '../components/Logo.js';
import { SidebarPlataforma } from '../components/SidebarPlataforma.js';
import { NavigationProgress, PageArea } from '../components/PageFeedback.js';
import { MENU_DA_PLATAFORMA } from '../lib/menuDaPlataforma.js';
import { useAuth } from '../hooks/useAuth.js';
import { useConsultaDeMidia } from '../hooks/useConsultaDeMidia.js';
import { useMenuRecolhido } from '../hooks/useMenuRecolhido.js';

/**
 * Moldura do painel mestre, restrito a administradores da plataforma.
 *
 * A navegacao e lateral e fixa. Era uma faixa horizontal no topo, que com nove
 * destinos ja rolava de lado no celular e quebrava em duas linhas no tablet --
 * e, por estar no fluxo, empurrava o conteudo para baixo em toda tela. A barra
 * presa a janela devolve a altura ao conteudo e deixa os nove destinos
 * visiveis de uma vez.
 *
 * Quem compensa a largura da barra e o padding desta coluna, e nao uma grade:
 * a barra e `fixed` e nao ocupa espaco no fluxo, entao a medida daqui tem de
 * acompanhar a de la -- `w-72`/`md:pl-72`, `w-[4.5rem]`/`md:pl-[4.5rem]`.
 */
export function PlatformLayout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const { recolhido, alternar } = useMenuRecolhido();
  const [aberta, setAberta] = useState(false);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);

  // Abaixo de `md:` a barra e gaveta: ali nao ha trilho de icones nem recolher.
  const ehCelular = useConsultaDeMidia('(max-width: 767px)');
  const soIcones = recolhido && !ehCelular;

  // Trocar de tela fecha a gaveta. O `onClick` de cada item ja faz isso, mas
  // nao cobre voltar pelo navegador nem um link vindo do conteudo.
  useEffect(() => setAberta(false), [pathname]);

  /**
   * Abrir leva o foco para dentro da gaveta; fechar o devolve ao hamburguer.
   *
   * A barra vem ANTES do conteudo no documento, entao sem isto o Tab seguinte
   * ao hamburguer pularia a gaveta inteira e cairia no conteudo atras do veu
   * -- um menu que o mouse abre e o teclado nao alcanca.
   */
  const jaAbriu = useRef(false);
  useEffect(() => {
    if (aberta) {
      jaAbriu.current = true;
      fecharRef.current?.focus();
    } else if (jaAbriu.current) {
      jaAbriu.current = false;
      gatilhoRef.current?.focus();
    }
  }, [aberta]);

  // Gaveta aberta: o fundo nao rola por baixo e Esc a fecha.
  useEffect(() => {
    if (!aberta) return undefined;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setAberta(false);
    };
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.body.style.overflow = anterior;
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberta]);

  return (
    <div className="min-h-dvh bg-slate-50">
      <SidebarPlataforma
        itens={MENU_DA_PLATAFORMA}
        aberta={aberta}
        fora={ehCelular && !aberta}
        fecharRef={fecharRef}
        onFechar={() => setAberta(false)}
        soIcones={soIcones}
        recolhido={recolhido}
        onAlternarRecolhido={alternar}
        user={user}
        onSair={() => void logout()}
      />

      {aberta ? (
        <button
          type="button"
          /*
            Fora do caminho do teclado: Esc e o X da gaveta ja fecham, e um
            botao do tamanho da janela no meio da ordem do Tab seria so ruido
            para quem usa leitor de tela -- alem de um segundo controle com o
            mesmo nome do X.
          */
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setAberta(false)}
          className="fixed inset-0 z-30 bg-scrim/50 md:hidden"
        />
      ) : null}

      {/* `min-w-0`: sem isso um conteudo largo estica a coluna e a pagina
          inteira passa a rolar de lado, atras da barra fixa. */}
      <div
        className={cx(
          'flex min-h-dvh min-w-0 flex-col transition-[padding] duration-200 ease-[var(--ease-out-soft)]',
          soIcones ? 'md:pl-[4.5rem]' : 'md:pl-72',
        )}
        /*
          Com a gaveta aberta o conteudo esta atras do veu: `inert` prende o
          foco na gaveta sem biblioteca de armadilha de foco, e impede que o
          leitor de tela anuncie a tela que a pessoa nao esta vendo.
        */
        {...(aberta && ehCelular ? { inert: true } : {})}
      >
        <NavigationProgress />

        {/* No celular a barra sai da tela: o cabecalho e o unico caminho de volta. */}
        <header className="sticky top-0 z-20 flex h-16 flex-none items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur-xl md:hidden">
          <Button ref={gatilhoRef} variant="ghost" size="icon" onClick={() => setAberta(true)} aria-label="Abrir menu">
            <Menu aria-hidden="true" className="size-5" />
          </Button>
          <Link to="/plataforma" aria-label="CODECA Build, painel da plataforma" className="flex items-center">
            <Logo className="h-8" priority />
          </Link>
          <span className="ml-auto rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
            Plataforma
          </span>
        </header>

        <main className="flex-1">
          <PageArea />
        </main>
      </div>
    </div>
  );
}
