import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import { cx } from './utils.js';

/**
 * Campos de formulario.
 *
 * Cada campo associa rotulo, descricao e mensagem de erro por `aria-describedby`
 * e marca `aria-invalid`, para que leitores de tela anunciem o problema.
 */

export interface FieldShellProps {
  /** Aceita no para rotulos com marcacao, como o cadeado de campo travado. */
  label: ReactNode;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
  /**
   * Densidade reduzida: rotulo a 4px do campo e campo de 38px em vez de 42px.
   *
   * E opcao, e nao o novo padrao, de proposito. A altura confortavel continua
   * valendo em todo o painel, onde o formulario tem a pagina inteira. Quem
   * precisa disto e a tela que tem de caber em uma dobra -- hoje so o
   * cadastro. Trocar o padrao apertaria centenas de campos de uma vez.
   */
  compacto?: boolean;
  /**
   * `id` de um texto de apoio desenhado FORA do campo -- hoje a lista de
   * conferencia da senha, que nao cabe em `hint` por ser uma lista.
   *
   * Entra no `aria-describedby` junto com a dica e o erro: para o leitor de
   * tela, a lista pertence ao campo mesmo morando noutro elemento.
   */
  describedById?: string | undefined;
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  compacto,
  describedById,
}: FieldShellProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null, describedById ?? null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className={cx('grid', compacto ? 'gap-1' : 'gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="ml-0.5 text-brand-600">*</span> : null}
      </label>
      {children({ inputId, describedBy, invalid: Boolean(error) })}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Base de todo controle de formulario.
 *
 * O foco continua sendo o azul da marca -- `brand-500` na borda e um anel
 * translucido da mesma cor. O que mudou e o conforto: 2.5 de altura interna em
 * vez de 2, raio maior e a transicao que acompanha borda e sombra, para o
 * campo responder ao toque em vez de piscar.
 */
/**
 * `border-contorno` e nao `border-slate-300`: a borda e o que identifica o
 * campo, e a WCAG 2.2 (1.4.11) pede 3:1 para isso. `slate-300` media 1,49:1.
 *
 * `placeholder:text-slate-500` e nao `-400`: o texto de exemplo e texto, e
 * vale o minimo de 4,5:1. `slate-400` sobre branco media 2,63:1 -- era o
 * "placeholder quase invisivel".
 */
/**
 * Exportado (e nao so interno) para o campo que precisa de markup proprio --
 * a senha, com o botao de olho dentro da caixa -- continuar com borda, foco e
 * contraste identicos aos demais, sem copiar a lista de classes.
 */
export const CONTROL_CLASSES =
  'w-full rounded-xl border border-contorno bg-white px-3.5 py-2.5 text-sm text-slate-900 '
  + 'transition-[border-color,box-shadow,outline-color] duration-200 ease-[var(--ease-out-soft)] '
  + 'placeholder:text-slate-500 hover:border-slate-500 '
  + 'focus:border-brand-500 focus:outline-2 focus:outline-offset-0 '
  + 'focus:outline-brand-500/40 disabled:bg-slate-50 disabled:text-slate-600 disabled:hover:border-contorno '
  + 'aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus:outline-rose-400/40';

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: ReactNode;
  hint?: string;
  error?: string | undefined;
  /** Ver `FieldShellProps.compacto`. */
  compacto?: boolean;
}

export function TextInput({ label, hint, error, required, className, compacto, ...rest }: TextInputProps) {
  return (
    <Field
      label={label}
      {...(hint ? { hint } : {})}
      error={error}
      required={required}
      className={className}
      compacto={compacto}
    >
      {({ inputId, describedBy, invalid }) => (
        <input
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          required={required}
          // 38px em vez de 42px: so o padding vertical muda, entao borda, raio,
          // foco e contraste continuam identicos ao campo padrao.
          className={compacto ? CONTROL_CLASSES.replace('py-2.5', 'py-2') : CONTROL_CLASSES}
          {...rest}
        />
      )}
    </Field>
  );
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: ReactNode;
  hint?: string;
  error?: string | undefined;
}

export function TextArea({ label, hint, error, required, className, rows = 4, ...rest }: TextAreaProps) {
  return (
    <Field label={label} {...(hint ? { hint } : {})} error={error} required={required} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <textarea
          id={inputId}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          required={required}
          className={cx(CONTROL_CLASSES, 'resize-y')}
          {...rest}
        />
      )}
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'> {
  /** `ReactNode` como nos outros campos: o cadeado do campo travado e um icone. */
  label: ReactNode;
  hint?: string;
  error?: string | undefined;
  options: readonly SelectOption[];
  placeholder?: string;
}

export function Select({
  label,
  hint,
  error,
  required,
  options,
  placeholder,
  className,
  ...rest
}: SelectProps) {
  return (
    <Field label={label} {...(hint ? { hint } : {})} error={error} required={required} className={className}>
      {({ inputId, describedBy, invalid }) => (
        <select
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          required={required}
          className={CONTROL_CLASSES}
          {...rest}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Checkbox({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  /** `ReactNode`: o rotulo de aceite de termos leva links. */
  label: ReactNode;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 rounded border-contorno text-brand-600 focus:ring-brand-500"
      />
      <label htmlFor={id} className="text-sm text-slate-700">
        {label}
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </label>
    </div>
  );
}

/** Interruptor usado nas configuracoes do site. */
export function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span className="text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-6 w-11 flex-none rounded-full transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
          checked ? 'bg-brand-600' : 'bg-slate-300',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        {/*
         * `left-0.5` e obrigatorio, nao decorativo.
         *
         * Sem `left`, um elemento `absolute` cai na POSICAO ESTATICA -- e a
         * trilha e um `<button>`, que o navegador alinha ao centro. A posicao
         * estatica virava `left: 22px` (o meio dos 44px da trilha), de modo que
         * o indicador desligado encostava na borda direita e o LIGADO saia
         * inteiro da trilha, 20px a direita dela: o circulo branco solto.
         *
         * Com a origem presa em 2px, o deslocamento e so o percurso:
         * 44 (trilha) - 20 (indicador) - 2 (folga de cada lado) = 20px.
         */}
        <span
          className={cx(
            'absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </label>
  );
}

/** Controle numerico com faixa, usado no editor de estilos. */
export function RangeInput({
  label,
  value,
  min,
  max,
  step = 1,
  unit = 'px',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">
          {label}
        </label>
        <span className="text-xs tabular-nums text-slate-500">
          {value}
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-600"
      />
    </div>
  );
}

/** Seletor de cor com campo hexadecimal, validado na digitacao. */
export function ColorInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const id = useId();
  const isHex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={isHex ? value.slice(0, 7) : '#000000'}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          aria-label={`${label}: seletor visual`}
          className="size-10 flex-none cursor-pointer rounded-xl border border-contorno bg-white p-0.5"
        />
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          aria-invalid={!isHex}
          className={cx(CONTROL_CLASSES, 'font-mono text-xs uppercase')}
          maxLength={9}
          spellCheck={false}
        />
      </div>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {!isHex ? <p className="text-xs font-medium text-rose-600">Use o formato #1E3A8A.</p> : null}
    </div>
  );
}
