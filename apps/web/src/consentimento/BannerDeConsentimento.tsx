import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Cookie } from 'lucide-react';
import { Button } from '@codeca/ui';
import { useConsentimento } from './ConsentimentoProvider.js';

/** Endereços das políticas. Absolutos: o card também aparece em tela cheia. */
const POLITICA_DE_COOKIES = 'https://codecabuild.vercel.app/cookies';
const POLITICA_DE_PRIVACIDADE = 'https://codecabuild.vercel.app/privacidade';

/**
 * As paginas que o banner nao pode cobrir.
 *
 * Um card flutuante em cima do texto que explica o card e uma piada de mau
 * gosto: quem clicou em "saiba mais" quer LER. O banner volta na proxima tela.
 */
const ROTAS_SEM_BANNER = ['/cookies', '/privacidade', '/termos'];

/**
 * O aviso de cookies do painel.
 *
 * So aparece quando ha o que perguntar -- ver `FERRAMENTAS_OPCIONAIS`. Nao
 * pisca em quem ja decidiu, porque a decisao e lida de forma sincrona na
 * montagem do provedor, antes do primeiro quadro.
 *
 * "Aceitar todos" e "Recusar nao essenciais" tem o MESMO peso visual, de
 * proposito: o aviso em que recusar custa mais do que aceitar nao e
 * consentimento livre, e a ANPD ja disse isso.
 */
export function BannerDeConsentimento() {
  const { precisaDecidir, aceitarTodos, recusarOpcionais, abrirPreferencias, preferenciasAbertas } =
    useConsentimento();
  const { pathname } = useLocation();
  const cartao = useRef<HTMLDivElement>(null);

  const escondido = ROTAS_SEM_BANNER.some((rota) => pathname.startsWith(rota));
  const visivel = precisaDecidir && !escondido && !preferenciasAbertas;

  /*
    Esc recusa o que e opcional, e nao apenas fecha.

    Fechar sem decidir deixaria o banner voltando a cada navegacao -- e, pior,
    deixaria a pessoa sem saber o que ficou valendo. Esc aqui significa "nao
    quero isso agora", que e exatamente recusar o opcional.
  */
  useEffect(() => {
    if (!visivel) return undefined;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') recusarOpcionais();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [visivel, recusarOpcionais]);

  // O foco vai para o cartao ao aparecer: quem navega por teclado ou leitor de
  // tela encontra a pergunta, em vez de tropecar nela no fim da pagina.
  useEffect(() => {
    if (visivel) cartao.current?.focus();
  }, [visivel]);

  if (!visivel) return null;

  return (
    <div
      ref={cartao}
      role="dialog"
      aria-modal="false"
      aria-labelledby="consentimento-titulo"
      aria-describedby="consentimento-texto"
      tabIndex={-1}
      className={[
        // Canto inferior esquerdo no desktop; largura inteira no celular.
        'fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:left-4 sm:bottom-4 sm:w-[27rem]',
        'grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-overlay',
        'focus:outline-2 focus:outline-offset-2 focus:outline-brand-600',
      ].join(' ')}
    >
      <div className="flex items-start gap-2.5">
        <Cookie aria-hidden="true" className="mt-0.5 size-5 flex-none text-brand-600" />
        <h2 id="consentimento-titulo" className="text-sm font-semibold text-slate-900">
          Controle sua privacidade
        </h2>
      </div>

      <p id="consentimento-texto" className="text-sm leading-relaxed text-slate-600">
        O painel usa cookies necessários para manter você conectado com segurança. Os opcionais só são
        carregados se você autorizar.{' '}
        <a
          href={POLITICA_DE_COOKIES}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
        >
          Política de Cookies
        </a>{' '}
        ·{' '}
        <a
          href={POLITICA_DE_PRIVACIDADE}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
        >
          Política de Privacidade
        </a>
      </p>

      {/*
        Os dois primeiros botoes sao irmaos: mesma variante, mesmo tamanho,
        mesma largura. Trocar um por um link discreto seria desenhar a recusa
        para nao ser clicada.
      */}
      {/*
        `whitespace-nowrap`: o botao tem altura fixa, entao um rotulo que
        quebra em duas linhas aperta o texto dentro da pilula. No celular eles
        ja ficam um por linha -- a grade so vira duas colunas a partir de
        640px, onde o cartao tem 27rem e os dois rotulos cabem inteiros.
      */}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button className="whitespace-nowrap px-3" onClick={aceitarTodos}>
          Aceitar todos
        </Button>
        <Button className="whitespace-nowrap px-3" onClick={recusarOpcionais}>
          Recusar não essenciais
        </Button>
      </div>
      <Button variant="ghost" size="sm" className="justify-self-start" onClick={abrirPreferencias}>
        Personalizar
      </Button>
    </div>
  );
}
