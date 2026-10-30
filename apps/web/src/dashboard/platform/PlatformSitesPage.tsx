import { useEffect, useMemo, useState } from 'react';
import { Copy, KeyRound, Plus, RotateCw, Save, Trash2 } from 'lucide-react';
import { formatDateTime } from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Modal,
  PageHeader,
  Select,
  Switch,
  Tabs,
  TextArea,
  TextInput,
  useToast,
  type Column,
} from '@codeca/ui';
import { useResource, useMutation } from '../../hooks/useResource.js';
import { platformSiteApi } from '../../services/endpoints.js';
import { ResourcePanel } from '../../components/ResourcePanel.js';
import type { IssuedKey, SiteApiKeyRow, SiteModuleView, SiteStatus } from '../../types/index.js';

/**
 * Configuracao dos sites pela CODECA IA.
 *
 * Reune num lugar so o que antes exigia chamadas de API soltas: identidade do
 * projeto, modulos que o cliente enxerga, campos que ele pode editar, origens
 * autorizadas e credenciais de integracao.
 */

const STATUS_LABELS: Record<SiteStatus, string> = {
  draft: 'Em desenvolvimento',
  active: 'No ar',
  suspended: 'Suspenso',
  archived: 'Arquivado',
};

const ABAS = [
  { id: 'identidade', label: 'Identidade' },
  { id: 'modulos', label: 'Modulos e campos' },
  { id: 'origens', label: 'Origens' },
  { id: 'chaves', label: 'Chaves' },
] as const;

export function PlatformSitesPage() {
  const sites = useResource(() => platformSiteApi.list(), []);
  const [siteId, setSiteId] = useState<string | null>(null);

  const colunas: Array<Column<{ id: string; name: string; tenantName: string; status: SiteStatus; segment: string | null }>> = [
    {
      key: 'name',
      header: 'Site',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{row.name}</p>
          <p className="truncate text-xs text-slate-500">{row.tenantName}</p>
        </div>
      ),
    },
    {
      key: 'segment',
      header: 'Segmento',
      hideOnMobile: true,
      render: (row) => <span className="text-xs text-slate-600">{row.segment ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Situacao',
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'success' : row.status === 'suspended' ? 'danger' : 'neutral'}>
          {STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      key: 'acao',
      header: '',
      render: (row) => (
        <Button variant="outline" size="sm" onClick={() => setSiteId(row.id)}>
          Configurar
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sites"
        description="Projetos integrados a plataforma. Configure modulos, campos editaveis, origens e credenciais."
      />

      <ResourcePanel resource={sites}>
        {(data) => (
          <Card>
            <DataTable
              columns={colunas}
              rows={data.items}
              rowKey={(row) => row.id}
              empty="Nenhum site cadastrado ainda."
            />
          </Card>
        )}
      </ResourcePanel>

      {siteId ? <ConfiguracaoDoSite siteId={siteId} onClose={() => setSiteId(null)} /> : null}
    </div>
  );
}

function ConfiguracaoDoSite({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const [aba, setAba] = useState<string>('identidade');
  const detalhe = useResource(() => platformSiteApi.detail(siteId), [siteId]);

  return (
    <Card>
      <CardHeader
        title="Configuracao do site"
        description="O cliente so enxerga o que estiver habilitado aqui."
        actions={
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        }
      />
      <CardBody className="space-y-5">
        <Tabs items={ABAS} active={aba} onChange={setAba} />

        <ResourcePanel resource={detalhe}>
          {(data) => (
            <>
              {aba === 'identidade' ? (
                <AbaIdentidade siteId={siteId} site={data.site} onSaved={() => void detalhe.reload()} />
              ) : null}
              {aba === 'modulos' ? (
                <AbaModulos siteId={siteId} modules={data.modules} onSaved={() => void detalhe.reload()} />
              ) : null}
              {aba === 'origens' ? <AbaOrigens siteId={siteId} /> : null}
              {aba === 'chaves' ? <AbaChaves siteId={siteId} /> : null}
            </>
          )}
        </ResourcePanel>
      </CardBody>
    </Card>
  );
}

// ------------------------------------------------------------- identidade

function AbaIdentidade({
  siteId,
  site,
  onSaved,
}: {
  siteId: string;
  site: { name: string; status: SiteStatus; internalNotes: string; slug: string };
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(site.name);
  const [status, setStatus] = useState<SiteStatus>(site.status);
  const [internalNotes, setInternalNotes] = useState(site.internalNotes);

  const salvar = useMutation(
    () => platformSiteApi.update(siteId, { name, status, internalNotes }),
    {
      onSuccess: () => {
        toast.success('Site atualizado');
        onSaved();
      },
      onError: (error) => toast.error('Nao foi possivel salvar', error.message),
    },
  );

  return (
    <div className="grid gap-4 md:max-w-2xl">
      <TextInput label="Nome do projeto" value={name} onChange={(e) => setName(e.target.value)} />
      <Select
        label="Situacao"
        value={status}
        onChange={(e) => setStatus(e.target.value as SiteStatus)}
        options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
        hint="Em desenvolvimento ate a integracao do site ficar pronta."
      />
      <TextArea
        label="Anotacoes internas"
        value={internalNotes}
        rows={3}
        hint="Visivel apenas para a CODECA IA. O cliente nunca ve este campo."
        onChange={(e) => setInternalNotes(e.target.value)}
      />
      <div>
        <Button onClick={() => void salvar.run(undefined)} disabled={salvar.loading}>
          <Save aria-hidden="true" className="size-4" />
          Salvar
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- modulos

function AbaModulos({
  siteId,
  modules,
  onSaved,
}: {
  siteId: string;
  modules: SiteModuleView[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [estado, setEstado] = useState(modules);
  useEffect(() => setEstado(modules), [modules]);

  const salvar = useMutation(
    () =>
      platformSiteApi.saveModules(siteId, {
        modules: estado.map((m) => ({ key: m.key, enabled: m.enabled, settings: m.settings })),
        // Enviamos a politica inteira; o servidor guarda so o que difere do
        // padrao do registro.
        fieldPolicies: estado.flatMap((m) =>
          m.fields.map((f) => ({
            moduleKey: m.key,
            fieldKey: f.key,
            editable: f.editable,
            note: '',
          })),
        ),
      }),
    {
      onSuccess: () => {
        toast.success('Modulos atualizados');
        onSaved();
      },
      onError: (error) => toast.error('Nao foi possivel salvar', error.message),
    },
  );

  function alternarModulo(key: string, enabled: boolean) {
    setEstado((atual) => atual.map((m) => (m.key === key ? { ...m, enabled } : m)));
  }

  function alternarCampo(moduleKey: string, fieldKey: string, editable: boolean) {
    setEstado((atual) =>
      atual.map((m) =>
        m.key === moduleKey
          ? { ...m, fields: m.fields.map((f) => (f.key === fieldKey ? { ...f, editable } : f)) }
          : m,
      ),
    );
  }

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Como o cliente ve isto">
        Modulo desligado some do painel dele e da API do site. Campo desmarcado aparece, mas
        bloqueado para edicao &mdash; o conteudo continua sendo entregue ao site.
      </Alert>

      {estado.map((modulo) => (
        <Card key={modulo.key}>
          <CardHeader
            title={modulo.name}
            description={modulo.description}
            actions={
              <Switch
                label={modulo.enabled ? 'Habilitado' : 'Desabilitado'}
                checked={modulo.enabled}
                onChange={(checked) => alternarModulo(modulo.key, checked)}
              />
            }
          />
          {modulo.enabled ? (
            <CardBody>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Campos que o cliente pode editar
              </p>
              <div className="grid gap-x-6 sm:grid-cols-2">
                {modulo.fields.map((campo) => (
                  <Switch
                    key={campo.key}
                    label={campo.label}
                    {...(campo.help ? { hint: campo.help } : {})}
                    checked={campo.editable}
                    onChange={(checked) => alternarCampo(modulo.key, campo.key, checked)}
                  />
                ))}
              </div>
            </CardBody>
          ) : null}
        </Card>
      ))}

      <Button onClick={() => void salvar.run(undefined)} disabled={salvar.loading}>
        <Save aria-hidden="true" className="size-4" />
        Salvar configuracao
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- origens

function AbaOrigens({ siteId }: { siteId: string }) {
  const toast = useToast();
  const lista = useResource(() => platformSiteApi.origins(siteId), [siteId]);
  const [origens, setOrigens] = useState<Array<{ origin: string; note: string }>>([]);
  const [nova, setNova] = useState('');

  useEffect(() => {
    if (lista.data) setOrigens(lista.data.items.map((o) => ({ origin: o.origin, note: o.note })));
  }, [lista.data]);

  const salvar = useMutation(
    (proximas: Array<{ origin: string; note: string }>) =>
      platformSiteApi.saveOrigins(siteId, { origins: proximas }),
    {
      onSuccess: () => {
        toast.success('Origens atualizadas');
        void lista.reload();
      },
      onError: (error) => toast.error('Endereco recusado', error.message),
    },
  );

  return (
    <div className="space-y-4 md:max-w-2xl">
      <Alert tone="warning" title="Sem origem cadastrada, a chave publicavel nao atende">
        Cadastre o endereco do site em producao e, se usar, o da previa. A comparacao e exata:
        <code className="mx-1">https://exemplo.com.br</code> nao autoriza
        <code className="mx-1">https://www.exemplo.com.br</code>.
      </Alert>

      <div className="flex gap-2">
        <TextInput
          label="Endereco do site"
          placeholder="https://construtora.com.br"
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          className="flex-1"
        />
        <div className="self-end">
          <Button
            variant="outline"
            disabled={!nova.trim() || salvar.loading}
            onClick={() => {
              const proximas = [...origens, { origin: nova.trim(), note: '' }];
              setNova('');
              void salvar.run(proximas);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            Adicionar
          </Button>
        </div>
      </div>

      <ResourcePanel resource={lista}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma origem cadastrada.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
              {data.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <code className="truncate text-sm text-slate-700">{item.origin}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void salvar.run(origens.filter((o) => o.origin !== item.origin))
                    }
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    <span className="sr-only">Remover {item.origin}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )
        }
      </ResourcePanel>
    </div>
  );
}

// ----------------------------------------------------------------- chaves

function AbaChaves({ siteId }: { siteId: string }) {
  const toast = useToast();
  const lista = useResource(() => platformSiteApi.keys(siteId), [siteId]);
  const [emitida, setEmitida] = useState<IssuedKey | null>(null);
  const [revogar, setRevogar] = useState<SiteApiKeyRow | null>(null);

  const criar = useMutation(
    (kind: 'publishable' | 'secret') => platformSiteApi.createKey(siteId, { kind, name: '' }),
    {
      onSuccess: (resultado) => {
        // A secreta so existe aqui, nesta resposta. Guardamos em memoria para
        // mostrar uma vez e nada alem disso.
        if (resultado.showOnce) setEmitida(resultado.key);
        else toast.success('Chave publicavel criada');
        void lista.reload();
      },
      onError: (error) => toast.error('Nao foi possivel criar', error.message),
    },
  );

  const rotacionar = useMutation(
    (keyId: string) => platformSiteApi.rotateKey(siteId, keyId, { graceMinutes: 60 }),
    {
      onSuccess: (resultado) => {
        if (resultado.showOnce) setEmitida(resultado.key);
        toast.success('Chave rotacionada', 'A anterior ainda vale por 60 minutos.');
        void lista.reload();
      },
      onError: (error) => toast.error('Nao foi possivel rotacionar', error.message),
    },
  );

  const revogarChave = useMutation((keyId: string) => platformSiteApi.revokeKey(siteId, keyId), {
    onSuccess: () => {
      toast.success('Chave revogada', 'Ela para de atender imediatamente.');
      setRevogar(null);
      void lista.reload();
    },
    onError: (error) => toast.error('Nao foi possivel revogar', error.message),
  });

  async function copiar(valor: string) {
    try {
      await navigator.clipboard.writeText(valor);
      toast.success('Copiado');
    } catch {
      toast.error('Nao foi possivel copiar', 'Selecione o texto e copie manualmente.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void criar.run('publishable')} disabled={criar.loading}>
          <KeyRound aria-hidden="true" className="size-4" />
          Nova chave publicavel
        </Button>
        <Button variant="outline" onClick={() => void criar.run('secret')} disabled={criar.loading}>
          <KeyRound aria-hidden="true" className="size-4" />
          Nova chave secreta
        </Button>
      </div>

      <ResourcePanel resource={lista}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma chave emitida.</p>
          ) : (
            <ul className="space-y-2">
              {data.items.map((chave) => (
                <li key={chave.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge tone={chave.kind === 'secret' ? 'warning' : 'brand'}>
                          {chave.kind === 'secret' ? 'secreta' : 'publicavel'}
                        </Badge>
                        {chave.revokedAt ? <Badge tone="danger">revogada</Badge> : null}
                        {chave.expiresAt && !chave.revokedAt ? (
                          <Badge tone="neutral">expira {formatDateTime(chave.expiresAt)}</Badge>
                        ) : null}
                      </div>
                      <code className="mt-1 block truncate text-xs text-slate-600">{chave.token}</code>
                      <p className="mt-1 text-xs text-slate-500">
                        {chave.lastUsedAt
                          ? `Usada por ultimo em ${formatDateTime(chave.lastUsedAt)}`
                          : 'Nunca usada'}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {chave.kind === 'publishable' && chave.token ? (
                        <Button variant="ghost" size="sm" onClick={() => void copiar(chave.token!)}>
                          <Copy aria-hidden="true" className="size-4" />
                          <span className="sr-only">Copiar chave</span>
                        </Button>
                      ) : null}
                      {!chave.revokedAt ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void rotacionar.run(chave.id)}
                            disabled={rotacionar.loading}
                          >
                            <RotateCw aria-hidden="true" className="size-4" />
                            <span className="sr-only">Rotacionar</span>
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setRevogar(chave)}>
                            <Trash2 aria-hidden="true" className="size-4" />
                            <span className="sr-only">Revogar</span>
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </ResourcePanel>

      <ChaveEmitida chave={emitida} onClose={() => setEmitida(null)} onCopy={copiar} />

      <ConfirmDialog
        open={revogar !== null}
        title="Revogar esta chave?"
        message="Ela para de atender imediatamente, sem janela de transicao. Se o site do cliente ainda a estiver usando, ele sai do ar. Para trocar sem derrubar, use rotacionar."
        confirmLabel="Revogar"
        tone="danger"
        onCancel={() => setRevogar(null)}
        onConfirm={() => {
          if (revogar) void revogarChave.run(revogar.id);
        }}
      />
    </div>
  );
}

/**
 * A chave secreta, mostrada uma unica vez.
 *
 * Depois deste modal ela nao existe em lugar nenhum fora do site do cliente:
 * o banco guarda so o hash. A tela precisa deixar isso evidente antes de o
 * operador fechar a janela.
 */
function ChaveEmitida({
  chave,
  onClose,
  onCopy,
}: {
  chave: IssuedKey | null;
  onClose: () => void;
  onCopy: (valor: string) => void;
}) {
  return (
    <Modal
      open={chave !== null}
      onClose={onClose}
      title="Copie a chave agora"
      description="Esta e a unica vez que ela aparece. Guardamos apenas o hash; se perder, sera preciso rotacionar."
      footer={
        <Button onClick={onClose}>Ja copiei</Button>
      }
    >
      {chave ? (
        <div className="space-y-3">
          <Alert tone="warning" title="Chave secreta: nunca no navegador">
            Use somente no servidor do site. Nao coloque em variavel <code>VITE_*</code>, em
            componente de cliente nem no repositorio.
          </Alert>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <code className="flex-1 break-all text-xs text-slate-800">{chave.token}</code>
            <Button variant="outline" size="sm" onClick={() => onCopy(chave.token)}>
              <Copy aria-hidden="true" className="size-4" />
              Copiar
            </Button>
          </div>
          <p className="text-xs text-slate-500">Escopos: {chave.scopes.join(', ')}</p>
        </div>
      ) : null}
    </Modal>
  );
}
