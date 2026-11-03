import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Titulo da aba e instrucao de indexacao, por rota.
 *
 * O `index.html` traz os metadados da pagina inicial -- e o que um rastreador
 * ou uma previa de link le, sem executar JavaScript. Dentro do aplicativo, o
 * titulo precisa acompanhar a tela (uma aba "Gestao de Conteudo..." em cima
 * do painel nao diz onde a pessoa esta), e o que e area logada nao deve ser
 * indexado.
 */

export const TITULO_DA_PAGINA_INICIAL = 'CODECA Build | Gestão de Conteúdo para Sites Empresariais';

interface Meta {
  titulo: string;
  indexar: boolean;
}

function metaDe(caminho: string): Meta {
  if (caminho === '/') return { titulo: TITULO_DA_PAGINA_INICIAL, indexar: true };
  if (caminho.startsWith('/painel')) return { titulo: 'Painel | CODECA Build', indexar: false };
  if (caminho.startsWith('/plataforma')) return { titulo: 'Plataforma | CODECA Build', indexar: false };
  if (caminho === '/entrar') return { titulo: 'Entrar | CODECA Build', indexar: false };
  if (caminho === '/criar-conta') return { titulo: 'Criar conta | CODECA Build', indexar: false };
  if (caminho === '/termos') return { titulo: 'Termos de uso | CODECA Build', indexar: true };
  if (caminho === '/privacidade') return { titulo: 'Política de privacidade | CODECA Build', indexar: true };
  if (['/recuperar-senha', '/redefinir-senha', '/confirmar-email', '/aceitar-convite'].includes(caminho)) {
    return { titulo: 'Acesso | CODECA Build', indexar: false };
  }
  return { titulo: 'Página não encontrada | CODECA Build', indexar: false };
}

export function RouteMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    const { titulo, indexar } = metaDe(pathname);
    document.title = titulo;

    let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.append(robots);
    }
    robots.content = indexar ? 'index, follow' : 'noindex, nofollow';
  }, [pathname]);

  return null;
}
