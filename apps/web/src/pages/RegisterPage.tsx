import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Checkbox, TextInput, useToast } from '@codeca/ui';
import { slugify } from '@codeca/shared';
import { GoogleResultAlert, GoogleSignIn, OrDivider, useGoogleResult } from '../components/GoogleAuth.js';
import { useAuth } from '../hooks/useAuth.js';
import { DesafioDeBot } from '../components/DesafioDeBot.js';
import { useMutation } from '../hooks/useResource.js';
import { authApi } from '../services/endpoints.js';
import { useForm } from '../utils/forms.js';

export function RegisterPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { applySession, refresh, features } = useAuth();
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
  // `null` enquanto o desafio nao foi resolvido. Com o desafio desligado o
  // valor nunca e consultado.
  const [botToken, setBotToken] = useState<string | null>(null);
  // A regra da senha so aparece quando ela esta em foco (ou em erro). Fora
  // desses dois momentos ela ocupa uma linha sem informar nada: quem ainda
  // nao chegou no campo nao vai ler, e quem ja preencheu nao precisa mais.
  const [senhaEmFoco, setSenhaEmFoco] = useState(false);

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

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Criar a conta da empresa</h1>
      <p className="mt-1 text-sm text-slate-600">
        Já tem conta?{' '}
        <Link to="/entrar" className="link">
          Entrar
        </Link>
      </p>

      <div className="mt-4 grid gap-2.5">
        <GoogleResultAlert code={google.code} onDismiss={google.dismiss} />
        {/*
          O separador sai de dentro do componente e vem para ca, depois do
          aviso.

          O aviso fala do Google. Com o "ou" no meio, ele caia do lado do
          formulario e parecia valer para o cadastro por e-mail -- justamente
          a confusao que esta reorganizacao deveria desfazer.
        */}
        <GoogleSignIn compacto showDivider={false} onError={(message) => setGeneralError(message)} />
        {/*
          Reduzido a uma linha, e nao removido.

          O aceite do checkbox abaixo nao cobre quem entra pelo Google: esse
          caminho nao passa por este formulario, entao o checkbox nunca e
          marcado. Apagar o aviso deixaria o cadastro por Google sem nenhuma
          mencao aos termos.
        */}
        <p className="-mt-0.5 text-xs text-slate-500">
          Pelo Google, você aceita os <Link to="/termos" className="link">termos</Link> e a{' '}
          <Link to="/privacidade" className="link">política de privacidade</Link>.
        </p>
        <OrDivider />
      </div>

      <form
        className="mt-2 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setGeneralError(null);
          void register.run({ ...values, ...(botToken ? { botToken } : {}) });
        }}
      >
        {generalError ? <Alert tone="danger">{generalError}</Alert> : null}

        {/*
          Duas colunas a partir de 768px, uma abaixo disso.

          `md` e nao `lg`: entre 768 e 1024 a apresentacao ainda esta embaixo,
          entao a coluna do formulario ocupa a largura toda e comporta o par
          com folga. A partir de 1024 ela divide a tela com a apresentacao, e
          os 448px continuam dando 218px por campo.
        */}
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            compacto
            label="Nome da empresa"
            required
            autoComplete="organization"
            placeholder="Nome da sua empresa"
            value={values.companyName}
            error={errors.companyName}
            onChange={(event) => setField('companyName', event.target.value)}
          />

          <TextInput
            compacto
            label="Seu nome"
            required
            autoComplete="name"
            value={values.name}
            error={errors.name}
            onChange={(event) => setField('name', event.target.value)}
          />

          {/*
            O endereco interno ocupa a largura do par, em UMA linha truncada.

            Duas tentativas anteriores foram medidas e descartadas. Como dica
            comum do campo, o texto quebrava em duas linhas dentro dos 202px da
            coluna e custava 36px. Flutuando ao lado do rotulo, custava 16px e
            empurrava o proprio rotulo para duas linhas, deixando a previa em
            `construtora...` -- sem altura economizada de verdade e sem
            informacao. Ocupando a largura inteira, cabe em uma linha e custa
            os 28px previstos, com o nome legivel.
          */}
          {previewSlug ? (
            <p className="truncate text-xs text-slate-500 md:col-span-2">
              Endereço interno: <span className="font-medium text-slate-600">{previewSlug}</span>
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            compacto
            label="E-mail"
            type="email"
            required
            autoComplete="email"
            placeholder="voce@empresa.com.br"
            // A explicacao saiu da linha fixa abaixo do campo e virou dica do
            // proprio campo: o rotulo ja diz o que e, e o texto so acrescenta
            // para quem parar em cima.
            title="Usado para entrar no painel e como contato inicial do site."
            value={values.email}
            error={errors.email}
            onChange={(event) => setField('email', event.target.value)}
          />

          <TextInput
            compacto
            label="Telefone"
            autoComplete="tel"
            placeholder="(19) 99999-0000"
            value={values.phone}
            error={errors.phone}
            onChange={(event) => setField('phone', event.target.value)}
          />
        </div>

        <TextInput
          compacto
          label="Senha"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Ao menos 10 caracteres, com letras e números"
          value={values.password}
          error={errors.password}
          hint={senhaEmFoco ? 'Ao menos 10 caracteres, com letras e números.' : undefined}
          onFocus={() => setSenhaEmFoco(true)}
          onBlur={() => setSenhaEmFoco(false)}
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

        <DesafioDeBot siteKey={features.turnstileSiteKey} onToken={setBotToken} />

        <Button
          type="submit"
          size="md"
          loading={register.loading}
          disabled={features.botProtection && !botToken}
        >
          Criar conta
        </Button>
      </form>
    </div>
  );
}
