import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, TextInput, useToast } from '@codeca/ui';
import { useMutation } from '../hooks/useResource.js';
import { authApi } from '../services/endpoints.js';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const reset = useMutation(
    (input: { token: string; password: string }) => authApi.resetPassword(input.token, input.password),
    {
      onSuccess: () => {
        toast.success('Senha redefinida', 'Entre com a nova senha.');
        navigate('/entrar', { replace: true });
      },
    },
  );

  if (!token) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Link invalido</h1>
        <Alert tone="danger" title="Token ausente" >
          Abra o link completo recebido por e-mail. Se ele expirou, solicite um novo.
        </Alert>
        <Link to="/recuperar-senha" className="mt-4 inline-block link">
          Solicitar novo link
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Definir nova senha</h1>
      <p className="mt-1.5 text-sm text-slate-600">
        Ao concluir, todas as sessoes abertas serao encerradas por seguranca.
      </p>

      <form
        className="mt-8 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (password !== confirmation) {
            setMismatch(true);
            return;
          }
          setMismatch(false);
          void reset.run({ token, password });
        }}
      >
        {reset.error ? <Alert tone="danger">{reset.error.message}</Alert> : null}

        <TextInput
          label="Nova senha"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          error={reset.error?.fieldErrors.password}
          hint="Ao menos 10 caracteres, com letras e numeros."
          onChange={(event) => setPassword(event.target.value)}
        />
        <TextInput
          label="Confirmar nova senha"
          type="password"
          required
          autoComplete="new-password"
          value={confirmation}
          error={mismatch ? 'As senhas nao conferem.' : undefined}
          onChange={(event) => setConfirmation(event.target.value)}
        />

        <Button type="submit" size="lg" loading={reset.loading}>
          Salvar nova senha
        </Button>
      </form>
    </div>
  );
}
