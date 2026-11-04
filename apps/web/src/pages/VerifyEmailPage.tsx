import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Spinner, TextInput } from '@codeca/ui';
import { useAuth } from '../hooks/useAuth.js';
import { useMutation } from '../hooks/useResource.js';
import { authApi } from '../services/endpoints.js';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { refresh, user } = useAuth();
  const [state, setState] = useState<'idle' | 'verifying' | 'done' | 'failed'>(token ? 'verifying' : 'idle');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');

  const resend = useMutation(authApi.resendVerification);

  useEffect(() => {
    if (!token) return;
    let active = true;
    authApi
      .verifyEmail(token)
      .then(async () => {
        if (!active) return;
        setState('done');
        await refresh();
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState('failed');
        setMessage(error instanceof Error ? error.message : 'Não foi possível confirmar o e-mail.');
      });
    return () => {
      active = false;
    };
  }, [token, refresh]);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Confirmação de e-mail</h1>

      {state === 'verifying' ? (
        <div className="mt-8 flex items-center gap-3">
          <Spinner label="Confirmando" />
          <p className="text-sm text-slate-600">Confirmando seu e-mail...</p>
        </div>
      ) : null}

      {state === 'done' ? (
        <div className="mt-8 grid gap-4">
          <Alert tone="success" title="E-mail confirmado">
            Tudo certo. Agora você pode publicar o site e conectar um domínio próprio.
          </Alert>
          <Link to="/painel">
            <Button className="w-full">Ir para o painel</Button>
          </Link>
        </div>
      ) : null}

      {state === 'failed' || state === 'idle' ? (
        <div className="mt-8 grid gap-4">
          {state === 'failed' ? (
            <Alert tone="danger" title="Não foi possível confirmar">
              {message} Solicite um novo link abaixo.
            </Alert>
          ) : (
            <p className="text-sm text-slate-600">
              Informe o e-mail da conta para receber um novo link de confirmação.
            </p>
          )}

          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void resend.run(email);
            }}
          >
            <TextInput
              label="E-mail"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" loading={resend.loading}>
              Reenviar confirmação
            </Button>
          </form>

          {resend.loading ? null : resend.error ? (
            <Alert tone="danger">{resend.error.message}</Alert>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
