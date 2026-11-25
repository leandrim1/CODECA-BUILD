import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { Button, CONTROL_CLASSES, Field, TextInput, cx } from '@codeca/ui';
import {
  CEP_INVALIDO,
  WHATSAPP_EXEMPLO,
  WHATSAPP_INVALIDO,
  anoDeFundacaoValido,
  digitosDeAno,
  digitosDeCep,
  formatarCep,
  mensagemDeAnoInvalido,
  normalizarWhatsApp,
  whatsappValido,
} from '@codeca/shared';
import { ApiError } from '../services/api.js';
import { enderecoApi, type EnderecoEncontrado } from '../services/endpoints.js';

/**
 * Campos do conteudo do site que precisam de mais do que uma caixa de texto.
 *
 * Todos seguem a regra dos campos do cadastro: a tela **conserta** o que da
 * para consertar (tira o que nao e digito, formata, normaliza) e so avisa
 * quando sobra erro -- e sempre depois do blur, porque durante a digitacao
 * todo valor esta incompleto. O servidor cobra as mesmas regras em
 * `modules/documents.ts`.
 */

/** Ano de fundacao: quatro digitos, sem as setinhas do `type=number`. */
export function CampoDeAno({
  label,
  value,
  onChange,
  hint,
  disabled,
  error,
}: {
  label: ReactNode;
  value: string;
  onChange: (valor: string) => void;
  hint?: string | undefined;
  disabled?: boolean;
  error?: string | undefined;
}) {
  const [tocado, setTocado] = useState(false);
  const erroLocal = tocado && value !== '' && !anoDeFundacaoValido(value) ? mensagemDeAnoInvalido() : undefined;

  return (
    <Field label={label} {...(hint ? { hint } : {})} error={error ?? erroLocal}>
      {({ inputId, describedBy, invalid }) => (
        <input
          id={inputId}
          /*
            `text` com `inputMode="numeric"`, e nao `type="number"`: o campo
            numerico traz setinhas que mudam o ano na rolagem do mouse, aceita
            `1e5` e `-20`, e no celular abre um teclado com virgula e sinal.
            Aqui o que se quer sao quatro digitos.
          */
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="1998"
          disabled={disabled}
          value={value}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={CONTROL_CLASSES}
          onChange={(evento: ChangeEvent<HTMLInputElement>) => onChange(digitosDeAno(evento.target.value))}
          onBlur={() => setTocado(true)}
        />
      )}
    </Field>
  );
}

/** WhatsApp: link da conversa, e nao telefone. */
export function CampoDeWhatsApp({
  label,
  value,
  onChange,
  hint,
  disabled,
  error,
}: {
  label: ReactNode;
  value: string;
  onChange: (valor: string) => void;
  hint?: string | undefined;
  disabled?: boolean;
  error?: string | undefined;
}) {
  const [tocado, setTocado] = useState(false);
  const erroLocal = tocado && value !== '' && !whatsappValido(value) ? WHATSAPP_INVALIDO : undefined;

  return (
    <TextInput
      label={label}
      type="url"
      inputMode="url"
      placeholder={WHATSAPP_EXEMPLO}
      hint={hint ?? `Ex.: ${WHATSAPP_EXEMPLO}`}
      error={error ?? erroLocal}
      disabled={disabled}
      value={value}
      // No blur, e nao a cada tecla: normalizar durante a digitacao brigaria
      // com quem esta no meio de colar ou corrigir o numero.
      onChange={(evento) => onChange(evento.target.value.replace(/\s+/g, ''))}
      onBlur={() => {
        setTocado(true);
        const normalizado = normalizarWhatsApp(value);
        if (normalizado !== value) onChange(normalizado);
      }}
    />
  );
}

export interface CampoDeCepProps {
  label: ReactNode;
  /** So digitos; a mascara e desenhada aqui. */
  value: string;
  onChange: (digitos: string) => void;
  /** Chamado quando o ViaCEP responde: preenche endereco, cidade e estado. */
  onEndereco: (endereco: EnderecoEncontrado) => void;
  tenantId: string;
  hint?: string | undefined;
  disabled?: boolean;
  error?: string | undefined;
}

/**
 * CEP com mascara e busca automatica.
 *
 * A consulta sai sozinha ao completar os oito digitos -- quem digita um CEP
 * quer o endereco, e pedir um clique a mais seria cobrar pela conveniencia. O
 * que ela preenche continua editavel: o ViaCEP erra numero e nao conhece
 * complemento.
 */
export function CampoDeCep({
  label,
  value,
  onChange,
  onEndereco,
  tenantId,
  hint,
  disabled,
  error,
}: CampoDeCepProps) {
  const [tocado, setTocado] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function buscar(digitos: string) {
    setBuscando(true);
    setAviso(null);
    try {
      const encontrado = await enderecoApi.porCep(tenantId, digitos);
      onEndereco(encontrado);
    } catch (erro) {
      // Erro de CEP nao e erro de formulario: o campo continua valido e a
      // pessoa pode preencher o endereco a mao.
      setAviso(erro instanceof ApiError ? erro.message : 'Não foi possível consultar o CEP agora.');
    } finally {
      setBuscando(false);
    }
  }

  const erroLocal = tocado && value !== '' && value.length !== 8 ? CEP_INVALIDO : undefined;

  return (
    <div className="grid gap-1.5">
      <Field label={label} {...(hint ? { hint } : {})} error={error ?? erroLocal}>
        {({ inputId, describedBy, invalid }) => (
          <div className="relative">
            <input
              id={inputId}
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="00000-000"
              maxLength={9}
              disabled={disabled}
              value={formatarCep(value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-busy={buscando}
              className={cx(CONTROL_CLASSES, 'pr-11')}
              onChange={(evento) => {
                const digitos = digitosDeCep(evento.target.value);
                onChange(digitos);
                setAviso(null);
                if (digitos.length === 8 && !disabled) void buscar(digitos);
              }}
              onBlur={() => setTocado(true)}
            />
            {buscando ? (
              <span className="absolute inset-y-0 right-0 flex w-11 items-center justify-center">
                <Loader2 aria-hidden="true" className="size-4 animate-spin text-slate-500" />
                <span className="sr-only">Consultando o CEP…</span>
              </span>
            ) : null}
          </div>
        )}
      </Field>
      {aviso ? <p className="text-xs text-amber-700">{aviso}</p> : null}
    </div>
  );
}

/**
 * "Usar minha localizacao atual".
 *
 * Botao separado, e nao automatico: pedir a localizacao sozinho ao abrir a
 * tela e o tipo de coisa que faz o navegador mostrar um aviso e a pessoa
 * recusar para sempre. Aqui ela pede quando quer.
 */
export function BotaoDeLocalizacao({
  tenantId,
  onEndereco,
  disabled,
}: {
  tenantId: string;
  onEndereco: (endereco: EnderecoEncontrado) => void;
  disabled?: boolean;
}) {
  const [carregando, setCarregando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  function pedir() {
    if (!('geolocation' in navigator)) {
      setAviso('Este navegador não informa a localização. Preencha o endereço à mão.');
      return;
    }
    setCarregando(true);
    setAviso(null);
    navigator.geolocation.getCurrentPosition(
      async (posicao) => {
        try {
          const encontrado = await enderecoApi.porCoordenada(
            tenantId,
            posicao.coords.latitude,
            posicao.coords.longitude,
          );
          onEndereco(encontrado);
        } catch (erro) {
          setAviso(erro instanceof ApiError ? erro.message : 'Não foi possível descobrir o endereço agora.');
        } finally {
          setCarregando(false);
        }
      },
      (erro) => {
        setCarregando(false);
        setAviso(
          erro.code === erro.PERMISSION_DENIED
            ? 'Permissão de localização negada. Você pode liberar nas configurações do navegador ou preencher o endereço à mão.'
            : 'Não foi possível obter a sua localização. Preencha o endereço à mão.',
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="grid gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        loading={carregando}
        onClick={pedir}
        icon={<MapPin aria-hidden="true" className="size-4" />}
      >
        Usar minha localização atual
      </Button>
      {aviso ? <p className="text-xs text-amber-700">{aviso}</p> : null}
    </div>
  );
}
