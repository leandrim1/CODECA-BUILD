import { useEffect, useMemo, useState } from 'react';
import { Lock, Save } from 'lucide-react';
import { SOCIAL_NETWORKS, SOCIAL_NETWORK_LABELS, type SocialNetwork } from '@codeca/shared';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  PageHeader,
  Select,
  Switch,
  TextArea,
  TextInput,
  useToast,
} from '@codeca/ui';
import { useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { useSiteModules } from '../hooks/useSiteModules.js';
import { moduleApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { ImageField } from '../components/MediaPicker.js';
import { formatList, numberOrNull, parseList } from '../utils/forms.js';
import type { SiteModuleFieldView } from '../types/index.js';

/**
 * Conteudo dos modulos de instancia unica (institucional, contato).
 *
 * Uma tela so para os dois, e para os que vierem depois: o formulario e
 * desenhado a partir dos campos que a API devolve, com a politica do site ja
 * aplicada. Escrever uma tela por modulo significaria que habilitar um modulo
 * novo exige deploy do painel -- exatamente o que o modelo headless existe
 * para evitar.
 *
 * O campo travado aparece, com o valor e um cadeado. Esconde-lo faria o
 * cliente achar que o dado nao existe e pedir para a CODECA IA cadastrar algo
 * que ja esta lá.
 */

/** Valor do formulario: texto para todo campo, convertido na gravacao. */
type FormValue = string | boolean | string[] | Record<string, string> | null;

export function DocumentModulePage({ moduleKey }: { moduleKey: 'institucional' | 'contato' }) {
  const tenantId = useTenantId();
  const toast = useToast();
  const { module, reload: reloadModules } = useSiteModules();
  const documento = useResource(() => moduleApi.document(tenantId, moduleKey), [tenantId, moduleKey]);

  const definicao = module(moduleKey);

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title={definicao?.name ?? 'Conteudo do site'}
        description={definicao?.description ?? 'Conteudo que o seu site exibe.'}
      />

      <ResourcePanel resource={documento}>
        {(data) => (
          <Formulario
            key={data.moduleKey}
            moduleKey={moduleKey}
            fields={data.fields}
            inicial={data.data}
            personalizados={data.customFields ?? {}}
            atualizadoEm={data.updatedAt}
            onSaved={() => {
              documento.reload();
              // A politica pode ter mudado junto: recarregar mantem o menu e
              // os cadeados coerentes com o que o servidor acabou de aceitar.
              reloadModules();
              toast.success('Conteudo salvo', 'O seu site passa a exibir a versao nova.');
            }}
          />
        )}
      </ResourcePanel>
    </div>
  );
}

function Formulario({
  moduleKey,
  fields,
  inicial,
  personalizados,
  atualizadoEm,
  onSaved,
}: {
  moduleKey: string;
  fields: SiteModuleFieldView[];
  inicial: Record<string, unknown>;
  /** Valores dos campos personalizados, que vem fora de `data`. */
  personalizados: Record<string, unknown>;
  atualizadoEm: string | null;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const [valores, setValores] = useState<Record<string, FormValue>>(() =>
    paraFormulario(fields, { ...inicial, ...personalizados }),
  );

  useEffect(() => {
    setValores(paraFormulario(fields, { ...inicial, ...personalizados }));
  }, [fields, inicial, personalizados]);

  const travados = useMemo(() => fields.filter((campo) => !campo.editable), [fields]);

  const salvar = useMutation(
    () => moduleApi.saveDocument(tenantId, moduleKey, paraApi(fields, valores, inicial, personalizados)),
    {
      onSuccess: onSaved,
      onError: (error) => toast.error('Nao foi possivel salvar', error.message),
    },
  );

  function definir(key: string, value: FormValue) {
    setValores((atual) => ({ ...atual, [key]: value }));
  }

  return (
    <Card>
      <CardHeader
        title="Conteudo"
        description={
          atualizadoEm
            ? `Alterado pela ultima vez em ${new Date(atualizadoEm).toLocaleString('pt-BR')}.`
            : 'Ainda nao alterado por aqui.'
        }
        actions={
          <Button
            onClick={() => void salvar.run(undefined)}
            disabled={salvar.loading}
            icon={<Save aria-hidden="true" className="size-4" />}
          >
            Salvar
          </Button>
        }
      />
      <CardBody className="grid gap-5">
        {travados.length > 0 ? (
          <Alert tone="info" title="Alguns campos sao mantidos pela CODECA IA">
            {travados.map((campo) => campo.label).join(', ')} aparecem aqui para consulta. Para
            alterar, fale com a equipe que desenvolveu o seu site.
          </Alert>
        ) : null}

        {fields.map((campo) =>
          campo.key === 'social' ? (
            <RedesSociais
              key={campo.key}
              campo={campo}
              valor={(valores.social as Record<string, string> | null) ?? {}}
              onChange={(proximo) => definir('social', proximo)}
            />
          ) : (
            <Campo
              key={campo.key}
              campo={campo}
              valor={valores[campo.key] ?? ''}
              onChange={(proximo) => definir(campo.key, proximo)}
            />
          ),
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => void salvar.run(undefined)}
            disabled={salvar.loading}
            icon={<Save aria-hidden="true" className="size-4" />}
          >
            Salvar
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/** Um campo do modulo, no controle que o tipo pede. */
function Campo({
  campo,
  valor,
  onChange,
}: {
  campo: SiteModuleFieldView;
  valor: FormValue;
  onChange: (valor: FormValue) => void;
}) {
  const travado = !campo.editable;
  const dica = travado ? 'Mantido pela CODECA IA neste site.' : campo.help;
  const rotulo = (
    <span className="inline-flex items-center gap-1.5">
      {campo.label}
      {travado ? <Lock aria-label="Campo travado" className="size-3.5 text-slate-400" /> : null}
    </span>
  );
  const comum = {
    label: rotulo,
    ...(dica ? { hint: dica } : {}),
    readOnly: travado,
    disabled: travado,
    required: campo.required ?? false,
  };

  if (campo.type === 'boolean') {
    return (
      <Switch
        label={campo.label}
        {...(dica ? { hint: dica } : {})}
        checked={valor === true}
        disabled={travado}
        onChange={(marcado) => onChange(marcado)}
      />
    );
  }

  if (campo.type === 'image') {
    return (
      <ImageField
        label={campo.label}
        value={typeof valor === 'string' && valor !== '' ? valor : null}
        onChange={(mediaId) => onChange(mediaId)}
        {...(dica ? { hint: dica } : {})}
      />
    );
  }

  if (campo.type === 'imageList') {
    // A selecao multipla vive na Biblioteca de imagens; aqui a tela so diz o
    // que ja existe, e a gravacao reenvia a lista intacta.
    const quantidade = Array.isArray(valor) ? valor.length : 0;
    return (
      <Field label={rotulo} hint="Gerencie as imagens na Biblioteca de imagens.">
        {() => (
          <p className="text-sm text-slate-600">
            {quantidade === 0
              ? 'Nenhuma imagem nesta galeria.'
              : `${quantidade} imagem(ns) nesta galeria.`}
          </p>
        )}
      </Field>
    );
  }

  if (campo.type === 'select' && campo.options && campo.options.length > 0) {
    // Campo de escolha personalizado. Sem este ramo ele cairia no `TextInput`
    // de texto livre, e a gravacao seria recusada pela validacao -- a opcao
    // foi definida por quem configurou o site, e fora dela nao entra.
    return (
      <Select
        label={rotulo}
        {...(dica ? { hint: dica } : {})}
        disabled={travado}
        required={campo.required ?? false}
        value={typeof valor === 'string' ? valor : ''}
        onChange={(event) => onChange(event.target.value)}
        options={campo.options.map((opcao) => ({ value: opcao, label: opcao }))}
      />
    );
  }

  if (campo.type === 'longText') {
    return (
      <TextArea
        {...comum}
        rows={campo.key === 'history' ? 8 : 4}
        value={typeof valor === 'string' ? valor : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (campo.type === 'tags') {
    return (
      <TextArea
        {...comum}
        hint={dica ?? 'Separe por virgula ou quebra de linha.'}
        rows={2}
        value={Array.isArray(valor) ? formatList(valor) : typeof valor === 'string' ? valor : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  const tipoHtml =
    campo.type === 'email'
      ? 'email'
      : campo.type === 'number'
        ? 'number'
        : campo.type === 'date'
          ? 'date'
          : campo.type === 'url'
            ? 'url'
            : campo.type === 'phone'
              ? 'tel'
              : 'text';

  return (
    <TextInput
      {...comum}
      type={tipoHtml}
      value={typeof valor === 'string' ? valor : valor === null ? '' : String(valor)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * Redes sociais: um endereco por rede, nao uma lista de textos.
 *
 * O registro declara o campo como `tags` porque o tipo descreve o controle, e
 * o valor e um objeto validado rede a rede. A tela desenha o objeto.
 */
function RedesSociais({
  campo,
  valor,
  onChange,
}: {
  campo: SiteModuleFieldView;
  valor: Record<string, string>;
  onChange: (valor: Record<string, string>) => void;
}) {
  const travado = !campo.editable;

  return (
    <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-medium text-slate-700">
        {campo.label}
        {travado ? <Lock aria-label="Campo travado" className="ml-1.5 inline size-3.5 text-slate-400" /> : null}
      </legend>
      <p className="text-xs text-slate-500">Endereco completo, comecando com https://.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {SOCIAL_NETWORKS.map((rede: SocialNetwork) => (
          <TextInput
            key={rede}
            label={SOCIAL_NETWORK_LABELS[rede]}
            type="url"
            placeholder="https://"
            value={valor[rede] ?? ''}
            readOnly={travado}
            disabled={travado}
            onChange={(event) => {
              const proximo = { ...valor };
              // Campo vazio sai do objeto: o schema aceita apenas URL valida,
              // e string vazia seria recusada.
              if (event.target.value.trim() === '') delete proximo[rede];
              else proximo[rede] = event.target.value.trim();
              onChange(proximo);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Valor da API no formato que os controles usam. */
function paraFormulario(
  fields: SiteModuleFieldView[],
  dados: Record<string, unknown>,
): Record<string, FormValue> {
  const saida: Record<string, FormValue> = {};
  for (const campo of fields) {
    const valor = dados[campo.key];
    if (campo.key === 'social') {
      saida.social = (valor as Record<string, string> | undefined) ?? {};
    } else if (campo.type === 'boolean') {
      saida[campo.key] = valor === true;
    } else if (campo.type === 'tags') {
      saida[campo.key] = Array.isArray(valor) ? formatList(valor as string[]) : '';
    } else if (campo.type === 'imageList') {
      saida[campo.key] = Array.isArray(valor) ? (valor as string[]) : [];
    } else if (valor === null || valor === undefined) {
      saida[campo.key] = campo.type === 'image' ? null : '';
    } else {
      saida[campo.key] = String(valor);
    }
  }
  return saida;
}

/**
 * Corpo da gravacao.
 *
 * Campo travado volta com o valor que **veio do servidor**, nao com o que a
 * tela mostra: assim um reenvio nao conta como alteracao e a gravacao nao e
 * recusada por um campo que o cliente nem tocou.
 */
/**
 * Monta o corpo da gravacao.
 *
 * Os campos personalizados vao num envelope `customFields`, nao soltos no
 * documento: o schema tipado do documento recusa chave desconhecida, e juntar
 * os dois faria o campo personalizado depender de afrouxar essa validacao.
 */
function paraApi(
  fields: SiteModuleFieldView[],
  valores: Record<string, FormValue>,
  original: Record<string, unknown>,
  originalPersonalizados: Record<string, unknown> = {},
): Record<string, unknown> {
  const corpo: Record<string, unknown> = {};
  const personalizados: Record<string, unknown> = {};

  for (const campo of fields) {
    if (campo.custom === true) {
      /**
       * Campo personalizado travado **sai do corpo**, ao contrario do tipado.
       *
       * A diferenca e do servidor, nao um descuido: no campo tipado a
       * verificacao compara valor a valor, entao reenviar o mesmo valor passa.
       * No personalizado ela recusa a **chave** -- e a gravacao mescla sobre o
       * que esta guardado, entao omitir preserva o valor em vez de apaga-lo.
       * Reenviar aqui levaria 403 em toda gravacao do documento.
       */
      if (campo.editable) {
        personalizados[campo.key] = valorPersonalizado(campo, valores[campo.key]);
      }
      continue;
    }

    if (!campo.editable) {
      corpo[campo.key] = original[campo.key] ?? null;
      continue;
    }

    const valor = valores[campo.key];
    if (campo.key === 'social') {
      corpo.social = valor ?? {};
    } else if (campo.type === 'boolean') {
      corpo[campo.key] = valor === true;
    } else if (campo.type === 'tags') {
      corpo[campo.key] = typeof valor === 'string' ? parseList(valor) : (valor ?? []);
    } else if (campo.type === 'imageList') {
      corpo[campo.key] = Array.isArray(valor) ? valor : [];
    } else if (campo.type === 'number') {
      corpo[campo.key] = typeof valor === 'string' ? numberOrNull(valor) : valor;
    } else if (campo.type === 'image') {
      corpo[campo.key] = typeof valor === 'string' && valor !== '' ? valor : null;
    } else {
      corpo[campo.key] = typeof valor === 'string' ? valor : (valor ?? '');
    }
  }

  return Object.keys(personalizados).length > 0
    ? { ...corpo, customFields: personalizados }
    : corpo;
}

/** Converte o valor do formulario na forma que a API espera. */
function valorPersonalizado(campo: SiteModuleFieldView, valor: FormValue): unknown {
  if (campo.type === 'boolean') return valor === true;
  if (campo.type === 'tags') return typeof valor === 'string' ? parseList(valor) : (valor ?? []);
  if (campo.type === 'number') return typeof valor === 'string' ? numberOrNull(valor) : valor;
  return typeof valor === 'string' ? valor : (valor ?? '');
}
