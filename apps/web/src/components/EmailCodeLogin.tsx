import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';
import { Alert, Button, Checkbox, TextInput, cx, useToast } from '@codeca/ui';
import {
  LOGIN_CODE_LENGTH,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
  emailSchema,
  slugify,
} from '@codeca/shared';
import { useAuth } from '../hooks/useAuth.js';
import { ApiError } from '../services/api.js';
import { authApi } from '../services/endpoints.js';
import { useForm } from '../utils/forms.js';

/**
 * Entrar por e-mail com codigo de 6 digitos.
 *
 * Tres passos: informar o e-mail -> digitar o codigo -> (so para e-mail novo)
 * concluir o cadastro. A tela nao sabe, e nao tenta descobrir, se o e-mail tem
 * conta: o pedido de codigo responde igual nos dois casos, e quem decide entre
 * "entrar" e "cadastrar" e o servidor, depois do codigo provado.
 *
 * Nada de sensivel fica no navegador: o codigo vive so no estado desta tela, e
 * a sessao e o cookie HttpOnly de sempre.
 */

type Step = 'email' | 'code' | 'register';

export function EmailCodeLogin({
  mode,
  from,
  onBack,
}: {
  mode: 'login' | 'signup';
  /** Destino depois de entrar, quando a pessoa foi barrada em uma tela protegida. */
  from?: string | undefined;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { applySession, refresh } = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  /** Instante (ms) a partir do qual o reenvio e liberado. */
  const [resendAt, setResendAt] = useState(0);

  const finish = useCallback(
    async (session: Parameters<typeof applySession>[0], notice?: string | null) => {
      applySession(session);
      await refresh();
      if (notice) toast.push({ tone: 'warning', title: 'Atenção', description: notice });
      const semEmpresa = (session?.memberships.length ?? 0) === 0 && session?.user.platformRole !== 'platform_admin';
      navigate(semEmpresa ? '/criar-empresa' : from && from.startsWith('/painel') ? from : '/painel', {
        replace: true,
      });
    },
    [applySession, refresh, toast, navigate, from],
  );

  /**
   * `sent`: saiu um codigo novo. `waiting`: ja saiu um ha menos de 60 segundos
   * (a pessoa voltou e pediu de novo): ele continua valendo, entao segue para
   * digita-lo. `failed`: nada saiu, e a mensagem do servidor fica na tela.
   */
  const sendCode = async (address: string): Promise<'sent' | 'waiting' | 'failed'> => {
    setSending(true);
    setGeneralError(null);
    try {
      const result = await authApi.codeRequest(address);
      setResendAt(Date.now() + result.resendAfterSeconds * 1000);
      return 'sent';
    } catch (error) {
      if (error instanceof ApiError && error.code === 'rate_limited') {
        const wait = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
        if (wait && wait <= LOGIN_CODE_RESEND_SECONDS) {
          setResendAt(Date.now() + wait * 1000);
          return 'waiting';
        }
      }
      setGeneralError(error instanceof ApiError ? error.message : 'Não foi possível enviar o código agora.');
      return 'failed';
    } finally {
      setSending(false);
    }
  };

  const submitEmail = async () => {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setEmailError('Informe um e-mail válido.');
      return;
    }
    setEmailError(undefined);
    setEmail(parsed.data);
    if ((await sendCode(parsed.data)) !== 'failed') setStep('code');
  };

  if (step === 'email') {
    return (
      <div className="grid gap-5">
        <Header
          title={mode === 'login' ? 'Entrar com e-mail' : 'Criar conta com e-mail'}
          text="Enviaremos um código de verificação para o seu e-mail. Sem senha."
        />
        {generalError ? <Alert tone="danger">{generalError}</Alert> : null}
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submitEmail();
          }}
        >
          <TextInput
            label="E-mail"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            required
            value={email}
            error={emailError}
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailError(undefined);
            }}
          />
          <Button type="submit" size="lg" loading={sending} icon={<Mail aria-hidden="true" className="size-4" />}>
            Enviar código de verificação
          </Button>
        </form>
        <BackLink onClick={onBack}>Voltar ao {mode === 'login' ? 'login' : 'cadastro'}</BackLink>
      </div>
    );
  }

  if (step === 'code') {
    return (
      <CodeStep
        email={email}
        resendAt={resendAt}
        sending={sending}
        generalError={generalError}
        onResend={() => sendCode(email)}
        onChangeEmail={() => {
          setGeneralError(null);
          setStep('email');
        }}
        onVerified={(result) => {
          if (result.status === 'registration_required') setStep('register');
          else void finish(result.session, result.notice);
        }}
      />
    );
  }

  return (
    <RegisterStep
      email={email}
      onDone={(session) => void finish(session)}
      onRestart={() => {
        setStep('email');
        setGeneralError(null);
      }}
    />
  );
}

// ------------------------------------------------------------------ passo 2

function CodeStep({
  email,
  resendAt,
  sending,
  generalError,
  onResend,
  onChangeEmail,
  onVerified,
}: {
  email: string;
  resendAt: number;
  sending: boolean;
  generalError: string | null;
  onResend: () => Promise<'sent' | 'waiting' | 'failed'>;
  onChangeEmail: () => void;
  onVerified: (result: Awaited<ReturnType<typeof authApi.codeVerify>>) => void;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(LOGIN_CODE_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const seconds = useSecondsUntil(resendAt);
  const verifyingRef = useRef(false);
  const focusFirst = useRef<() => void>(() => undefined);
  const refocus = useRef(false);

  // Os campos ficam desabilitados durante a conferencia, e um campo desabilitado
  // nao recebe foco: o foco volta ao primeiro so depois de a conferencia acabar.
  useEffect(() => {
    if (!verifying && refocus.current) {
      refocus.current = false;
      focusFirst.current();
    }
  }, [verifying]);

  const code = digits.join('');
  const complete = code.length === LOGIN_CODE_LENGTH;

  const verify = async () => {
    // Clique ou Enter repetidos: so uma conferencia por vez (cada uma gasta uma tentativa).
    if (!complete || verifyingRef.current) return;
    verifyingRef.current = true;
    setVerifying(true);
    setError(null);
    try {
      onVerified(await authApi.codeVerify({ email, code }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível verificar o código agora.');
      setDigits(Array(LOGIN_CODE_LENGTH).fill(''));
      refocus.current = true;
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  };

  return (
    <div className="grid gap-5">
      <Header
        title="Confirme o código"
        text={
          <>
            Enviamos um código de {LOGIN_CODE_LENGTH} dígitos para <strong className="break-words">{email}</strong>. Ele
            expira em {LOGIN_CODE_TTL_MINUTES} minutos.
          </>
        }
      />
      {generalError ? <Alert tone="danger">{generalError}</Alert> : null}
      {info ? <Alert tone="success">{info}</Alert> : null}

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void verify();
        }}
      >
        <CodeInput
          digits={digits}
          onChange={(next) => {
            setDigits(next);
            setError(null);
          }}
          invalid={error !== null}
          disabled={verifying}
          registerFocus={(focus) => {
            focusFirst.current = focus;
          }}
        />
        {error ? (
          <p role="alert" className="-mt-1 text-sm font-medium text-rose-600">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" loading={verifying} disabled={!complete}>
          Verificar e entrar
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <button
          type="button"
          className="link disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
          disabled={seconds > 0 || sending}
          onClick={() =>
            void onResend().then((result) => {
              if (result === 'sent') {
                setInfo('Enviamos um novo código. O anterior deixou de valer.');
                setDigits(Array(LOGIN_CODE_LENGTH).fill(''));
                setError(null);
                focusFirst.current();
              }
            })
          }
        >
          {seconds > 0 ? `Reenviar código em ${formatClock(seconds)}` : sending ? 'Enviando...' : 'Reenviar código'}
        </button>
        <button type="button" className="link" onClick={onChangeEmail}>
          Alterar e-mail
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Não chegou? Veja a caixa de spam. Por segurança, o código só pode ser usado uma vez.
      </p>
    </div>
  );
}

/** Seis campos de um digito: avanco automatico, colar de uma vez, Backspace volta. */
function CodeInput({
  digits,
  onChange,
  invalid,
  disabled,
  registerFocus,
}: {
  digits: string[];
  onChange: (digits: string[]) => void;
  invalid: boolean;
  disabled: boolean;
  registerFocus: (focusFirst: () => void) => void;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const focusAt = (index: number) => {
    const target = refs.current[Math.max(0, Math.min(LOGIN_CODE_LENGTH - 1, index))];
    target?.focus();
    target?.select();
  };

  useEffect(() => {
    registerFocus(() => focusAt(0));
    // `registerFocus` guarda so uma funcao; registrar de novo a cada render nao muda nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Preenche a partir de `start`, ignorando tudo que nao for digito. */
  const fill = (start: number, raw: string) => {
    const chars = raw.replace(/\D/g, '').slice(0, LOGIN_CODE_LENGTH - start);
    if (!chars) return;
    const next = [...digits];
    for (let i = 0; i < chars.length; i += 1) next[start + i] = chars[i]!;
    onChange(next);
    focusAt(Math.min(start + chars.length, LOGIN_CODE_LENGTH - 1));
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index]) {
      event.preventDefault();
      if (index > 0) {
        const next = [...digits];
        next[index - 1] = '';
        onChange(next);
        focusAt(index - 1);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusAt(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusAt(index + 1);
    }
  };

  const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text');
    // Colar o codigo inteiro, de qualquer campo, preenche os seis desde o primeiro.
    fill(text.replace(/\D/g, '').length >= LOGIN_CODE_LENGTH ? 0 : index, text);
  };

  return (
    <div role="group" aria-label="Código de verificação" className="flex justify-between gap-2 sm:gap-3">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          value={digit}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={LOGIN_CODE_LENGTH}
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          autoFocus={index === 0}
          aria-label={`Dígito ${index + 1} de ${LOGIN_CODE_LENGTH}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cx(
            'h-14 w-full min-w-0 rounded-xl border bg-white text-center text-2xl font-semibold tabular-nums text-slate-900',
            'transition-[border-color,box-shadow] duration-200 focus:border-brand-500 focus:outline-2 focus:outline-offset-0 focus:outline-brand-500/40',
            'disabled:bg-slate-50 disabled:text-slate-500',
            invalid ? 'border-rose-400 focus:outline-rose-400/40' : 'border-slate-300 hover:border-slate-400',
          )}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={(event) => onPaste(index, event)}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '') {
              const next = [...digits];
              next[index] = '';
              onChange(next);
            } else {
              // Digitar (1 caractere) ou o autopreenchimento do navegador (varios).
              fill(index, value);
            }
          }}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ passo 3

function RegisterStep({
  email,
  onDone,
  onRestart,
}: {
  email: string;
  onDone: (session: Awaited<ReturnType<typeof authApi.codeRegister>>['session']) => void;
  onRestart: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const { values, errors, setField, applyApiError } = useForm({
    name: '',
    companyName: '',
    phone: '',
    acceptedTerms: false,
  });
  const previewSlug = slugify(values.companyName);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setGeneralError(null);
    try {
      const result = await authApi.codeRegister(values);
      onDone(result.session);
    } catch (error) {
      if (error instanceof ApiError) {
        applyApiError(error);
        setGeneralError(Object.keys(error.fieldErrors).length > 0 ? null : error.message);
      } else {
        setGeneralError('Não foi possível concluir o cadastro agora.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5">
      <Header
        title="Falta pouco"
        text={
          <>
            E-mail confirmado: <strong className="break-words">{email}</strong>. Conte-nos sobre você e a sua empresa para
            abrir o painel.
          </>
        }
      />
      {generalError ? (
        <Alert tone="danger">
          {generalError}{' '}
          <button type="button" className="link" onClick={onRestart}>
            Pedir novo código
          </button>
        </Alert>
      ) : null}
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextInput
          label="Seu nome"
          required
          autoComplete="name"
          autoFocus
          value={values.name}
          error={errors.name}
          onChange={(event) => setField('name', event.target.value)}
        />
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
          label="Telefone"
          autoComplete="tel"
          placeholder="(19) 99999-0000"
          value={values.phone}
          error={errors.phone}
          onChange={(event) => setField('phone', event.target.value)}
        />
        <Checkbox
          label={
            <>
              Aceito os{' '}
              <Link to="/termos" className="link" target="_blank" rel="noreferrer">
                termos de uso
              </Link>{' '}
              e a{' '}
              <Link to="/privacidade" className="link" target="_blank" rel="noreferrer">
                política de privacidade
              </Link>
            </>
          }
          checked={values.acceptedTerms}
          onChange={(checked) => setField('acceptedTerms', checked)}
        />
        {errors.acceptedTerms ? <p className="-mt-2 text-xs font-medium text-rose-600">{errors.acceptedTerms}</p> : null}
        <Button type="submit" size="lg" loading={saving}>
          Criar conta e entrar
        </Button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------- apoio

function Header({ title, text }: { title: string; text: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
      <p className="mt-1.5 text-sm text-slate-600">{text}</p>
    </div>
  );
}

export function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="link inline-flex items-center gap-1.5 text-sm">
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      {children}
    </button>
  );
}

/** Segundos que faltam ate `target` (ms). Atualiza uma vez por segundo, so enquanto falta. */
function useSecondsUntil(target: number): number {
  const compute = () => Math.max(0, Math.ceil((target - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(compute);
  useEffect(() => {
    setSeconds(compute());
    if (target <= Date.now()) return;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setSeconds(left);
      if (left === 0) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return seconds;
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
