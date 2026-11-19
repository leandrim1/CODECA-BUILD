import { useCallback, useState } from 'react';

/**
 * Lembra se a barra do painel mestre ficou recolhida (so icones).
 *
 * Sem preferencia guardada o padrao depende da tela: no tablet a barra nasce
 * recolhida, no computador nasce aberta. Uma barra de 288px sobre 1024px come
 * quase um terco da largura util, e a primeira impressao de quem abre o painel
 * num tablet seria a de um conteudo espremido -- mas forcar o mesmo no
 * computador seria esconder os rotulos de quem tem espaco de sobra.
 *
 * A escolha da pessoa, uma vez feita, vale em qualquer largura: quem recolheu
 * no computador quer recolhido.
 */
const CHAVE = 'codeca:plataforma-menu-recolhido';

/** Abaixo do `lg:` do Tailwind -- a faixa de tablet. */
const TELA_ESTREITA = '(max-width: 1023px)';

function lerPreferencia(): boolean {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (bruto === '1') return true;
    if (bruto === '0') return false;
    return window.matchMedia(TELA_ESTREITA).matches;
  } catch {
    // Navegacao privada pode bloquear o armazenamento, e `matchMedia` nao
    // existe em todo ambiente de teste: aberta e o padrao seguro.
    return false;
  }
}

export interface MenuRecolhido {
  recolhido: boolean;
  alternar: () => void;
}

export function useMenuRecolhido(): MenuRecolhido {
  const [recolhido, setRecolhido] = useState(lerPreferencia);

  const alternar = useCallback(() => {
    setRecolhido((atual) => {
      const proximo = !atual;
      try {
        window.localStorage.setItem(CHAVE, proximo ? '1' : '0');
      } catch {
        // Sem armazenamento a escolha vale so nesta aba.
      }
      return proximo;
    });
  }, []);

  return { recolhido, alternar };
}
