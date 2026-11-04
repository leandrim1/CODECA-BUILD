import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Alert, Button, Checkbox, Skeleton, TextInput, useToast } from '@codeca/ui';
import { slugify } from '@codeca/shared';
import { BackLink, EmailCodeLogin } from '../components/EmailCodeLogin.js';
import { GoogleResultAlert, GoogleSignIn, useGoogleResult } from '../components/GoogleAuth.js';
import { useAuth } from '../hooks/useAuth.js';
import { useMutation } from '../hooks/useResource.js';
import { authApi } from '../services/endpoints.js';
import { useForm } from '../utils/forms.js';

/** Mesmas tres opcoes da entrada: Google, codigo por e-mail e o formulario com senha. */
type View = 'choose' | 'email' | 'password';

export function RegisterPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { applySession, refresh, features, loading } = useAuth();
  const [view, setView] = useState<View>('choose');
  const [generalError, setGeneralError] = useState<string | null>(null);
  const google = useGoogleResult();

  const { values, errors, setField, applyApiError } = useForm({
    name: '',
    email: '',
    password: '',
    companyName: '',
    phone: '',
    acceptedTerms: false,
  });

  const register = useMutation(authApi.register, {
    onSuccess: async (result) => {
      applySession(result.session);
      await refresh();
      if (!result.emailDelivery.delivered && result.emailDelivery.reason) {
        toast.push({
          tone: 'warning',
          title: 'Conta criada, mas o e-mail de confirmação não saiu',
          description: result.emailDelivery.reason,
        });
      } else {
        toast.success('Conta criada', 'Confirme seu e-mail para liberar a publicação do site.');
      }
      navigate('/painel', { replace: true });
    },
    onError: (error) => {
      applyApiError(error);
      setGeneralError(Object.keys(error.fieldErrors).length > 0 ? null : error.message);
    },
  });

  const previewSlug = slugify(values.companyName);

  const hasAlternatives = features.googleAuth || features.emailCodeAuth;
  const current: View = !loading && !hasAlternatives ? 'password' : view;

  if (current === 'email') {
    return (
      <div>
        <EmailCodeLogin mode="signup" onBack={() => setView('choose')} />
      </div>
    );
  }

  if (current === 'choose') {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Criar a conta da empresa</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Já tem conta?{' '}
          <Link to="/entrar" className="link">
            Entrar
          </Link>
        </p>

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
              <GoogleSignIn onError={(message) => setGeneralError(message)} showDivider={features.emailCodeAuth} />
              {features.emailCodeAuth ? (
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full justify-center"
                  icon={<Mail aria-hidden="true" className="size-5 text-slate-500" />}
                  onClick={() => setView('email')}
                >
                  Continuar com e-mail
                </Button>
              ) : null}
            </>
          )}
        </div>

        <div className="mt-8 grid gap-3 text-sm text-slate-600">
          <button type="button" className="link justify-self-start" onClick={() => setView('password')}>
            Prefiro criar a conta com senha
          </button>
          <p className="text-xs text-slate-500">
            Ao continuar, você aceita os{' '}
            <Link to="/termos" className="link">
              termos de uso
            </Link>{' '}
            e a{' '}
            <Link to="/privacidade" className="link">
              política de privacidade
            </Link>
            . A empresa é cadastrada no passo seguinte.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Criar a conta da empresa</h1>
      <p className="mt-1.5 text-sm text-slate-600">
        Já tem conta?{' '}
        <Link to="/entrar" className="link">
          Entrar
        </Link>
      </p>

      <form
        className="mt-8 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setGeneralError(null);
          void register.run(values);
        }}
      >
        {generalError ? <Alert tone="danger">{generalError}</Alert> : null}

        <TextInput
          label="Nome da empresa"
          required
          autoComplete="organization"
          placeholder="Nome da sua empresa"
          value={values.companyName}
          error={errors.companyName}
          hint={previewSlug ? `Endereço interno: ${previewSlug}` : undefined}
          onChange={(event) => setField('companyName', event.target.value)}
        />

        <TextInput
          label="Seu nome"
          required
          autoComplete="name"
          value={values.name}
          error={errors.name}
          onChange={(event) => setField('name', event.target.value)}
        />

        <TextInput
          label="E-mail"
          type="email"
          required
          autoComplete="email"
          value={values.email}
          error={errors.email}
          hint="Usado para entrar no painel e como contato inicial do site."
          onChange={(event) => setField('email', event.target.value)}
        />

        <TextInput
          label="Telefone"
          autoComplete="tel"
          placeholder="(19) 99999-0000"
          value={values.phone}
          error={errors.phone}
          onChange={(event) => setField('phone', event.target.value)}
        />

        <TextInput
          label="Senha"
          type="password"
          required
          autoComplete="new-password"
          value={values.password}
          error={errors.password}
          hint="Ao menos 10 caracteres, com letras e números."
          onChange={(event) => setField('password', event.target.value)}
        />

        <Checkbox
          label={
            <>
              Aceito os{' '}
              <Link to="/termos" className="link" target="_blank" rel="noreferrer">termos de uso</Link> e a{' '}
              <Link to="/privacidade" className="link" target="_blank" rel="noreferrer">política de privacidade</Link>
            </>
          }
          checked={values.acceptedTerms}
          onChange={(checked) => setField('acceptedTerms', checked)}
        />
        {errors.acceptedTerms ? (
          <p className="-mt-2 text-xs font-medium text-rose-600">{errors.acceptedTerms}</p>
        ) : null}

        <Button type="submit" size="lg" loading={register.loading}>
          Criar conta
        </Button>
      </form>

      {hasAlternatives ? (
        <div className="mt-6">
          <BackLink onClick={() => setView('choose')}>Outras formas de criar a conta</BackLink>
        </div>
      ) : null}
    </div>
  );
}
