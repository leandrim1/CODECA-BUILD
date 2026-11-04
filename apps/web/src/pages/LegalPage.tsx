import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LEGAL_VERSION, formatIsoDate } from '@codeca/shared';
import { Logo } from '../landing/ui.js';
import { EMPRESA } from '../legal/empresa.js';
import { PRIVACIDADE } from '../legal/privacidade.js';
import { TERMOS } from '../legal/termos.js';
import type { Bloco, Documento } from '../legal/types.js';

/**
 * Termos de uso e politica de privacidade.
 *
 * Esta pagina so **desenha**. O texto vive em `legal/termos.ts` e
 * `legal/privacidade.ts` -- a revisao juridica olha esses dois arquivos -- e os
 * dados da empresa em `legal/empresa.ts`. A versao exibida (`LEGAL_VERSION`) e a
 * mesma gravada no aceite do cadastro (`users.terms_version`).
 */

type Tipo = 'termos' | 'privacidade';

const DOCUMENTOS: Record<Tipo, Documento> = { termos: TERMOS, privacidade: PRIVACIDADE };
const OUTRO: Record<Tipo, { to: string; rotulo: string }> = {
  termos: { to: '/privacidade', rotulo: 'Política de privacidade' },
  privacidade: { to: '/termos', rotulo: 'Termos de uso' },
};

export function LegalPage({ tipo }: { tipo: Tipo }) {
  const documento = DOCUMENTOS[tipo];
  const outro = OUTRO[tipo];

  return (
    <div className="landing min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-[4.25rem] max-w-3xl items-center justify-between px-5">
          <Link to="/" aria-label="CODECA Build, página inicial">
            <Logo />
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
            <ArrowLeft aria-hidden="true" className="size-4" />
            Voltar
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 [overflow-wrap:anywhere] sm:py-20">
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.03em] text-slate-900">{documento.titulo}</h1>
        <p className="mt-3 leading-relaxed text-slate-600">{documento.resumo}</p>
        <p className="mt-2 text-sm text-slate-500">
          Versão de <time dateTime={LEGAL_VERSION}>{formatIsoDate(LEGAL_VERSION, 'long')}</time>
        </p>

        <nav aria-label="Sumário" className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Nesta página</p>
          <ol className="mt-3 grid gap-1.5 text-[0.95rem] sm:grid-cols-2">
            {documento.secoes.map((secao) => (
              <li key={secao.id}>
                <a href={`#${secao.id}`} className="text-slate-600 hover:text-brand-700 hover:underline">
                  {secao.titulo}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-10">
          {documento.secoes.map((secao) => (
            <section key={secao.id} id={secao.id} className="scroll-mt-6">
              <h2 className="text-xl font-semibold text-slate-900">{secao.titulo}</h2>
              <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
                {secao.blocos.map((bloco, index) => (
                  <BlocoView key={index} bloco={bloco} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-14 border-t border-slate-200 pt-6 text-sm text-slate-500">
          Leia também:{' '}
          <Link to={outro.to} className="font-medium text-brand-700 hover:underline">
            {outro.rotulo}
          </Link>
          .
        </p>
      </main>
    </div>
  );
}

function BlocoView({ bloco }: { bloco: Bloco }) {
  switch (bloco.tipo) {
    case 'p':
      return <p className="leading-relaxed text-slate-600">{bloco.texto}</p>;
    case 'subtitulo':
      return <h3 className="mt-3 font-semibold text-slate-900">{bloco.texto}</h3>;
    case 'lista':
      return (
        <ul className="grid list-disc gap-2 pl-5 leading-relaxed text-slate-600 marker:text-slate-400">
          {bloco.itens.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case 'tabela':
      return (
        // Rolagem dentro da tabela: no celular ela e mais larga que a tela, e
        // alargar a pagina quebraria o layout.
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                {bloco.colunas.map((coluna) => (
                  <th key={coluna} scope="col" className="px-4 py-2.5 font-semibold">
                    {coluna}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-600">
              {bloco.linhas.map((linha) => (
                <tr key={linha[0]}>
                  {linha.map((celula, i) => (
                    <td key={i} className={i === 0 ? 'px-4 py-2.5 align-top font-medium text-slate-800' : 'px-4 py-2.5 align-top'}>
                      {celula}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'aviso':
      return (
        <p className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3 text-sm leading-relaxed text-slate-700">
          {bloco.texto}
        </p>
      );
    case 'contato':
      return <Contato />;
  }
}

/**
 * Identificacao e canal de contato. So aparece o que existe em `EMPRESA`: campo
 * nulo e omitido. Sem e-mail de privacidade, a pagina diz que o canal sera
 * divulgado, em vez de inventar um endereco.
 */
function Contato() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-600">
      <p className="font-medium text-slate-900">
        {EMPRESA.nome} — {EMPRESA.produto}
      </p>
      {EMPRESA.cnpj ? <p>CNPJ: {EMPRESA.cnpj}</p> : null}
      {EMPRESA.endereco ? <p>{EMPRESA.endereco}</p> : null}
      {EMPRESA.emailPrivacidade ? (
        <p>
          E-mail:{' '}
          <a className="font-medium text-brand-700 hover:underline" href={`mailto:${EMPRESA.emailPrivacidade}`}>
            {EMPRESA.emailPrivacidade}
          </a>
        </p>
      ) : (
        <p>O canal de contato para assuntos de privacidade será divulgado nesta página.</p>
      )}
    </div>
  );
}
