import {
  Boxes,
  FolderOpen,
  Globe,
  Inbox,
  PenLine,
  Send,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cx } from '@codeca/ui';
import { Reveal } from './Reveal.js';
import { Container, Eyebrow, SectionTitle } from './ui.js';
import imoveis from '../assets/landing/painel-imoveis.webp';

interface Recurso {
  icon: LucideIcon;
  titulo: string;
  texto: string;
}

const GESTAO: Recurso = {
  icon: PenLine,
  titulo: 'Gestão de conteúdo',
  texto:
    'Atualize textos, informações institucionais, imagens e conteúdos do site em um ambiente centralizado.',
};

const MODULOS: Recurso = {
  icon: Boxes,
  titulo: 'Módulos personalizados',
  texto:
    'Gerencie imóveis, produtos, serviços, projetos, profissionais, turmas, galerias e outros conteúdos conforme o projeto.',
};

const DEMAIS: readonly Recurso[] = [
  {
    icon: SlidersHorizontal,
    titulo: 'Campos personalizados',
    texto: 'Cada módulo pode contar com campos específicos para representar as informações do seu negócio.',
  },
  {
    icon: Globe,
    titulo: 'Domínio empresarial',
    texto:
      'Conecte o domínio da sua empresa e acompanhe as configurações e a verificação pelo painel, conforme os recursos do plano.',
  },
  {
    icon: Inbox,
    titulo: 'Gestão de interessados',
    texto:
      'Organize contatos recebidos pelo site, com informações sobre o assunto e o item de interesse.',
  },
  {
    icon: Users,
    titulo: 'Equipe e permissões',
    texto:
      'Gerencie os acessos dos colaboradores, definindo quem pode administrar, editar, publicar ou consultar informações.',
  },
  {
    icon: FolderOpen,
    titulo: 'Biblioteca de arquivos',
    texto:
      'Organize imagens e arquivos utilizados nos conteúdos do site, respeitando os limites do plano.',
  },
  {
    icon: Send,
    titulo: 'Gestão de publicação',
    texto: 'Organize conteúdos em estados como rascunho e publicado, conforme os recursos habilitados.',
  },
];

/** Exemplos de modulo, so para dar forma ao texto: quem define os do projeto e a CODECA IA. */
const EXEMPLOS = ['Imóveis', 'Produtos', 'Serviços', 'Projetos', 'Profissionais', 'Turmas', 'Galerias'] as const;

function Icone({ icon: Icon, destaque }: { icon: LucideIcon; destaque?: boolean }) {
  return (
    <span
      className={cx(
        'grid size-11 place-items-center rounded-xl ring-1',
        destaque ? 'bg-white/10 text-white ring-white/20' : 'bg-brand-50 text-brand-700 ring-brand-100',
      )}
    >
      <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
    </span>
  );
}

export function Features() {
  return (
    <section id="recursos" className="scroll-mt-20 border-t border-slate-200/70 bg-slate-50 py-20 sm:py-28" aria-labelledby="titulo-recursos">
      <Container>
        <Reveal className="max-w-3xl">
          <Eyebrow>Recursos da plataforma</Eyebrow>
          <SectionTitle id="titulo-recursos" className="mt-5">
            Tudo o que sua operação digital precisa para evoluir.
          </SectionTitle>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
            Uma estrutura flexível, com recursos configurados de acordo com a realidade de cada empresa.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-12 lg:gap-5">
          {/* Dois destaques: o que a plataforma faz de mais central. */}
          <Reveal className="sm:col-span-2 lg:col-span-7">
            <article className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-7 shadow-card sm:p-9">
              <Icone icon={GESTAO.icon} />
              <h3 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900">{GESTAO.titulo}</h3>
              <p className="mt-3 max-w-md leading-relaxed text-slate-600">{GESTAO.texto}</p>
              <div className="relative mt-8 h-56 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50 [mask-image:linear-gradient(to_bottom,#000_60%,transparent)] sm:ml-8 sm:h-60">
                <img
                  src={imoveis}
                  width={1920}
                  height={1200}
                  alt="Lista de conteúdo no painel, com miniaturas, situação de publicação e ações por item."
                  loading="lazy"
                  decoding="async"
                  className="block h-auto w-full min-w-[34rem] object-top"
                />
              </div>
            </article>
          </Reveal>

          <Reveal delay={100} className="sm:col-span-2 lg:col-span-5">
            <article className="relative flex h-full flex-col overflow-hidden rounded-3xl bg-brand-800 p-7 text-white shadow-raised sm:p-9">
              <div aria-hidden="true" className="lp-grid-dark pointer-events-none absolute inset-0 opacity-70" />
              <div className="relative flex h-full flex-col">
                <Icone icon={MODULOS.icon} destaque />
                <h3 className="mt-6 text-2xl font-semibold tracking-tight">{MODULOS.titulo}</h3>
                <p className="mt-3 leading-relaxed text-brand-100/85">{MODULOS.texto}</p>
                <ul className="mt-auto flex flex-wrap gap-2 pt-8" aria-label="Exemplos de módulos">
                  {EXEMPLOS.map((nome) => (
                    <li
                      key={nome}
                      className="rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white"
                    >
                      {nome}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          </Reveal>

          {DEMAIS.map((recurso, indice) => (
            <Reveal key={recurso.titulo} delay={(indice % 3) * 90} className="lg:col-span-4">
              <article className="h-full rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card transition-all duration-300 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:shadow-raised sm:p-7">
                <Icone icon={recurso.icon} />
                <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">{recurso.titulo}</h3>
                <p className="mt-2.5 text-[0.95rem] leading-relaxed text-slate-600">{recurso.texto}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
