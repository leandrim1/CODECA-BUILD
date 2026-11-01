import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { CUSTOM_RECORD_STATUSES, type CustomRecordStatus } from '@codeca/shared';
import {
  Badge,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  Select,
  Switch,
  TextInput,
  useToast,
  type Column,
} from '@codeca/ui';
import { SafeIcon } from '../components/SafeIcon.js';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { useSiteModules } from '../hooks/useSiteModules.js';
import { customModuleApi } from '../services/endpoints.js';
import { CampoPersonalizado } from '../components/CustomFields.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { labels, publicationTone, toOptions } from '../utils/labels.js';
import type { CustomRecordRow, SiteModuleFieldView } from '../types/index.js';

/**
 * Tela de um modulo criado para este site.
 *
 * Uma tela para todos eles, montada a partir das definicoes -- do mesmo jeito
 * que `DocumentModulePage` ja fazia com os documentos do registro. Uma tela por
 * modulo seria impossivel: a existencia do modulo e dado, e nao ha o que
 * escrever antes de o modulo existir.
 *
 * O formulario reusa `CampoPersonalizado`, o renderizador da etapa F. Um
 * segundo renderizador para os mesmos dez tipos sairia de acordo com o primeiro
 * no primeiro tipo novo.
 */
export function CustomModulePage({ moduleKey }: { moduleKey: string }) {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const { customModule, loading } = useSiteModules();
  const modulo = customModule(moduleKey);

  const [editando, setEditando] = useState<CustomRecordRow | 'novo' | null>(null);
  const [removendo, setRemovendo] = useState<CustomRecordRow | null>(null);

  const lista = useResource(
    () => customModuleApi.records(tenantId, moduleKey, { pageSize: 50 }),
    [tenantId, moduleKey],
  );

  const remover = useMutation(
    (id: string) => customModuleApi.remove(tenantId, moduleKey, id),
    {
      onSuccess: () => {
        toast.success('Registro excluido');
        setRemovendo(null);
        lista.reload();
      },
      onError: (error) => toast.error('Nao foi possivel excluir', error.message),
    },
  );

  const colunas = useMemo<Column<CustomRecordRow>[]>(
    () => [
      { key: 'title', header: 'Titulo', render: (row) => row.title },
      {
        key: 'publicationStatus',
        header: 'Situacao',
        render: (row) => (
          <Badge tone={publicationTone(row.publicationStatus)}>
            {labels.publication[row.publicationStatus]}
          </Badge>
        ),
      },
      {
        key: 'acoes',
        header: '',
        render: (row) =>
          can('content:write') ? (
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditando(row)}>
                <Pencil aria-hidden="true" className="size-4" />
                <span className="sr-only">Editar {row.title}</span>
              </Button>
              {can('content:delete') ? (
                <Button variant="ghost" size="sm" onClick={() => setRemovendo(row)}>
                  <Trash2 aria-hidden="true" className="size-4" />
                  <span className="sr-only">Excluir {row.title}</span>
                </Button>
              ) : null}
            </div>
          ) : null,
      },
    ],
    [can],
  );

  // A moldura carrega os modulos uma vez; enquanto nao chegou, nao se sabe se
  // o modulo existe. `RequireCustomModule` cuida do caso de nao existir.
  if (loading && !modulo) return null;

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title={modulo?.name ?? moduleKey}
        description={modulo?.description || 'Conteudo deste projeto.'}
        actions={
          can('content:write') ? (
            <Button
              icon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setEditando('novo')}
            >
              Novo registro
            </Button>
          ) : undefined
        }
      />

      <ResourcePanel resource={lista}>
        {(data) =>
          data.items.length === 0 ? (
            <Card>
              <CardBody>
                <EmptyState
                  icon={<SafeIcon name={modulo?.icon ?? ''} className="size-8" />}
                  title="Nenhum registro cadastrado"
                  description={`Cadastre o primeiro item de ${modulo?.name ?? 'este modulo'} para que apareca no site.`}
                />
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody className="p-0">
                <DataTable columns={colunas} rows={data.items} rowKey={(row) => row.id} />
              </CardBody>
            </Card>
          )
        }
      </ResourcePanel>

      {editando ? (
        <FormularioRegistro
          moduleKey={moduleKey}
          nomeDoModulo={modulo?.name ?? moduleKey}
          registro={editando === 'novo' ? null : editando}
          onClose={() => setEditando(null)}
          onSaved={() => {
            setEditando(null);
            lista.reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removendo !== null}
        title="Excluir registro"
        message={`"${removendo?.title ?? ''}" sera removido do painel e do site. Esta acao nao pode ser desfeita.`}
        confirmLabel="Excluir"
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
 * Formulario de um registro.
 *
 * Os campos definidos vem da **resposta da API**, nao do contexto da moldura:
 * num registro existente a API devolve `fields` junto, e usar essa lista
 * garante que o formulario e a validacao do servidor falam do mesmo conjunto.
 */
function FormularioRegistro({
  moduleKey,
  nomeDoModulo,
  registro,
  onClose,
  onSaved,
}: {
  moduleKey: string;
  nomeDoModulo: string;
  registro: CustomRecordRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const { customModule } = useSiteModules();
  const doContexto = customModule(moduleKey);

  const detalhe = useResource(
    () => customModuleApi.record(tenantId, moduleKey, registro!.id),
    [tenantId, moduleKey, registro?.id],
    { enabled: registro !== null },
  );

  const campos: SiteModuleFieldView[] = detalhe.data?.fields ?? doContexto?.fields ?? [];

  const [title, setTitle] = useState(registro?.title ?? '');
  const [status, setStatus] = useState<CustomRecordStatus>(
    registro?.publicationStatus ?? 'draft',
  );
  const [featured, setFeatured] = useState(registro?.featured ?? false);
  const [valores, setValores] = useState<Record<string, unknown>>(registro?.data ?? {});

  // O formulario abre antes de a resposta chegar: sem isto o campo nasceria
  // vazio e a gravacao apagaria o valor.
  useEffect(() => {
    const atual = detalhe.data?.record;
    if (!atual) return;
    setTitle(atual.title);
    setStatus(atual.publicationStatus);
    setFeatured(atual.featured);
    setValores(atual.data ?? {});
  }, [detalhe.data]);

  const salvar = useMutation(
    () => {
      const corpo: Record<string, unknown> = {
        title,
        publicationStatus: status,
        featured,
        // Campo travado **sai do corpo**: o servidor recusa a chave de um campo
        // que a CODECA IA mantem, e a gravacao mescla sobre o que esta gravado,
        // entao omitir preserva o valor em vez de apaga-lo.
        data: Object.fromEntries(
          campos
            .filter((campo) => campo.editable)
            .map((campo) => [campo.key, paraApi(campo, valores[campo.key])]),
        ),
      };
      return registro
        ? customModuleApi.update(tenantId, moduleKey, registro.id, corpo)
        : customModuleApi.create(tenantId, moduleKey, corpo);
    },
    {
      onSuccess: () => {
        toast.success(registro ? 'Registro atualizado' : 'Registro cadastrado');
        onSaved();
      },
      onError: (error) => toast.error('Nao foi possivel salvar', error.message),
    },
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={registro ? `Editar em ${nomeDoModulo}` : `Novo registro em ${nomeDoModulo}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar.run(undefined)} disabled={salvar.loading}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextInput
          label="Titulo"
          value={title}
          required
          hint="Como o registro aparece na lista e no endereco do site."
          onChange={(event) => setTitle(event.target.value)}
        />

        {campos.map((campo) => (
          <CampoPersonalizado
            key={campo.key}
            campo={campo}
            valor={valores[campo.key]}
            erro={undefined}
            onChange={(valor) => setValores((atual) => ({ ...atual, [campo.key]: valor }))}
          />
        ))}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Situacao"
            value={status}
            options={toOptions(labels.publication, CUSTOM_RECORD_STATUSES)}
            onChange={(event) => setStatus(event.target.value as CustomRecordStatus)}
          />
          <Switch
            label="Destacar"
            hint="Registros destacados aparecem primeiro na listagem."
            checked={featured}
            onChange={setFeatured}
          />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Converte o valor do formulario na forma que a API espera.
 *
 * Mesma conversao de `paraApiPersonalizados`: `tags` chega como texto separado
 * por virgula e numero como texto -- campo numerico vazio viraria `NaN` e
 * enviaria valor invalido sem o cliente perceber.
 */
function paraApi(campo: SiteModuleFieldView, valor: unknown): unknown {
  if (campo.type === 'boolean') return valor === true;
  if (campo.type === 'tags') {
    return Array.isArray(valor)
      ? valor
      : String(valor ?? '')
          .split(/[,\n]/)
          .map((item) => item.trim())
          .filter(Boolean);
  }
  if (campo.type === 'number') {
    const texto = String(valor ?? '').trim();
    return texto === '' ? null : Number(texto.replace(',', '.'));
  }
  return typeof valor === 'string' ? valor : (valor ?? '');
}

/**
 * Tela de um modulo `document`: um registro so, sem lista.
 *
 * Separada da de colecao e nao um ramo dentro dela: as duas nao tem lista,
 * modal, exclusao nem destaque em comum, e o `if` no meio do componente
 * deixaria as duas piores.
 */
export function CustomDocumentPage({ moduleKey }: { moduleKey: string }) {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();

  const documento = useResource(
    () => customModuleApi.document(tenantId, moduleKey),
    [tenantId, moduleKey],
  );

  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<CustomRecordStatus>('draft');
  const [valores, setValores] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const dados = documento.data;
    if (!dados) return;
    setTitle(dados.record?.title ?? dados.module.name);
    setStatus(dados.record?.publicationStatus ?? 'draft');
    setValores(dados.record?.data ?? {});
  }, [documento.data]);

  const campos = documento.data?.fields ?? [];

  const salvar = useMutation(
    () =>
      customModuleApi.saveDocument(tenantId, moduleKey, {
        title,
        publicationStatus: status,
        data: Object.fromEntries(
          campos
            .filter((campo) => campo.editable)
            .map((campo) => [campo.key, paraApi(campo, valores[campo.key])]),
        ),
      }),
    {
      onSuccess: () => {
        toast.success('Documento salvo');
        documento.reload();
      },
      onError: (error) => toast.error('Nao foi possivel salvar', error.message),
    },
  );

  return (
    <div className="panel-shell grid gap-6">
      <ResourcePanel resource={documento}>
        {(dados) => (
          <>
            <PageHeader
              title={dados.module.name}
              description={dados.module.description || 'Conteudo deste projeto.'}
            />
            <Card>
              <CardBody className="grid gap-4">
                <TextInput
                  label="Titulo"
                  value={title}
                  required
                  onChange={(event) => setTitle(event.target.value)}
                />

                {campos.length === 0 ? (
                  <EmptyState
                    icon={<SafeIcon name={dados.module.icon ?? ''} className="size-8" />}
                    title="Nenhum campo configurado"
                    description="A CODECA IA ainda nao definiu os campos deste modulo."
                  />
                ) : (
                  campos.map((campo) => (
                    <CampoPersonalizado
                      key={campo.key}
                      campo={campo}
                      valor={valores[campo.key]}
                      erro={undefined}
                      onChange={(valor) =>
                        setValores((atual) => ({ ...atual, [campo.key]: valor }))
                      }
                    />
                  ))
                )}

                <Select
                  label="Situacao"
                  value={status}
                  options={toOptions(labels.publication, CUSTOM_RECORD_STATUSES)}
                  onChange={(event) => setStatus(event.target.value as CustomRecordStatus)}
                />

                {can('content:write') ? (
                  <div className="flex justify-end">
                    <Button onClick={() => void salvar.run(undefined)} disabled={salvar.loading}>
                      Salvar
                    </Button>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          </>
        )}
      </ResourcePanel>
    </div>
  );
}
