import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Tema claro, escuro ou o do sistema.
 *
 * Nao e `next-themes`: este projeto e Vite + React Router, nao Next.js. Nao ha
 * servidor renderizando HTML, entao tambem nao ha `suppressHydrationWarning` a
 * fazer -- o que evita o flash e o roteiro inline do `index.html`, que escreve
 * a classe antes da primeira pintura, antes mesmo do React existir.
 *
 * O tema vale SO no painel do cliente. A pagina publica foi desenhada em claro
 * e o painel mestre ja e escuro; aplicar a classe fora de `/painel` quebraria
 * os dois. Por isso a classe entra e sai conforme a rota.
 */

export type PreferenciaDeTema = 'sistema' | 'claro' | 'escuro';
export type TemaEfetivo = 'claro' | 'escuro';

/** A mesma chave que o roteiro do `index.html` le. Mudar aqui exige mudar la. */
export const CHAVE_DO_TEMA = 'codeca:tema';

/** O mesmo prefixo que o roteiro do `index.html` testa. */
export const PREFIXO_DO_PAINEL = '/painel';

interface TemaContextValue {
  /** O que a pessoa escolheu. */
  preferencia: PreferenciaDeTema;
  /** O que esta valendo na tela agora. */
  efetivo: TemaEfetivo;
  /** Verdadeiro quando a rota atual aceita tema escuro. */
  disponivel: boolean;
  definir: (preferencia: PreferenciaDeTema) => void;
}

const TemaContext = createContext<TemaContextValue | null>(null);

function ehPreferencia(valor: unknown): valor is PreferenciaDeTema {
  return valor === 'sistema' || valor === 'claro' || valor === 'escuro';
}

function lerPreferencia(): PreferenciaDeTema {
  try {
    const guardado = window.localStorage.getItem(CHAVE_DO_TEMA);
    return ehPreferencia(guardado) ? guardado : 'sistema';
  } catch {
    // Navegacao privada pode bloquear o armazenamento; seguimos em memoria.
    return 'sistema';
  }
}

function sistemaPrefereEscuro(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [preferencia, setPreferencia] = useState<PreferenciaDeTema>(lerPreferencia);
  const [sistemaEscuro, setSistemaEscuro] = useState(sistemaPrefereEscuro);

  const disponivel = pathname.startsWith(PREFIXO_DO_PAINEL);
  const escolhido: TemaEfetivo =
    preferencia === 'sistema' ? (sistemaEscuro ? 'escuro' : 'claro') : preferencia;
  const efetivo: TemaEfetivo = disponivel ? escolhido : 'claro';

  // Acompanha o sistema enquanto a preferencia for "sistema". O ouvinte fica
  // sempre montado: se a pessoa trocar o tema do sistema com a aba aberta, a
  // tela precisa acompanhar sem recarregar.
  useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return undefined;
    }
    const aoMudar = (evento: MediaQueryListEvent) => setSistemaEscuro(evento.matches);
    media.addEventListener('change', aoMudar);
    return () => media.removeEventListener('change', aoMudar);
  }, []);

  // A classe no <html> e o que a folha de estilo le. Sai ao deixar o painel.
  useEffect(() => {
    const raiz = document.documentElement;
    raiz.classList.toggle('dark', efetivo === 'escuro');
    raiz.style.colorScheme = efetivo === 'escuro' ? 'dark' : 'light';
  }, [efetivo]);

  const definir = useCallback((proxima: PreferenciaDeTema) => {
    setPreferencia(proxima);
    try {
      window.localStorage.setItem(CHAVE_DO_TEMA, proxima);
    } catch {
      // Sem armazenamento a escolha vale so para esta aba. Melhor que falhar.
    }
  }, []);

  const valor = useMemo<TemaContextValue>(
    () => ({ preferencia, efetivo, disponivel, definir }),
    [preferencia, efetivo, disponivel, definir],
  );

  return <TemaContext.Provider value={valor}>{children}</TemaContext.Provider>;
}

export function useTheme(): TemaContextValue {
  const valor = useContext(TemaContext);
  if (!valor) throw new Error('useTheme precisa estar dentro de ThemeProvider.');
  return valor;
}
