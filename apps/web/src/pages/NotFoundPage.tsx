import { Link } from 'react-router-dom';
import { Button } from '@codeca/ui';

export function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-600">Erro 404</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Pagina nao encontrada</h1>
        <p className="mt-2 text-slate-600">
          O endereco acessado nao existe neste painel. Verifique o link ou volte para a visao geral.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/painel">
            <Button>Ir para o painel</Button>
          </Link>
          <Link to="/">
            <Button variant="outline">Pagina inicial</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
