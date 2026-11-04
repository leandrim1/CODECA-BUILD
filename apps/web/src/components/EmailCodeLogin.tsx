import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Alert, Button, cx, useToast } from '@codeca/ui';
import { LOGIN_CODE_LENGTH, LOGIN_CODE_TTL_MINUTES } from '@codeca/shared';
import { useAuth } from '../hooks/useAuth.js';
import { ApiError } from '../services/api.js';
import { authApi } from '../services/endpoints.js';

/**
 * Segunda etapa do login: o codigo de 6 digitos enviado por e-mail.
 *
 * Aparece DEPOIS da senha correta (ou do Google). Nao existe entrada por aqui sem
 * a primeira etapa: o servidor so aceita o codigo de quem apresenta o comprovante
 * (cookie HttpOnly) emitido por ela, e esta tela nem sabe pedir um codigo para
 * um e-mail qualquer -- so reenviar o da etapa em andamento.
 *
 * Nada de sensivel fica no navegador: o codigo vive so no estado desta tela, e a
 * sessao e o cookie HttpOnly de sempre.
 */
export function LoginCodeStep({
  email,
  initialResendSeconds,
  from,
  onBack,
}: {
  email: string;
  /** Segundos ate liberar o reenvio, como o servidor informou. */
  initialResendSeconds: number;
  /** Destino de quem foi barrado em uma tela protegida (so vale se o servidor nao trouxer outro). */
  from?: string | undefined;
  /** Descarta a primeira etapa e volta ao login. */
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { applySession, refresh } = useAuth();
  const [digits, setDigits] = useState<string[]>(() => Array(LOGIN_CODE_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(() => Date.now() + initialResendSeconds * 1000);
  const seconds = useSecondsUntil(resendAt);
  const verifyingRef = useRef(false);
  const focusFirst = useRef<() => void>(() => undefined);
  const refocus = useRef(false);

  const code = digits.join('');
  const complete = code.length === LOGIN_CODE_LENGTH;

  // Os campos ficam desabilitados durante a conferencia, e um campo desabilitado
  // nao recebe foco: o foco volta ao primeiro so depois de a conferencia acabar.
  useEffect(() => {
    if (!verifying && refocus.current) {
      refocus.current = false;
      focusFirst.current();
    }
  }, [verifying]);

  const finish = useCallback(
    async (result: Extract<Awaited<ReturnType<typeof authApi.codeVerify>>, { status: 'authenticated' }>) => {
      applySession(result.session);
      await refresh();
      const session = result.session;
      const semEmpresa = (session?.memberships.length ?? 0) === 0 && session?.user.platformRole !== 'platform_admin';
      const destino = result.next && result.next.startsWith('/') ? result.next : from;
      navigate(semEmpresa ? '/criar-empresa' : destino && destino.startsWith('/painel') ? destino : '/painel', {
        replace: true,
      });
    },
    [applySession, refresh, navigate, from],
  );

  const verify = async () => {
    // Clique ou Enter repetidos: so uma conferencia por vez (cada uma gasta uma tentativa).
    if (!complete || verifyingRef.current) return;
    verifyingRef.current = true;
    setVerifying(true);
    setError(null);
    setGeneralError(null);
    try {
      await finish(await authApi.codeVerify({ code }));
    } catch (caught) {
      // Comprovante vencido (15 min): nao ha o que tentar aqui, volta ao login.
      if (caught instanceof ApiError && caught.status === 401 && /verificação expirou/i.test(caught.message)) {
        toast.error('Verificação expirada', caught.message);
        onBack();
        return;
      }
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível verificar o código agora.');
      setDigits(Array(LOGIN_CODE_LENGTH).fill(''));
      refocus.current = true;
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  };

  const resend = async () => {
    setSending(true);
    setGeneralError(null);
    setInfo(null);
    try {
      const result = await authApi.codeResend();
      setResendAt(Date.now() + result.resendAfterSeconds * 1000);
      setInfo('Enviamos um novo código. O anterior deixou de valer.');
      setDigits(Array(LOGIN_CODE_LENGTH).fill(''));
      setError(null);
      focusFirst.current();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'rate_limited') {
        const wait = (caught.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
        if (wait && wait <= 60) setResendAt(Date.now() + wait * 1000);
      }
      setGeneralError(caught instanceof ApiError ? caught.message : 'Não foi possível reenviar o código agora.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Confirme o código</h2>
        <p className="mt-1.5 text-sm text-slate-600">
          Enviamos um código de {LOGIN_CODE_LENGTH} dígitos para <strong className="break-words">{email}</strong>. Ele
          expira em {LOGIN_CODE_TTL_MINUTES} minutos.
        </p>
      </div>
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
          onClick={() => void resend()}
        >
          {seconds > 0 ? `Reenviar código em ${formatClock(seconds)}` : sending ? 'Enviando...' : 'Reenviar código'}
        </button>
        <button type="button" className="link" onClick={onBack}>
          Entrar com outra conta
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

// ------------------------------------------------------------------- apoio

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
