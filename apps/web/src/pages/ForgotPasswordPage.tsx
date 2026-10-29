import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, TextInput } from '@codeca/ui';
import { useMutation } from '../hooks/useResource.js';
import { authApi } from '../services/endpoints.js';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const request = useMutation(authApi.forgotPassword, { onSuccess: () => setSent(true) });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Recuperar senha</h1>
      <p className="mt-1.5 text-sm text-slate-600">
        Informe o e-mail da conta e enviaremos um link para definir uma nova senha.
      </p>

      {sent ? (
        <div className="mt-8 grid gap-4">
          {/* A mensagem e a mesma para qualquer e-mail, para nao revelar cadastros. */}
          <Alert tone="success" title="Verifique sua caixa de entrada">
            Se existir uma conta com <strong>{email}</strong>, o link de redefinicao chega em alguns minutos.
            O link expira em 2 horas.
          </Alert>
          <Link to="/entrar">
            <Button variant="outline" className="w-full">
              Voltar para o login
            </Button>
          </Link>
        </div>
      ) : (
        <form
          className="mt-8 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void request.run(email);
          }}
        >
          {request.error ? <Alert tone="danger">{request.error.message}</Alert> : null}
          <TextInput
            label="E-mail"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button type="submit" size="lg" loading={request.loading}>
            Enviar link
          </Button>
          <Link to="/entrar" className="text-center text-sm link">
            Voltar para o login
          </Link>
        </form>
      )}
    </div>
  );
}
