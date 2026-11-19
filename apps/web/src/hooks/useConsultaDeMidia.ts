import { useEffect, useState } from 'react';

/**
 * Acompanha uma media query em JavaScript.
 *
 * Quase toda resposta a largura de tela e melhor em CSS -- nao custa render e
 * nao erra na primeira pintura. Isto existe para os casos em que a largura
 * muda a **arvore**, e nao a aparencia: levar uma folha para fora da barra
 * lateral com um portal, trocar o rotulo de um item por `sr-only`, decidir se
 * a barra nasce recolhida. Nada disso se escreve em media query.
 *
 * O `matchMedia` vem protegido porque ambientes de teste sem DOM completo nao
 * o tem: sem o `try`, a ausencia derrubaria a tela inteira em vez de apenas
 * devolver `false`.
 */
export function useConsultaDeMidia(consulta: string): boolean {
  const [combina, setCombina] = useState(() => {
    try {
      return window.matchMedia(consulta).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia(consulta);
    } catch {
      return undefined;
    }
    // A tela pode ter mudado entre o primeiro estado e este efeito.
    setCombina(media.matches);
    const aoMudar = (evento: MediaQueryListEvent) => setCombina(evento.matches);
    media.addEventListener('change', aoMudar);
    return () => media.removeEventListener('change', aoMudar);
  }, [consulta]);

  return combina;
}
