import { Link } from 'react-router-dom';
import {
  Building2,
  Check,
  Globe,
  HardHat,
  LayoutTemplate,
  MessageCircle,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { DEFAULT_PLANS, PLAN_FEATURE_LABELS, formatBytes } from '@codeca/shared';
import { Badge, Button, Card, CardBody } from '@codeca/ui';
import { useAuth } from '../hooks/useAuth.js';

/** Site institucional da plataforma. */

const RECURSOS = [
  {
    icon: LayoutTemplate,
    title: 'Editor visual por blocos',
    text: 'Monte as paginas arrastando secoes prontas. Sem codigo, com previa em desktop, tablet e celular.',
  },
  {
    icon: Building2,
    title: 'Imoveis a venda',
    text: 'Cadastre imoveis com fotos, valores, caracteristicas e pagina propria pronta para os buscadores.',
  },
  {
    icon: HardHat,
    title: 'Obras em andamento',
    text: 'Mostre a evolucao das obras por etapa, com fotos e datas informadas pela sua equipe.',
  },
  {
    icon: Globe,
    title: 'Dominio proprio com HTTPS',
    text: 'Conecte o dominio da construtora, siga as instrucoes de DNS e acompanhe a verificacao pelo painel.',
  },
  {
    icon: MessageCircle,
    title: 'Interessados organizados',
    text: 'Os contatos do site chegam no painel com assunto, imovel relacionado e historico de atendimento.',
  },
  {
    icon: Users,
    title: 'Equipe com papeis',
    text: 'Convide a equipe definindo quem administra, quem publica conteudo e quem apenas consulta.',
  },
];

export function LandingPage() {
  const { user, tenant } = useAuth();
  const destino = user ? (tenant ? '/painel' : '/plataforma') : '/criar-conta';

  return (
    <div className="bg-white">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3.5 sm:px-6">
          <Link to="/" className="inline-flex items-center gap-2 font-semibold text-slate-900">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
              <Building2 aria-hidden="true" className="size-4" />
            </span>
            Codeca Build
          </Link>
          <nav className="ml-auto flex items-center gap-2" aria-label="Acesso">
            {user ? (
              <Link to={destino}>
                <Button size="sm">Ir para o painel</Button>
              </Link>
            ) : (
              <>
                <Link to="/entrar">
                  <Button variant="ghost" size="sm">
                    Entrar
                  </Button>
                </Link>
                <Link to="/criar-conta">
                  <Button size="sm">Criar conta</Button>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-3xl">
            <Badge tone="brand">Plataforma para construtoras e incorporadoras</Badge>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              O site da sua construtora, com imoveis, obras e dominio proprio.
            </h1>
            <p className="mt-5 text-lg text-slate-600">
              Cada construtora tem o proprio site, a propria identidade visual e o proprio painel. Monte as
              paginas no editor visual, cadastre imoveis e obras, conecte seu dominio e receba os contatos
              direto no painel.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/criar-conta">
                <Button size="lg">Criar conta gratuita</Button>
              </Link>
              <Link to="/entrar">
                <Button size="lg" variant="outline">
                  Ja tenho conta
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">
              O plano de avaliacao permite montar e visualizar o site. Publicar em dominio proprio exige um
              plano com esse recurso.
            </p>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-slate-50 py-16" aria-labelledby="recursos">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="recursos" className="text-2xl font-semibold tracking-tight text-slate-900">
              O que esta incluido
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {RECURSOS.map((item) => (
                <Card key={item.title}>
                  <CardBody className="grid gap-2">
                    <span className="grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-700">
                      <item.icon aria-hidden="true" className="size-5" />
                    </span>
                    <h3 className="font-semibold text-slate-900">{item.title}</h3>
                    <p className="text-sm text-slate-600">{item.text}</p>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16" aria-labelledby="planos">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="planos" className="text-2xl font-semibold tracking-tight text-slate-900">
              Planos
            </h2>
            <p className="mt-2 max-w-2xl text-slate-600">
              Os limites valem por construtora e sao verificados no servidor. A contratacao e a troca de
              plano sao feitas com a equipe da plataforma.
            </p>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {DEFAULT_PLANS.map((plan) => (
                <Card key={plan.code} className={plan.code === 'essencial' ? 'ring-2 ring-brand-500' : ''}>
                  <CardBody className="grid gap-4">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
                        {plan.code === 'essencial' ? <Badge tone="brand">Mais escolhido</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{plan.description}</p>
                    </div>

                    <p className="text-3xl font-semibold tracking-tight text-slate-900">
                      {plan.priceCents === 0 ? (
                        'Gratuito'
                      ) : (
                        <>
                          R$ {(plan.priceCents / 100).toLocaleString('pt-BR')}
                          <span className="text-sm font-normal text-slate-500">/mes</span>
                        </>
                      )}
                    </p>

                    <ul className="grid gap-2 text-sm text-slate-600">
                      <li className="flex gap-2">
                        <Check aria-hidden="true" className="size-4 flex-none text-emerald-600" />
                        {plan.limits.maxPublishedProperties} imoveis publicados
                      </li>
                      <li className="flex gap-2">
                        <Check aria-hidden="true" className="size-4 flex-none text-emerald-600" />
                        {plan.limits.maxProjects} obras cadastradas
                      </li>
                      <li className="flex gap-2">
                        <Check aria-hidden="true" className="size-4 flex-none text-emerald-600" />
                        {plan.limits.maxUsers} usuarios
                      </li>
                      <li className="flex gap-2">
                        <Check aria-hidden="true" className="size-4 flex-none text-emerald-600" />
                        {formatBytes(plan.limits.storageBytes)} de armazenamento
                      </li>
                      <li className="flex gap-2">
                        <Check aria-hidden="true" className="size-4 flex-none text-emerald-600" />
                        {plan.limits.maxDomains === 0
                          ? 'Sem dominio proprio'
                          : `${plan.limits.maxDomains} dominio(s) proprio(s)`}
                      </li>
                      {plan.limits.features.slice(0, 4).map((feature) => (
                        <li key={feature} className="flex gap-2">
                          <Check aria-hidden="true" className="size-4 flex-none text-emerald-600" />
                          {PLAN_FEATURE_LABELS[feature]}
                        </li>
                      ))}
                    </ul>

                    <Link to="/criar-conta">
                      <Button variant={plan.code === 'essencial' ? 'primary' : 'outline'} className="w-full">
                        Comecar
                      </Button>
                    </Link>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-slate-200 bg-slate-900 py-16 text-white">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-semibold">
                <ShieldCheck aria-hidden="true" className="size-6 text-brand-300" />
                Dados de cada construtora separados dos demais
              </h2>
              <p className="mt-3 text-slate-300">
                Uma unica plataforma atende varias construtoras, mas cada empresa tem seus proprios usuarios,
                conteudos, dominio e painel. A separacao e garantida no banco de dados e conferida no servidor
                em toda operacao.
              </p>
            </div>
            <Link to="/criar-conta" className="lg:justify-self-end">
              <Button size="lg" variant="primary">
                Criar a conta da minha construtora
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 text-sm text-slate-500 sm:px-6">
          <p>Codeca Build - plataforma de sites para construtoras</p>
          <p>{new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}
