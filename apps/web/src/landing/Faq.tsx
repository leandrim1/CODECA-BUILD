import { Plus } from 'lucide-react';
import { montarPerguntas } from './faq-content.js';
import { usePlanosPublicos } from './Pricing.js';
import { Reveal } from './Reveal.js';
import { Container, Eyebrow, SectionTitle } from './ui.js';

export function Faq() {
  const planos = usePlanosPublicos();
  const perguntas = montarPerguntas(planos.data?.plans ?? null);

  return (
    <section id="perguntas" className="scroll-mt-20 border-t border-slate-200/70 bg-white py-20 sm:py-28" aria-labelledby="titulo-perguntas">
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-20">
        <Reveal>
          <Eyebrow>Perguntas frequentes</Eyebrow>
          <SectionTitle id="titulo-perguntas" className="mt-5">
            O que costumam nos perguntar.
          </SectionTitle>
          <p className="mt-5 text-lg leading-relaxed text-slate-600">
            Respostas diretas sobre o funcionamento da plataforma e as condições dos planos.
          </p>
        </Reveal>

        <Reveal delay={100} className="lp-faq divide-y divide-slate-200 border-y border-slate-200">
          {perguntas.map((item) => (
            <details key={item.pergunta} className="group">
              <summary className="flex cursor-pointer items-start justify-between gap-6 py-6 text-left text-lg font-medium tracking-tight text-slate-900 transition-colors hover:text-brand-700 focus-visible:outline-brand-600">
                {item.pergunta}
                <Plus
                  aria-hidden="true"
                  className="lp-faq-sinal mt-1 size-5 flex-none text-brand-600 transition-transform duration-300"
                />
              </summary>
              <p className="max-w-2xl pb-7 pr-10 leading-relaxed text-slate-600">{item.resposta}</p>
            </details>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}
