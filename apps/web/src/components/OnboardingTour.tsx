import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { Button, cx } from '@codeca/ui';
import { PASSOS_DO_TOUR, type PassoDoTour } from '../lib/tourDoPainel.js';
import { useConsultaDeMidia } from '../hooks/useConsultaDeMidia.js';

/**
 * Tour de boas-vindas.
 *
 * Feito a mao, e nao com driver.js ou react-joyride. A conta: a biblioteca
 * resolveria o POSICIONAMENTO, e so. O balao teria de ser repintado com os
 * tokens do tema de qualquer forma -- sobrescrevendo as classes de um
 * terceiro, que e a pior especie de acoplamento -- e nenhuma das duas entrega
 * a folha inferior que o celular pede. Sobrariam as ~90 linhas de geometria
 * abaixo, agora com uma dependencia a mais no pacote.
 *
 * O destaque e um RECORTE por quatro retangulos (acima, abaixo, esquerda,
 * direita do alvo), e nao uma mascara SVG: quatro divs com o veu do tema
 * funcionam em qualquer navegador e seguem o `--color-scrim`, que ja e escuro
 * nos dois temas.
 *
 * Nada bloqueia o painel: Esc pula, o veu nao fecha por engano (so o botao
 * fecha), e pular grava o mesmo marco que concluir -- o tour nao volta sozinho.
 */

interface Caixa {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Folga entre o recorte e o elemento, para o destaque nao encostar nele. */
const FOLGA = 8;
/** Distancia entre o balao e o recorte. */
const RESPIRO = 12;
const LARGURA_DO_BALAO = 340;

export function OnboardingTour({ aoEncerrar }: { aoEncerrar: () => void }) {
  const [indice, setIndice] = useState(0);
  const [alvo, setAlvo] = useState<Caixa | null>(null);
  const baloRef = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  const textoId = useId();
  const ehCelular = useConsultaDeMidia('(max-width: 639px)');

  const passo: PassoDoTour | undefined = PASSOS_DO_TOUR[indice];
  const ultimo = indice === PASSOS_DO_TOUR.length - 1;

  const avancar = useCallback(() => {
    setIndice((i) => (i >= PASSOS_DO_TOUR.length - 1 ? i : i + 1));
  }, []);
  const voltar = useCallback(() => setIndice((i) => Math.max(0, i - 1)), []);

  /**
   * Mede o alvo deste passo.
   *
   * No celular a barra lateral e uma gaveta fechada: o elemento existe mas
   * esta fora da tela. Medir e destacar algo que a pessoa nao ve apontaria
   * para o nada, entao ali o passo vira cartao central -- o texto continua
   * ensinando onde a coisa fica.
   */
  const medir = useCallback(() => {
    if (!passo?.alvo) return setAlvo(null);
    const el = document.querySelector<HTMLElement>(`[data-tour="${passo.alvo}"]`);
    if (!el) return setAlvo(null);
    const r = el.getBoundingClientRect();
    const dentroDaJanela = r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
    if (!dentroDaJanela) return setAlvo(null);
    return setAlvo({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [passo]);

  useLayoutEffect(() => {
    const el = passo?.alvo
      ? document.querySelector<HTMLElement>(`[data-tour="${passo.alvo}"]`)
      : null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // Depois da rolagem suave: medir antes devolveria a posicao antiga.
    const t = window.setTimeout(medir, 260);
    return () => window.clearTimeout(t);
  }, [medir, passo]);

  useEffect(() => {
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [medir]);

  // O foco entra no balao a cada passo: sem isso o teclado fica na tela de
  // tras, que o tour esta justamente cobrindo.
  useEffect(() => {
    baloRef.current?.focus();
  }, [indice]);

  // O fundo nao rola por baixo do tour.
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  const aoTeclar = (evento: React.KeyboardEvent) => {
    if (evento.key === 'Escape') return aoEncerrar();
    if (evento.key === 'ArrowRight') return ultimo ? aoEncerrar() : avancar();
    if (evento.key === 'ArrowLeft') return voltar();
    return undefined;
  };

  if (!passo) return null;

  const recortes: Caixa[] = alvo
    ? [
        { top: 0, left: 0, width: window.innerWidth, height: Math.max(0, alvo.top - FOLGA) },
        {
          top: alvo.top + alvo.height + FOLGA,
          left: 0,
          width: window.innerWidth,
          height: Math.max(0, window.innerHeight - (alvo.top + alvo.height + FOLGA)),
        },
        {
          top: Math.max(0, alvo.top - FOLGA),
          left: 0,
          width: Math.max(0, alvo.left - FOLGA),
          height: alvo.height + FOLGA * 2,
        },
        {
          top: Math.max(0, alvo.top - FOLGA),
          left: alvo.left + alvo.width + FOLGA,
          width: Math.max(0, window.innerWidth - (alvo.left + alvo.width + FOLGA)),
          height: alvo.height + FOLGA * 2,
        },
      ]
    : [{ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight }];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      aria-describedby={textoId}
      className="fixed inset-0 z-[60]"
      onKeyDown={aoTeclar}
    >
      {recortes.map((r, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="fixed bg-scrim/60"
          style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
        />
      ))}

      {alvo ? (
        <div
          aria-hidden="true"
          className="fixed rounded-2xl ring-2 ring-brand-400 transition-all duration-200 ease-[var(--ease-out-soft)]"
          style={{
            top: alvo.top - FOLGA,
            left: alvo.left - FOLGA,
            width: alvo.width + FOLGA * 2,
            height: alvo.height + FOLGA * 2,
          }}
        />
      ) : null}

      <div
        ref={baloRef}
        tabIndex={-1}
        className={cx(
          'fixed rounded-2xl border border-slate-200 bg-white p-5 shadow-overlay outline-none',
          // No celular e folha inferior, da largura da tela: um balao de 340px
          // posicionado ao lado de um elemento nao cabe em 360px.
          ehCelular ? 'inset-x-3 bottom-3' : 'w-[21.25rem]',
        )}
        style={ehCelular ? undefined : posicaoDoBalao(alvo, passo.lado)}
      >
        <div className="flex items-start justify-between gap-3">
          <p id={tituloId} className="text-base font-semibold tracking-tight text-slate-900">
            {passo.titulo}
          </p>
          <button
            type="button"
            onClick={aoEncerrar}
            aria-label="Pular tour"
            className="flex size-8 flex-none items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <p id={textoId} className="mt-1.5 text-sm leading-relaxed text-slate-600">
          {passo.texto}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p aria-live="polite" className="text-xs font-medium tabular-nums text-slate-600">
            {indice + 1} de {PASSOS_DO_TOUR.length}
          </p>
          <div className="flex items-center gap-2">
            {/*
              "Pular", e nao "Pular tour": com tres botoes no balao de 340px o
              rotulo de duas palavras quebrava em duas linhas e desalinhava a
              fileira. O nome completo fica no `aria-label`, para quem ouve.
            */}
            <Button variant="ghost" size="sm" onClick={aoEncerrar} aria-label="Pular tour">
              Pular
            </Button>
            {indice > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={voltar}
                icon={<ArrowLeft aria-hidden="true" className="size-4" />}
              >
                Voltar
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={ultimo ? aoEncerrar : avancar}
              icon={ultimo ? undefined : <ArrowRight aria-hidden="true" className="size-4" />}
            >
              {ultimo ? 'Concluir' : 'Próximo'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Onde o balao cabe.
 *
 * Tenta o lado pedido e vira quando nao couber -- um balao cortado pela
 * janela e pior do que um balao do outro lado. Sem alvo, vai ao centro.
 */
function posicaoDoBalao(alvo: Caixa | null, lado: PassoDoTour['lado']): React.CSSProperties {
  if (!alvo) {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }
  const alturaEstimada = 220;
  const cabeDireita = alvo.left + alvo.width + RESPIRO + LARGURA_DO_BALAO < window.innerWidth;
  const cabeBaixo = alvo.top + alvo.height + RESPIRO + alturaEstimada < window.innerHeight;

  const preso = (valor: number, maximo: number) => Math.max(12, Math.min(valor, maximo - 12));

  if (lado === 'direita' && cabeDireita) {
    return {
      left: alvo.left + alvo.width + RESPIRO,
      top: preso(alvo.top, window.innerHeight - alturaEstimada),
    };
  }
  if (lado === 'baixo' && cabeBaixo) {
    return {
      top: alvo.top + alvo.height + RESPIRO,
      left: preso(alvo.left, window.innerWidth - LARGURA_DO_BALAO),
    };
  }
  // Nao coube do lado pedido: tenta abaixo, depois acima.
  if (cabeBaixo) {
    return {
      top: alvo.top + alvo.height + RESPIRO,
      left: preso(alvo.left, window.innerWidth - LARGURA_DO_BALAO),
    };
  }
  return {
    top: Math.max(12, alvo.top - RESPIRO - alturaEstimada),
    left: preso(alvo.left, window.innerWidth - LARGURA_DO_BALAO),
  };
}
