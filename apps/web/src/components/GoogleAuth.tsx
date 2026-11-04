import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Skeleton } from '@codeca/ui';
import { GOOGLE_AUTH_ERRORS, type GoogleAuthResult } from '@codeca/shared';
import { useAuth } from '../hooks/useAuth.js';
import { ApiError } from '../services/api.js';
import { authApi } from '../services/endpoints.js';

/**
 * "Continuar com Google".
 *
 * O botao so inicia o fluxo: pede a URL ao servidor e segue para ela. Quem
 * fala com o Google, confere o token e abre a sessao e a API; aqui nao ha
 * credencial, token nem segredo.
 */

/** Icone oficial do Google (marca "G" em quatro cores), conforme as diretrizes de marca. */
export function GoogleIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className={className}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** Separador "ou" entre o Google e o formulario. */
export function OrDivider() {
  return (
    <div role="separator" aria-orientation="horizontal" className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-slate-400">
      <span className="h-px flex-1 bg-slate-200" />
      ou
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

/**
 * O botao e o separador, juntos, so quando o servidor tem o Google configurado.
 *
 * Enquanto a sessao ainda esta sendo conferida o espaco ja fica reservado (mesma
 * altura do botao): decidir so depois empurraria o formulario para baixo.
 */
export function GoogleSignIn({
  next,
  onError,
  showDivider = true,
}: {
  next?: string;
  onError: (message: string) => void;
  /** O "ou" depois do botao. Falso quando nao ha outra opcao abaixo dele. */
  showDivider?: boolean;
}) {
  const { features, loading } = useAuth();
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);

  // Voltar do Google pelo botao "voltar" do navegador restaura a pagina como ela
  // estava, com o botao ainda "carregando": destrava.
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) {
        startingRef.current = false;
        setStarting(false);
      }
    };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);

  if (loading) return <Skeleton className="h-12 w-full rounded-xl" />;
  if (!features.googleAuth) return null;

  const start = async () => {
    // Clique repetido: o estado de React so atualiza no proximo ciclo, a ref e imediata.
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      const { authorizationUrl } = await authApi.googleStart({
        intent: 'continue',
        ...(next ? { next } : {}),
      });
      // Segue para o Google. O botao continua "carregando" ate a pagina sair.
      window.location.assign(authorizationUrl);
    } catch (error) {
      startingRef.current = false;
      setStarting(false);
      onError(error instanceof ApiError ? error.message : GOOGLE_AUTH_ERRORS.failed);
    }
  };

  return (
    <div className="grid gap-4">
      <Button
        variant="outline"
        size="lg"
        className="w-full justify-center"
        loading={starting}
        icon={<GoogleIcon />}
        onClick={() => void start()}
      >
        {starting ? 'Abrindo o Google...' : 'Continuar com Google'}
      </Button>
      {showDivider ? <OrDivider /> : null}
    </div>
  );
}

/**
 * Le `?google=<codigo>` (o servidor volta para a tela com o resultado), mostra a
 * mensagem uma vez e limpa a URL para um F5 nao repeti-la.
 */
export function useGoogleResult(): { code: GoogleAuthResult | null; dismiss: () => void } {
  const [params, setParams] = useSearchParams();
  const raw = params.get('google');
  const [code, setCode] = useState<GoogleAuthResult | null>(() =>
    raw && raw in GOOGLE_AUTH_ERRORS ? (raw as GoogleAuthResult) : null,
  );

  useEffect(() => {
    if (!raw) return;
    if (raw in GOOGLE_AUTH_ERRORS) setCode(raw as GoogleAuthResult);
    const next = new URLSearchParams(params);
    next.delete('google');
    setParams(next, { replace: true });
  }, [raw, params, setParams]);

  return { code, dismiss: () => setCode(null) };
}

/** Aviso do resultado do Google, no topo do formulario. */
export function GoogleResultAlert({ code, onDismiss }: { code: GoogleAuthResult | null; onDismiss?: () => void }) {
  if (!code) return null;
  const success = code === 'linked';
  return (
    <Alert
      tone={success ? 'success' : code === 'cancelled' ? 'info' : 'danger'}
      title={success ? 'Google vinculado' : code === 'cancelled' ? 'Acesso cancelado' : 'Não foi possível entrar com o Google'}
      {...(onDismiss ? { action: <button type="button" className="text-xs underline" onClick={onDismiss}>Fechar</button> } : {})}
    >
      {GOOGLE_AUTH_ERRORS[code]}
      {code === 'email_in_use' ? (
        <>
          {' '}
          <Link to="/recuperar-senha" className="link">
            Esqueci minha senha
          </Link>
        </>
      ) : null}
    </Alert>
  );
}
