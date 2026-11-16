import { useState } from 'react';
import { AlertTriangle, Copy, KeyRound, RefreshCw, ShieldOff } from 'lucide-react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, PageHeader, Switch, Tabs, useToast } from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { selfServiceApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';

/**
 * Autoatendimento: chaves de integracao e modulos do site.
 *
 * Duas coisas que antes exigiam abrir chamado. A tela e honesta sobre o que
 * cada acao faz: revogar uma chave DERRUBA o site do cliente ate o valor novo
 * ser publicado, e desligar um modulo ESCONDE o conteudo do site. As duas
 * coisas sao ditas antes, nao depois.
 */
export function IntegrationPage() {
  const tenantId = useTenantId();
  const { can } = useAuth();
  const [tab, setTab] = useState('chaves');

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Integração"
        description="As chaves que ligam seu site à plataforma e os módulos de conteúdo disponíveis."
      />
      <Tabs
        active={tab}
        onChange={setTab}
        items={[
          { id: 'chaves', label: 'Chaves de acesso' },
          { id: 'modulos', label: 'Módulos' },
        ]}
      />
      {tab === 'chaves' ? (
        <PainelDeChaves tenantId={tenantId} podeGerenciar={can('integration:manage')} />
      ) : (
        <PainelDeModulos tenantId={tenantId} podeGerenciar={can('integration:manage')} />
      )}
    </div>
  );
}

const SITUACAO: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  ativa: { label: 'Ativa', tone: 'success' },
  expirando: { label: 'Expirando', tone: 'warning' },
  revogada: { label: 'Revogada', tone: 'neutral' },
  expirada: { label: 'Expirada', tone: 'neutral' },
};

const data = (valor: string | null) =>
  valor ? new Date(valor).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

function PainelDeChaves({ tenantId, podeGerenciar }: { tenantId: string; podeGerenciar: boolean }) {
  const toast = useToast();
  const chaves = useResource('selfService.keys', () => selfServiceApi.keys(tenantId), [tenantId]);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [novoSegredo, setNovoSegredo] = useState<{ token: string; notice: string } | null>(null);

  const revogar = useMutation((keyId: string) => selfServiceApi.revokeKey(tenantId, keyId), {
    onSuccess: () => {
      setConfirmando(null);
      void chaves.reload();
      toast.success('Chave revogada', 'O site precisa de uma chave nova para voltar a receber conteúdo.');
    },
    onError: (e) => toast.error('Não foi possível revogar', e.message),
  });

  const rotacionar = useMutation((keyId: string) => selfServiceApi.rotateKey(tenantId, keyId, 60), {
    onSuccess: (r) => {
      setNovoSegredo({ token: r.token, notice: r.notice });
      void chaves.reload();
    },
    onError: (e) => toast.error('Não foi possível trocar a chave', e.message),
  });

  return (
    <ResourcePanel resource={chaves}>
      {(dados) => (
        <div className="grid gap-4">
          {novoSegredo ? (
            <Card>
              <CardHeader
                title="Copie a chave nova agora"
                description="Ela não será mostrada de novo. Publique este valor no seu site."
              />
              <CardBody className="grid gap-3">
                <p className="select-all break-all rounded-xl bg-slate-50 p-4 font-mono text-sm text-slate-900">
                  {novoSegredo.token}
                </p>
                <Alert tone="warning">{novoSegredo.notice}</Alert>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(novoSegredo.token)
                        .then(() => toast.success('Chave copiada'))
                        .catch(() => toast.error('Não foi possível copiar'));
                    }}
                  >
                    <Copy className="size-4" /> Copiar
                  </Button>
                  <Button onClick={() => setNovoSegredo(null)}>Já copiei</Button>
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Alert tone="info">{dados.issueNotice}</Alert>

          {dados.keys.length === 0 ? (
            <Card>
              <CardBody className="py-10 text-center">
                <KeyRound className="mx-auto size-8 text-slate-300" />
                <p className="mt-3 text-sm text-slate-600">
                  Nenhuma chave emitida ainda. A CODECA IA emite a chave quando conecta o seu site.
                </p>
              </CardBody>
            </Card>
          ) : (
            dados.keys.map((chave) => (
              <Card key={chave.id}>
                <CardBody className="grid gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-900">
                          {chave.name || (chave.kind === 'secret' ? 'Chave secreta' : 'Chave pública')}
                        </h3>
                        <Badge tone={SITUACAO[chave.status]?.tone ?? 'neutral'}>
                          {SITUACAO[chave.status]?.label ?? chave.status}
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-sm text-slate-500">{chave.hint}</p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-slate-500">Criada em</dt>
                      <dd className="font-medium text-slate-800">{data(chave.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Último uso</dt>
                      <dd className="font-medium text-slate-800">{data(chave.lastUsedAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Validade</dt>
                      <dd className="font-medium text-slate-800">{data(chave.expiresAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Permissões</dt>
                      <dd className="font-medium text-slate-800">{chave.scopes.length}</dd>
                    </div>
                  </dl>

                  {chave.kind === 'publishable' && chave.token ? (
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Chave pública (vai no código do site)
                      </p>
                      <p className="mt-1 select-all break-all font-mono text-sm text-slate-800">{chave.token}</p>
                    </div>
                  ) : null}

                  {podeGerenciar && !chave.revokedAt ? (
                    confirmando === chave.id ? (
                      <Alert tone="danger" title="Revogar esta chave agora?">
                        <p className="text-sm">
                          O site que usa esta chave para de receber conteúdo imediatamente, até você publicar
                          uma chave nova. Faça isto se a chave vazou.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="danger" loading={revogar.loading} onClick={() => void revogar.run(chave.id)}>
                            Sim, revogar
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirmando(null)}>
                            Cancelar
                          </Button>
                        </div>
                      </Alert>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={rotacionar.loading}
                          onClick={() => void rotacionar.run(chave.id)}
                        >
                          <RefreshCw className="size-4" /> Trocar por uma nova
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmando(chave.id)}>
                          <ShieldOff className="size-4" /> Revogar
                        </Button>
                      </div>
                    )
                  ) : null}
                </CardBody>
              </Card>
            ))
          )}
        </div>
      )}
    </ResourcePanel>
  );
}

function PainelDeModulos({ tenantId, podeGerenciar }: { tenantId: string; podeGerenciar: boolean }) {
  const toast = useToast();
  const modulos = useResource('selfService.modules', () => selfServiceApi.modules(tenantId), [tenantId]);
  const [pendente, setPendente] = useState<{
    key: string;
    enabled: boolean;
    impacto: { moduleName: string; records: number; warnings: string[] };
  } | null>(null);

  const prever = useMutation(
    ({ key, enabled }: { key: string; enabled: boolean }) =>
      selfServiceApi.toggleModule(tenantId, key, enabled, true),
    {
      onSuccess: (r, variaveis) => {
        // Sem nada a avisar, aplica direto: confirmacao vazia e so atrito.
        if (r.impacto.warnings.length === 0) {
          void aplicar.run(variaveis);
          return;
        }
        setPendente({ key: variaveis.key, enabled: variaveis.enabled, impacto: r.impacto });
      },
      onError: (e) => toast.error('Não foi possível verificar', e.message),
    },
  );

  const aplicar = useMutation(
    ({ key, enabled }: { key: string; enabled: boolean }) =>
      selfServiceApi.toggleModule(tenantId, key, enabled, false),
    {
      onSuccess: (_r, variaveis) => {
        setPendente(null);
        void modulos.reload();
        toast.success(variaveis.enabled ? 'Módulo ligado' : 'Módulo desligado');
      },
      onError: (e) => toast.error('Não foi possível alterar', e.message),
    },
  );

  return (
    <ResourcePanel resource={modulos}>
      {(dados) => (
        <div className="grid gap-4">
          {dados.notice ? <Alert tone="info">{dados.notice}</Alert> : null}

          {pendente ? (
            <Alert
              tone="warning"
              title={`${pendente.enabled ? 'Ligar' : 'Desligar'} ${pendente.impacto.moduleName}?`}
            >
              <ul className="ml-4 list-disc space-y-1 text-sm">
                {pendente.impacto.warnings.map((aviso) => (
                  <li key={aviso}>{aviso}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  loading={aplicar.loading}
                  onClick={() => void aplicar.run({ key: pendente.key, enabled: pendente.enabled })}
                >
                  Confirmar
                </Button>
                <Button variant="ghost" onClick={() => setPendente(null)}>
                  Cancelar
                </Button>
              </div>
            </Alert>
          ) : null}

          <Card>
            <CardHeader
              title="Módulos de conteúdo"
              description="Desligar um módulo esconde o conteúdo dele do site. Nada é apagado, e ligar de novo traz tudo de volta."
            />
            <CardBody className="divide-y divide-slate-100">
              {dados.modules.map((modulo) => (
                <div key={modulo.key} className="py-1 first:pt-0">
                  {/*
                    O proprio `Switch` ja mostra nome e descricao e cuida do
                    rotulo para leitor de tela -- passar um rotulo proprio
                    duplicava o texto na tela.
                  */}
                  <Switch
                    label={modulo.name}
                    hint={modulo.description}
                    checked={modulo.enabled}
                    disabled={!podeGerenciar || !modulo.manageable || prever.loading || aplicar.loading}
                    onChange={(valor) => void prever.run({ key: modulo.key, enabled: valor })}
                  />
                  {modulo.dependsOn.length > 0 ? (
                    <p className="-mt-1 flex items-center gap-1.5 pb-2 text-xs text-slate-500">
                      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                      Usa {modulo.dependsOn.map((d) => d.name).join(', ')}
                    </p>
                  ) : null}
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      )}
    </ResourcePanel>
  );
}
