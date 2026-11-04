import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Alert, Button, Checkbox, Skeleton, TextInput, useToast } from '@codeca/ui';
import { BackLink, EmailCodeLogin } from '../components/EmailCodeLogin.js';
import { GoogleResultAlert, GoogleSignIn, useGoogleResult } from '../components/GoogleAuth.js';
import { useAuth } from '../hooks/useAuth.js';
import { useMutation } from '../hooks/useResource.js';
import { authApi } from '../services/endpoints.js';
import { useForm } from '../utils/forms.js';

/**
 * Entrar. Tres jeitos, cada um independente do outro:
 * Google, codigo enviado por e-mail e e-mail com senha.
 *
 * A tela abre limpa -- Google, "ou", e-mail -- e a senha fica a um clique, para
 * nao carregar a entrada com tres formularios. Sem Google nem codigo
 * configurados no servidor, so resta a senha e ela aparece direto.
 */
type View = 'choose' | 'email' | 'password';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { applySession, refresh, features, loading } = useAuth();
  const { values, errors, setField, applyApiError } = useForm({ email: '', password: '', rememberMe: false });
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [view, setView] = useState<View>('choose');
  const google = useGoogleResult();
  const from = (location.state as { from?: string } | null)?.from;

  const login = useMutation(authApi.login, {
    onSuccess: async (result) => {
      applySession(result.session);
      await refresh();
      navigate(from && from.startsWith('/painel') ? from : '/painel', { replace: true });
    },
    onError: (error) => {
      applyApiError(error);
      setGeneralError(Object.keys(error.fieldErrors).length > 0 ? null : error.message);
      if (error.code === 'rate_limited') toast.error('Muitas tentativas', error.message);
    },
  });

  // Sem Google nem codigo no servidor, a senha e o unico jeito: abre direto nela.
  const hasAlternatives = features.googleAuth || features.emailCodeAuth;
  const current: View = !loading && !hasAlternatives ? 'password' : view;

  if (current === 'email') {
    return (
      <div>
        <EmailCodeLogin mode="login" from={from} onBack={() => setView('choose')} />
      </div>
    );
  }

  if (current === 'password') {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Entrar no painel</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Não tem conta?{' '}
          <Link to="/criar-conta" className="link">
            Criar conta da empresa
          </Link>
        </p>

        <form
          className="mt-8 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setGeneralError(null);
            void login.run(values);
          }}
        >
          {generalError ? <Alert tone="danger">{generalError}</Alert> : null}

          <TextInput
            label="E-mail"
            type="email"
            autoComplete="email"
            required
            value={values.email}
            error={errors.email}
            onChange={(event) => setField('email', event.target.value)}
          />

          <TextInput
            label="Senha"
            type="password"
            autoComplete="current-password"
            required
            value={values.password}
            error={errors.password}
            onChange={(event) => setField('password', event.target.value)}
          />

          <div className="flex items-center justify-between gap-3">
            <Checkbox
              label="Manter conectado"
              checked={values.rememberMe}
              onChange={(checked) => setField('rememberMe', checked)}
            />
            <Link to="/recuperar-senha" className="text-sm link">
              Esqueci minha senha
            </Link>
          </div>

          <Button type="submit" size="lg" loading={login.loading}>
            Entrar
          </Button>
        </form>

        {hasAlternatives ? (
          <div className="mt-6">
            <BackLink onClick={() => setView('choose')}>Outras formas de entrar</BackLink>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Bem-vindo ao CODECA Build</h1>
      <p className="mt-1.5 text-sm text-slate-600">Acesse sua conta para gerenciar seu site.</p>

      <div className="mt-8 grid gap-4">
        <GoogleResultAlert code={google.code} onDismiss={google.dismiss} />
        {generalError ? <Alert tone="danger">{generalError}</Alert> : null}

        {loading ? (
          <>
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </>
        ) : (
          <>
            <GoogleSignIn
              {...(from && from.startsWith('/painel') ? { next: from } : {})}
              onError={(message) => setGeneralError(message)}
              // O separador so existe entre o Google e o e-mail: sem e-mail, nao ha "ou".
              showDivider={features.emailCodeAuth}
            />
            {features.emailCodeAuth ? (
              <Button
                variant="outline"
                size="lg"
                className="w-full justify-center"
                icon={<Mail aria-hidden="true" className="size-5 text-slate-500" />}
                onClick={() => setView('email')}
              >
                Entrar com e-mail
              </Button>
            ) : null}
          </>
        )}
      </div>

      <div className="mt-8 grid gap-3 text-sm text-slate-600">
        <button type="button" className="link justify-self-start" onClick={() => setView('password')}>
          Prefiro entrar com senha
        </button>
        <p>
          Não tem conta?{' '}
          <Link to="/criar-conta" className="link">
            Criar conta da empresa
          </Link>
        </p>
      </div>
    </div>
  );
}
