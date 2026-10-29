import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, TextInput, useToast } from '@codeca/ui';
import { useAuth } from '../hooks/useAuth.js';
import { useMutation } from '../hooks/useResource.js';
import { authApi } from '../services/endpoints.js';
import { useForm } from '../utils/forms.js';

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { applySession, refresh, selectTenant } = useAuth();
  const token = params.get('token') ?? '';
  const [generalError, setGeneralError] = useState<string | null>(null);

  const { values, errors, setField, applyApiError } = useForm({ name: '', password: '' });

  const accept = useMutation(authApi.acceptInvite, {
    onSuccess: async (result) => {
      applySession(result.session);
      selectTenant(result.tenantId);
      await refresh();
      toast.success('Convite aceito', 'Bem-vindo a equipe.');
      navigate('/painel', { replace: true });
    },
    onError: (error) => {
      applyApiError(error);
      setGeneralError(Object.keys(error.fieldErrors).length > 0 ? null : error.message);
    },
  });

  if (!token) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Convite invalido</h1>
        <Alert tone="danger" title="Link incompleto">
          Abra o link completo que chegou por e-mail. Convites expiram em 7 dias.
        </Alert>
        <Link to="/entrar" className="mt-4 inline-block link">
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Aceitar convite</h1>
      <p className="mt-1.5 text-sm text-slate-600">
        Defina seu nome e sua senha para entrar no painel da construtora. Se voce ja tem conta, basta
        confirmar.
      </p>

      <form
        className="mt-8 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setGeneralError(null);
          void accept.run({
            token,
            ...(values.name ? { name: values.name } : {}),
            ...(values.password ? { password: values.password } : {}),
          });
        }}
      >
        {generalError ? <Alert tone="danger">{generalError}</Alert> : null}

        <TextInput
          label="Seu nome"
          autoComplete="name"
          value={values.name}
          error={errors.name}
          onChange={(event) => setField('name', event.target.value)}
        />
        <TextInput
          label="Senha"
          type="password"
          autoComplete="new-password"
          value={values.password}
          error={errors.password}
          hint="Obrigatoria apenas se esta e a sua primeira conta na plataforma."
          onChange={(event) => setField('password', event.target.value)}
        />

        <Button type="submit" size="lg" loading={accept.loading}>
          Aceitar convite
        </Button>
      </form>
    </div>
  );
}
