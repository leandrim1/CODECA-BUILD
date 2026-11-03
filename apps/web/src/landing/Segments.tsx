import { Reveal } from './Reveal.js';
import { Container } from './ui.js';

/**
 * A plataforma nao e de um ramo: a faixa logo abaixo da primeira dobra diz isso
 * antes de qualquer outra coisa.
 *
 * E uma lista de **exemplos** de quem usa, nao de quem "ja usa": nao ha numero
 * de clientes nem logos aqui, e nada disso sera inventado.
 */
const SEGMENTOS = [
  'Lojas e comércio',
  'Clínicas e consultórios',
  'Restaurantes e delivery',
  'Escolas e instituições de ensino',
  'Imobiliárias',
  'Construtoras',
  'Escritórios',
  'Prestadores de serviços',
  'Empresas de tecnologia',
  'Profissionais autônomos',
] as const;

export function Segments() {
  return (
    <section aria-labelledby="titulo-segmentos" className="border-y border-slate-200/70 bg-white py-12 sm:py-14">
      <Container>
        <Reveal className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] lg:items-center lg:gap-12">
          <h2
            id="titulo-segmentos"
            className="text-balance text-xl font-semibold leading-snug tracking-[-0.015em] text-slate-900 sm:text-2xl"
          >
            Uma plataforma para empresas de qualquer segmento.
          </h2>
          <ul className="flex flex-wrap gap-2.5" aria-label="Exemplos de segmentos atendidos">
            {SEGMENTOS.map((nome) => (
              <li
                key={nome}
                className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700"
              >
                {nome}
              </li>
            ))}
            <li className="rounded-full border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-500">
              e outros segmentos empresariais
            </li>
          </ul>
        </Reveal>
      </Container>
    </section>
  );
}
