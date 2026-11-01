import { useEffect, useMemo, useState } from 'react';
import { Copy, KeyRound, Plus, RotateCw, Save, Trash2 } from 'lucide-react';
import {
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  SAFE_ICONS,
  DELIVERY_STATE_LABELS,
  MODULE_REGISTRY,
  formatDateTime,
  type ModuleKey,
} from '@codeca/shared';
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
import { platformApi, platformSiteApi } from '../../services/endpoints.js';
import { ResourcePanel } from '../../components/ResourcePanel.js';
import { SafeIcon } from '../../components/SafeIcon.js';
import type {
  CustomFieldRow,
  CustomModuleView,
  IssuedKey,
  SiteApiKeyRow,
  SiteModuleView,
  SiteStatus,
  SiteWebhookRow,
} from '../../types/index.js';

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
  { id: 'proprios', label: 'Modulos do projeto' },
  { id: 'campos', label: 'Campos do projeto' },
  { id: 'modulos', label: 'Modulos e campos' },
  { id: 'origens', label: 'Origens' },
  { id: 'chaves', label: 'Chaves' },
  { id: 'avisos', label: 'Avisos de publicacao' },
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
              {aba === 'proprios' ? (
                <AbaModulosProprios siteId={siteId} onSaved={() => void detalhe.reload()} />
              ) : null}
              {aba === 'campos' ? (
                <AbaCampos siteId={siteId} modules={data.modules} onSaved={() => void detalhe.reload()} />
              ) : null}
              {aba === 'modulos' ? (
                <AbaModulos siteId={siteId} modules={data.modules} onSaved={() => void detalhe.reload()} />
              ) : null}
              {aba === 'origens' ? <AbaOrigens siteId={siteId} /> : null}
              {aba === 'chaves' ? <AbaChaves siteId={siteId} /> : null}
              {aba === 'avisos' ? <AbaAvisos siteId={siteId} /> : null}
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
  site: {
    name: string;
    status: SiteStatus;
    internalNotes: string;
    slug: string;
    segmentId: string | null;
  };
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(site.name);
  const [status, setStatus] = useState<SiteStatus>(site.status);
  const [internalNotes, setInternalNotes] = useState(site.internalNotes);
  const [segmentId, setSegmentId] = useState<string>(site.segmentId ?? '');
  const segmentos = useResource(() => platformApi.segments(), []);

  const salvar = useMutation(
    () =>
      platformSiteApi.update(siteId, {
        name,
        status,
        internalNotes,
        segmentId: segmentId === '' ? null : segmentId,
      }),
    {
      onSuccess: () => {
        toast.success('Site atualizado');
        onSaved();
      },
      onError: (error) => toast.error('Nao foi possivel salvar', error.message),
    },
  );

  /**
   * Aplicar o segmento e um pedido separado da gravacao.
   *
   * Trocar o segmento corrige a classificacao do projeto; aplicar o conjunto
   * reconfigura um site em producao. Juntar as duas coisas faria a segunda
   * acontecer sem ninguem ter pedido.
   */
  const aplicar = useMutation(() => platformSiteApi.applySegment(siteId), {
    onSuccess: (resultado) => {
      const ligados = resultado.enabled;
      toast.success(
        ligados.length === 0
          ? 'Nada a mudar: o site ja tem os modulos do segmento'
          : `${ligados.length} modulo(s) habilitado(s)`,
      );
      onSaved();
    },
    onError: (error) => toast.error('Nao foi possivel aplicar', error.message),
  });

  const atual = segmentos.data?.items.find((item) => item.id === segmentId) ?? null;
  const salvo = segmentId === (site.segmentId ?? '');

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

      <Select
        label="Segmento"
        value={segmentId}
        onChange={(e) => setSegmentId(e.target.value)}
        options={[
          { value: '', label: 'Sem segmento' },
          ...(segmentos.data?.items ?? [])
            // Um inativo que o site ja usa continua na lista: senao a tela
            // mostraria "Sem segmento" para um site que tem um.
            .filter((item) => item.isActive || item.id === site.segmentId)
            .map((item) => ({
              value: item.id,
              label: item.isActive ? item.name : `${item.name} (inativo)`,
            })),
        ]}
        hint="Classifica o projeto. Trocar aqui nao mexe nos modulos do site."
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

      {atual ? (
        <div className="grid gap-2 rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-medium text-slate-800">
            Aplicar os modulos de {atual.name} a este site
          </p>
          <p className="text-sm text-slate-600">
            Habilita o que o segmento traz e <strong>nao desliga nada</strong>. Desligar um modulo
            em uso e decisao da aba Modulos, onde da para ver o que esta ligado.
          </p>
          {atual.defaultModules.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {atual.defaultModules.map((key) => (
                <li key={key} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {MODULE_REGISTRY[key].name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-700">
              Este segmento nao tem modulo padrao definido.
            </p>
          )}
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={!salvo || aplicar.loading || atual.defaultModules.length === 0}
              onClick={() => void aplicar.run(undefined)}
            >
              Aplicar segmento
            </Button>
            {salvo ? null : (
              <p className="mt-1.5 text-xs text-slate-500">
                Salve a troca de segmento antes de aplicar.
              </p>
            )}
          </div>
        </div>
      ) : null}
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

// ----------------------------------------------------------------- avisos

/**
 * Enderecos que recebem `content.published`.
 *
 * A maioria dos sites nao precisa disto: um site Vite busca o conteudo em
 * tempo de execucao e a mudanca aparece na proxima visita. A aba existe para
 * o site que renderiza no servidor e guarda cache -- e e por isso que ela
 * comeca explicando quando nao usar.
 */
function AbaAvisos({ siteId }: { siteId: string }) {
  const toast = useToast();
  const lista = useResource(() => platformSiteApi.webhooks(siteId), [siteId]);
  const [emitido, setEmitido] = useState<{ url: string; secret: string } | null>(null);
  const [removendo, setRemovendo] = useState<SiteWebhookRow | null>(null);
  const [url, setUrl] = useState('');
  const [descricao, setDescricao] = useState('');

  const criar = useMutation(
    () => platformSiteApi.createWebhook(siteId, { url: url.trim(), description: descricao.trim() }),
    {
      onSuccess: (resultado) => {
        setEmitido({ url: resultado.webhook.url, secret: resultado.secret });
        setUrl('');
        setDescricao('');
        void lista.reload();
      },
      onError: (error) => toast.error('Nao foi possivel cadastrar', error.message),
    },
  );

  const rotacionar = useMutation(
    (webhookId: string) => platformSiteApi.rotateWebhookSecret(siteId, webhookId),
    {
      onSuccess: (resultado) => {
        setEmitido({ url: resultado.webhook.url, secret: resultado.secret });
        void lista.reload();
      },
      onError: (error) => toast.error('Nao foi possivel rotacionar', error.message),
    },
  );

  const alternar = useMutation(
    (entrada: { id: string; isActive: boolean }) =>
      platformSiteApi.updateWebhook(siteId, entrada.id, { isActive: entrada.isActive }),
    {
      onSuccess: () => void lista.reload(),
      onError: (error) => toast.error('Nao foi possivel alterar', error.message),
    },
  );

  const remover = useMutation((webhookId: string) => platformSiteApi.removeWebhook(siteId, webhookId), {
    onSuccess: () => {
      toast.success('Endereco removido');
      setRemovendo(null);
      void lista.reload();
    },
    onError: (error) => toast.error('Nao foi possivel remover', error.message),
  });

  return (
    <div className="space-y-4">
      <Alert tone="info" title="A maioria dos sites nao precisa disto">
        Um site Vite busca o conteudo a cada visita, entao a alteracao do cliente aparece sozinha.
        Cadastre um endereco apenas quando o site renderiza no servidor e guarda cache -- ele
        recebe <code>content.published</code> e invalida o proprio cache.
      </Alert>

      <Card>
        <CardHeader title="Novo endereco" description="A plataforma envia um POST assinado a cada publicacao." />
        <CardBody className="grid gap-3">
          <TextInput
            label="Endereco"
            placeholder="https://site-do-cliente.com.br/api/revalidar"
            value={url}
            hint="Https obrigatorio. Somente localhost pode usar http, para desenvolvimento."
            onChange={(event) => setUrl(event.target.value)}
          />
          <TextInput
            label="Para que serve"
            placeholder="Revalidacao do cache do Next"
            value={descricao}
            onChange={(event) => setDescricao(event.target.value)}
          />
          <div className="flex justify-end">
            <Button
              onClick={() => void criar.run(undefined)}
              disabled={criar.loading || url.trim() === ''}
              icon={<Plus aria-hidden="true" className="size-4" />}
            >
              Cadastrar
            </Button>
          </div>
        </CardBody>
      </Card>

      <ResourcePanel resource={lista}>
        {(data) => (
          <div className="space-y-4">
            {data.items.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum endereco cadastrado.</p>
            ) : (
              <ul className="space-y-2">
                {data.items.map((item) => (
                  <li key={item.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="text-xs text-slate-800">{item.url}</code>
                          <Badge tone={item.isActive ? 'success' : 'neutral'}>
                            {item.isActive ? 'ativo' : 'desativado'}
                          </Badge>
                          {item.consecutiveFailures > 0 ? (
                            <Badge tone="danger">{item.consecutiveFailures} falha(s) seguidas</Badge>
                          ) : null}
                        </div>
                        {item.description ? (
                          <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                        ) : null}
                        <p className="mt-1 text-xs text-slate-500">
                          {item.lastAttemptAt
                            ? `Ultima tentativa em ${formatDateTime(item.lastAttemptAt)}`
                              + (item.lastStatus ? ` (respondeu ${item.lastStatus})` : '')
                            : 'Nenhuma tentativa ainda'}
                        </p>
                        {item.lastError ? (
                          <p className="mt-1 text-xs text-rose-600">{item.lastError}</p>
                        ) : null}
                      </div>

                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void alternar.run({ id: item.id, isActive: !item.isActive })}
                          disabled={alternar.loading}
                        >
                          {item.isActive ? 'Desativar' : 'Ativar'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void rotacionar.run(item.id)}
                          disabled={rotacionar.loading}
                        >
                          <RotateCw aria-hidden="true" className="size-4" />
                          <span className="sr-only">Rotacionar o segredo</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemovendo(item)}>
                          <Trash2 aria-hidden="true" className="size-4" />
                          <span className="sr-only">Remover</span>
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {data.deliveries.length > 0 ? (
              <Card>
                <CardHeader
                  title="Ultimas entregas"
                  description="O que falhou e tentado de novo pelo job diario."
                />
                <CardBody>
                  <ul className="grid gap-1.5 text-xs">
                    {data.deliveries.map((entrega) => (
                      <li key={entrega.id} className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            entrega.status === 'delivered'
                              ? 'success'
                              : entrega.status === 'exhausted'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {DELIVERY_STATE_LABELS[entrega.status]}
                        </Badge>
                        <span className="text-slate-600">{entrega.event}</span>
                        <span className="text-slate-400">
                          {formatDateTime(entrega.createdAt)} - {entrega.attempts} tentativa(s)
                        </span>
                        {entrega.lastError ? (
                          <span className="text-rose-600">{entrega.lastError}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ) : null}
          </div>
        )}
      </ResourcePanel>

      <SegredoEmitido emitido={emitido} onClose={() => setEmitido(null)} />

      <ConfirmDialog
        open={removendo !== null}
        title="Remover este endereco?"
        message="O site do cliente para de receber avisos de publicacao. O conteudo continua sendo servido normalmente pela API."
        confirmLabel="Remover"
        tone="danger"
        loading={remover.loading}
        onCancel={() => setRemovendo(null)}
        onConfirm={() => {
          if (removendo) void remover.run(removendo.id);
        }}
      />
    </div>
  );
}

/**
 * O segredo de assinatura, mostrado uma unica vez.
 *
 * Diferente das chaves de integracao, este fica guardado em claro -- assinar
 * exige o valor a cada entrega. A contrapartida e que ele nunca e lido de
 * volta, e a tela precisa deixar isso claro antes de o operador fechar.
 */
function SegredoEmitido({
  emitido,
  onClose,
}: {
  emitido: { url: string; secret: string } | null;
  onClose: () => void;
}) {
  const toast = useToast();

  async function copiar(valor: string) {
    try {
      await navigator.clipboard.writeText(valor);
      toast.success('Copiado');
    } catch {
      toast.error('Nao foi possivel copiar', 'Selecione o texto e copie manualmente.');
    }
  }

  return (
    <Modal
      open={emitido !== null}
      onClose={onClose}
      title="Copie o segredo agora"
      description="Esta e a unica vez que ele aparece. Nao ha como consulta-lo depois; quem perder rotaciona."
      footer={<Button onClick={onClose}>Ja copiei</Button>}
    >
      {emitido ? (
        <div className="space-y-3">
          <Alert tone="warning" title="Segredo de assinatura: somente no servidor do site">
            Guarde como variavel de ambiente do projeto do cliente. Nao vai em{' '}
            <code>VITE_*</code>, nem em componente de cliente, nem no repositorio.
          </Alert>
          <p className="text-xs text-slate-500">Endereco: {emitido.url}</p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <code className="flex-1 break-all text-xs text-slate-800">{emitido.secret}</code>
            <Button variant="outline" size="sm" onClick={() => void copiar(emitido.secret)}>
              <Copy aria-hidden="true" className="size-4" />
              Copiar
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

// ------------------------------------------------------- campos do projeto

/**
 * Campos personalizados por modulo.
 *
 * O caso que motivou isto: um cliente tem "CRECI", outro tem "Registro
 * profissional", e nenhum dos dois precisa da estrutura do outro.
 *
 * So aparecem aqui os modulos que o registro marca como aceitando campo
 * personalizado -- ou seja, aqueles cujo formulario do painel do cliente
 * **renderiza** os campos. Permitir definir um campo que nenhuma tela mostra
 * faria a CODECA IA configurar algo que nunca aparece.
 */
function AbaCampos({
  siteId,
  modules,
  onSaved,
}: {
  siteId: string;
  modules: SiteModuleView[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const lista = useResource(() => platformSiteApi.customFields(siteId), [siteId]);
  const proprios = useResource(() => platformSiteApi.customModules(siteId), [siteId]);

  /**
   * As duas origens de modulo que aceitam campo, numa lista para o seletor.
   *
   * Os do registro so quando declaram `customFields`; os criados para o site
   * sempre, porque os campos sao a unica coisa que eles tem -- um modulo
   * proprio sem campo nenhum nao mostra nada ao cliente.
   */
  const aceitam: Array<{ key: string; name: string; proprio: boolean }> = [
    ...modules
      .filter((modulo) => MODULE_REGISTRY[modulo.key].customFields === true)
      .map((modulo) => ({ key: modulo.key as string, name: modulo.name, proprio: false })),
    ...(proprios.data?.items ?? []).map((modulo) => ({
      key: modulo.key,
      name: `${modulo.name} (deste site)`,
      proprio: true,
    })),
  ];
  const [moduloAtivo, setModuloAtivo] = useState<string>(aceitam[0]?.key ?? 'imoveis');
  const [campos, setCampos] = useState<CustomFieldRow[] | null>(null);

  const doModulo = useMemo(
    () =>
      campos ??
      (lista.data?.items ?? []).filter((campo) => campo.moduleKey === moduloAtivo),
    [campos, lista.data, moduloAtivo],
  );

  const salvar = useMutation(
    () =>
      platformSiteApi.saveCustomFields(
        siteId,
        moduloAtivo,
        doModulo.map((campo) => ({
          fieldKey: campo.fieldKey,
          label: campo.label,
          type: campo.type,
          required: campo.required,
          help: campo.help,
          options: campo.options,
          editable: campo.editable,
          sortOrder: campo.sortOrder,
        })),
      ),
    {
      onSuccess: () => {
        toast.success('Campos salvos');
        setCampos(null);
        lista.reload();
        onSaved();
      },
      onError: (error) => toast.error('Nao foi possivel salvar', error.message),
    },
  );

  function trocarModulo(key: string) {
    setCampos(null);
    setModuloAtivo(key);
  }

  function atualizar(indice: number, patch: Partial<CustomFieldRow>) {
    setCampos(doModulo.map((campo, i) => (i === indice ? { ...campo, ...patch } : campo)));
  }

  if (aceitam.length === 0) {
    return (
      <Alert tone="info" title="Nenhum modulo deste site aceita campo personalizado">
        O recurso vale para institucional, contato, imoveis, obras, servicos, produtos, equipe e
        depoimentos -- e para qualquer modulo criado na aba "Modulos do projeto".
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      <Alert tone="info" title="Campos que so existem neste site">
        O cliente preenche no painel e o site le em <code>customFields</code>. A chave e o que o
        projeto usa em codigo -- escolha-a com cuidado, porque muda-la depois nao traz os valores
        ja gravados.
      </Alert>

      <Select
        label="Modulo"
        value={moduloAtivo}
        onChange={(event) => trocarModulo(event.target.value)}
        options={aceitam.map((modulo) => ({ value: modulo.key, label: modulo.name }))}
        hint="Modulos da plataforma que aceitam campo extra, e os criados para este site."
      />

      <ResourcePanel resource={lista}>
        {() => (
          <div className="grid gap-3">
            {doModulo.length === 0 ? (
              <p className="text-sm text-slate-600">
                Nenhum campo neste modulo. Acrescente abaixo.
              </p>
            ) : (
              doModulo.map((campo, indice) => (
                <div key={indice} className="grid gap-3 rounded-lg border border-slate-200 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextInput
                      label="Chave"
                      value={campo.fieldKey}
                      hint="Como o site le: customFields.creci"
                      onChange={(event) =>
                        atualizar(indice, {
                          fieldKey: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                        })
                      }
                    />
                    <TextInput
                      label="Rotulo"
                      value={campo.label}
                      hint="Como aparece para o cliente."
                      onChange={(event) => atualizar(indice, { label: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Select
                      label="Tipo"
                      value={campo.type}
                      onChange={(event) => atualizar(indice, { type: event.target.value })}
                      options={CUSTOM_FIELD_TYPES.map((tipo) => ({
                        value: tipo,
                        label: CUSTOM_FIELD_TYPE_LABELS[tipo],
                      }))}
                    />
                    <TextInput
                      label="Ordem"
                      inputMode="numeric"
                      value={String(campo.sortOrder)}
                      onChange={(event) =>
                        atualizar(indice, { sortOrder: Number(event.target.value) || 0 })
                      }
                    />
                  </div>
                  {campo.type === 'select' ? (
                    <TextInput
                      label="Opcoes"
                      value={campo.options.join(', ')}
                      hint="Separe por virgula. Pelo menos duas."
                      onChange={(event) =>
                        atualizar(indice, {
                          options: event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  ) : null}
                  <TextInput
                    label="Ajuda"
                    value={campo.help}
                    hint="Texto curto abaixo do campo, no painel do cliente."
                    onChange={(event) => atualizar(indice, { help: event.target.value })}
                  />
                  <div className="flex flex-wrap items-center gap-4">
                    {/*
                      Obrigatorio e travado juntos impediriam todo cadastro: o
                      cliente nao pode preencher (403) nem omitir. A API recusa
                      a combinacao, e aqui ela nem fica marcavel -- um controle
                      que garante erro nao deve existir na tela.
                    */}
                    <Switch
                      label="Obrigatorio"
                      {...(campo.editable
                        ? {}
                        : { hint: 'Indisponivel: o cliente nao edita este campo.' })}
                      checked={campo.required && campo.editable}
                      disabled={!campo.editable}
                      onChange={(marcado) => atualizar(indice, { required: marcado })}
                    />
                    <Switch
                      label="O cliente pode editar"
                      hint="Desmarque para a CODECA IA preencher e o cliente so consultar."
                      checked={campo.editable}
                      onChange={(marcado) =>
                        atualizar(
                          indice,
                          // Travar desmarca o obrigatorio, em vez de guardar um
                          // estado que o salvar recusaria.
                          marcado ? { editable: true } : { editable: false, required: false },
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCampos(doModulo.filter((_, i) => i !== indice))}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      <span className="sr-only">Remover campo</span>
                    </Button>
                  </div>
                </div>
              ))
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                icon={<Plus aria-hidden="true" className="size-4" />}
                onClick={() =>
                  setCampos([
                    ...doModulo,
                    {
                      moduleKey: moduloAtivo,
                      fieldKey: '',
                      label: '',
                      type: 'text',
                      required: false,
                      help: '',
                      options: [],
                      editable: true,
                      sortOrder: doModulo.length,
                    },
                  ])
                }
              >
                Acrescentar campo
              </Button>
              <Button onClick={() => void salvar.run(undefined)} disabled={salvar.loading}>
                <Save aria-hidden="true" className="size-4" />
                Salvar campos
              </Button>
            </div>

            <p className="text-xs text-slate-500">
              Remover um campo aqui tira ele do painel e da API publica, mas <strong>nao apaga</strong> o
              que o cliente ja escreveu: redefinir com a mesma chave traz os valores de volta.
            </p>
          </div>
        )}
      </ResourcePanel>
    </div>
  );
}

/**
 * Modulos criados para este site.
 *
 * E por aqui que a CODECA IA da ao projeto um tipo de conteudo que nenhum
 * modulo da plataforma cobre. Os campos de cada um sao definidos na aba
 * "Campos do projeto", que trata os dois tipos de modulo igual.
 *
 * Tres cuidados que a tela carrega de proposito, todos sobre o que **nao** se
 * pode desfazer:
 *
 * 1. A chave nao muda depois de criada -- o site do cliente a usa em codigo.
 * 2. O tipo tambem nao -- trocar lista por documento deixaria registros que a
 *    tela nova nao sabe mostrar.
 * 3. Apagar e recusado enquanto houver registro, e a tela diz isso antes de o
 *    servidor recusar. Desabilitar e o caminho reversivel.
 */
function AbaModulosProprios({
  siteId,
  onSaved,
}: {
  siteId: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const lista = useResource(() => platformSiteApi.customModules(siteId), [siteId]);
  const [criando, setCriando] = useState(false);
  const [removendo, setRemovendo] = useState<CustomModuleView | null>(null);
  const [novo, setNovo] = useState({
    key: '',
    name: '',
    description: '',
    kind: 'collection' as 'collection' | 'document',
    icon: '' as string,
  });

  const criar = useMutation(() => platformSiteApi.createCustomModule(siteId, novo), {
    onSuccess: () => {
      toast.success('Modulo criado');
      setCriando(false);
      setNovo({ key: '', name: '', description: '', kind: 'collection', icon: '' });
      lista.reload();
      onSaved();
    },
    onError: (error) => toast.error('Nao foi possivel criar', error.message),
  });

  const alternar = useMutation(
    (entrada: { key: string; enabled: boolean }) =>
      platformSiteApi.updateCustomModule(siteId, entrada.key, { enabled: entrada.enabled }),
    {
      onSuccess: () => {
        lista.reload();
        onSaved();
      },
      onError: (error) => toast.error('Nao foi possivel salvar', error.message),
    },
  );

  const remover = useMutation(
    (key: string) => platformSiteApi.removeCustomModule(siteId, key),
    {
      onSuccess: () => {
        toast.success('Modulo removido');
        setRemovendo(null);
        lista.reload();
        onSaved();
      },
      onError: (error) => toast.error('Nao foi possivel remover', error.message),
    },
  );

  return (
    <div className="grid gap-4">
      <Alert tone="info" title="Modulos que existem somente neste site">
        Um cardapio, uma lista de turmas, um catalogo de processos. O cliente edita o conteudo no
        painel dele e o site le em <code>/api/v1/custom/&lt;chave&gt;</code>. A chave e o tipo nao
        mudam depois de criados, porque o site do cliente depende dos dois.
      </Alert>

      <ResourcePanel resource={lista}>
        {(data) => (
          <div className="grid gap-3">
            {data.items.length === 0 ? (
              <p className="text-sm text-slate-600">
                Nenhum modulo proprio. Acrescente abaixo quando o projeto pedir um tipo de conteudo
                que a plataforma nao tem.
              </p>
            ) : (
              data.items.map((modulo) => (
                <div
                  key={modulo.key}
                  className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <SafeIcon name={modulo.icon} size={16} />
                      <span className="font-medium text-slate-900">{modulo.name}</span>
                      <Badge tone="neutral">
                        {modulo.kind === 'document' ? 'Documento' : 'Lista'}
                      </Badge>
                      <code className="text-xs text-slate-500">{modulo.key}</code>
                    </div>
                    {modulo.description ? (
                      <p className="text-sm text-slate-600">{modulo.description}</p>
                    ) : null}
                    <p className="text-xs text-slate-500">
                      {modulo.fields.length === 0
                        ? 'Sem campos ainda -- defina-os na aba "Campos do projeto".'
                        : `${modulo.fields.length} campo(s) definido(s).`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      label="No ar"
                      checked={modulo.enabled}
                      onChange={(marcado) =>
                        void alternar.run({ key: modulo.key, enabled: marcado })
                      }
                    />
                    <Button variant="ghost" size="sm" onClick={() => setRemovendo(modulo)}>
                      <Trash2 aria-hidden="true" className="size-4" />
                      <span className="sr-only">Remover {modulo.name}</span>
                    </Button>
                  </div>
                </div>
              ))
            )}

            {criando ? (
              <div className="grid gap-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput
                    label="Chave"
                    value={novo.key}
                    hint="Como o site le: /api/v1/custom/cardapio. Nao muda depois."
                    onChange={(event) =>
                      setNovo((atual) => ({
                        ...atual,
                        key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                      }))
                    }
                  />
                  <TextInput
                    label="Nome"
                    value={novo.name}
                    hint="Como aparece no menu do cliente."
                    onChange={(event) => setNovo((atual) => ({ ...atual, name: event.target.value }))}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label="Tipo"
                    value={novo.kind}
                    hint="Nao muda depois de criado."
                    options={[
                      { value: 'collection', label: 'Lista de registros' },
                      { value: 'document', label: 'Documento unico' },
                    ]}
                    onChange={(event) =>
                      setNovo((atual) => ({
                        ...atual,
                        kind: event.target.value as 'collection' | 'document',
                      }))
                    }
                  />
                  <Select
                    label="Icone"
                    value={novo.icon}
                    options={[
                      { value: '', label: 'Sem icone' },
                      ...SAFE_ICONS.map((nome) => ({ value: nome, label: nome })),
                    ]}
                    onChange={(event) => setNovo((atual) => ({ ...atual, icon: event.target.value }))}
                  />
                </div>
                <TextArea
                  label="Descricao"
                  rows={2}
                  value={novo.description}
                  hint="Texto curto no topo da tela do cliente."
                  onChange={(event) =>
                    setNovo((atual) => ({ ...atual, description: event.target.value }))
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void criar.run(undefined)} disabled={criar.loading}>
                    <Save aria-hidden="true" className="size-4" />
                    Criar modulo
                  </Button>
                  <Button variant="outline" onClick={() => setCriando(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button
                  variant="outline"
                  icon={<Plus aria-hidden="true" className="size-4" />}
                  onClick={() => setCriando(true)}
                >
                  Acrescentar modulo
                </Button>
              </div>
            )}
          </div>
        )}
      </ResourcePanel>

      <ConfirmDialog
        open={removendo !== null}
        title="Remover modulo"
        message={
          `O modulo ${removendo?.name ?? ''} e as definicoes de campo dele serao apagados. `
          + 'Se o cliente ja cadastrou registros, a remocao e recusada -- nesse caso use o '
          + '"No ar" para tirar do ar sem apagar conteudo.'
        }
        confirmLabel="Remover"
        tone="danger"
        loading={remover.loading}
        onCancel={() => setRemovendo(null)}
        onConfirm={() => {
          if (removendo) void remover.run(removendo.key);
        }}
      />
    </div>
  );
}
