import { ArrowRight } from 'lucide-react';
import { useDestino } from './Header.js';
import { Reveal } from './Reveal.js';
import { Container, LinkButton } from './ui.js';

export function FinalCta() {
  const destino = useDestino();

  return (
    <section className="relative overflow-hidden bg-brand-700 py-24 text-white sm:py-32" aria-labelledby="titulo-final">
      <div aria-hidden="true" className="lp-grid-dark pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-48 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-brand-500/40 blur-3xl"
      />
      <Container className="relative">
        <Reveal className="mx-auto max-w-4xl text-center">
          <h2
            id="titulo-final"
            className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl lg:text-6xl"
          >
            Sua empresa merece uma presença digital à altura do seu negócio.
          </h2>
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-brand-100 sm:text-xl">
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
