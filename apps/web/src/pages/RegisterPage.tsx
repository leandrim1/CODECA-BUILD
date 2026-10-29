import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Checkbox, TextInput, useToast } from '@codeca/ui';
import { slugify } from '@codeca/shared';
import { useAuth } from '../hooks/useAuth.js';
import { useMutation } from '../hooks/useResource.js';
import { authApi } from '../services/endpoints.js';
import { useForm } from '../utils/forms.js';

export function RegisterPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { applySession, refresh } = useAuth();
  const [generalError, setGeneralError] = useState<string | null>(null);

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
          title: 'Conta criada, mas o e-mail de confirmacao nao saiu',
          description: result.emailDelivery.reason,
        });
      } else {
        toast.success('Conta criada', 'Confirme seu e-mail para liberar a publicacao do site.');
      }
      navigate('/painel', { replace: true });
    },
    onError: (error) => {
      applyApiError(error);
      setGeneralError(Object.keys(error.fieldErrors).length > 0 ? null : error.message);
    },
  });

  const previewSlug = slugify(values.companyName);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Criar a conta da construtora</h1>
      <p className="mt-1.5 text-sm text-slate-600">
        Ja tem conta?{' '}
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
          label="Nome da construtora"
          required
          autoComplete="organization"
          placeholder="Construtora Horizonte"
          value={values.companyName}
          error={errors.companyName}
          hint={previewSlug ? `Endereco interno: ${previewSlug}` : undefined}
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
          hint="Ao menos 10 caracteres, com letras e numeros."
          onChange={(event) => setField('password', event.target.value)}
        />

        <Checkbox
          label="Aceito os termos de uso e a politica de privacidade"
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
    </div>
  );
}
