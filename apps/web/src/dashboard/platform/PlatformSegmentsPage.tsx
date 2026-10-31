import { useState } from 'react';
import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { MODULE_KEYS, MODULE_REGISTRY, slugify, type ModuleKey } from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Modal,
  PageHeader,
  Switch,
  TextArea,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useMutation, useResource } from '../../hooks/useResource.js';
import { platformApi } from '../../services/endpoints.js';
import { ResourcePanel } from '../../components/ResourcePanel.js';
import { useForm } from '../../utils/forms.js';
import type { SegmentRecord } from '../../types/index.js';

/**
 * Segmentos: os conjuntos padrao de modulos.
 *
 * A plataforma atende qualquer ramo, e segmento e dado -- nao codigo.
 * Cadastrar "Clinica odontologica" aqui e uma linha; antes da etapa 7 era um
 * `ALTER TYPE` no Postgres seguido de implantacao.
 *
 * A tela repete em dois lugares que editar um segmento **nao** reconfigura
 * site nenhum. E a duvida natural de quem mexe num conjunto compartilhado, e
 * a resposta errada custaria caro: um cliente perderia uma tela que usa.
 */
export function PlatformSegmentsPage() {
  const [editing, setEditing] = useState<SegmentRecord | 'new' | null>(null);
  const segments = useResource(() => platformApi.segments(), []);

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Segmentos"
        description="Conjuntos padrao de modulos, aplicados ao cadastrar um site."
        actions={
          <Button icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setEditing('new')}>
            Novo segmento
          </Button>
        }
      />

      <Alert tone="info" title="O segmento e um ponto de partida, nao uma trava">
        Ele define quais modulos um site novo recebe no cadastro. Editar um segmento aqui nao mexe
        nos sites que ja existem: para reconfigurar um projeto, abra o site em Sites e use
        &ldquo;Aplicar segmento&rdquo;.
      </Alert>

      <ResourcePanel resource={segments}>
        {(data) => (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {data.items.map((segment) => (
              <Card key={segment.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {segment.name}
                      {segment.isDefault ? (
                        <Badge tone="brand">
                          <Star aria-hidden="true" className="mr-1 inline size-3" />
                          padrao
                        </Badge>
                      ) : null}
                      {segment.isActive ? null : <Badge tone="neutral">inativo</Badge>}
                    </span>
                  }
                  description={`${segment.code} - ${segment.siteCount} site(s)`}
                  actions={
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<Pencil aria-hidden="true" className="size-3.5" />}
                      onClick={() => setEditing(segment)}
                    >
                      Editar
                    </Button>
                  }
                />
                <CardBody className="grid gap-3">
                  {segment.description ? (
                    <p className="text-sm text-slate-600">{segment.description}</p>
                  ) : null}
                  {segment.defaultModules.length === 0 ? (
                    <p className="text-sm text-amber-700">
                      Nenhum modulo definido: um site criado com este segmento recebe todos.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {segment.defaultModules.map((key) => (
                        <li
                          key={key}
                          className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                        >
                          {MODULE_REGISTRY[key].name}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </ResourcePanel>

      {editing ? (
        <SegmentModal
          segment={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            segments.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function SegmentModal({
  segment,
  onClose,
  onSaved,
}: {
  segment: SegmentRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const form = useForm({
    code: segment?.code ?? '',
    name: segment?.name ?? '',
    description: segment?.description ?? '',
    defaultModules: (segment?.defaultModules ?? []) as string[],
    isActive: segment?.isActive ?? true,
    isDefault: segment?.isDefault ?? false,
  });

  const save = useMutation(
    () => {
      const body = {
        name: form.values.name,
        description: form.values.description,
        defaultModules: form.values.defaultModules,
        isActive: form.values.isActive,
        isDefault: form.values.isDefault,
      };
      return segment
        ? platformApi.updateSegment(segment.id, body)
        : platformApi.createSegment({ ...body, code: form.values.code });
    },
    {
      onSuccess: () => {
        toast.success('Segmento salvo');
        onSaved();
      },
      onError: (error) => {
        form.applyApiError(error);
        if (Object.keys(error.fieldErrors).length === 0) {
          toast.error('Nao foi possivel salvar', error.message);
        }
      },
    },
  );

  const remove = useMutation(() => platformApi.deleteSegment(segment!.id), {
    onSuccess: () => {
      toast.success('Segmento removido');
      onSaved();
    },
    onError: (error) => toast.error('Nao foi possivel remover', error.message),
  });

  const { values, errors, setField } = form;

  const alternar = (key: ModuleKey) => {
    const atual = values.defaultModules;
    setField(
      'defaultModules',
      atual.includes(key) ? atual.filter((k) => k !== key) : [...atual, key],
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={segment ? `Editar ${segment.name}` : 'Novo segmento'}
      size="lg"
      footer={
        <>
          {segment && segment.siteCount === 0 && !segment.isDefault ? (
            <Button
              variant="danger"
              loading={remove.loading}
              icon={<Trash2 aria-hidden="true" className="size-4" />}
              onClick={() => void remove.run(undefined)}
            >
              Remover
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.loading} onClick={() => void save.run(undefined)}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {segment ? (
          <Alert tone="info" title="Esta edicao nao alcanca os sites existentes">
            Os {segment.siteCount} site(s) deste segmento mantem exatamente os modulos que tem
            hoje. Um projeto pode ter sido ajustado a mao, e tirar um modulo daqui esconderia do
            cliente uma tela que ele usa.
          </Alert>
        ) : null}

        {segment ? (
          <TextInput label="Codigo" value={segment.code} disabled hint="O codigo nao muda: ele ja viajou para o site do cliente na resposta da API publica." />
        ) : (
          <TextInput
            label="Codigo"
            required
            value={values.code}
            error={errors.code}
            hint="Aparece na API publica como site.segment. Letras minusculas, numeros e hifen."
            onChange={(event) => setField('code', slugify(event.target.value))}
          />
        )}

        <TextInput
          label="Nome"
          required
          value={values.name}
          error={errors.name}
          hint="Como aparece no painel mestre. Ex.: Clinica odontologica."
          onChange={(event) => setField('name', event.target.value)}
        />

        <TextArea
          label="Descricao"
          rows={2}
          value={values.description}
          error={errors.description}
          onChange={(event) => setField('description', event.target.value)}
        />

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-slate-800">Modulos padrao</legend>
          <p className="text-xs text-slate-500">
            O que um site novo deste segmento recebe habilitado. A CODECA IA ajusta site a site
            depois.
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {MODULE_KEYS.map((key) => (
              <Checkbox
                key={key}
                label={MODULE_REGISTRY[key].name}
                hint={MODULE_REGISTRY[key].description}
                checked={values.defaultModules.includes(key)}
                onChange={() => alternar(key)}
              />
            ))}
          </div>
        </fieldset>

        <Switch
          label="Disponivel para projetos novos"
          hint="Desativado, ele sai da lista de escolha e os sites que o usam continuam como estao."
          checked={values.isActive}
          onChange={(checked) => setField('isActive', checked)}
        />

        <Switch
          label="Padrao de empresas recem-cadastradas"
          hint="Exatamente um segmento e o padrao. Marcar este desmarca o atual."
          checked={values.isDefault}
          onChange={(checked) => setField('isDefault', checked)}
        />
      </div>
    </Modal>
  );
}
