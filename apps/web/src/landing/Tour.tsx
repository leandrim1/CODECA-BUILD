import { useId, useState } from 'react';
import { cx } from '@codeca/ui';
import { BrowserFrame, PhoneFrame } from './Frames.js';
import { Reveal } from './Reveal.js';
import { Container, Eyebrow, SectionTitle } from './ui.js';
import visaoGeral from '../assets/landing/painel-visao-geral.webp';
import produtos from '../assets/landing/painel-produtos.webp';
import edicao from '../assets/landing/painel-edicao.webp';
import celular from '../assets/landing/painel-celular.webp';

/**
 * O painel por dentro: as quatro capturas reais, uma de cada vez.
 *
 * Cada aba descreve o que a captura mostra -- e so isso. Nada aqui apresenta
 * como real uma funcao que a interface nao tem.
 */
const TELAS = [
  {
    id: 'visao',
    aba: 'Visão geral',
    titulo: 'O estado do site, num só olhar',
    texto:
      'Menu lateral organizado pelos módulos do projeto, indicadores de conteúdo, situação do site, domínio e uso dos limites do plano.',
    imagem: visaoGeral,
    largura: 1920,
    altura: 1200,
    alt: 'Painel do CODECA Build na visão geral, com menu lateral por módulos, indicadores de conteúdo, situação do site e uso do limite de conteúdos do plano.',
  },
  {
    id: 'gestao',
    aba: 'Gestão de conteúdo',
    titulo: 'Cada tipo de conteúdo, na sua lista',
    texto:
      'Listas com busca e filtros, situação de publicação, imagem de capa e ações por item. Aqui, o catálogo de produtos de uma loja de demonstração; o mesmo vale para serviços, profissionais, imóveis, projetos e os módulos do seu projeto.',
    imagem: produtos,
    largura: 1920,
    altura: 1200,
    alt: 'Lista de produtos no painel, com miniatura, categoria, preço, situação de publicação e ações de editar e remover.',
  },
  {
    id: 'edicao',
    aba: 'Edição de informações',
    titulo: 'Formulários pensados para o conteúdo',
    texto:
      'Campos organizados por assunto. O que a CODECA IA bloqueia em um projeto aparece como leitura, com a explicação de por que está travado.',
    imagem: edicao,
    largura: 1920,
    altura: 1200,
    alt: 'Formulário de edição de um produto, com campos de identificação, resumo, descrição, preço e categoria.',
  },
  {
    id: 'celular',
    aba: 'No celular',
    titulo: 'O mesmo painel, no bolso',
    texto: 'A interface se adapta ao celular: o menu vira uma gaveta e os indicadores seguem em coluna única.',
    imagem: celular,
    largura: 780,
    altura: 1688,
    alt: 'Painel no celular, com indicadores de conteúdo em cartões empilhados.',
    celular: true,
  },
] as const;

export function Tour() {
  const [ativa, setAtiva] = useState<(typeof TELAS)[number]['id']>('visao');
  const base = useId();
  const tela = TELAS.find((t) => t.id === ativa) ?? TELAS[0];

  return (
    <section className="scroll-mt-20 bg-white py-20 sm:py-28" aria-labelledby="titulo-painel">
      <Container>
        <Reveal className="max-w-3xl">
          <Eyebrow>O painel por dentro</Eyebrow>
          <SectionTitle id="titulo-painel" className="mt-5">
            Uma interface clara para quem opera o dia a dia.
          </SectionTitle>
        </Reveal>

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] lg:gap-12">
          <div>
            <div
              role="tablist"
              aria-label="Telas do painel"
              className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:mx-0 lg:grid lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden"
            >
              {TELAS.map((item) => {
                const selecionada = item.id === ativa;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`${base}-aba-${item.id}`}
                    aria-selected={selecionada}
                    aria-controls={`${base}-painel`}
                    onClick={() => setAtiva(item.id)}
                    className={cx(
                      'flex-none whitespace-nowrap rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all duration-200',
                      selecionada
                        ? 'border-brand-200 bg-brand-50 text-brand-800 lg:shadow-card'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
                    )}
                  >
                    {item.aba}
                  </button>
                );
              })}
            </div>

            <div className="mt-8" aria-live="polite">
              <h3 className="text-2xl font-semibold tracking-tight text-slate-900">{tela.titulo}</h3>
              <p className="mt-3 leading-relaxed text-slate-600">{tela.texto}</p>
              <p className="mt-6 text-xs text-slate-500">Capturas da interface real, com dados de demonstração.</p>
            </div>
          </div>

          <div
            role="tabpanel"
            id={`${base}-painel`}
            aria-labelledby={`${base}-aba-${ativa}`}
            className="relative min-h-0"
          >
            {/*
              As quatro ficam no DOM, empilhadas na mesma celula da grade, e so a
              ativa aparece. Assim a area tem sempre a altura da maior e a troca
              de aba nao desloca o que esta embaixo.
            */}
            <div className="grid">
              {TELAS.map((item) => {
                const visivel = item.id === ativa;
                const imagem = (
                  <img
                    src={item.imagem}
                    width={item.largura}
                    height={item.altura}
                    alt={item.alt}
                    loading="lazy"
                    decoding="async"
                    className="block h-auto w-full"
                  />
                );
                return (
                  <div
                    key={item.id}
                    aria-hidden={!visivel}
                    className={cx(
                      'col-start-1 row-start-1 transition-opacity duration-300',
                      visivel ? 'opacity-100' : 'pointer-events-none opacity-0',
                    )}
                  >
                    {'celular' in item ? (
                      <div className="grid place-items-center rounded-3xl bg-gradient-to-b from-brand-50 to-slate-50 py-8 ring-1 ring-slate-200/70">
                        <PhoneFrame className="w-[11.5rem] sm:w-[13rem]">{imagem}</PhoneFrame>
                      </div>
                    ) : (
                      <BrowserFrame>{imagem}</BrowserFrame>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
