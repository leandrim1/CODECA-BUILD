import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Save } from 'lucide-react';
import {
  BRAZIL_STATES,
  CEP_INVALIDO,
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_LABELS,
  TELEFONE_INVALIDO,
  WHATSAPP_INVALIDO,
  anoDeFundacaoValido,
  cepValido,
  errosDosHorarios,
  horariosDoTexto,
  mensagemDeAnoInvalido,
  normalizarWhatsApp,
  lerMapSettings,
  mapSettingsPadrao,
  type MapSettings,
  type NormalizedAddress,
  telefoneValido,
  textoDosHorarios,
  whatsappValido,
  type HorariosDeAtendimento,
  type SocialNetwork,
} from '@codeca/shared';
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
import { CampoDeTelefone } from '../components/CamposComMascara.js';
import { CampoDeAno, CampoDeWhatsApp } from './CamposDeContato.js';
import { AddressPicker } from '../components/endereco/AddressPicker.js';
import { ConfiguracoesDoMapa } from './ConfiguracoesDoMapa.js';
import { CampoDeHorarios } from './CampoDeHorarios.js';
import type { MediaRef, SiteModuleFieldView } from '../types/index.js';

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
type FormValue = string | boolean | string[] | Record<string, string> | HorariosDeAtendimento | null;

export function DocumentModulePage({ moduleKey }: { moduleKey: 'institucional' | 'contato' }) {
  const tenantId = useTenantId();
  const toast = useToast();
  const { module, reload: reloadModules } = useSiteModules();
  const documento = useResource('moduleApi.document', () => moduleApi.document(tenantId, moduleKey), [tenantId, moduleKey]);

  const definicao = module(moduleKey);

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title={definicao?.name ?? 'Conteúdo do site'}
        description={definicao?.description ?? 'Conteúdo que o seu site exibe.'}
      />

      <ResourcePanel resource={documento}>
        {(data) => (
          <Formulario
            key={data.moduleKey}
            moduleKey={moduleKey}
            fields={data.fields}
            inicial={data.data}
            personalizados={data.customFields ?? {}}
            imagens={data.images ?? {}}
            atualizadoEm={data.updatedAt}
            onSaved={() => {
              documento.reload();
              // A politica pode ter mudado junto: recarregar mantem o menu e
              // os cadeados coerentes com o que o servidor acabou de aceitar.
              reloadModules();
              toast.success('Conteúdo salvo', 'O seu site passa a exibir a versão nova.');
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
  imagens,
  atualizadoEm,
  onSaved,
}: {
  moduleKey: string;
  fields: SiteModuleFieldView[];
  inicial: Record<string, unknown>;
  /** Valores dos campos personalizados, que vem fora de `data`. */
  personalizados: Record<string, unknown>;
  /** Imagens ja gravadas, por id, para os campos de imagem poderem mostra-las. */
  imagens: Record<string, MediaRef>;
  atualizadoEm: string | null;
  onSaved: () => void;
}) {
  const tenantId = useTenantId();
  const toast = useToast();
  const [valores, setValores] = useState<Record<string, FormValue>>(() =>
    paraFormulario(fields, { ...inicial, ...personalizados }),
  );

  // Uma conferencia em segundo plano que traga valores novos nao pode apagar
  // o que a pessoa esta digitando; depois de salvar, os valores novos entram.
  const alterado = useRef(false);
  useEffect(() => {
    if (alterado.current) return;
    setValores(paraFormulario(fields, { ...inicial, ...personalizados }));
  }, [fields, inicial, personalizados]);

  const travados = useMemo(() => fields.filter((campo) => !campo.editable), [fields]);

  const salvar = useMutation(
    () => moduleApi.saveDocument(tenantId, moduleKey, paraApi(fields, valores, inicial, personalizados)),
    {
      onSuccess: () => {
        alterado.current = false;
        onSaved();
      },
      onError: (error) => toast.error('Não foi possível salvar', error.message),
    },
  );

  function definir(key: string, value: FormValue) {
    alterado.current = true;
    setValores((atual) => ({ ...atual, [key]: value }));
  }

  /**
   * Varios campos de uma vez.
   *
   * O CEP, o mapa e o "usar minha localizacao" preenchem endereco, cidade,
   * estado e coordenada juntos. Chamar `definir` quatro vezes seguidas
   * perderia atualizacoes, porque cada uma leria o estado de antes.
   */
  function definirVarios(patch: Record<string, FormValue>) {
    alterado.current = true;
    setValores((atual) => ({ ...atual, ...patch }));
  }

  const erros = errosDoDocumento(moduleKey, valores);
  const temErro = Object.keys(erros).length > 0;

  /*
    O horario que ja estava gravado em texto livre, quando ninguem ainda
    escolheu os horarios na grade. O que der para interpretar vira estrutura
    sozinho; o que nao der aparece no aviso, para nao sumir da tela.
  */
  const horariosGravados = valores.businessHoursSchedule as HorariosDeAtendimento | null;
  const textoDeHorarioAntigo =
    moduleKey === 'contato' && !horariosGravados && typeof valores.businessHours === 'string'
      ? valores.businessHours
      : '';

  return (
    <Card>
      <CardHeader
        title="Conteúdo"
        description={
          atualizadoEm
            ? `Alterado pela última vez em ${new Date(atualizadoEm).toLocaleString('pt-BR')}.`
            : 'Ainda não alterado por aqui.'
        }
        actions={
          <Button
            onClick={() => void salvar.run(undefined)}
            loading={salvar.loading}
            disabled={temErro}
            icon={<Save aria-hidden="true" className="size-4" />}
          >
            Salvar
          </Button>
        }
      />
      <CardBody className="grid gap-5">
        {travados.length > 0 ? (
          <Alert tone="info" title="Alguns campos são mantidos pela CODECA IA">
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
              moduleKey={moduleKey}
              tenantId={tenantId}
              valor={valores[campo.key] ?? ''}
              valores={valores}
              erro={erros[campo.key]}
              errosDoFormulario={erros}
              textoDeHorarioAntigo={textoDeHorarioAntigo}
              imagens={imagens}
              onChange={(proximo) => definir(campo.key, proximo)}
              onPatch={definirVarios}
            />
          ),
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          {temErro ? (
            <p className="text-sm text-rose-600">Corrija os campos destacados para salvar.</p>
          ) : null}
          <Button
            onClick={() => void salvar.run(undefined)}
            loading={salvar.loading}
            disabled={temErro}
            icon={<Save aria-hidden="true" className="size-4" />}
          >
            Salvar
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Erros que a tela consegue ver antes de enviar.
 *
 * Mesmas regras do servidor (`modules/documents.ts`), vindas das mesmas
 * funcoes -- aqui elas existem para o botao Salvar nao mandar o que vai
 * voltar recusado, e para o aviso aparecer embaixo do campo certo.
 */
export function errosDoDocumento(
  moduleKey: string,
  valores: Record<string, FormValue>,
): Record<string, string> {
  const erros: Record<string, string> = {};
  const texto = (chave: string) => (typeof valores[chave] === 'string' ? (valores[chave] as string) : '');

  if (moduleKey === 'institucional') {
    const ano = texto('foundedYear');
    if (ano !== '' && !anoDeFundacaoValido(ano)) erros.foundedYear = mensagemDeAnoInvalido();
  }

  if (moduleKey === 'contato') {
    const telefone = texto('phone');
    if (telefone !== '' && !telefoneValido(telefone)) erros.phone = TELEFONE_INVALIDO;

    const whatsapp = texto('whatsapp');
    if (whatsapp !== '' && !whatsappValido(whatsapp)) erros.whatsapp = WHATSAPP_INVALIDO;

    const cep = texto('postalCode');
    if (cep !== '' && !cepValido(cep)) erros.postalCode = CEP_INVALIDO;

    const uf = texto('state');
    if (uf !== '' && !(BRAZIL_STATES as readonly string[]).includes(uf)) {
      erros.state = 'Informe uma UF válida.';
    }

    const horarios = valores.businessHoursSchedule as HorariosDeAtendimento | null;
    const porDia = errosDosHorarios(horarios ?? null);
    const dias = Object.keys(porDia);
    if (dias.length > 0) {
      erros.businessHoursSchedule = 'Confira os horários destacados abaixo.';
    }
  }

  return erros;
}

/** Um campo do modulo, no controle que o tipo pede. */
function Campo({
  campo,
  moduleKey,
  tenantId,
  valor,
  valores,
  erro,
  errosDoFormulario = {},
  textoDeHorarioAntigo,
  imagens,
  onChange,
  onPatch,
}: {
  campo: SiteModuleFieldView;
  moduleKey: string;
  tenantId: string;
  valor: FormValue;
  /** Os demais valores: o mapa resume o endereco a partir deles. */
  valores: Record<string, FormValue>;
  erro?: string | undefined;
  /** Todos os erros do formulario: o endereco mostra varios de uma vez. */
  errosDoFormulario?: Record<string, string>;
  textoDeHorarioAntigo?: string;
  imagens: Record<string, MediaRef>;
  onChange: (valor: FormValue) => void;
  onPatch: (patch: Record<string, FormValue>) => void;
}) {
  const travado = !campo.editable;
  const dica = travado ? 'Mantido pela CODECA IA neste site.' : campo.help;
  const rotulo = (
    <span className="inline-flex items-center gap-1.5">
      {campo.label}
      {travado ? <Lock aria-label="Campo travado" className="size-3.5 text-slate-500" /> : null}
    </span>
  );
  const comum = {
    label: rotulo,
    ...(dica ? { hint: dica } : {}),
    ...(erro ? { error: erro } : {}),
    readOnly: travado,
    disabled: travado,
    required: campo.required ?? false,
  };

  /*
    Campos com controle proprio, escolhidos pela CHAVE e nao pelo tipo.

    O tipo descreve a forma do dado (texto, numero, url) e e o que o SDK e a
    API publica enxergam. Quem precisa de mais do que uma caixa de texto e a
    TELA, e so em alguns campos conhecidos -- declarar um tipo novo no
    registro para cada um deles espalharia detalhe de interface por um
    contrato que o site do cliente tambem le.
  */
  const texto = typeof valor === 'string' ? valor : '';
  const textoDe = (v: FormValue | undefined) => (typeof v === 'string' ? v : '');

  if (moduleKey === 'institucional' && campo.key === 'foundedYear') {
    return (
      <CampoDeAno
        label={rotulo}
        hint={dica}
        disabled={travado}
        value={texto}
        error={erro}
        onChange={(proximo) => onChange(proximo)}
      />
    );
  }

  if (moduleKey === 'contato') {
    if (campo.key === 'phone') {
      return (
        <CampoDeTelefone
          label={rotulo}
          hint={dica}
          disabled={travado}
          value={texto}
          error={erro}
          onChange={(digitos) => onChange(digitos)}
        />
      );
    }

    if (campo.key === 'whatsapp') {
      return (
        <CampoDeWhatsApp
          label={rotulo}
          hint={dica}
          disabled={travado}
          value={texto}
          error={erro}
          onChange={(proximo) => onChange(proximo)}
        />
      );
    }

    /*
      Um campo desenha o ENDERECO INTEIRO, e os demais somem.

      CEP, rua, numero, complemento, bairro, cidade, UF e coordenada sao um
      dado so para quem preenche -- o CEP preenche a rua, o mapa preenche a
      coordenada, e arrastar o pino mexe em todos. Oito caixas soltas na tela
      obrigariam a pessoa a costurar isso de cabeca.
    */
    if (campo.key === 'postalCode') {
      const endereco: NormalizedAddress = {
        street: textoDe(valores.addressLine),
        number: textoDe(valores.addressNumber),
        complement: textoDe(valores.addressComplement),
        neighborhood: textoDe(valores.neighborhood),
        city: textoDe(valores.city),
        state: textoDe(valores.state),
        postalCode: textoDe(valores.postalCode),
        country: 'BR',
        ...(textoDe(valores.latitude) !== '' ? { lat: Number(valores.latitude) } : {}),
        ...(textoDe(valores.longitude) !== '' ? { lng: Number(valores.longitude) } : {}),
      };

      return (
        <AddressPicker
          value={endereco}
          disabled={travado}
          settings={lerMapSettings(valores.mapSettings)}
          erros={{
            postalCode: erro,
            street: errosDoFormulario.addressLine,
            city: errosDoFormulario.city,
            state: errosDoFormulario.state,
          }}
          onChange={(proximo) => {
            const patch: Record<string, FormValue> = {
              addressLine: proximo.street,
              addressNumber: proximo.number ?? '',
              addressComplement: proximo.complement ?? '',
              neighborhood: proximo.neighborhood ?? '',
              city: proximo.city,
              state: proximo.state,
              postalCode: proximo.postalCode,
              latitude: typeof proximo.lat === 'number' ? String(proximo.lat) : '',
              longitude: typeof proximo.lng === 'number' ? String(proximo.lng) : '',
            };
            /*
              Carimbo de auditoria so quando a coordenada muda de verdade:
              digitar o complemento nao e geocodificar.
            */
            if (proximo.lat !== endereco.lat || proximo.lng !== endereco.lng) {
              patch.geocodedAt = new Date().toISOString();
              patch.geocodeSource = 'painel';
            }
            onPatch(patch);
          }}
        />
      );
    }

    /* Os campos que o AddressPicker ja desenha nao aparecem duas vezes. */
    if (
      campo.key === 'addressLine'
      || campo.key === 'addressNumber'
      || campo.key === 'addressComplement'
      || campo.key === 'neighborhood'
      || campo.key === 'city'
      || campo.key === 'state'
      || campo.key === 'latitude'
      || campo.key === 'longitude'
      || campo.key === 'geocodedAt'
      || campo.key === 'geocodeSource'
    ) {
      return null;
    }

    if (campo.key === 'mapSettings') {
      const lat = textoDe(valores.latitude) !== '' ? Number(valores.latitude) : null;
      const lng = textoDe(valores.longitude) !== '' ? Number(valores.longitude) : null;
      return (
        <div className="grid gap-3">
          <span className="text-sm font-medium text-slate-700">{campo.label}</span>
          <ConfiguracoesDoMapa
            settings={lerMapSettings(valor)}
            disabled={travado}
            latitude={lat}
            longitude={lng}
            onChange={(proximo: MapSettings) => onChange(proximo as unknown as FormValue)}
          />
        </div>
      );
    }

    if (campo.key === 'businessHoursSchedule') {
      return (
        <CampoDeHorarios
          label={campo.label}
          disabled={travado}
          valor={(valor as HorariosDeAtendimento | null) ?? null}
          textoAntigo={textoDeHorarioAntigo ?? null}
          onChange={(horarios) =>
            // O texto legivel sai junto: e o campo que o site e o SDK ja liam,
            // e ele nao pode divergir da grade que acabou de ser editada.
            onPatch({ businessHoursSchedule: horarios, businessHours: textoDosHorarios(horarios) })
          }
        />
      );
    }

    /*
      O texto do horario e gerado, nao digitado. Some da tela quando o cliente
      pode editar a grade; continua aparecendo quando o campo esta travado,
      porque campo travado se mostra, como todos os outros.
    */
    if (campo.key === 'businessHours' && !travado) return null;
  }

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
    const id = typeof valor === 'string' && valor !== '' ? valor : null;
    return (
      <ImageField
        label={campo.label}
        value={id}
        preview={id ? imagens[id] ?? null : null}
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
        hint={dica ?? 'Separe por vírgula ou quebra de linha.'}
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
        {travado ? <Lock aria-label="Campo travado" className="ml-1.5 inline size-3.5 text-slate-500" /> : null}
      </legend>
      <p className="text-xs text-slate-500">Endereço completo, começando com https://.</p>
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
    } else if (campo.key === 'businessHoursSchedule') {
      // Objeto, e nao texto: o tipo declarado e `tags` (o registro nao tem um
      // tipo "estrutura"), entao sem este desvio a conversao o transformaria
      // em lista de palavras.
      saida[campo.key] = (valor as HorariosDeAtendimento | null) ?? null;
    } else if (campo.key === 'mapSettings') {
      // Mesmo caso: configuracao e objeto, e `lerMapSettings` garante que o
      // formulario sempre abra com algo valido.
      saida[campo.key] = lerMapSettings(valor) as unknown as FormValue;
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

  /*
    Horario gravado como texto, antes desta tela existir.

    Tenta virar grade na abertura: "Seg a Sex: 08:00–18:00" tem tudo o que a
    estrutura precisa, e obrigar a pessoa a digitar de novo o que ja estava
    certo seria trabalho inventado. O que nao for reconhecido continua `null`,
    e a tela mostra o texto antigo em vez de descarta-lo.
  */
  /*
    WhatsApp gravado como telefone, antes de o campo virar link.

    Converte na abertura para a tela mostrar o que sera salvo. Sem isto, o
    campo abre com "(19) 99999-0000" embaixo de um exemplo que pede
    `https://wa.me/...`, e a conversao so apareceria depois de tocar no campo.
  */
  if (typeof saida.whatsapp === 'string' && saida.whatsapp !== '') {
    saida.whatsapp = normalizarWhatsApp(saida.whatsapp);
  }

  if (saida.businessHoursSchedule === null || saida.businessHoursSchedule === undefined) {
    const interpretado = horariosDoTexto(dados.businessHours);
    if (interpretado) saida.businessHoursSchedule = interpretado;
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
    } else if (campo.key === 'businessHoursSchedule') {
      corpo[campo.key] = valor ?? null;
    } else if (campo.key === 'mapSettings') {
      corpo[campo.key] = valor ?? mapSettingsPadrao();
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
