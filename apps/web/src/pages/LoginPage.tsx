import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Checkbox, TextInput, useToast } from '@codeca/ui';
import { useAuth } from '../hooks/useAuth.js';
import { useMutation } from '../hooks/useResource.js';
import { authApi } from '../services/endpoints.js';
import { useForm } from '../utils/forms.js';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { applySession, refresh } = useAuth();
  const { values, errors, setField, applyApiError } = useForm({ email: '', password: '', rememberMe: false });
  const [generalError, setGeneralError] = useState<string | null>(null);

  const login = useMutation(authApi.login, {
    onSuccess: async (result) => {
      applySession(result.session);
      await refresh();
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith('/painel') ? from : '/painel', { replace: true });
    },
    onError: (error) => {
      applyApiError(error);
      setGeneralError(Object.keys(error.fieldErrors).length > 0 ? null : error.message);
      if (error.code === 'rate_limited') toast.error('Muitas tentativas', error.message);
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Entrar no painel</h1>
      <p className="mt-1.5 text-sm text-slate-600">
        Nao tem conta?{' '}
        <Link to="/criar-conta" className="link">
          Criar conta da construtora
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
    </div>
  );
}
