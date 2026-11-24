import { useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react';
import { CONTROL_CLASSES, Field, cx } from '@codeca/ui';
import {
  NOME_INVALIDO,
  NOME_MAX,
  TELEFONE_INVALIDO,
  TELEFONE_MAX_MASCARA,
  digitosDeTelefone,
  formatarTelefone,
  nomeFinal,
  nomeValido,
  sanitizarNome,
  telefoneValido,
} from '@codeca/shared';

/**
 * Campos que limpam o que recebem: telefone e nome de pessoa.
 *
 * Os dois seguem a mesma ideia -- o campo **conserta** em vez de reclamar. Quem
 * cola "+55 (19) 99999-0000" ve "(19) 99999-0000"; quem cola "Maria 123" ve
 * "Maria". O aviso fica reservado para o que a limpeza nao resolve (um DDD que
 * nao existe, um campo com uma letra so), e so depois do blur: durante a
 * digitacao, todo nome esta incompleto.
 *
 * A limpeza mora em `onChange`, e nao em `onKeyDown`, porque teclado de
 * celular, colagem, ditado e preenchimento automatico do navegador nao passam
 * por tecla nenhuma.
 */

/**
 * Mantem o cursor onde ele estava quando o valor muda embaixo dele.
 *
 * Sem isto, editar o meio de `(19) 99999-0000` joga o cursor para o fim a cada
 * tecla: o valor exibido e recalculado, o React troca o `value` do input e o
 * navegador reposiciona o cursor no fim da string nova.
 *
 * A conta nao e por indice de caractere (a mascara move os indices), e sim por
 * ANCORA: quantos caracteres que importam -- digitos, no telefone -- existem
 * antes do cursor. Reposicionar depois do mesmo numero de ancoras preserva o
 * lugar, mesmo que parenteses e hifen tenham entrado ou saido ao redor.
 */
function useCursorEstavel() {
  const ref = useRef<HTMLInputElement>(null);
  const destino = useRef<number | null>(null);

  useLayoutEffect(() => {
    const campo = ref.current;
    if (!campo || destino.current === null) return;
    const posicao = Math.min(destino.current, campo.value.length);
    destino.current = null;
    // `setSelectionRange` antes da pintura: feito em `useEffect`, o cursor
    // piscaria no fim por um quadro.
    campo.setSelectionRange(posicao, posicao);
  });

  /**
   * Quando a limpeza nao muda nada (a pessoa digitou um caractere recusado), o
   * React nao re-renderiza e o efeito acima nao roda -- mas o caractere ja esta
   * no DOM. Aqui o input volta ao valor correto na hora, sem esperar render.
   */
  function restaurar(campo: HTMLInputElement, valor: string, posicao: number) {
    campo.value = valor;
    campo.setSelectionRange(posicao, posicao);
  }

  return { ref, destino, restaurar };
}

/** Posicao logo depois do n-esimo digito de um texto com mascara. */
function depoisDoDigito(texto: string, n: number): number {
  if (n <= 0) return 0;
  let vistos = 0;
  for (let i = 0; i < texto.length; i += 1) {
    if (texto[i]! >= '0' && texto[i]! <= '9') {
      vistos += 1;
      if (vistos === n) return i + 1;
    }
  }
  return texto.length;
}

const CONTROL_COMPACTO = CONTROL_CLASSES.replace('py-2.5', 'py-2');

export interface CampoDeTelefoneProps {
  /** SO digitos (`19999990000`): a mascara e assunto desta tela. */
  value: string;
  onChange: (digitos: string) => void;
  label?: string;
  /** Erro vindo do servidor; o erro local aparece depois do blur. */
  error?: string | undefined;
  compacto?: boolean;
}

export function CampoDeTelefone({
  value,
  onChange,
  label = 'Telefone',
  error,
  compacto,
}: CampoDeTelefoneProps) {
  const { ref, destino, restaurar } = useCursorEstavel();
  const [tocado, setTocado] = useState(false);
  const exibido = formatarTelefone(value);

  /** Caminho unico: um texto bruto entra, digitos saem, cursor fica no lugar. */
  function aplicar(campo: HTMLInputElement, bruto: string, cursor: number, apagouUmCaractere: boolean) {
    let antesDoCursor = bruto.slice(0, cursor).replace(/\D+/g, '').length;
    let digitos = digitosDeTelefone(bruto);

    /*
      Backspace em cima de um caractere da mascara.

      Apagar o hifen de `(19) 99999-0000` nao tira digito nenhum: a mascara o
      devolve e o campo parece travado. Quando a tecla apagou so pontuacao, o
      digito anterior ao cursor vai junto -- que e o que a pessoa quis apagar.

      A condicao e UM caractere a menos, e nao "ficou mais curto": colar
      `19999990000` sobre `(19) 99999-0000` tambem encurta o texto (11 contra
      15) sem apagar nada, e a versao anterior desta funcao comia um digito do
      numero colado -- defeito que so apareceu no navegador, porque `fill` e o
      preenchimento automatico mandam o valor inteiro de uma vez.
    */
    if (apagouUmCaractere && digitos.length === digitosDeTelefone(exibido).length && antesDoCursor > 0) {
      digitos = digitos.slice(0, antesDoCursor - 1) + digitos.slice(antesDoCursor);
      antesDoCursor -= 1;
    }

    const novoExibido = formatarTelefone(digitos);
    destino.current = depoisDoDigito(novoExibido, Math.min(antesDoCursor, digitos.length));
    if (novoExibido === exibido) restaurar(campo, exibido, destino.current);
    onChange(digitos);
  }

  function aoMudar(evento: ChangeEvent<HTMLInputElement>) {
    const campo = evento.currentTarget;
    aplicar(campo, campo.value, campo.selectionStart ?? campo.value.length, exibido.length - campo.value.length === 1);
  }

  /*
    Colar passa por aqui, e nao pelo navegador.

    `maxLength` corta o texto colado ANTES de qualquer codigo nosso rodar, e
    `+55 (19) 99999-0000` tem 19 caracteres: o navegador entregaria
    `+55 (19) 99999-` e o numero sairia errado (virava DDD 55). Lendo o texto
    da area de transferencia direto, o limite continua valendo para o que se
    digita e o prefixo de pais e tratado como deveria.
  */
  function aoColar(evento: ClipboardEvent<HTMLInputElement>) {
    const texto = evento.clipboardData?.getData('text') ?? '';
    if (!texto) return;
    evento.preventDefault();
    const campo = evento.currentTarget;
    const inicio = campo.selectionStart ?? campo.value.length;
    const fim = campo.selectionEnd ?? inicio;
    const bruto = campo.value.slice(0, inicio) + texto + campo.value.slice(fim);
    aplicar(campo, bruto, inicio + texto.length, false);
  }

  const erroLocal = tocado && value !== '' && !telefoneValido(value) ? TELEFONE_INVALIDO : undefined;

  return (
    <Field label={label} error={error ?? erroLocal} compacto={compacto}>
      {({ inputId, describedBy, invalid }) => (
        <input
          ref={ref}
          id={inputId}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="(19) 99999-0000"
          maxLength={TELEFONE_MAX_MASCARA}
          value={exibido}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={compacto ? CONTROL_COMPACTO : CONTROL_CLASSES}
          onChange={aoMudar}
          onPaste={aoColar}
          onBlur={() => setTocado(true)}
        />
      )}
    </Field>
  );
}

export interface CampoDeNomeProps {
  value: string;
  onChange: (nome: string) => void;
  label?: string;
  error?: string | undefined;
  required?: boolean;
  compacto?: boolean;
}

export function CampoDeNome({
  value,
  onChange,
  label = 'Seu nome',
  error,
  required,
  compacto,
}: CampoDeNomeProps) {
  const { ref, destino, restaurar } = useCursorEstavel();
  const [tocado, setTocado] = useState(false);

  function aoMudar(evento: ChangeEvent<HTMLInputElement>) {
    const campo = evento.currentTarget;
    const bruto = campo.value;
    const cursor = campo.selectionStart ?? bruto.length;

    // Aqui a ancora e o proprio texto limpo: nome nao tem mascara, entao cada
    // caractere que sobrevive ocupa uma posicao.
    const limpo = sanitizarNome(bruto);
    destino.current = sanitizarNome(bruto.slice(0, cursor)).length;
    if (limpo === value) restaurar(campo, value, destino.current);
    onChange(limpo);
  }

  const erroLocal = tocado && !nomeValido(value) ? NOME_INVALIDO : undefined;

  return (
    <Field label={label} error={error ?? erroLocal} required={required} compacto={compacto}>
      {({ inputId, describedBy, invalid }) => (
        <input
          ref={ref}
          id={inputId}
          type="text"
          autoComplete="name"
          maxLength={NOME_MAX}
          required={required}
          value={value}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={compacto ? CONTROL_COMPACTO : CONTROL_CLASSES}
          onChange={aoMudar}
          // O espaco do fim sobrevive a digitacao e morre aqui: "Ana " a
          // caminho do sobrenome e uma coisa, "Ana " guardada e outra.
          onBlur={() => {
            setTocado(true);
            const aparado = nomeFinal(value);
            if (aparado !== value) onChange(aparado);
          }}
        />
      )}
    </Field>
  );
}
