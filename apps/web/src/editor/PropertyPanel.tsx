import { useState } from 'react';
import { ChevronDown, Monitor, Smartphone, Tablet } from 'lucide-react';
import {
  BLOCK_DEFINITIONS,
  type Breakpoint,
  type PageSection,
} from '@codeca/shared';
import { Alert, SegmentedControl, Tabs, TextInput, cx } from '@codeca/ui';
import { BLOCK_FIELDS, RESPONSIVE_FIELDS, STYLE_GROUPS, type FieldGroup } from './fields.js';
import { FieldRenderer } from './FieldRenderer.js';

/**
 * Painel direito: propriedades da secao selecionada.
 *
 * Divide-se em conteudo (propriedades do bloco), estilo (espacamento, fundo,
 * bordas) e tamanhos de tela (o que muda em tablet e celular). Cada alteracao
 * e revalidada pelo schema do bloco antes de entrar no layout.
 */

export interface PropertyPanelProps {
  section: PageSection | null;
  readOnly?: boolean;
  issues?: readonly string[];
  onChangeProps: (path: string, value: unknown) => void;
  onChangeStyle: (path: string, value: unknown) => void;
  onChangeResponsive: (breakpoint: Exclude<Breakpoint, 'desktop'>, path: string, value: unknown) => void;
  onRename: (name: string) => void;
}

export function PropertyPanel({
  section,
  readOnly = false,
  issues = [],
  onChangeProps,
  onChangeStyle,
  onChangeResponsive,
  onRename,
}: PropertyPanelProps) {
  const [tab, setTab] = useState('conteudo');
  const [breakpoint, setBreakpoint] = useState<Exclude<Breakpoint, 'desktop'>>('tablet');

  if (!section) {
    return (
      <div className="grid place-items-center p-6 text-center">
        <p className="max-w-xs text-sm text-slate-500">
          Selecione uma secao na lista ao lado ou clique direto na previa para editar as propriedades.
        </p>
      </div>
    );
  }

  const definition = BLOCK_DEFINITIONS[section.type];
  const contentGroups = BLOCK_FIELDS[section.type];

  return (
    <div className="grid content-start">
      <div className="border-b border-slate-200 p-3">
        <p className="text-xs uppercase tracking-wider text-slate-400">{definition.label}</p>
        <TextInput
          label="Nome da secao no editor"
          value={section.name}
          placeholder={definition.label}
          disabled={readOnly}
          hint="Usado apenas na lista do editor; nao aparece no site."
          onChange={(event) => onRename(event.target.value)}
        />
      </div>

      {issues.length > 0 ? (
        <div className="p-3">
          <Alert tone="danger" title="Valor nao aceito">
            <ul className="grid list-disc gap-0.5 pl-4">
              {issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      <Tabs
        items={[
          { id: 'conteudo', label: 'Conteudo' },
          { id: 'estilo', label: 'Estilo' },
          { id: 'telas', label: 'Telas' },
        ]}
        active={tab}
        onChange={setTab}
        className="px-3 pt-1"
      />

      <div className="grid gap-3 p-3">
        {tab === 'conteudo'
          ? contentGroups.map((group) => (
              <CollapsibleGroup key={group.title} group={group}>
                {group.fields.map((field) => (
                  <FieldRenderer
                    key={field.path}
                    field={field}
                    values={section.props}
                    disabled={readOnly}
                    onChange={onChangeProps}
                  />
                ))}
              </CollapsibleGroup>
            ))
          : null}

        {tab === 'estilo'
          ? STYLE_GROUPS.map((group) => (
              <CollapsibleGroup key={group.title} group={group}>
                {group.fields.map((field) => (
                  <FieldRenderer
                    key={field.path}
                    field={field}
                    values={section.style as unknown as Record<string, unknown>}
                    disabled={readOnly}
                    onChange={onChangeStyle}
                  />
                ))}
              </CollapsibleGroup>
            ))
          : null}

        {tab === 'telas' ? (
          <div className="grid gap-3">
            <Alert tone="info">
              O que for definido aqui vale apenas no tamanho de tela escolhido. Os campos em branco seguem o
              valor de computador.
            </Alert>

            <SegmentedControl
              label="Tamanho de tela"
              value={breakpoint}
              onChange={setBreakpoint}
              options={[
                { value: 'tablet', label: 'Tablet', icon: <Tablet aria-hidden="true" className="size-3.5" /> },
                { value: 'mobile', label: 'Celular', icon: <Smartphone aria-hidden="true" className="size-3.5" /> },
              ]}
            />

            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Monitor aria-hidden="true" className="size-3.5" />
              Computador usa os valores da aba Estilo.
            </p>

            {RESPONSIVE_FIELDS.map((field) => (
              <FieldRenderer
                key={field.path}
                field={field}
                values={section.responsive[breakpoint] as unknown as Record<string, unknown>}
                disabled={readOnly}
                onChange={(path, value) => onChangeResponsive(breakpoint, path, value)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CollapsibleGroup({ group, children }: { group: FieldGroup; children: React.ReactNode }) {
  const [open, setOpen] = useState(!group.collapsed);
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 bg-slate-50 px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
      >
        <ChevronDown aria-hidden="true" className={cx('size-3.5 transition-transform', open && 'rotate-180')} />
        {group.title}
      </button>
      {open ? <div className="grid gap-4 p-3">{children}</div> : null}
    </section>
  );
}
