import { Database, KeyRound, LayoutDashboard, ServerCog, UserCog, type LucideIcon } from 'lucide-react';
import { Reveal } from './Reveal.js';
import { Container, Eyebrow, SectionTitle } from './ui.js';

const ITENS: ReadonlyArray<{ icon: LucideIcon; titulo: string; texto: string }> = [
  {
    icon: Database,
    titulo: 'Separação de dados por empresa',
    texto: 'Usuários, conteúdos e configurações pertencem a uma organização e não se misturam com as demais.',
  },
  {
    icon: KeyRound,
    titulo: 'Controle de acesso por usuário',
    texto: 'Cada pessoa entra com a própria conta e enxerga apenas as empresas às quais foi vinculada.',
  },
  {
    icon: UserCog,
    titulo: 'Permissões por função',
    texto: 'Administrar, editar, publicar ou apenas consultar: o papel define o que cada usuário pode fazer.',
  },
  {
    icon: LayoutDashboard,
    titulo: 'Gestão centralizada',
    texto: 'Acessos, domínios, conteúdos e plano da empresa são administrados em um só lugar.',
  },
  {
    icon: ServerCog,
    titulo: 'Operações protegidas no backend',
    texto: 'As regras valem no servidor, em toda operação. Esconder um botão na tela nunca é a proteção.',
  },
];

const EMPRESAS = ['Empresa A', 'Empresa B', 'Empresa C'] as const;

export function Security() {
  return (
    <section className="scroll-mt-20 bg-white py-20 sm:py-28" aria-labelledby="titulo-seguranca">
      <Container className="grid gap-14 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:gap-20">
        <div>
          <Reveal>
            <Eyebrow>Segurança e organização</Eyebrow>
            <SectionTitle id="titulo-seguranca" className="mt-5">
              Uma estrutura. Empresas independentes. Dados protegidos.
            </SectionTitle>
            <div className="mt-7 grid gap-5 text-lg leading-relaxed text-slate-600">
              <p>
                O CODECA Build foi concebido para atender múltiplas empresas em uma única plataforma, mantendo
                usuários, conteúdos e configurações separados por organização.
              </p>
              <p>O acesso aos dados é controlado no servidor, com permissões e isolamento entre empresas.</p>
            </div>
          </Reveal>

          {/* Esquema: uma camada de acesso, tres organizacoes separadas. */}
          <Reveal delay={120} className="mt-10">
            <figure
              className="rounded-3xl border border-slate-200/80 bg-slate-50 p-5 sm:p-6"
              aria-label="Esquema: cada empresa tem seus próprios usuários, conteúdos e configurações, atrás de uma mesma camada de acesso no servidor."
            >
              <div className="flex items-center gap-3 rounded-xl bg-brand-800 px-4 py-3 text-sm font-medium text-white">
                <ServerCog aria-hidden="true" className="size-4 flex-none text-brand-300" />
                Camada de acesso no servidor: permissões e isolamento
              </div>
              <div aria-hidden="true" className="mx-auto h-4 w-px bg-brand-300" />
              <div className="grid gap-3 sm:grid-cols-3">
                {EMPRESAS.map((nome) => (
                  <div key={nome} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
                    <p className="text-sm font-semibold text-slate-900">{nome}</p>
                    <ul className="mt-2 grid gap-1 text-xs text-slate-500">
                      <li>Usuários</li>
                      <li>Conteúdos</li>
                      <li>Configurações</li>
                    </ul>
                  </div>
                ))}
              </div>
            </figure>
          </Reveal>
        </div>

        <ul className="grid content-start gap-3">
          {ITENS.map((item, indice) => (
            <Reveal as="li" key={item.titulo} delay={indice * 70}>
              <div className="flex gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-6">
                <span className="grid size-11 flex-none place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                  <item.icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
                </span>
                <div>
                  <h3 className="font-semibold tracking-tight text-slate-900">{item.titulo}</h3>
                  <p className="mt-1 text-[0.95rem] leading-relaxed text-slate-600">{item.texto}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </ul>
      </Container>
    </section>
  );
}
