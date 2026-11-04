import type { CSSProperties } from 'react';
import {
  Blocks,
  Check,
  Globe,
  Inbox,
  Lock,
  PencilLine,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { cx } from '@codeca/ui';
import './auth-showcase.css';

/**
 * Apresentacao das telas de acesso (entrar, criar conta, recuperar senha).
 *
 * E so apresentacao: nada aqui le sessao, formulario ou rota. O formulario fica
 * na outra metade do `AuthLayout`.
 *
 * - Desktop: painel cheio ao lado do formulario, com a composicao visual.
 * - Telas baixas: a composicao so aparece a partir de ~880 px de altura, e abaixo
 *   de ~780 px as descricoes dos cartoes tambem saem, para o painel caber sem rolar.
 * - Tablet e celular: vira um bloco compacto DEPOIS do formulario -- sem
 *   decoracao, com os recursos em cartoes curtos -- para nao empurrar o login.
 *
 * Tudo e CSS, SVG e Lucide: nenhuma imagem, nenhuma dependencia nova.
 */

interface Recurso {
  icon: LucideIcon;
  title: string;
  text: string;
}

/** O conteudo comercial da plataforma, um item por recurso. */
const RECURSOS: readonly Recurso[] = [
  {
    icon: PencilLine,
    title: 'Conteúdo editável',
    text: 'Atualize textos e informações sem precisar de um novo deploy.',
  },
  {
    icon: Blocks,
    title: 'Módulos personalizados',
    text: 'Ative funcionalidades de acordo com o segmento do seu negócio.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Campos exclusivos',
    text: 'Personalize informações e recursos para atender às necessidades da sua empresa.',
  },
  {
    icon: Inbox,
    title: 'Gestão de interessados',
    text: 'Receba e organize contatos diretamente no painel administrativo.',
  },
  {
    icon: Globe,
    title: 'Domínio próprio e HTTPS',
    text: 'Tenha sua identidade digital com domínio personalizado e conexão segura.',
  },
];

/** Atraso de entrada em escada. */
const atraso = (ms: number): CSSProperties => ({ ['--d' as string]: `${ms}ms` });

export function AuthShowcase() {
  return (
    <aside
      aria-label="Apresentação da plataforma"
      className={cx(
        'relative isolate overflow-hidden bg-[#0B1120] text-white',
        // No desktop o painel acompanha a altura da tela; se o conteudo for maior, rola por dentro.
        'lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto',
      )}
    >
      <Backdrop />

      <div className="relative mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 px-6 py-10 sm:px-10 lg:gap-5 lg:px-12 lg:py-8 xl:gap-6 xl:px-14">
        {/* ---- cabecalho */}
        <div className="as-in flex flex-wrap items-center gap-x-4 gap-y-2" style={atraso(0)}>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-emerald-300">
            <span aria-hidden="true" className="relative flex size-2">
              <span className="as-ping absolute inset-0 rounded-full bg-emerald-400" />
              <span className="relative size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.9)]" />
            </span>
            <span className="sr-only">Sistema </span>online
          </span>
          <span className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-brand-300">
            <CircuitGlyph />
            Plataforma para empresas
          </span>
        </div>

        {/* ---- titulo e subtitulo */}
        <div className="as-in" style={atraso(90)}>
          <h2 className="text-balance text-[1.9rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl lg:text-[2.2rem] xl:text-[2.7rem]">
            Seu negócio merece uma{' '}
            <span className="bg-gradient-to-r from-brand-300 via-brand-400 to-sky-300 bg-clip-text text-transparent">
              presença digital
            </span>{' '}
            à altura.
          </h2>
          <p className="mt-4 max-w-md text-[0.95rem] leading-relaxed text-slate-400 lg:text-base">
            Tenha seu próprio site profissional, com ferramentas inteligentes e controle total sobre seu conteúdo.
          </p>
        </div>

        {/* ---- composicao visual (so em tela grande e alta) */}
        <div
          className="as-in hidden lg:[@media(min-height:880px)]:block"
          style={atraso(180)}
          aria-hidden="true"
        >
          <PlatformScene />
        </div>

        {/* ---- recursos */}
        <ul className="grid grid-cols-2 gap-2.5 lg:gap-3">
          {RECURSOS.map((recurso, index) => (
            <li
              key={recurso.title}
              className={cx('as-in', index === RECURSOS.length - 1 && 'col-span-2')}
              style={atraso(260 + index * 70)}
            >
              <FeatureCard {...recurso} />
            </li>
          ))}
        </ul>

        {/* ---- seguranca */}
        <div
          className="as-in flex items-start gap-3 border-t border-white/10 pt-5 text-sm leading-snug text-slate-400"
          style={atraso(260 + RECURSOS.length * 70)}
        >
          <span
            aria-hidden="true"
            className="grid size-9 flex-none place-items-center rounded-full bg-brand-500/15 text-brand-300 ring-1 ring-brand-300/25 shadow-[0_0_18px_rgb(51_98_251/0.35)]"
          >
            <ShieldCheck className="size-[1.1rem]" />
          </span>
          <p className="pt-0.5">
            <span className="font-medium text-slate-200">Dados isolados.</span> Cada empresa possui seu próprio site,
            dados e usuários, isolados das demais.
          </p>
        </div>
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ pecas

function FeatureCard({ icon: Icon, title, text }: Recurso) {
  return (
    <div
      className={cx(
        'group h-full rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur-sm',
        'transition duration-300 ease-out',
        'hover:-translate-y-0.5 hover:border-brand-400/40 hover:bg-white/[0.08] hover:shadow-[0_10px_30px_-12px_rgb(51_98_251/0.55)]',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cx(
            'grid size-9 flex-none place-items-center rounded-lg text-brand-300',
            'bg-gradient-to-br from-brand-500/30 to-brand-400/5 ring-1 ring-brand-300/20',
            'transition duration-300 group-hover:text-white group-hover:ring-brand-300/50',
          )}
        >
          <Icon className="size-[1.05rem]" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[0.82rem] font-semibold leading-tight text-white sm:text-sm">{title}</h3>
          {/* No celular so o titulo: os cartoes ficam curtos e a tela nao vira uma rolagem. */}
          <p className="mt-1 hidden text-xs leading-relaxed text-slate-400 sm:block lg:[@media(max-height:780px)]:hidden">
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Luz ambiente, malha e um brilho na borda do painel. */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="as-glow absolute -right-32 -top-40 size-[34rem] rounded-full bg-brand-600/30 blur-3xl" />
      <div
        className="as-glow absolute -bottom-40 -left-32 size-[30rem] rounded-full bg-indigo-600/25 blur-3xl"
        style={{ animationDelay: '-4s' }}
      />
      <div className="absolute left-1/2 top-1/3 size-72 -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
      <div className="as-grid absolute inset-0" />
      <div className="absolute inset-y-0 left-0 hidden w-px bg-gradient-to-b from-transparent via-brand-400/30 to-transparent lg:block" />
    </div>
  );
}

/** Pequeno glifo de circuito ao lado do rotulo: so um traco de tecnologia. */
function CircuitGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 12" className="h-3 w-7 flex-none text-brand-400" fill="none">
      <path d="M0 6h7l3-4h6l3 4h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="2" r="1.2" fill="currentColor" />
      <circle cx="19" cy="6" r="1.2" fill="currentColor" />
    </svg>
  );
}

/**
 * Cena abstrata de uma plataforma digital: uma janela de site, cartoes de
 * interface flutuando e linhas de conexao. Nenhum dado real, nenhum numero --
 * so a ideia de "site + painel + contatos + seguranca" ligados.
 */
function PlatformScene() {
  return (
    <div className="as-stage relative mx-auto h-[12.5rem] w-full max-w-[32rem]">
      {/* linhas de conexao e pontos luminosos */}
      <svg viewBox="0 0 512 200" className="absolute inset-0 size-full" fill="none">
        <defs>
          <linearGradient id="as-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="rgb(89 140 255)" stopOpacity="0.15" />
            <stop offset="0.5" stopColor="rgb(142 181 255)" stopOpacity="0.9" />
            <stop offset="1" stopColor="rgb(89 140 255)" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        {/* da janela do site para cada cartao: o ponto fica na borda, nunca em cima do conteudo */}
        <path className="as-dash" d="M287 66 C 304 66, 300 28, 317 28" stroke="url(#as-line)" strokeWidth="1.3" />
        <path
          className="as-dash"
          d="M287 118 C 296 118, 288 172, 299 172"
          stroke="url(#as-line)"
          strokeWidth="1.3"
          style={{ animationDelay: '-1.4s' }}
        />
        {[
          [287, 66],
          [287, 118],
          [317, 28],
          [299, 172],
        ].map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="6" fill="rgb(51 98 251)" opacity="0.28" />
            <circle cx={x} cy={y} r="2.4" fill="rgb(190 211 255)" />
          </g>
        ))}
      </svg>

      {/* janela do site (principal, inclinada) */}
      <div className="as-float absolute left-0 top-3 w-[56%]" style={{ ['--dur' as string]: '8s' }}>
        <div className="as-tilt overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-b from-white/[0.10] to-white/[0.03] shadow-[0_30px_60px_-20px_rgb(2_6_23/0.9),0_0_0_1px_rgb(255_255_255/0.03)_inset] backdrop-blur">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <span className="flex gap-1">
              <span className="size-1.5 rounded-full bg-white/25" />
              <span className="size-1.5 rounded-full bg-white/25" />
              <span className="size-1.5 rounded-full bg-white/25" />
            </span>
            <span className="mx-auto inline-flex items-center gap-1 rounded-md bg-white/[0.07] px-2 py-0.5 text-[0.6rem] font-medium text-slate-300">
              <Lock className="size-2.5 text-emerald-300" />
              seusite.com.br
            </span>
          </div>
          <div className="grid gap-2 p-3">
            <div className="h-10 rounded-lg bg-gradient-to-br from-brand-500/60 via-brand-400/30 to-sky-300/20 ring-1 ring-white/10" />
            <div className="h-1.5 w-3/4 rounded-full bg-white/25" />
            <div className="h-1.5 w-1/2 rounded-full bg-white/15" />
            <div className="mt-0.5 grid grid-cols-3 gap-1.5">
              <div className="h-6 rounded-md bg-white/[0.07] ring-1 ring-white/10" />
              <div className="h-6 rounded-md bg-white/[0.07] ring-1 ring-white/10" />
              <div className="h-6 rounded-md bg-white/[0.07] ring-1 ring-white/10" />
            </div>
          </div>
        </div>
      </div>

      {/* cartao: conteudo atualizado */}
      <div className="as-float absolute right-0 top-0 w-[38%]" style={{ ['--dur' as string]: '6.4s', ['--d' as string]: '-1.2s' }}>
        <div className="flex items-center gap-2.5 rounded-xl border border-white/15 bg-slate-900/60 p-2.5 shadow-[0_18px_40px_-16px_rgb(2_6_23/0.9)] backdrop-blur-md">
          <span className="grid size-7 flex-none place-items-center rounded-lg bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/25">
            <Check className="size-3.5" />
          </span>
          <div className="min-w-0">
            <div className="text-[0.68rem] font-semibold leading-tight text-white">Conteúdo atualizado</div>
            <div className="mt-1 h-1 w-14 rounded-full bg-white/20" />
          </div>
        </div>
      </div>

      {/* cartao: novo interessado */}
      <div className="as-float absolute bottom-0 right-2 w-[40%]" style={{ ['--dur' as string]: '7.4s', ['--d' as string]: '-3s' }}>
        <div className="flex items-center gap-2.5 rounded-xl border border-white/15 bg-slate-900/60 p-2.5 shadow-[0_18px_40px_-16px_rgb(2_6_23/0.9)] backdrop-blur-md">
          <span className="grid size-7 flex-none place-items-center rounded-lg bg-brand-500/25 text-brand-200 ring-1 ring-brand-300/25">
            <Inbox className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.68rem] font-semibold leading-tight text-white">Novo interessado</span>
              <span className="rounded-full bg-brand-500/30 px-1.5 py-px text-[0.52rem] font-semibold uppercase tracking-wide text-brand-200">
                novo
              </span>
            </div>
            <div className="mt-1 h-1 w-16 rounded-full bg-white/20" />
          </div>
        </div>
      </div>

      {/* selo: conexao segura */}
      <div className="as-float absolute bottom-1 left-[22%]" style={{ ['--dur' as string]: '6.8s', ['--d' as string]: '-2s' }}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-[0.62rem] font-semibold text-emerald-200 shadow-[0_0_20px_rgb(52_211_153/0.18)] backdrop-blur">
          <Lock className="size-3" />
          HTTPS ativo
        </span>
      </div>
    </div>
  );
}
