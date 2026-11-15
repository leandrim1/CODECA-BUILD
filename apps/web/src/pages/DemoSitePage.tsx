import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Mail, MapPin, Phone, RefreshCw } from 'lucide-react';
import { ApiError } from '../services/api.js';
import { demoApi } from '../services/endpoints.js';

/**
 * Site de demonstracao.
 *
 * Pagina publica, sem sessao: e o "site" de quem esta avaliando a plataforma.
 * Tudo o que aparece aqui vem da API publica -- a mesma que um site real usa --
 * e nada e inventado pelo navegador: se o painel nao tem o conteudo, a secao
 * simplesmente nao aparece.
 *
 * A faixa no topo diz o que isto e. Um visitante que caia aqui nao pode
 * confundir uma demonstracao com o site de uma empresa de verdade.
 */

type Registro = Record<string, unknown>;

interface Conteudo {
  nome: string;
  institucional: Registro;
  contato: Registro;
  banners: Registro[];
  servicos: Registro[];
  depoimentos: Registro[];
  equipe: Registro[];
  perguntas: Registro[];
}

type Estado =
  | { fase: 'carregando' }
  | { fase: 'pronto'; conteudo: Conteudo; lidoEm: Date }
  | { fase: 'encerrada' }
  | { fase: 'avaliacao_vencida' }
  | { fase: 'erro' };

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : '');
const lista = (valor: unknown): Registro[] => {
  const itens = (valor as { items?: unknown } | null)?.items;
  return Array.isArray(itens) ? (itens as Registro[]) : [];
};

/** Secao opcional: modulo desligado responde erro, e a pagina segue sem ela. */
async function opcional<T>(leitura: Promise<T>, vazio: T): Promise<T> {
  try {
    return await leitura;
  } catch (erro) {
    if (erro instanceof ApiError && (erro.status === 402 || erro.status === 404)) throw erro;
    return vazio;
  }
}

async function carregar(siteId: string): Promise<Conteudo> {
  // A identidade vem primeiro: e ela que diz se a demonstracao existe e se a
  // avaliacao ainda vale. As secoes vem depois, cada uma por conta propria.
  const identidade = await demoApi.read<{ site: { name: string } }>(siteId, 'site');
  const vazio = { items: [] as Registro[] };
  const semDados = { data: {} as Registro };

  const [institucional, contato, banners, servicos, depoimentos, equipe, perguntas] = await Promise.all([
    opcional(demoApi.read<{ data: Registro }>(siteId, 'content/institucional'), semDados),
    opcional(demoApi.read<{ data: Registro }>(siteId, 'content/contato'), semDados),
    opcional(demoApi.read<unknown>(siteId, 'banners'), vazio),
    opcional(demoApi.read<unknown>(siteId, 'services'), vazio),
    opcional(demoApi.read<unknown>(siteId, 'testimonials'), vazio),
    opcional(demoApi.read<unknown>(siteId, 'team'), vazio),
    opcional(demoApi.read<unknown>(siteId, 'faqs'), vazio),
  ]);

  return {
    nome: texto(institucional.data?.companyName) || identidade.site.name,
    institucional: institucional.data ?? {},
    contato: contato.data ?? {},
    banners: lista(banners),
    servicos: lista(servicos),
    depoimentos: lista(depoimentos),
    equipe: lista(equipe),
    perguntas: lista(perguntas),
  };
}

export function DemoSitePage() {
  const { siteId = '' } = useParams();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [atualizando, setAtualizando] = useState(false);

  const ler = useCallback(async () => {
    setAtualizando(true);
    try {
      const conteudo = await carregar(siteId);
      setEstado({ fase: 'pronto', conteudo, lidoEm: new Date() });
    } catch (erro) {
      if (erro instanceof ApiError && erro.status === 402) setEstado({ fase: 'avaliacao_vencida' });
      else if (erro instanceof ApiError && erro.status === 404) setEstado({ fase: 'encerrada' });
      else setEstado({ fase: 'erro' });
    } finally {
      setAtualizando(false);
    }
  }, [siteId]);

  useEffect(() => {
    document.title = 'Site de demonstração · CODECA Build';
    void ler();
  }, [ler]);

  // Quem volta para esta aba depois de editar no painel ve a mudanca sem
  // precisar procurar o botao.
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void ler();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [ler]);

  return (
    <div className="min-h-screen bg-white text-slate-800">
      <div className="border-b border-amber-200 bg-amber-50 text-amber-900">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-sm">
          <p>
            <strong>Site de demonstração.</strong> Criado pela CODECA Build para você experimentar o
            painel. Não é o site de uma empresa real.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void ler()}
              disabled={atualizando}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium hover:bg-amber-100 disabled:opacity-60"
            >
              <RefreshCw aria-hidden="true" className={`size-3.5 ${atualizando ? 'animate-spin' : ''}`} />
              {atualizando ? 'Atualizando…' : 'Atualizar'}
            </button>
            <Link to="/painel" className="inline-flex items-center gap-1.5 font-medium underline">
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              Voltar ao painel
            </Link>
          </div>
        </div>
      </div>

      {estado.fase === 'carregando' ? (
        <Aviso titulo="Carregando o site…" />
      ) : estado.fase === 'avaliacao_vencida' ? (
        <Aviso titulo="O período de avaliação terminou">
          O conteúdo cadastrado continua salvo. Para o site voltar a aparecer, contrate um plano em{' '}
          <Link to="/painel/plano" className="font-medium text-brand-700 underline">
            Plano e assinatura
          </Link>
          .
        </Aviso>
      ) : estado.fase === 'encerrada' ? (
        <Aviso titulo="Esta demonstração não está disponível">
          O endereço pode estar incorreto, ou a demonstração foi encerrada porque o site real já
          foi conectado.
        </Aviso>
      ) : estado.fase === 'erro' ? (
        <Aviso titulo="Não foi possível carregar o site agora">
          Tente de novo em instantes, pelo botão “Atualizar” acima.
        </Aviso>
      ) : (
        <Site conteudo={estado.conteudo} lidoEm={estado.lidoEm} />
      )}
    </div>
  );
}

function Aviso({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-xl font-semibold text-slate-900">{titulo}</h1>
      {children ? <p className="mt-3 text-sm text-slate-600">{children}</p> : null}
    </div>
  );
}

function Site({ conteudo, lidoEm }: { conteudo: Conteudo; lidoEm: Date }) {
  const destaque = conteudo.banners[0];
  const apresentacao = texto(conteudo.institucional.shortDescription);
  const contato = conteudo.contato;
  const endereco = [texto(contato.addressLine), texto(contato.city), texto(contato.state)]
    .filter(Boolean)
    .join(', ');
  const temContato = Boolean(texto(contato.email) || texto(contato.phone) || texto(contato.whatsapp) || endereco);

  return (
    <>
      <header className="border-b border-slate-100">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <span className="flex items-center gap-2.5 text-lg font-semibold text-slate-900">
            {/* Marca de demonstracao: a inicial da empresa, nao um logotipo inventado. */}
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-lg bg-brand-600 text-base font-bold text-white"
            >
              {conteudo.nome.charAt(0).toUpperCase() || 'S'}
            </span>
            {conteudo.nome}
          </span>
          <nav aria-label="Seções" className="hidden gap-5 text-sm text-slate-600 sm:flex">
            {conteudo.servicos.length > 0 ? <a href="#servicos">Serviços</a> : null}
            {apresentacao ? <a href="#sobre">Sobre</a> : null}
            {temContato ? <a href="#contato">Contato</a> : null}
          </nav>
        </div>
      </header>

      <section className="bg-gradient-to-br from-brand-700 to-brand-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <h1 className="max-w-2xl text-3xl font-bold leading-tight sm:text-5xl">
            {texto(destaque?.title) || conteudo.nome}
          </h1>
          {texto(destaque?.subtitle) ? (
            <p className="mt-4 max-w-xl text-base text-white/85 sm:text-lg">{texto(destaque?.subtitle)}</p>
          ) : null}
          {texto(destaque?.buttonLabel) ? (
            <a
              href={texto(destaque?.buttonUrl).startsWith('#') ? texto(destaque?.buttonUrl) : '#contato'}
              className="mt-8 inline-block rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-800"
            >
              {texto(destaque?.buttonLabel)}
            </a>
          ) : null}
        </div>
      </section>

      {conteudo.servicos.length > 0 ? (
        <Secao id="servicos" titulo="Serviços">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {conteudo.servicos.map((servico, indice) => (
              <article key={texto(servico.id) || indice} className="rounded-xl border border-slate-200 p-5">
                <h3 className="font-semibold text-slate-900">{texto(servico.title)}</h3>
                {texto(servico.summary) ? (
                  <p className="mt-2 text-sm text-slate-600">{texto(servico.summary)}</p>
                ) : null}
                {Array.isArray(servico.highlights) && servico.highlights.length > 0 ? (
                  <ul className="mt-3 grid gap-1 text-sm text-slate-600">
                    {(servico.highlights as unknown[]).map((item, i) => (
                      <li key={i}>• {texto(item)}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </Secao>
      ) : null}

      {apresentacao ? (
        <Secao id="sobre" titulo={`Sobre ${conteudo.nome}`} fundo>
          <p className="max-w-3xl whitespace-pre-line text-slate-700">{apresentacao}</p>
        </Secao>
      ) : null}

      {conteudo.depoimentos.length > 0 ? (
        <Secao id="depoimentos" titulo="Depoimentos">
          <div className="grid gap-4 sm:grid-cols-2">
            {conteudo.depoimentos.map((item, indice) => (
              <blockquote key={texto(item.id) || indice} className="rounded-xl border border-slate-200 p-5">
                <p className="text-slate-700">“{texto(item.content)}”</p>
                <footer className="mt-3 text-sm font-medium text-slate-900">{texto(item.authorName)}</footer>
              </blockquote>
            ))}
          </div>
        </Secao>
      ) : null}

      {conteudo.equipe.length > 0 ? (
        <Secao id="equipe" titulo="Equipe" fundo>
          <ul className="grid gap-3 sm:grid-cols-3">
            {conteudo.equipe.map((pessoa, indice) => (
              <li key={texto(pessoa.id) || indice} className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="font-medium text-slate-900">{texto(pessoa.name)}</p>
                <p className="text-sm text-slate-600">{texto(pessoa.role)}</p>
              </li>
            ))}
          </ul>
        </Secao>
      ) : null}

      {conteudo.perguntas.length > 0 ? (
        <Secao id="perguntas" titulo="Perguntas frequentes">
          <dl className="grid max-w-3xl gap-4">
            {conteudo.perguntas.map((item, indice) => (
              <div key={texto(item.id) || indice}>
                <dt className="font-medium text-slate-900">{texto(item.question)}</dt>
                <dd className="mt-1 text-sm text-slate-600">{texto(item.answer)}</dd>
              </div>
            ))}
          </dl>
        </Secao>
      ) : null}

      {temContato ? (
        <Secao id="contato" titulo="Contato" fundo>
          <ul className="grid gap-2 text-slate-700">
            {texto(contato.phone) || texto(contato.whatsapp) ? (
              <li className="flex items-center gap-2">
                <Phone aria-hidden="true" className="size-4 text-brand-700" />
                {texto(contato.phone) || texto(contato.whatsapp)}
              </li>
            ) : null}
            {texto(contato.email) ? (
              <li className="flex items-center gap-2">
                <Mail aria-hidden="true" className="size-4 text-brand-700" />
                {texto(contato.email)}
              </li>
            ) : null}
            {endereco ? (
              <li className="flex items-center gap-2">
                <MapPin aria-hidden="true" className="size-4 text-brand-700" />
                {endereco}
              </li>
            ) : null}
          </ul>
        </Secao>
      ) : null}

      <footer className="border-t border-slate-100">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-slate-500">
          Conteúdo lido às {lidoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Uma
          alteração feita no painel aparece aqui em poucos segundos: use “Atualizar”, no topo.
        </div>
      </footer>
    </>
  );
}

function Secao({
  id,
  titulo,
  fundo = false,
  children,
}: {
  id: string;
  titulo: string;
  fundo?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={fundo ? 'bg-slate-50' : ''}>
      <div className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="mb-6 text-2xl font-semibold text-slate-900">{titulo}</h2>
        {children}
      </div>
    </section>
  );
}
