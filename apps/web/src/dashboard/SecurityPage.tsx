import { useState } from 'react';
import { Check, Copy, KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, PageHeader, TextInput, useToast } from '@codeca/ui';
import { useMutation, useResource } from '../hooks/useResource.js';
import { authApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';

/**
 * Verificacao em duas etapas da conta.
 *
 * A tela tem tres estados, e nenhum deles esconde o que esta acontecendo:
 * desligada (explica o que e), em configuracao (QR Code e conferencia) e
 * ligada (quantos codigos restam, e como desligar).
 *
 * Os codigos de recuperacao aparecem UMA vez. A tela diz isso antes de
 * mostra-los, e nao deixa seguir sem um passo deliberado.
 */
export function SecurityPage() {
  const toast = useToast();
  const estado = useResource('authApi.totpState', () => authApi.totpState(), []);

  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [recuperacao, setRecuperacao] = useState<string[] | null>(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [desligando, setDesligando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const iniciar = useMutation(authApi.totpSetup, {
    onSuccess: (r) => {
      setSetup(r);
      setErro(null);
      setCodigo('');
    },
    onError: (e) => setErro(e.message),
  });

  const confirmar = useMutation(authApi.totpConfirm, {
    onSuccess: (r) => {
      setRecuperacao(r.recoveryCodes);
      setSetup(null);
      setCodigo('');
      setErro(null);
      void estado.reload();
      toast.success('Verificação em duas etapas ativada');
    },
    onError: (e) => setErro(e.message),
  });

  const desligar = useMutation(authApi.totpDisable, {
    onSuccess: () => {
      setDesligando(false);
      setConfirmacao('');
      setErro(null);
      void estado.reload();
      toast.success('Verificação em duas etapas desligada');
    },
    onError: (e) => setErro(e.message),
  });

  const novosCodigos = useMutation(authApi.totpRecoveryCodes, {
    onSuccess: (r) => {
      setRecuperacao(r.recoveryCodes);
      setConfirmacao('');
      setErro(null);
      void estado.reload();
    },
    onError: (e) => setErro(e.message),
  });

  const copiar = async (texto: string, oQue: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(`${oQue} copiado`);
    } catch {
      toast.error('Não foi possível copiar', 'Selecione o texto e copie manualmente.');
    }
  };

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Segurança"
        description="Proteja sua conta com uma segunda etapa no login."
      />

      {/* Codigos de recuperacao: aparecem uma unica vez. */}
      {recuperacao ? (
        <Card>
          <CardHeader
            title="Guarde estes códigos agora"
            description="Eles não serão mostrados de novo. Cada um funciona uma única vez, para entrar se você perder o celular."
          />
          <CardBody className="grid gap-4">
            <ul className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-4 font-mono text-sm sm:grid-cols-4">
              {recuperacao.map((c) => (
                <li key={c} className="text-center tracking-wider text-slate-800">
                  {c}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void copiar(recuperacao.join('\n'), 'Códigos')}>
                <Copy className="size-4" /> Copiar todos
              </Button>
              <Button onClick={() => setRecuperacao(null)}>
                <Check className="size-4" /> Guardei os códigos
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <ResourcePanel resource={estado}>
        {(dados) => (
          <div className="grid gap-6">
            {erro ? <Alert tone="danger">{erro}</Alert> : null}

            {/* ------------------------------------------------ desligada */}
            {!dados.enabled && !setup ? (
              <Card>
                <CardHeader
                  title="Aplicativo autenticador"
                  description="Além da senha, o login pede um código de 6 dígitos que muda a cada 30 segundos."
                />
                <CardBody className="grid gap-4">
                  <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-4">
                    <Smartphone className="mt-0.5 size-5 shrink-0 text-slate-500" />
                    <p className="text-sm leading-relaxed text-slate-600">
                      Funciona com Google Authenticator, Microsoft Authenticator, 1Password e outros
                      aplicativos do tipo. Você instala um deles no celular, aponta a câmera para um código
                      e pronto — nada é enviado por e-mail.
                    </p>
                  </div>
                  <div>
                    <Button onClick={() => void iniciar.run(undefined)} loading={iniciar.loading}>
                      <ShieldCheck className="size-4" /> Ativar verificação em duas etapas
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ) : null}

            {/* -------------------------------------------- configurando */}
            {setup ? (
              <Card>
                <CardHeader
                  title="Configure o aplicativo"
                  description="Adicione a conta ao aplicativo e confirme com o código que ele mostrar."
                />
                <CardBody className="grid gap-5">
                  <ChaveParaOAplicativo
                    secret={setup.secret}
                    otpauthUri={setup.otpauthUri}
                    onCopy={(texto, oQue) => void copiar(texto, oQue)}
                  />
                  <div className="grid gap-5">
                    <div className="grid gap-3 sm:max-w-sm">
                      <TextInput
                        label="Código do aplicativo"
                        name="codigo"
                        value={codigo}
                        onChange={(e) => setCodigo(e.target.value)}
                        placeholder="000000"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        hint="Digite os 6 dígitos que aparecem agora no aplicativo."
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void confirmar.run(codigo)}
                      loading={confirmar.loading}
                      disabled={codigo.trim().length !== 6}
                    >
                      Confirmar e ativar
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setSetup(null);
                        setErro(null);
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ) : null}

            {/* --------------------------------------------------- ligada */}
            {dados.enabled ? (
              <>
                <Card>
                  <CardHeader
                    title="Verificação em duas etapas está ativa"
                    description="Seu login pede o código do aplicativo depois da senha."
                  />
                  <CardBody className="grid gap-4">
                    <Alert tone={dados.recoveryCodesLeft > 2 ? 'success' : 'warning'}>
                      {dados.recoveryCodesLeft > 0
                        ? `Você tem ${dados.recoveryCodesLeft} código(s) de recuperação não usados.`
                        : 'Você não tem mais códigos de recuperação. Gere uma lista nova agora.'}
                    </Alert>

                    <div className="grid gap-3 sm:max-w-sm">
                      <TextInput
                        label="Sua senha"
                        name="confirmacao"
                        type="password"
                        value={confirmacao}
                        onChange={(e) => setConfirmacao(e.target.value)}
                        hint="Pedimos de novo porque estas ações mexem na proteção da conta. Se você entrou com o Google, use um código do aplicativo."
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          loading={novosCodigos.loading}
                          disabled={confirmacao.trim().length === 0}
                          onClick={() => void novosCodigos.run(prova(confirmacao))}
                        >
                          <KeyRound className="size-4" /> Gerar novos códigos
                        </Button>
                        <Button
                          variant="danger"
                          loading={desligar.loading}
                          disabled={confirmacao.trim().length === 0}
                          onClick={() => setDesligando(true)}
                        >
                          <ShieldOff className="size-4" /> Desligar
                        </Button>
                      </div>
                    </div>
                  </CardBody>
                </Card>

                {desligando ? (
                  <Card>
                    <CardHeader
                      title="Desligar a verificação em duas etapas?"
                      description="Sua conta volta a ser protegida apenas pela senha, e os códigos de recuperação são apagados."
                    />
                    <CardBody className="flex flex-wrap gap-2">
                      <Button
                        variant="danger"
                        loading={desligar.loading}
                        onClick={() => void desligar.run(prova(confirmacao))}
                      >
                        Sim, desligar
                      </Button>
                      <Button variant="ghost" onClick={() => setDesligando(false)}>
                        Manter ativa
                      </Button>
                    </CardBody>
                  </Card>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </ResourcePanel>
    </div>
  );
}

/**
 * O que a pessoa digitou e senha ou codigo do aplicativo?
 *
 * Seis digitos e um codigo; qualquer outra coisa e senha. O servidor aceita os
 * dois no mesmo corpo e decide de novo -- aqui e so para o campo ser um so.
 */
function prova(valor: string): { password?: string; code?: string } {
  const limpo = valor.trim();
  return /^\d{6}$/.test(limpo) || /^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/.test(limpo)
    ? { code: limpo }
    : { password: limpo };
}

/**
 * Como o aplicativo recebe o segredo.
 *
 * **Sem QR Code nesta versao**, e a razao e deliberada: desenhar um QR Code
 * exige uma biblioteca (a instalacao depende de aprovacao) e mandar o endereco
 * `otpauth://` para um gerador de imagem de terceiros entregaria o segredo da
 * conta a esse terceiro -- o oposto do que esta tela existe para fazer.
 *
 * O que ha no lugar funciona nos dois aparelhos:
 * - **no celular**, o botao abre o aplicativo autenticador direto, ja
 *   configurado. E um toque, mais rapido que apontar a camera;
 * - **no computador**, a chave aparece em grupos de quatro, para ser digitada
 *   sem erro no aplicativo.
 */
function ChaveParaOAplicativo({
  secret,
  otpauthUri,
  onCopy,
}: {
  secret: string;
  otpauthUri: string;
  onCopy: (texto: string, oQue: string) => void;
}) {
  // Grupos de 4: a pessoa vai digitar isto olhando de uma tela para outra.
  const legivel = secret.match(/.{1,4}/g)?.join(' ') ?? secret;

  return (
    <div className="grid gap-4 rounded-xl bg-slate-50 p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          No celular
        </p>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Toque no botão abaixo para abrir o aplicativo autenticador já configurado.
        </p>
        <a
          href={otpauthUri}
          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <Smartphone className="size-4" /> Abrir no aplicativo
        </a>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          No computador, digite esta chave
        </p>
        <p className="mt-1 select-all break-all font-mono text-base tracking-widest text-slate-900">
          {legivel}
        </p>
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => onCopy(secret, 'Chave')}>
          <Copy className="size-4" /> Copiar chave
        </Button>
      </div>
    </div>
  );
}
