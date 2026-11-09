import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Checkbox, Skeleton, TextInput, useToast } from '@codeca/ui';
import { LOGIN_CODE_LENGTH } from '@codeca/shared';
import { LoginCodeStep } from '../components/EmailCodeLogin.js';
import { GoogleResultAlert, GoogleSignIn, useGoogleResult } from '../components/GoogleAuth.js';
import { useAuth } from '../hooks/useAuth.js';
import { useMutation } from '../hooks/useResource.js';
import { ApiError } from '../services/api.js';
import { authApi } from '../services/endpoints.js';
import { useForm } from '../utils/forms.js';

/**
 * Entrar.
 *
 * Tres caminhos, e todos terminam no mesmo lugar: o codigo de 6 digitos.
 *
 * - **Senha**: e-mail e senha e, depois, o codigo. A sessao so nasce com ele.
 * - **Google**: autoriza no Google e, depois, o codigo.
 * - **So o e-mail**: pede o codigo direto, sem senha. Para quem nao lembra a
 *   senha e nao precisa trocar de senha para entrar.
 *
 * Quem volta do Google chega em `/entrar?etapa=codigo`; o servidor ja enviou o
 * codigo, e esta tela so precisa saber para qual e-mail.
 */
interface CodeState {
  email: string;
  resendAfterSeconds: number;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { applySession, refresh, features, loading } = useAuth();
  const { values, errors, setField, applyApiError } = useForm({ email: '', password: '', rememberMe: false });
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [step, setStep] = useState<CodeState | null>(null);
  /**
   * `senha`: e-mail e senha. `email`: pedir o codigo so com o e-mail.
   *
   * `?metodo=codigo` abre direto no segundo: serve para um link de suporte
   * ("entre por aqui") e para a varredura visual alcancar a tela, que de outro
   * modo so existe depois de um clique.
   */
  const [modo, setModo] = useState<'senha' | 'email'>(
    params.get('metodo') === 'codigo' ? 'email' : 'senha',
  );
  const google = useGoogleResult();
  const from = (location.state as { from?: string } | null)?.from;
  const backFromGoogle = params.get('etapa') === 'codigo';

  // Voltou do Google: o codigo ja foi enviado; pergunta ao servidor para onde.
  useEffect(() => {
    if (!backFromGoogle) return;
    const next = new URLSearchParams(params);
    next.delete('etapa');
    setParams(next, { replace: true });
    authApi
      .codePending()
      .then((pending) => setStep({ email: pending.email, resendAfterSeconds: pending.resendAfterSeconds }))
      .catch((error: unknown) => {
        setGeneralError(
          error instanceof ApiError ? error.message : 'Não foi possível continuar. Entre novamente.',
        );
      });
    // So uma vez, ao chegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backFromGoogle]);

  const login = useMutation(authApi.login, {
    onSuccess: async (result) => {
      if (result.status === 'code_required') {
        // Senha certa, sem sessao ainda: falta o codigo.
        setStep({ email: result.email, resendAfterSeconds: result.resendAfterSeconds });
        setField('password', '');
        return;
      }
      // Sem e-mail configurado no servidor a senha ainda entra direto.
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

  const pedirCodigo = useMutation(authApi.codeStart, {
    onSuccess: (result) => {
      // A resposta e a mesma exista ou nao a conta: a tela avanca igual, e um
      // e-mail sem conta so descobre isso ao digitar o codigo.
      setStep({ email: result.email, resendAfterSeconds: result.resendAfterSeconds });
    },
    onError: (error) => {
      applyApiError(error);
      setGeneralError(Object.keys(error.fieldErrors).length > 0 ? null : error.message);
      if (error.code === 'rate_limited') toast.error('Muitas tentativas', error.message);
    },
  });

  if (step) {
    return (
      <div>
        <LoginCodeStep
          email={step.email}
          initialResendSeconds={step.resendAfterSeconds}
          from={from}
          onBack={() => {
            void authApi.codeCancel().catch(() => undefined);
            setStep(null);
            setGeneralError(null);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Bem-vindo ao CODECA Build</h1>
      <p className="mt-1.5 text-sm text-slate-600">Acesse sua conta para gerenciar seu site.</p>

      <div className="mt-8 grid gap-4">
        <GoogleResultAlert code={google.code} onDismiss={google.dismiss} />
        {loading ? (
          <Skeleton className="h-12 w-full rounded-xl" />
        ) : (
          <GoogleSignIn
            {...(from && from.startsWith('/painel') ? { next: from } : {})}
            onError={(message) => setGeneralError(message)}
          />
        )}
      </div>

      <form
        className="mt-4 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setGeneralError(null);
          if (modo === 'email') {
            void pedirCodigo.run({ email: values.email, rememberMe: values.rememberMe });
            return;
          }
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

        {modo === 'senha' ? (
          <TextInput
            label="Senha"
            type="password"
            autoComplete="current-password"
            required
            value={values.password}
            error={errors.password}
            onChange={(event) => setField('password', event.target.value)}
          />
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Checkbox
            label="Manter conectado"
            checked={values.rememberMe}
            onChange={(checked) => setField('rememberMe', checked)}
          />
          {modo === 'senha' ? (
            <Link to="/recuperar-senha" className="text-sm link">
              Esqueci minha senha
            </Link>
          ) : null}
        </div>

        <Button type="submit" size="lg" loading={modo === 'email' ? pedirCodigo.loading : login.loading}>
          {modo === 'email' ? 'Enviar código' : features.emailCodeAuth ? 'Continuar' : 'Entrar'}
        </Button>
        {modo === 'email' ? (
          <p className="-mt-1 text-xs text-slate-500">
            Enviaremos um código de {LOGIN_CODE_LENGTH} dígitos para o e-mail da conta. Sem senha.
          </p>
        ) : features.emailCodeAuth ? (
          <p className="-mt-1 text-xs text-slate-500">
            Em seguida enviaremos um código de verificação para o seu e-mail.
          </p>
        ) : null}
      </form>

      {/*
        Entrar so com o e-mail. Depende do envio de e-mail estar configurado no
        servidor -- sem ele o codigo nunca chegaria, e o botao prometeria algo
        que nao acontece.
      */}
      {features.emailCodeAuth ? (
        <button
          type="button"
          className="mt-4 link text-sm"
          onClick={() => {
            setModo(modo === 'email' ? 'senha' : 'email');
            setField('password', '');
            setGeneralError(null);
          }}
        >
          {modo === 'email' ? 'Entrar com e-mail e senha' : 'Entrar com um código por e-mail'}
        </button>
      ) : null}

      <p className="mt-6 text-sm text-slate-600">
        Não tem conta?{' '}
        <Link to="/criar-conta" className="link">
          Criar conta da empresa
        </Link>
      </p>
    </div>
  );
}
