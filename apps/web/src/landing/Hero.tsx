import { ArrowRight, Check } from 'lucide-react';
import { useDestino } from './Header.js';
import { BrowserFrame, PhoneFrame } from './Frames.js';
import { Container, LinkButton } from './ui.js';
import painelVisaoGeral from '../assets/landing/painel-visao-geral.webp';
import painelCelular from '../assets/landing/painel-celular.webp';

const FUNDAMENTOS = [
  'Atualizações sem novo deploy',
  'Integração com o site por API',
  'Dados separados por empresa',
] as const;

export function Hero() {
  const destino = useDestino();

  return (
    <section className="relative overflow-x-clip pb-20 pt-10 sm:pb-24 sm:pt-16 lg:pb-28 lg:pt-20" aria-labelledby="titulo-principal">
      <div aria-hidden="true" className="lp-grid pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-40 size-[44rem] rounded-full bg-brand-100/60 blur-3xl"
      />

      <Container className="relative grid items-center gap-14 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-8">
        <div>
          <p className="flex items-center gap-3 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-brand-700 sm:text-xs">
            <span aria-hidden="true" className="h-px w-8 flex-none bg-brand-600" />
            Tecnologia e gestão digital • CODECA IA
          </p>

          <h1
            id="titulo-principal"
            className="mt-6 text-balance text-[2.6rem] font-semibold leading-[1.03] tracking-[-0.035em] text-slate-900 sm:text-6xl lg:text-[2.3rem] min-[1150px]:text-[2.55rem] xl:text-[3rem]"
          >
            Seu site.
            <br />
            Sua identidade.
            <br />
            <span className="text-brand-700">Sua empresa no controle.</span>
          </h1>

          <p className="mt-7 max-w-xl text-lg leading-relaxed text-slate-600 sm:text-xl sm:leading-relaxed">
            Sites empresariais desenvolvidos sob medida, conectados a uma plataforma inteligente de gestão de
            conteúdo. Sua empresa mantém informações, imagens e operações digitais atualizadas com autonomia e
            organização.
          </p>

          <p className="mt-6 max-w-xl border-l-2 border-brand-200 pl-4 text-base leading-relaxed text-slate-500">
            A CODECA IA desenvolve a experiência digital. O CODECA Build oferece a estrutura para gerenciar o
            conteúdo que faz sua empresa acontecer.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <LinkButton to="#plataforma" icon={<ArrowRight aria-hidden="true" className="size-4" />}>
              Conhecer a plataforma
            </LinkButton>
            <LinkButton to={destino.logado ? destino.painel : '/criar-conta'} variant="outline">
              {destino.logado ? 'Ir para o painel' : 'Criar minha conta'}
            </LinkButton>
          </div>

          <ul className="mt-9 grid gap-2.5 text-sm text-slate-600 sm:flex sm:flex-wrap sm:gap-x-6">
            {FUNDAMENTOS.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <Check aria-hidden="true" className="size-4 flex-none text-brand-600" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* A interface real, em composicao: o painel no computador e no celular. */}
        <figure className="relative lg:-mr-20 xl:-mr-40">
          <BrowserFrame label="Painel · Visão geral">
            <img
              src={painelVisaoGeral}
              width={1920}
              height={1200}
              alt="Visão geral do painel do CODECA Build, com menu lateral por módulos, indicadores de conteúdo, situação do site e uso do limite de conteúdos do plano."
              className="block h-auto w-full"
              // A imagem principal da pagina: nao espera, nao carrega em segundo plano.
              fetchPriority="high"
              decoding="async"
            />
          </BrowserFrame>
          <PhoneFrame className="absolute -bottom-8 left-3 w-[26%] min-w-[5.5rem] max-w-[11.5rem] sm:-bottom-10 sm:-left-6">
            <img
              src={painelCelular}
              width={780}
              height={1688}
              alt="O mesmo painel no celular, com cartões de indicadores em coluna única."
              className="block h-auto w-full"
              decoding="async"
            />
          </PhoneFrame>
          <figcaption className="mt-5 pl-[30%] text-xs text-slate-500 sm:pl-[26%]">
            Interface real do painel, com dados de demonstração.
          </figcaption>
        </figure>
      </Container>
    </section>
  );
}
