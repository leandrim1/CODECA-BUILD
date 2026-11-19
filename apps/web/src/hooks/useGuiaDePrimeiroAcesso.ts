import { useCallback, useState } from 'react';
import { useAuth } from './useAuth.js';
import { authApi } from '../services/endpoints.js';

/**
 * Os dois marcos do guia de primeiro acesso, e como desfaze-los.
 *
 * O estado verdadeiro vive no banco e chega pela sessao. Aqui ele ganha uma
 * sombra local porque a sessao so se atualiza depois da ida ao servidor: sem
 * ela, dispensar o checklist deixaria o cartao na tela ate a resposta chegar,
 * e a pessoa clicaria de novo achando que o botao falhou.
 *
 * A sombra some assim que a sessao volta com o valor gravado -- ela adianta a
 * resposta, nao substitui.
 */
export interface GuiaDePrimeiroAcesso {
  /** O tour nunca foi concluido nem pulado. */
  tourPendente: boolean;
  /** O checklist nao foi dispensado. */
  checklistVisivel: boolean;
  /** Pular tambem conclui: o tour nao volta sozinho. */
  encerrarTour: () => void;
  refazerTour: () => void;
  dispensarChecklist: () => void;
  reabrirChecklist: () => void;
}

export function useGuiaDePrimeiroAcesso(): GuiaDePrimeiroAcesso {
  const { user, refresh } = useAuth();
  const [sombra, setSombra] = useState<{ tour?: boolean; checklist?: boolean }>({});

  const gravar = useCallback(
    (corpo: { tourDone?: boolean; checklistDismissed?: boolean }) => {
      authApi
        .marcosDoGuia(corpo)
        .then(() => refresh())
        // Falha de rede nao pode prender a pessoa no tour: a sombra ja o
        // fechou, e a proxima visita o traz de volta -- que e melhor do que
        // um guia que nao fecha.
        .catch(() => undefined);
    },
    [refresh],
  );

  const encerrarTour = useCallback(() => {
    setSombra((s) => ({ ...s, tour: true }));
    gravar({ tourDone: true });
  }, [gravar]);

  const refazerTour = useCallback(() => {
    setSombra((s) => ({ ...s, tour: false }));
    gravar({ tourDone: false });
  }, [gravar]);

  const dispensarChecklist = useCallback(() => {
    setSombra((s) => ({ ...s, checklist: true }));
    gravar({ checklistDismissed: true });
  }, [gravar]);

  const reabrirChecklist = useCallback(() => {
    setSombra((s) => ({ ...s, checklist: false }));
    gravar({ checklistDismissed: false });
  }, [gravar]);

  // Sem sessao carregada nada aparece: um tour sobre uma tela que ainda nao
  // existe aponta para elementos que nao estao la.
  const marcos = user?.onboarding;
  const tourConcluido = sombra.tour ?? marcos?.tourDoneAt !== null;
  const checklistDispensado = sombra.checklist ?? marcos?.checklistDismissedAt !== null;

  return {
    tourPendente: Boolean(user) && !tourConcluido,
    checklistVisivel: Boolean(user) && !checklistDispensado,
    encerrarTour,
    refazerTour,
    dispensarChecklist,
    reabrirChecklist,
  };
}
