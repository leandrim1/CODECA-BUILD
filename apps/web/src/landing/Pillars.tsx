import { Layers, LayoutDashboard, PencilRuler } from 'lucide-react';
import { Reveal } from './Reveal.js';
import { Container, Eyebrow, SectionTitle } from './ui.js';

const PILARES = [
  {
    icon: PencilRuler,
    titulo: 'Desenvolvimento sob medida',
    texto:
      'A CODECA IA projeta e desenvolve o site a partir da identidade, dos objetivos e das necessidades da sua empresa. Sem modelo pronto, sem concessões de layout.',
  },
  {
    icon: LayoutDashboard,
    titulo: 'Gestão centralizada',
    texto:
      'Textos, imagens, produtos, serviços e contatos em um único painel, com usuários e permissões definidos por função.',
  },
  {
    icon: Layers,
    titulo: 'Estrutura preparada para crescer',
    texto:
      'Novos conteúdos, módulos e usuários entram conforme o negócio evolui e o plano contratado permite.',
  },
] as const;

export function Pillars() {
  return (
    <section id="plataforma" className="scroll-mt-20 border-y border-slate-200/70 bg-slate-50 py-20 sm:py-28" aria-labelledby="titulo-plataforma">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-20">
          <Reveal>
            <Eyebrow>A plataforma</Eyebrow>
            <SectionTitle id="titulo-plataforma" className="mt-5">
              Mais do que um site. Uma estrutura digital para sua empresa.
            </SectionTitle>
          </Reveal>
          <Reveal delay={120} className="grid gap-5 text-lg leading-relaxed text-slate-600">
            <p>
              Uma presença digital profissional precisa acompanhar a evolução do negócio. Produtos mudam,
              serviços crescem, equipes se renovam e novas oportunidades aparecem.
            </p>
            <p>
              Com o CODECA Build, seu site deixa de ser uma estrutura estática e passa a contar com uma
              plataforma de gestão preparada para acompanhar essas mudanças.
            </p>
          </Reveal>
        </div>

        <ol className="mt-14 grid gap-5 md:grid-cols-3 sm:mt-16">
          {PILARES.map((pilar, indice) => (
            <Reveal as="li" key={pilar.titulo} delay={indice * 100}>
              <article className="group relative h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-7 shadow-card transition-all duration-300 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:shadow-raised sm:p-8">
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-brand-600 transition-transform duration-500 group-hover:scale-x-100"
                />
                <div className="flex items-center justify-between">
                  <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                    <pilar.icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
                  </span>
                  <span aria-hidden="true" className="text-sm font-medium tabular-nums text-slate-300">
                    0{indice + 1}
                  </span>
                </div>
                <h3 className="mt-7 text-xl font-semibold tracking-tight text-slate-900">{pilar.titulo}</h3>
                <p className="mt-3 leading-relaxed text-slate-600">{pilar.texto}</p>
              </article>
            </Reveal>
          ))}
        </ol>
      </Container>
    </section>
  );
}
