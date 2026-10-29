import { useState } from 'react';
import {
  BLOCK_DEFINITIONS,
  BLOCK_GROUP_LABELS,
  BLOCK_TYPES,
  canAddBlock,
  type BlockGroup,
  type BlockType,
  type PageLayout,
} from '@codeca/shared';
import { BlockIcon } from '@codeca/site-renderer';
import { Badge, Modal, TextInput, cx } from '@codeca/ui';

/**
 * Catalogo de secoes disponiveis.
 *
 * Blocos avancados dependem do recurso correspondente no plano; eles aparecem
 * na lista com o aviso, para o cliente saber o que existe sem poder inserir.
 */
export function BlockPalette({
  open,
  onClose,
  layout,
  onInsert,
  advancedAvailable,
}: {
  open: boolean;
  onClose: () => void;
  layout: PageLayout;
  onInsert: (type: BlockType) => void;
  advancedAvailable: boolean;
}) {
  const [search, setSearch] = useState('');
  const normalized = search.trim().toLowerCase();

  const grouped = new Map<BlockGroup, BlockType[]>();
  for (const type of BLOCK_TYPES) {
    const definition = BLOCK_DEFINITIONS[type];
    const matches =
      normalized === ''
      || definition.label.toLowerCase().includes(normalized)
      || definition.description.toLowerCase().includes(normalized);
    if (!matches) continue;
    const list = grouped.get(definition.group) ?? [];
    list.push(type);
    grouped.set(definition.group, list);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar secao"
      description="Escolha um bloco para inserir ao final da pagina."
      size="lg"
    >
      <div className="grid gap-4">
        <TextInput
          label="Buscar secao"
          value={search}
          placeholder="imoveis, depoimentos, contato..."
          onChange={(event) => setSearch(event.target.value)}
        />

        {[...grouped.entries()].map(([group, types]) => (
          <section key={group} className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {BLOCK_GROUP_LABELS[group]}
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {types.map((type) => {
                const definition = BLOCK_DEFINITIONS[type];
                const blockedByPlan = definition.advanced && !advancedAvailable;
                const blockedByLayout = !canAddBlock(layout, type);
                const disabled = blockedByPlan || blockedByLayout;

                return (
                  <li key={type}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        onInsert(type);
                        onClose();
                      }}
                      className={cx(
                        'flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                        disabled
                          ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70'
                          : 'border-slate-200 hover:border-brand-400 hover:bg-brand-50/40',
                      )}
                    >
                      <span className="grid size-8 flex-none place-items-center rounded-lg bg-slate-100 text-slate-500">
                        <BlockIcon name={definition.icon} width={16} height={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-slate-800">{definition.label}</span>
                          {definition.advanced ? <Badge tone="brand">Avancado</Badge> : null}
                          {blockedByLayout && !blockedByPlan ? <Badge tone="neutral">Ja inserido</Badge> : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">{definition.description}</span>
                        {blockedByPlan ? (
                          <span className="mt-1 block text-xs font-medium text-amber-700">
                            Disponivel em planos com blocos avancados.
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {grouped.size === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Nenhuma secao encontrada para "{search}".
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
