import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Copy, Eye, EyeOff, GripVertical, Trash2 } from 'lucide-react';
import { BLOCK_DEFINITIONS, type PageLayout, type PageSection } from '@codeca/shared';
import { BlockIcon } from '@codeca/site-renderer';
import { cx } from '@codeca/ui';

/**
 * Arvore de secoes da pagina.
 *
 * A reordenacao funciona com o mouse e tambem pelo teclado (o sensor de teclado
 * do dnd-kit anuncia a posicao), para que o editor nao dependa de arrastar.
 */

export function SectionList({
  layout,
  selectedId,
  onSelect,
  onReorder,
  onToggleVisibility,
  onDuplicate,
  onRemove,
  readOnly = false,
}: {
  layout: PageLayout;
  selectedId: string | null;
  onSelect: (sectionId: string) => void;
  onReorder: (sectionId: string, toIndex: number) => void;
  onToggleVisibility: (sectionId: string) => void;
  onDuplicate: (sectionId: string) => void;
  onRemove: (sectionId: string) => void;
  readOnly?: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (layout.sections.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
        Nenhuma secao nesta pagina. Use o botao "Adicionar secao".
      </p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={(event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const toIndex = layout.sections.findIndex((section) => section.id === over.id);
        if (toIndex >= 0) onReorder(String(active.id), toIndex);
      }}
    >
      <SortableContext
        items={layout.sections.map((section) => section.id)}
        strategy={verticalListSortingStrategy}
        disabled={readOnly}
      >
        <ul className="grid gap-1">
          {layout.sections.map((section) => (
            <SectionRow
              key={section.id}
              section={section}
              selected={section.id === selectedId}
              readOnly={readOnly}
              onSelect={() => onSelect(section.id)}
              onToggleVisibility={() => onToggleVisibility(section.id)}
              onDuplicate={() => onDuplicate(section.id)}
              onRemove={() => onRemove(section.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SectionRow({
  section,
  selected,
  readOnly,
  onSelect,
  onToggleVisibility,
  onDuplicate,
  onRemove,
}: {
  section: PageSection;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });
  const definition = BLOCK_DEFINITIONS[section.type];

  const title =
    section.name
    || (typeof section.props.title === 'string' && section.props.title ? section.props.title : definition.label);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(
        'group flex items-center gap-1 rounded-lg border bg-white px-1.5 py-1.5 transition-colors',
        selected ? 'border-brand-400 ring-1 ring-brand-300' : 'border-slate-200 hover:border-slate-300',
        isDragging && 'z-10 shadow-lg',
        !section.visible && 'opacity-60',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={readOnly}
        aria-label={`Reordenar ${title}`}
        className="cursor-grab rounded p-0.5 text-slate-300 hover:text-slate-600 disabled:cursor-not-allowed"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>

      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        aria-current={selected ? 'true' : undefined}
      >
        <span className="grid size-6 flex-none place-items-center rounded bg-slate-100 text-slate-500">
          <BlockIcon name={definition.icon} width={13} height={13} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-800">{title}</span>
          <span className="block truncate text-[11px] text-slate-400">{definition.label}</span>
        </span>
      </button>

      {!readOnly ? (
        <span className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={onToggleVisibility}
            aria-label={section.visible ? `Ocultar ${title}` : `Exibir ${title}`}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            {section.visible ? (
              <Eye aria-hidden="true" className="size-3.5" />
            ) : (
              <EyeOff aria-hidden="true" className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            aria-label={`Duplicar ${title}`}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Copy aria-hidden="true" className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Excluir ${title}`}
            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ) : null}
    </li>
  );
}
