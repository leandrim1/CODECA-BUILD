import { useEffect, useId, useRef, useState } from 'react';

/**
 * Desafio de bot (Cloudflare Turnstile) nos formularios publicos.
 *
 * Nao aparece quando a plataforma nao o configurou -- e o caso padrao. A
 * decisao de exigir ou nao mora no servidor; aqui so se monta o widget e se
 * devolve o token, que o servidor confere com a chave secreta. Um desafio
 * resolvido so aqui nao prova nada.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (alvo: string | HTMLElement, opcoes: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Carrega o roteiro do provedor uma vez por pagina, e nao por componente. */
let carregando: Promise<void> | null = null;
function carregarTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  carregando ??= new Promise<void>((resolver, recusar) => {
    const tag = document.createElement('script');
    tag.src = SCRIPT;
    tag.async = true;
    tag.defer = true;
    tag.onload = () => resolver();
    tag.onerror = () => {
      carregando = null;
      recusar(new Error('nao foi possivel carregar o desafio'));
    };
    document.head.append(tag);
  });
  return carregando;
}

export function DesafioDeBot({
  siteKey,
  onToken,
}: {
  /** Vazio quando o desafio esta desligado: o componente nao desenha nada. */
  siteKey: string;
  onToken: (token: string | null) => void;
}) {
  const id = useId().replace(/:/g, '');
  const caixa = useRef<HTMLDivElement>(null);
  const [falhou, setFalhou] = useState(false);
  // `onToken` numa referencia: sem isso, uma funcao nova a cada render do
  // formulario remontaria o widget e a pessoa resolveria o desafio duas vezes.
  const aviso = useRef(onToken);
  aviso.current = onToken;

  useEffect(() => {
    if (!siteKey || !caixa.current) return;
    let widget: string | null = null;
    let vivo = true;

    void carregarTurnstile()
      .then(() => {
        if (!vivo || !caixa.current || !window.turnstile) return;
        widget = window.turnstile.render(caixa.current, {
          sitekey: siteKey,
          language: 'pt-br',
          callback: (token: string) => aviso.current(token),
          // Token vencido ou desafio recusado: o formulario volta a nao ter
          // prova, e o botao desabilita de novo.
          'expired-callback': () => aviso.current(null),
          'error-callback': () => aviso.current(null),
        });
      })
      .catch(() => {
        if (vivo) setFalhou(true);
      });

    return () => {
      vivo = false;
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [siteKey]);

  if (!siteKey) return null;

  if (falhou) {
    return (
      <p className="text-sm text-amber-700">
        Não foi possível carregar a verificação de segurança. Verifique a conexão e recarregue a página.
      </p>
    );
  }

  return <div ref={caixa} id={id} className="min-h-[65px]" />;
}
