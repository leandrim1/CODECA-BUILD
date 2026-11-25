import { ArrowRight } from 'lucide-react';
import { useDestino } from './Header.js';
import { Reveal } from './Reveal.js';
import { Container, LinkButton } from './ui.js';
import fundo3d from '../assets/landing/cta-fundo-3d.webp';

export function FinalCta() {
  const destino = useDestino();

  return (
    /*
      `bg-brand-900` continua embaixo de tudo: e a cor que aparece enquanto a
      imagem carrega e se ela falhar. Sem isso, o intervalo seria texto branco
      sobre fundo branco.
    */
    <section
      className="relative overflow-hidden bg-brand-900 py-24 text-white sm:py-32"
      aria-labelledby="titulo-final"
    >
      {/*
        A imagem 3D, com `cover` e centro: a secao e uma faixa larga e baixa, e
        a imagem e 16:9. `cover` preenche sem esticar -- o que sobra e cortado,
        nunca distorcido.

        No celular a faixa fica quase quadrada e o corte comeria o notebook, que
        mora a direita do centro; por isso o ponto de ancora anda para 68% ate
        `sm`. E a mesma imagem, so que enquadrada onde ela tem assunto.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[position:68%_center] bg-cover bg-no-repeat sm:bg-center"
        style={{ backgroundImage: `url(${fundo3d})` }}
      />
      <div aria-hidden="true" className="lp-cta-veu pointer-events-none absolute inset-0" />
      {/*
        Duas linhas finas acima e abaixo, no lugar do corte seco contra as
        secoes brancas vizinhas.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-brand-900/70 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-brand-900/70 to-transparent"
      />
      <Container className="relative">
        <Reveal className="mx-auto max-w-4xl text-center">
          <h2
            id="titulo-final"
            className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] [text-shadow:0_2px_18px_rgb(10_22_58_/_0.55)] sm:text-5xl lg:text-6xl"
          >
            Sua empresa merece uma presença digital à altura do seu negócio.
          </h2>
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-brand-100 [text-shadow:0_1px_12px_rgb(10_22_58_/_0.6)] sm:text-xl">
            Tenha um site desenvolvido sob medida e uma estrutura profissional para manter suas informações
            organizadas e atualizadas.
          </p>
          <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <LinkButton
              to={destino.cadastro}
              variant="light"
              className="h-14 px-8 text-base"
              icon={<ArrowRight aria-hidden="true" className="size-4" />}
            >
              Começar agora
            </LinkButton>
            <LinkButton to="#planos" variant="outline-light" className="h-14 px-8 text-base">
              Conhecer os planos
            </LinkButton>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
