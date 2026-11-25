import { useState, type ChangeEvent, type ReactNode } from 'react';
import { CONTROL_CLASSES, Field, TextInput } from '@codeca/ui';
import {
  WHATSAPP_EXEMPLO,
  WHATSAPP_INVALIDO,
  anoDeFundacaoValido,
  digitosDeAno,
  mensagemDeAnoInvalido,
  normalizarWhatsApp,
  whatsappValido,
} from '@codeca/shared';

/**
 * Campos do conteudo do site que precisam de mais do que uma caixa de texto.
 *
 * O endereco NAO esta aqui: ele e um bloco so (CEP, rua, numero, bairro,
 * cidade, UF e coordenada se preenchem em conjunto) e mora no
 * `AddressPicker`, que serve qualquer formulario do painel.
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
