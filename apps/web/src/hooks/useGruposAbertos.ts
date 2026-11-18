import { useCallback, useState } from 'react';

/**
 * Lembra quais grupos do menu ficaram abertos.
 *
 * Guarda a lista dos FECHADOS, nao dos abertos. A diferenca importa quando um
 * grupo novo aparece numa versao seguinte: guardando os abertos, ele nasceria
 * fechado para quem ja usava o painel e passaria despercebido; guardando os
 * fechados, ele nasce aberto, que e o padrao.
 *
 * O armazenamento pode lancar em navegacao privada: ai a preferencia vale so
 * para a aba, o que e melhor do que a barra deixar de funcionar.
 */

const CHAVE = 'codeca:menu-grupos-fechados';

function lerFechados(): Set<string> {
  try {
    const bruto = window.localStorage.getItem(CHAVE);
    if (!bruto) return new Set();
    const lista: unknown = JSON.parse(bruto);
    // Conteudo de localStorage e entrada externa: outra aba, outra versao, ou
    // alguem editando a mao. Sem esta conferencia, um valor estranho derrubaria
    // a barra inteira na montagem.
    return Array.isArray(lista) ? new Set(lista.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export interface GruposAbertos {
  /** `false` apenas para os que a pessoa fechou. */
  estaAberto: (id: string) => boolean;
  alternar: (id: string) => void;
  /**
   * Abre sem alternar.
   *
   * Serve a navegacao: ir para uma tela de dentro de um grupo fechado tem de
   * revelar onde a pessoa esta. Alternar faria o contrario em metade dos casos.
   */
  abrir: (id: string) => void;
}

export function useGruposAbertos(): GruposAbertos {
  const [fechados, setFechados] = useState<Set<string>>(lerFechados);

  const guardar = (proximo: Set<string>) => {
    try {
      window.localStorage.setItem(CHAVE, JSON.stringify([...proximo]));
    } catch {
      // Sem armazenamento a escolha vale so nesta aba.
    }
    return proximo;
  };

  const alternar = useCallback((id: string) => {
    setFechados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return guardar(proximo);
    });
  }, []);

  const abrir = useCallback((id: string) => {
    setFechados((atual) => {
      if (!atual.has(id)) return atual; // ja aberto: nao redesenha a barra
      const proximo = new Set(atual);
      proximo.delete(id);
      return guardar(proximo);
    });
  }, []);

  const estaAberto = useCallback((id: string) => !fechados.has(id), [fechados]);

  return { estaAberto, alternar, abrir };
}
