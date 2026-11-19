import { useCallback, useEffect, useRef, useState } from 'react';
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
 * A sombra e DESCARTADA assim que a sessao traz um valor novo. Isso nao e
 * detalhe: o hook e usado em mais de um lugar (a visao geral e o menu de
 * ajuda), e cada um tem a sua copia do estado. Sem o descarte, a visao geral
 * guardava "dispensei" na sombra dela, o menu gravava o desfazer no servidor,
 * e a visao geral continuava preferindo a propria sombra -- o "Ver primeiros
 * passos" nao trazia o cartao de volta. Medido em navegador.
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

  /**
   * Chegou valor novo do servidor: a sombra cumpriu o papel dela e sai.
   *
   * `user.onboarding` so troca de identidade quando o conteudo muda de
   * verdade (`replaceEqualDeep` no `useAuth`), entao isto nao dispara a cada
   * desenho.
   */
  const marcosVistos = useRef(user?.onboarding);
  useEffect(() => {
    if (marcosVistos.current === user?.onboarding) return;
    marcosVistos.current = user?.onboarding;
    setSombra({});
  }, [user?.onboarding]);

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
