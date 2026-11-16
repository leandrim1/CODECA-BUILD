import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, TextInput, useToast } from '@codeca/ui';
import { useAuth } from '../hooks/useAuth.js';
import { ApiError } from '../services/api.js';
import { authApi } from '../services/endpoints.js';

/**
 * Segunda etapa do login pelo aplicativo autenticador.
 *
 * Um campo so, de proposito: a pessoa que perdeu o aparelho digita aqui o
 * codigo de recuperacao, sem procurar outra tela. O servidor tenta o
 * aplicativo primeiro e, se nao bater, procura entre os de recuperacao.
 */
export function TotpLoginStep({
  email,
  from,
  onBack,
}: {
  email: string;
  from?: string | undefined;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { applySession, refresh } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const enviar = async () => {
    if (code.trim().length < 6 || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const resultado = await authApi.verifyTotp(code.trim());
      applySession(resultado.session);
      await refresh();

      if (resultado.usedRecoveryCode) {
        toast.push({
          tone: 'warning',
          title: 'Você entrou com um código de recuperação',
          description:
            resultado.recoveryCodesLeft > 0
              ? `Restam ${resultado.recoveryCodesLeft} código(s). Gere uma lista nova em Segurança.`
              : 'Era o último código. Gere uma lista nova em Segurança.',
        });
      }

      const destino = resultado.next || (from && from.startsWith('/painel') ? from : '/painel');
      navigate(destino, { replace: true });
    } catch (erro) {
      const mensagem =
        erro instanceof ApiError ? erro.message : 'Não foi possível verificar o código. Tente novamente.';
      setError(mensagem);
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Verificação em duas etapas</h1>
      <p className="mt-1.5 text-sm text-slate-600">
        Abra o aplicativo autenticador e digite o código de 6 dígitos da conta <strong>{email}</strong>.
      </p>

      <form
        className="mt-8 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void enviar();
        }}
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <TextInput
          label="Código"
          name="totp"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="000000"
          autoComplete="one-time-code"
          inputMode="text"
          autoFocus
          hint="Perdeu o celular? Digite aqui um dos códigos de recuperação que você guardou."
        />

        <Button type="submit" loading={verifying} disabled={code.trim().length < 6}>
          Entrar
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Voltar
        </Button>
      </form>
    </div>
  );
}
