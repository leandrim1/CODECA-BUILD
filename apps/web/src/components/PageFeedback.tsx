import { Component, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Alert, Button, Skeleton } from '@codeca/ui';
import { useAuth } from '../hooks/useAuth.js';

/**
 * O que o usuario ve enquanto uma tela chega, quebra ou demora.
 *
 * Tudo aqui vive **dentro** da moldura do painel (menu e cabecalho): o que
 * muda a cada navegacao e a area de conteudo, nunca a pagina inteira.
 */

/**
 * Esqueleto de uma tela inteira, para quando o codigo dela ainda nao chegou.
 *
 * Tem a mesma estrutura de uma tela carregando seus dados (cabecalho e
 * blocos): assim o conteudo vai de esqueleto para dado numa troca so, em vez
 * de passar por um indicador de espera e depois por um esqueleto.
 */
export function PageSkeleton() {
  return (
    <div className="panel-shell grid gap-6" role="status" aria-label="Carregando a tela">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}

/**
 * Renderiza a tela da rota atual, recriando-a a cada endereco.
 *
 * Duas rotas diferentes que usam o mesmo componente (institucional e contato)
 * reaproveitariam a mesma instancia, com o formulario da anterior. A chave
 * resolve isso -- e fica aqui, **dentro** do `Suspense`, de proposito: uma
 * chave no proprio `Suspense` o recriaria e traria o indicador de espera de
 * volta a cada clique, mesmo para telas ja carregadas.
 */
export function PageOutlet() {
  const { pathname } = useLocation();
  // Outra empresa no mesmo endereco e outra tela: nada do estado da anterior fica.
  const tenantId = useAuth().tenant?.tenantId ?? '';

  useEffect(() => {
    // Tela nova comeca no topo, como numa pagina nova.
    window.scrollTo(0, 0);
  }, [pathname]);

  return <Outlet key={`${tenantId}${pathname}`} />;
}

/**
 * Contem o erro de uma tela dentro da moldura.
 *
 * Sem isto, um erro de renderizacao subia ate a barreira da aplicacao e
 * derrubava o menu junto: o painel inteiro virava a tela de erro, e navegar
 * para outra tela -- que provavelmente funcionaria -- exigia recarregar.
 * Aqui o menu continua de pe, e trocar de tela limpa o erro.
 */
export class RouteErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { erro: Error | null; chave: string }
> {
  override state = { erro: null as Error | null, chave: this.props.resetKey };

  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { erro: Error | null; chave: string },
  ) {
    // Mudou de tela: o erro da anterior nao vale para esta.
    return props.resetKey !== state.chave ? { erro: null, chave: props.resetKey } : null;
  }

  override componentDidCatch(erro: Error, info: ErrorInfo): void {
    console.error('[painel] erro de renderização na tela', erro, info.componentStack);
  }

  override render(): ReactNode {
    const { erro } = this.state;
    if (!erro) return this.props.children;
    return (
      <div className="panel-shell">
        <Alert
          tone="danger"
          title="Esta tela encontrou um erro"
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => this.setState({ erro: null })}>
                Tentar de novo
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Recarregar
              </Button>
            </div>
          }
        >
          <p>
            O resto do painel continua funcionando: você pode abrir outra tela pelo menu. Se o
            erro se repetir, envie a mensagem abaixo para a CODECA IA.
          </p>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white/70 p-2 text-xs">
            {erro.message}
          </pre>
        </Alert>
      </div>
    );
  }
}

/**
 * Linha fina no topo enquanto uma navegacao demora.
 *
 * Com a tela anterior mantida ate a nova ficar pronta, um clique que leva
 * tempo pareceria ignorado. A linha so aparece depois de 180ms: navegacao
 * rapida nao mostra nada, e a lenta mostra que algo esta acontecendo.
 */
export function NavigationProgress() {
  const { pathname } = useLocation();
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => setPending(false), [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented && event.button !== 0) return;
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.origin !== window.location.origin) return;
      if (link.pathname === window.location.pathname) return;
      setPending(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return undefined;
    }
    const show = setTimeout(() => setVisible(true), 180);
    // Uma navegacao que nunca chega nao pode deixar a linha correndo para sempre.
    const giveUp = setTimeout(() => setPending(false), 15_000);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [pending]);

  if (!visible) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
      <div className="nav-progress h-full w-1/3 bg-brand-600" />
    </div>
  );
}

/**
 * A area de conteudo do painel: erro contido, espera e tela da rota.
 *
 * Esta area e a unica parte da moldura que muda entre telas. O `Suspense` e a
 * barreira de erro ficam **fora** do que e recriado a cada endereco, e e isso
 * que mantem a tela anterior visivel enquanto a proxima chega.
 */
export function PageArea() {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageSkeleton />}>
        <PageOutlet />
      </Suspense>
    </RouteErrorBoundary>
  );
}
