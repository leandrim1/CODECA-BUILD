import { useState } from 'react';
import { Check } from 'lucide-react';
import { DEFAULT_SEGMENTS, type ModuleKey } from '@codeca/shared';
import { cx } from '@codeca/ui';
import { Reveal } from './Reveal.js';
import { Container, Eyebrow, SectionTitle } from './ui.js';
import fundo3d from '../assets/landing/diferencial-fundo-3d.webp';

/**
 * Rotulos com acento: os do sistema vem sem, e esta e uma pagina de venda.
 * Os conjuntos de modulos, esses sim, vem do catalogo real de segmentos.
 */
const NOME_DO_MODULO: Partial<Record<ModuleKey, string>> = {
  institucional: 'Institucional',
  contato: 'Contato',
  banners: 'Banners',
  imoveis: 'Imóveis',
  obras: 'Obras e projetos',
  servicos: 'Serviços',
  produtos: 'Produtos',
  categorias: 'Categorias',
  galerias: 'Galerias',
  depoimentos: 'Depoimentos',
  equipe: 'Equipe',
  faq: 'Perguntas frequentes',
};

const SEGMENTOS = [
  { codigo: 'varejo', nome: 'Loja' },
  { codigo: 'clinica', nome: 'Clínica' },
  { codigo: 'restaurante', nome: 'Restaurante' },
  { codigo: 'escola', nome: 'Instituição de ensino' },
  { codigo: 'prestador', nome: 'Prestador de serviços' },
  { codigo: 'imobiliaria', nome: 'Imobiliária' },
  { codigo: 'construtora', nome: 'Construtora' },
] as const;

function modulosDe(codigo: string): string[] {
  const segmento = DEFAULT_SEGMENTS.find((s) => s.code === codigo);
  return (segmento?.defaultModules ?? []).map((chave) => NOME_DO_MODULO[chave] ?? chave);
}

export function Differential() {
  const [codigo, setCodigo] = useState<(typeof SEGMENTOS)[number]['codigo']>('varejo');
  const modulos = modulosDe(codigo);
  const nome = SEGMENTOS.find((s) => s.codigo === codigo)?.nome ?? '';

  return (
    <section className="relative overflow-hidden bg-brand-900 py-20 text-white sm:py-28" aria-labelledby="titulo-diferencial">
      {/*
        Cenario 3D no lugar da cor chapada. `cover` e centro: a imagem preenche
        a faixa sem esticar, e o que sobra e cortado.

        Ate `lg` o enquadramento anda para 62%, onde esta o monitor: empilhada,
        a secao fica estreita e alta, e o centro cairia no vazio azul da
        esquerda.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[position:62%_center] bg-cover bg-no-repeat lg:bg-center"
        style={{ backgroundImage: `url(${fundo3d})` }}
      />
      <div aria-hidden="true" className="lp-dif-veu pointer-events-none absolute inset-0" />
      {/* A grade continua, agora discreta: so o suficiente para a imagem nao virar foto solta. */}
      <div aria-hidden="true" className="lp-grid-dark pointer-events-none absolute inset-0 opacity-40" />
      <Container className="relative grid gap-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center lg:gap-20">
        <Reveal>
          <Eyebrow tone="dark">Diferencial</Eyebrow>
          <SectionTitle id="titulo-diferencial" tone="dark" className="mt-5">
            Cada empresa tem uma operação diferente. Sua plataforma também deve ter.
          </SectionTitle>
          <div className="mt-7 grid gap-5 text-lg leading-relaxed text-brand-100/85">
            <p>
              O CODECA Build não obriga sua empresa a se adaptar a um modelo pronto. A estrutura de conteúdo é
              configurada de acordo com o site desenvolvido pela CODECA IA.
            </p>
            <p>
              Uma imobiliária pode gerenciar imóveis. Uma loja pode organizar produtos. Uma construtora pode
              apresentar obras e projetos. Uma instituição pode administrar turmas, profissionais e informações
              institucionais.
            </p>
            <p className="font-medium text-white">A plataforma acompanha a estrutura de cada projeto.</p>
          </div>
        </Reveal>

        <Reveal delay={140}>
          {/*
            O vidro ficou mais presente: antes era `bg-white/[0.05]` sobre uma
            cor chapada, onde 5% ja bastava. Sobre a imagem, esse vidro
            desaparecia e o monitor 3D atravessava o cartao, disputando com o
            menu de modulos. A tinta escura e o desfoque maior devolvem a
            hierarquia -- o cartao e o assunto, a imagem e o ambiente.
          */}
          <div className="lp-dif-cartao rounded-3xl border border-white/15 p-5 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)] backdrop-blur-md sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">
              Estrutura inicial do painel, por segmento
            </p>
            <div role="group" aria-label="Segmento" className="mt-4 flex flex-wrap gap-2">
              {SEGMENTOS.map((s) => (
                <button
                  key={s.codigo}
                  type="button"
                  aria-pressed={s.codigo === codigo}
                  onClick={() => setCodigo(s.codigo)}
                  className={cx(
                    'rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200',
                    s.codigo === codigo
                      ? 'border-white bg-white text-brand-800'
                      : 'border-white/25 text-white hover:border-white/60 hover:bg-white/10',
                  )}
                >
                  {s.nome}
                </button>
              ))}
            </div>

            <div className="mt-5 rounded-2xl bg-white p-4 text-slate-800 shadow-raised sm:p-5">
              <p className="px-2 pb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Menu do painel · {nome}
              </p>
              <ul className="grid gap-0.5 sm:grid-cols-2" aria-live="polite">
                {modulos.map((modulo, i) => (
                  <li
                    key={`${codigo}-${modulo}`}
                    className={cx(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm',
                      i === 0 ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600',
                    )}
                  >
                    <Check aria-hidden="true" className="size-3.5 flex-none text-brand-600" />
                    {modulo}
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-brand-100/75">
              É o ponto de partida de cada segmento. Os módulos e campos finais de cada projeto são definidos e
              mantidos pela CODECA IA: o cliente gerencia o conteúdo, não monta o site.
            </p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
