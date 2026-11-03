import { ArrowRight, Globe, LayoutDashboard, Server } from 'lucide-react';
import { Reveal } from './Reveal.js';
import { Container, Eyebrow, SectionTitle } from './ui.js';

const ETAPAS = [
  {
    numero: '01',
    titulo: 'Desenvolvimento personalizado',
    texto:
      'A CODECA IA desenvolve um site alinhado à identidade visual, aos objetivos e às necessidades da empresa.',
  },
  {
    numero: '02',
    titulo: 'Integração com o CODECA Build',
    texto:
      'O projeto é conectado à plataforma por meio da API e dos recursos de gestão configurados para aquele site.',
  },
  {
    numero: '03',
    titulo: 'Gestão e atualização',
    texto:
      'A empresa acessa seu painel, atualiza os conteúdos disponíveis e acompanha as informações do site com praticidade.',
  },
] as const;

/** O caminho de uma alteracao, do painel ate o site. */
const FLUXO = [
  {
    icon: LayoutDashboard,
    titulo: 'Painel da empresa',
    texto: 'Sua equipe edita e publica os conteúdos disponíveis.',
  },
  {
    icon: Server,
    titulo: 'CODECA Build',
    texto: 'Guarda o conteúdo, aplica módulos, campos e permissões e o expõe pela API.',
  },
  {
    icon: Globe,
    titulo: 'Site da empresa',
    texto: 'Desenvolvido pela CODECA IA, busca o conteúdo publicado pela API.',
  },
] as const;

export function HowItWorks() {
  return (
    <section
      id="como-funciona"
      className="relative scroll-mt-20 overflow-hidden bg-brand-900 py-20 text-white sm:py-28"
      aria-labelledby="titulo-como-funciona"
    >
      <div aria-hidden="true" className="lp-grid-dark pointer-events-none absolute inset-0" />

      <Container className="relative">
        <Reveal className="max-w-3xl">
          <Eyebrow tone="dark">Como funciona</Eyebrow>
          <SectionTitle id="titulo-como-funciona" tone="dark" className="mt-5">
            Da criação à gestão. Tudo conectado.
          </SectionTitle>
        </Reveal>

        <ol className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-8 sm:mt-16">
          {/* Fio que liga as tres etapas, so onde elas estao lado a lado. */}
          <span
            aria-hidden="true"
            className="absolute left-0 right-0 top-[1.65rem] hidden h-px bg-gradient-to-r from-brand-300/60 via-brand-300/30 to-transparent md:block"
          />
          {ETAPAS.map((etapa, indice) => (
            <Reveal as="li" key={etapa.numero} delay={indice * 120} className="relative">
              <span className="relative inline-flex h-[3.3rem] items-center bg-brand-900 pr-5 text-5xl font-semibold leading-none tracking-tight text-brand-300 tabular-nums">
                {etapa.numero}
              </span>
              <h3 className="mt-5 text-xl font-semibold tracking-tight">{etapa.titulo}</h3>
              <p className="mt-3 max-w-sm leading-relaxed text-brand-100/80">{etapa.texto}</p>
            </Reveal>
          ))}
        </ol>

        <Reveal className="mt-16 sm:mt-20">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">
            O caminho de uma alteração
          </p>
          <ol className="grid gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur-sm md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch md:gap-0 md:p-4">
            {FLUXO.flatMap((no, indice) => {
              const cartao = (
                <li
                  key={no.titulo}
                  className="rounded-2xl bg-brand-800/60 p-6 ring-1 ring-inset ring-white/10 md:p-7"
                >
                  <span className="grid size-11 place-items-center rounded-xl bg-white/10 text-white ring-1 ring-white/15">
                    <no.icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{no.titulo}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-brand-100/80">{no.texto}</p>
                </li>
              );
              if (indice === FLUXO.length - 1) return [cartao];
              return [
                cartao,
                <li
                  key={`seta-${no.titulo}`}
                  aria-hidden="true"
                  className="grid place-items-center py-1 text-brand-300 md:px-4 md:py-0"
                >
                  <ArrowRight className="size-5 rotate-90 md:rotate-0" />
                </li>,
              ];
            })}
          </ol>
          <p className="mt-5 text-sm text-brand-100/70">
            Sem novo deploy: o que a empresa publica no painel é o que o site passa a exibir.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
