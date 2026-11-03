import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '../landing/ui.js';

/**
 * Termos de uso e politica de privacidade.
 *
 * **O texto juridico ainda nao existe no projeto**, e nao cabe a quem
 * programa redigi-lo: termos e politica de privacidade obrigam a empresa, e
 * precisam sair de quem responde por ela. Ate la, esta pagina diz exatamente
 * isso -- em vez de inventar clausulas, ou de deixar o link do rodape e o
 * "aceito os termos" do cadastro sem lugar nenhum para onde ir.
 *
 * Quando o texto estiver pronto, ele entra em `DOCUMENTOS`, e a pagina passa a
 * exibi-lo no lugar do aviso.
 */

type Tipo = 'termos' | 'privacidade';

interface Documento {
  titulo: string;
  /** Paragrafos do texto juridico. Vazio enquanto ele nao for publicado. */
  secoes: ReadonlyArray<{ titulo: string; texto: string }>;
}

const DOCUMENTOS: Record<Tipo, Documento> = {
  termos: { titulo: 'Termos de uso', secoes: [] },
  privacidade: { titulo: 'Política de privacidade', secoes: [] },
};

export function LegalPage({ tipo }: { tipo: Tipo }) {
  const documento = DOCUMENTOS[tipo];

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

      <main className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.03em] text-slate-900">{documento.titulo}</h1>

        {documento.secoes.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-slate-600 shadow-card sm:p-8">
            <p className="font-medium text-slate-900">Documento ainda não publicado.</p>
            <p className="mt-2 leading-relaxed">
              O texto de {documento.titulo.toLowerCase()} do CODECA Build será publicado nesta página pela CODECA
              IA. Enquanto isso, não há condições escritas aqui para consultar.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid gap-8">
            {documento.secoes.map((secao) => (
              <section key={secao.titulo}>
                <h2 className="text-xl font-semibold text-slate-900">{secao.titulo}</h2>
                <p className="mt-2 leading-relaxed text-slate-600">{secao.texto}</p>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
