import { ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { THEME_COLOR_TOKENS } from '@codeca/shared';
import { BlockIcon } from '@codeca/site-renderer';
import {
  Button,
  Checkbox,
  ColorInput,
  RangeInput,
  Select,
  Switch,
  TextArea,
  TextInput,
  cx,
} from '@codeca/ui';
import { ImageField } from '../components/MediaPicker.js';
import type { FieldDef } from './fields.js';

/**
 * Controles do painel de propriedades.
 *
 * Os valores sao lidos e escritos por caminho (`filter.city`, `padding.top`),
 * para que o mesmo componente sirva as propriedades do bloco, ao estilo e as
 * variacoes por tamanho de tela.
 */

export function getByPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

export function setByPath<T extends Record<string, unknown>>(source: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const head = keys[0];
  if (!head) return source;

  if (keys.length === 1) {
    return { ...source, [head]: value };
  }

  const child = source[head];
  const base = child && typeof child === 'object' && !Array.isArray(child) ? (child as Record<string, unknown>) : {};
  return { ...source, [head]: setByPath(base, keys.slice(1).join('.'), value) };
}

export interface FieldRendererProps {
  field: FieldDef;
  values: Record<string, unknown>;
  onChange: (path: string, value: unknown) => void;
  disabled?: boolean;
}

export function FieldRenderer({ field, values, onChange, disabled }: FieldRendererProps) {
  const raw = getByPath(values, field.path);

  switch (field.kind) {
    case 'text':
      return (
        <TextInput
          label={field.label}
          value={typeof raw === 'string' ? raw : ''}
          {...(field.hint ? { hint: field.hint } : {})}
          {...(field.placeholder ? { placeholder: field.placeholder } : {})}
          disabled={disabled}
          onChange={(event) => onChange(field.path, event.target.value)}
        />
      );

    case 'textarea':
    case 'richtext':
      return (
        <TextArea
          label={field.label}
          rows={field.kind === 'richtext' ? 6 : 3}
          value={typeof raw === 'string' ? raw : ''}
          {...(field.hint ? { hint: field.hint } : {})}
          disabled={disabled}
          onChange={(event) => onChange(field.path, event.target.value)}
        />
      );

    case 'link':
      return (
        <TextInput
          label={field.label}
          value={typeof raw === 'string' ? raw : ''}
          hint={field.hint ?? 'Caminho interno (/contato), ancora (#secao) ou URL https.'}
          disabled={disabled}
          placeholder="/contato"
          onChange={(event) => onChange(field.path, event.target.value)}
        />
      );

    case 'boolean':
      return (
        <Switch
          label={field.label}
          {...(field.hint ? { hint: field.hint } : {})}
          checked={raw === true}
          disabled={disabled}
          onChange={(checked) => onChange(field.path, checked)}
        />
      );

    case 'select':
      return (
        <Select
          label={field.label}
          value={typeof raw === 'string' ? raw : ''}
          options={field.options ?? []}
          {...(field.hint ? { hint: field.hint } : {})}
          {...(field.nullable ? { placeholder: 'Herdar' } : {})}
          disabled={disabled}
          onChange={(event) => onChange(field.path, event.target.value === '' ? undefined : event.target.value)}
        />
      );

    case 'multiselect': {
      const selected = Array.isArray(raw) ? (raw as string[]) : [];
      return (
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium text-slate-700">{field.label}</legend>
          {field.hint ? <p className="text-xs text-slate-500">{field.hint}</p> : null}
          <div className="grid gap-1 rounded-lg border border-slate-200 p-2.5">
            {(field.options ?? []).map((option) => (
              <Checkbox
                key={option.value}
                label={option.label}
                checked={selected.includes(option.value)}
                disabled={disabled}
                onChange={(checked) =>
                  onChange(
                    field.path,
                    checked
                      ? [...selected, option.value]
                      : selected.filter((value) => value !== option.value),
                  )
                }
              />
            ))}
          </div>
        </fieldset>
      );
    }

    case 'range': {
      const numeric = typeof raw === 'number' ? raw : null;
      if (field.nullable && numeric === null) {
        return (
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-slate-700">{field.label}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(field.path, field.min ?? 0)}
            >
              Definir valor
            </Button>
          </div>
        );
      }
      return (
        <div className="grid gap-1">
          <RangeInput
            label={field.label}
            value={numeric ?? field.min ?? 0}
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            unit={field.unit ?? 'px'}
            onChange={(value) => onChange(field.path, value)}
          />
          {field.nullable ? (
            <button
              type="button"
              className="justify-self-start text-xs text-slate-500 underline"
              onClick={() => onChange(field.path, null)}
            >
              Usar o padrao
            </button>
          ) : null}
          {field.hint ? <p className="text-xs text-slate-500">{field.hint}</p> : null}
        </div>
      );
    }

    case 'color': {
      const value = typeof raw === 'string' ? raw : '';
      const token = value.startsWith('token:') ? value.slice('token:'.length) : '';
      return (
        <div className="grid gap-2">
          <Select
            label={field.label}
            value={token || (value ? 'custom' : '')}
            placeholder={field.nullable ? 'Herdar do tema' : undefined}
            options={[
              ...THEME_COLOR_TOKENS.map((item) => ({ value: item, label: `Tema: ${item}` })),
              { value: 'custom', label: 'Cor especifica' },
            ]}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value;
              if (next === '') onChange(field.path, null);
              else if (next === 'custom') onChange(field.path, '#1D4ED8');
              else onChange(field.path, next);
            }}
          />
          {value && !token ? (
            <ColorInput
              label="Cor"
              value={value}
              onChange={(next) => onChange(field.path, next)}
            />
          ) : null}
        </div>
      );
    }

    case 'icon': {
      const current = typeof raw === 'string' ? raw : '';
      return (
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium text-slate-700">{field.label}</legend>
          <div className="grid max-h-44 grid-cols-6 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {(field.options ?? []).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                aria-pressed={current === option.value}
                disabled={disabled}
                onClick={() => onChange(field.path, option.value)}
                className={cx(
                  'grid aspect-square place-items-center rounded-md border transition-colors',
                  current === option.value
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-transparent text-slate-500 hover:bg-slate-100',
                )}
              >
                <BlockIcon name={option.value} width={18} height={18} />
              </button>
            ))}
          </div>
        </fieldset>
      );
    }

    case 'image': {
      const image = (raw ?? null) as { url?: string; alt?: string; mediaId?: string | null } | null;
      return (
        <ImageField
          label={field.label}
          value={image?.mediaId ?? null}
          preview={
            image?.url ? { id: image.mediaId ?? '', url: image.url, alt: image.alt ?? '', width: null, height: null } : null
          }
          {...(field.hint ? { hint: field.hint } : {})}
          onChange={(mediaId, asset) =>
            onChange(
              field.path,
              asset
                ? {
                    mediaId,
                    url: asset.blobUrl,
                    alt: asset.alt,
                    width: asset.width,
                    height: asset.height,
                  }
                : field.nullable
                  ? null
                  : { mediaId: null, url: '', alt: '', width: null, height: null },
            )
          }
        />
      );
    }

    case 'buttons':
    case 'links':
    case 'items':
      return <ListField field={field} values={values} onChange={onChange} disabled={disabled} />;

    case 'number':
      return (
        <TextInput
          label={field.label}
          type="number"
          value={typeof raw === 'number' ? String(raw) : ''}
          disabled={disabled}
          onChange={(event) => onChange(field.path, event.target.value === '' ? null : Number(event.target.value))}
        />
      );

    default:
      return null;
  }
}

/**
 * Lista de itens (botoes, links, diferenciais, colunas do rodape).
 * Permite adicionar, remover e reordenar sem sair do painel.
 */
function ListField({ field, values, onChange, disabled }: FieldRendererProps) {
  const raw = getByPath(values, field.path);
  const single = field.kind === 'buttons' && field.maxItems === 1;
  const items: Array<Record<string, unknown>> = single
    ? raw && typeof raw === 'object'
      ? [raw as Record<string, unknown>]
      : []
    : Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : [];

  const [openIndex, setOpenIndex] = useState<number | null>(items.length === 1 ? 0 : null);
  const itemFields = field.itemFields ?? [];
  const maxItems = field.maxItems ?? 12;

  function commit(next: Array<Record<string, unknown>>) {
    onChange(field.path, single ? (next[0] ?? null) : next);
  }

  function defaultItem(): Record<string, unknown> {
    const item: Record<string, unknown> = {};
    for (const definition of itemFields) {
      if (definition.kind === 'boolean') item[definition.path] = false;
      else if (definition.kind === 'links' || definition.kind === 'items') item[definition.path] = [];
      else if (definition.kind === 'select' || definition.kind === 'icon') {
        item[definition.path] = definition.options?.[0]?.value ?? '';
      } else item[definition.path] = '';
    }
    return item;
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const current = next[index];
    const swap = next[target];
    if (!current || !swap) return;
    next[index] = swap;
    next[target] = current;
    commit(next);
  }

  const itemTitle = (item: Record<string, unknown>, index: number) => {
    const candidate = item.label ?? item.title ?? item.question ?? item.value;
    const text = typeof candidate === 'string' && candidate.trim() ? candidate : `${field.itemLabel ?? 'Item'} ${index + 1}`;
    return text;
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{field.label}</span>
        {items.length < maxItems ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            icon={<Plus aria-hidden="true" className="size-3.5" />}
            onClick={() => {
              commit([...items, defaultItem()]);
              setOpenIndex(items.length);
            }}
          >
            Adicionar
          </Button>
        ) : null}
      </div>

      {field.hint ? <p className="text-xs text-slate-500">{field.hint}</p> : null}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500">
          Nenhum item.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {items.map((item, index) => {
            const open = openIndex === index;
            return (
              <li key={index} className="overflow-hidden rounded-lg border border-slate-200">
                <div className="flex items-center gap-1 bg-slate-50 px-2 py-1.5">
                  {!single ? (
                    <span className="flex flex-col">
                      <button
                        type="button"
                        aria-label="Mover para cima"
                        className="text-[10px] leading-none text-slate-400 hover:text-slate-700"
                        onClick={() => move(index, -1)}
                      >
                        &#9650;
                      </button>
                      <button
                        type="button"
                        aria-label="Mover para baixo"
                        className="text-[10px] leading-none text-slate-400 hover:text-slate-700"
                        onClick={() => move(index, 1)}
                      >
                        &#9660;
                      </button>
                    </span>
                  ) : (
                    <GripVertical aria-hidden="true" className="size-3.5 text-slate-300" />
                  )}

                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-slate-700"
                    aria-expanded={open}
                    onClick={() => setOpenIndex(open ? null : index)}
                  >
                    <ChevronDown
                      aria-hidden="true"
                      className={cx('size-3.5 flex-none transition-transform', open && 'rotate-180')}
                    />
                    <span className="truncate">{itemTitle(item, index)}</span>
                  </button>

                  <button
                    type="button"
                    aria-label="Remover item"
                    disabled={disabled}
                    onClick={() => {
                      commit(items.filter((_, position) => position !== index));
                      setOpenIndex(null);
                    }}
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </button>
                </div>

                {open ? (
                  <div className="grid gap-3 p-2.5">
                    {itemFields.map((definition) => (
                      <FieldRenderer
                        key={definition.path}
                        field={definition}
                        values={item}
                        disabled={disabled}
                        onChange={(path, value) => {
                          const next = [...items];
                          next[index] = setByPath(item, path, value);
                          commit(next);
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
