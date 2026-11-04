import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Alert, Button, Checkbox, TextInput, useToast } from '@codeca/ui';
import { slugify } from '@codeca/shared';
import { useAuth } from '../hooks/useAuth.js';
import { useMutation } from '../hooks/useResource.js';
import { authApi } from '../services/endpoints.js';
import { useForm } from '../utils/forms.js';

/**
 * Cadastro da primeira empresa de quem entrou pelo Google.
 *
 * E o mesmo cadastro do formulario de e-mail e senha, sem o que o Google ja
 * respondeu (nome e e-mail confirmado). A empresa so nasce depois de a pessoa
 * informar o nome dela e aceitar os termos: nada e criado a partir de dados do
 * Google.
 */
export function CompanySetupPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, memberships, applySession, refresh, logout, isPlatformAdmin } = useAuth();
  const [generalError, setGeneralError] = useState<string | null>(null);
  const { values, errors, setField, applyApiError } = useForm({
    companyName: '',
    phone: user?.phone ?? '',
    acceptedTerms: false,
  });

  const create = useMutation(authApi.createCompany, {
    onSuccess: async (result) => {
      applySession(result.session);
      await refresh();
      toast.success('Empresa cadastrada', 'Seu painel está pronto.');
      navigate('/painel', { replace: true });
    },
    onError: (error) => {
      applyApiError(error);
      setGeneralError(Object.keys(error.fieldErrors).length > 0 ? null : error.message);
    },
  });

  // Quem ja pertence a uma empresa (ou administra a plataforma) nao passa por aqui.
  if (memberships.length > 0 || isPlatformAdmin) return <Navigate to="/painel" replace />;

  const previewSlug = slugify(values.companyName);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Cadastre a sua empresa</h1>
      <p className="mt-1.5 text-sm text-slate-600">
        Você entrou como <strong>{user?.email}</strong>. Falta só o nome da empresa para abrir o painel.
      </p>

      <form
        className="mt-8 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setGeneralError(null);
          void create.run(values);
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
        {errors.acceptedTerms ? (
          <p className="-mt-2 text-xs font-medium text-rose-600">{errors.acceptedTerms}</p>
        ) : null}

        <Button type="submit" size="lg" loading={create.loading}>
          Cadastrar empresa
        </Button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Foi convidado para uma empresa? Use o link do convite que chegou por e-mail.{' '}
        <button type="button" className="link" onClick={() => void logout().then(() => navigate('/entrar', { replace: true }))}>
          Sair
        </button>
      </p>
    </div>
  );
}
