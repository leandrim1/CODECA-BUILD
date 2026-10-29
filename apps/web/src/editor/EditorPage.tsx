import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Eye,
  Monitor,
  Plus,
  Rocket,
  Save,
  Smartphone,
  Tablet,
} from 'lucide-react';
import {
  addSection,
  coercePageLayout,
  createSection,
  duplicateSection,
  moveSection,
  removeSection,
  setSectionProps,
  setSectionStyle,
  toggleSectionVisibility,
  updateSection,
  type BlockType,
  type PageLayout,
  type PageSection,
  responsiveOverrideSchema,
} from '@codeca/shared';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  SegmentedControl,
  Select,
  Spinner,
  useToast,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { pageApi, tenantApi } from '../services/endpoints.js';
import { BlockPalette } from './BlockPalette.js';
import { PropertyPanel } from './PropertyPanel.js';
import { SectionList } from './SectionList.js';
import { SitePreviewFrame, useSitePreview, type PreviewDevice } from './SitePreviewFrame.js';
import { setByPath } from './FieldRenderer.js';

/**
 * Editor visual de sites.
 *
 * Tres areas: a esquerda a estrutura da pagina, no centro a previa e a direita
 * as propriedades da secao selecionada. As alteracoes aparecem na previa na
 * hora; salvar grava o rascunho e publicar cria uma nova versao no ar.
 *
 * O editor nunca aceita HTML, CSS ou JavaScript do usuario: cada alteracao
 * passa pelo schema do bloco correspondente antes de entrar no layout.
 */
export function EditorPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();

  const readOnly = !can('site:edit');
  const canPublish = can('site:publish');

  const pages = useResource(() => pageApi.list(tenantId), [tenantId]);
  const tenant = useResource(() => tenantApi.detail(tenantId), [tenantId]);

  const requestedPageId = params.get('pagina');
  const activePageId = useMemo(() => {
    const list = pages.data?.pages ?? [];
    if (requestedPageId && list.some((page) => page.id === requestedPageId)) return requestedPageId;
    return list.find((page) => page.isHome)?.id ?? list[0]?.id ?? null;
  }, [pages.data, requestedPageId]);

  const pageDetail = useResource(
    () => pageApi.detail(tenantId, activePageId as string),
    [tenantId, activePageId],
    { enabled: Boolean(activePageId) },
  );

  const activePage = pageDetail.data?.page ?? null;
  const pagePath = activePage ? (activePage.isHome ? '/' : `/${activePage.slug}`) : '/';
  const preview = useSitePreview({ tenantId, path: pagePath });

  const [layout, setLayout] = useState<PageLayout | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [removing, setRemoving] = useState<PageSection | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  // Carrega o rascunho da pagina ao trocar de pagina.
  useEffect(() => {
    if (!activePage) return;
    setLayout(coercePageLayout(activePage.draftLayout));
    setBaseRevision(activePage.draftRevision);
    setDirty(false);
    setSelectedId(null);
    setIssues([]);
  }, [activePage?.id, activePage?.draftRevision]);

  // Avisa antes de sair com alteracoes nao salvas.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const selectedSection = layout?.sections.find((section) => section.id === selectedId) ?? null;
  const hiddenSectionIds = useMemo(
    () => (layout?.sections ?? []).filter((section) => !section.visible).map((section) => section.id),
    [layout],
  );

  // A previa combina os dados do site com o layout em edicao.
  const previewData = useMemo(() => {
    if (!preview.data || !layout) return preview.data;
    if (!preview.data.page) return preview.data;
    return {
      ...preview.data,
      page: { ...preview.data.page, layout },
      context: { ...preview.data.context, routeKind: 'page' as const },
    };
  }, [preview.data, layout]);

  const apply = useCallback((next: PageLayout) => {
    setLayout(next);
    setDirty(true);
  }, []);

  const save = useMutation(
    (input: { layout: PageLayout; revision: number | null }) =>
      pageApi.saveDraft(tenantId, activePageId as string, input.layout, input.revision ?? undefined),
    {
      onSuccess: (result) => {
        setBaseRevision(result.draftRevision);
        setDirty(false);
        toast.success('Rascunho salvo', 'O site publico continua com a versao anterior.');
      },
      onError: (error) => {
        if (error.code === 'conflict') {
          toast.error('Pagina alterada em outro lugar', error.message);
        } else {
          toast.error('Nao foi possivel salvar', error.message);
        }
      },
    },
  );

  const publish = useMutation(() => pageApi.publish(tenantId, activePageId as string, ''), {
    onSuccess: (result) => {
      toast.success('Pagina publicada', `Versao ${result.version} esta no ar.`);
      pageDetail.reload();
      pages.reload();
      preview.reload();
    },
    onError: (error) => toast.error('Nao foi possivel publicar', error.message),
  });

  async function handlePublish() {
    if (dirty && layout) {
      const saved = await save.run({ layout, revision: baseRevision });
      if (!saved) return;
    }
    await publish.run(undefined);
  }

  function insertBlock(type: BlockType) {
    if (!layout) return;
    const section = createSection(type);
    apply(addSection(layout, section));
    setSelectedId(section.id);
  }

  const advancedAvailable = (tenant.data?.plan.limits.features ?? []).includes(
    'visual_editor_advanced_blocks',
  );

  if (pages.initialLoading || (activePageId && pageDetail.initialLoading)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-100">
        <Spinner label="Carregando o editor" />
      </div>
    );
  }

  if (!activePageId || !layout) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-100 p-6">
        <Alert tone="warning" title="Nenhuma pagina para editar">
          Crie uma pagina em <Link to="/painel/paginas" className="link">Paginas</Link> para comecar.
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-slate-100">
      {/* Barra superior */}
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <Link to="/painel">
          <Button variant="ghost" size="sm" icon={<ArrowLeft aria-hidden="true" className="size-4" />}>
            Painel
          </Button>
        </Link>

        <div className="min-w-44">
          <Select
            label="Pagina"
            className="[&>label]:sr-only"
            value={activePageId}
            options={(pages.data?.pages ?? []).map((page) => ({
              value: page.id,
              label: page.isHome ? `${page.title} (inicial)` : page.title,
            }))}
            onChange={(event) => {
              if (dirty && !window.confirm('Ha alteracoes nao salvas. Trocar de pagina vai descarta-las.')) {
                return;
              }
              setParams({ pagina: event.target.value });
            }}
          />
        </div>

        {dirty ? <Badge tone="warning">Alteracoes nao salvas</Badge> : <Badge tone="success">Rascunho salvo</Badge>}
        {activePage?.publishedVersionId ? null : <Badge tone="neutral">Nunca publicada</Badge>}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SegmentedControl
            label="Tamanho da tela na previa"
            value={device}
            onChange={setDevice}
            options={[
              { value: 'desktop', label: 'Computador', icon: <Monitor aria-hidden="true" className="size-3.5" /> },
              { value: 'tablet', label: 'Tablet', icon: <Tablet aria-hidden="true" className="size-3.5" /> },
              { value: 'mobile', label: 'Celular', icon: <Smartphone aria-hidden="true" className="size-3.5" /> },
            ]}
          />

          <a
            href={`/api/render/preview/${tenantId}?path=${encodeURIComponent(pagePath)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="ghost" size="sm" icon={<Eye aria-hidden="true" className="size-4" />}>
              Previa em nova aba
            </Button>
          </a>

          <Button
            variant="outline"
            size="sm"
            loading={save.loading}
            disabled={readOnly || !dirty}
            icon={<Save aria-hidden="true" className="size-4" />}
            onClick={() => void save.run({ layout, revision: baseRevision })}
          >
            Salvar rascunho
          </Button>

          <Button
            size="sm"
            loading={publish.loading || save.loading}
            disabled={!canPublish}
            icon={<Rocket aria-hidden="true" className="size-4" />}
            onClick={() => void handlePublish()}
          >
            Publicar
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[17rem_1fr_21rem]">
        {/* Painel esquerdo: estrutura da pagina */}
        <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white" aria-label="Estrutura da pagina">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-3">
            <h2 className="text-sm font-semibold text-slate-800">Secoes</h2>
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly}
              icon={<Plus aria-hidden="true" className="size-3.5" />}
              onClick={() => setPaletteOpen(true)}
            >
              Adicionar
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <SectionList
              layout={layout}
              selectedId={selectedId}
              readOnly={readOnly}
              onSelect={setSelectedId}
              onReorder={(sectionId, toIndex) => apply(moveSection(layout, sectionId, toIndex))}
              onToggleVisibility={(sectionId) => apply(toggleSectionVisibility(layout, sectionId))}
              onDuplicate={(sectionId) => apply(duplicateSection(layout, sectionId))}
              onRemove={(sectionId) => {
                const section = layout.sections.find((item) => item.id === sectionId);
                if (section) setRemoving(section);
              }}
            />
          </div>

          <p className="border-t border-slate-200 p-3 text-xs text-slate-500">
            {layout.sections.length} secao(oes). Arraste pela alca ou use as setas do teclado para reordenar.
          </p>
        </aside>

        {/* Centro: previa */}
        <section className="min-h-0 overflow-hidden" aria-label="Previa do site">
          <SitePreviewFrame
            data={previewData ?? null}
            device={device}
            loading={preview.loading}
            fill
            selectedSectionId={selectedId}
            hiddenSectionIds={hiddenSectionIds}
            onSelectSection={readOnly ? undefined : setSelectedId}
          />
        </section>

        {/* Painel direito: propriedades */}
        <aside
          className="min-h-0 overflow-y-auto border-l border-slate-200 bg-white"
          aria-label="Propriedades da secao"
        >
          <PropertyPanel
            section={selectedSection}
            readOnly={readOnly}
            issues={issues}
            onRename={(name) =>
              apply(updateSection(layout, selectedSection?.id ?? '', (section) => ({ ...section, name })))
            }
            onChangeProps={(path, value) => {
              if (!selectedSection) return;
              const patch = setByPath({ ...selectedSection.props }, path, value);
              const result = setSectionProps(layout, selectedSection.id, patch);
              setIssues(result.issues.map((issue) => issue.message));
              if (result.issues.length === 0) apply(result.layout);
            }}
            onChangeStyle={(path, value) => {
              if (!selectedSection) return;
              const patch = setByPath(
                { ...(selectedSection.style as unknown as Record<string, unknown>) },
                path,
                value,
              );
              const result = setSectionStyle(layout, selectedSection.id, patch);
              setIssues(result.issues.map((issue) => issue.message));
              if (result.issues.length === 0) apply(result.layout);
            }}
            onChangeResponsive={(breakpoint, path, value) => {
              if (!selectedSection) return;
              const current = selectedSection.responsive[breakpoint] as unknown as Record<string, unknown>;
              const patch = setByPath({ ...current }, path, value);
              const parsed = responsiveOverrideSchema.safeParse(patch);
              if (!parsed.success) {
                setIssues(parsed.error.issues.map((issue) => issue.message));
                return;
              }
              setIssues([]);
              apply(
                updateSection(layout, selectedSection.id, (section) => ({
                  ...section,
                  responsive: { ...section.responsive, [breakpoint]: parsed.data },
                })),
              );
            }}
          />
        </aside>
      </div>

      <BlockPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        layout={layout}
        advancedAvailable={advancedAvailable}
        onInsert={insertBlock}
      />

      <ConfirmDialog
        open={removing !== null}
        title="Excluir secao"
        message="A secao sera removida do rascunho. O site publico so muda quando voce publicar."
        confirmLabel="Excluir secao"
        onConfirm={() => {
          if (removing) {
            apply(removeSection(layout, removing.id));
            if (selectedId === removing.id) setSelectedId(null);
          }
          setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
