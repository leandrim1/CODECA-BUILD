import { useEffect, useMemo, useRef } from 'react';
import { BREAKPOINT_WIDTH_PX, type PublicSiteData } from '@codeca/shared';
import { renderSiteBody } from '@codeca/site-renderer';
import { Spinner } from '@codeca/ui';
import { useResource } from '../hooks/useResource.js';
import { previewApi } from '../services/endpoints.js';

/**
 * Previa do site dentro de um iframe.
 *
 * Por que iframe: as variacoes por tamanho de tela do site publicado sao media
 * queries de verdade. Dentro de um iframe com largura definida, elas respondem
 * exatamente como responderiam em um aparelho -- o que nao aconteceria em uma
 * div redimensionada na mesma pagina.
 *
 * O conteudo e gerado pelo mesmo renderizador usado no servidor, e escrito
 * diretamente no documento do iframe a cada alteracao. Assim a previa atualiza
 * sem recarregar, preservando a posicao de rolagem.
 */

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

export const DEVICE_WIDTH: Record<PreviewDevice, number> = BREAKPOINT_WIDTH_PX;

/** Carrega os dados do site para a previa (conteudo publicado + rascunho). */
export function useSitePreview({ tenantId, path }: { tenantId: string; path: string }) {
  return useResource(() => previewApi.siteData(tenantId, path), [tenantId, path]);
}

const SHELL = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style id="ct-theme"></style>
<style>
  [data-ct-pick] [data-block]{outline:1px dashed transparent;outline-offset:-1px;transition:outline-color .12s}
  [data-ct-pick] [data-block]:hover{outline-color:rgba(29,78,216,.45);cursor:pointer}
  [data-ct-pick] [data-block][data-ct-selected]{outline:2px solid #1d4ed8;outline-offset:-2px}
  [data-ct-pick] [data-block][data-ct-hidden]{opacity:.4}
</style>
</head>
<body><div id="ct-root"></div>
<script>
(function(){
  // Seleciona a secao clicada e avisa o editor na pagina de fora.
  document.addEventListener('click', function (event) {
    if (!document.body.hasAttribute('data-ct-pick')) return;
    var target = event.target instanceof Element ? event.target.closest('[data-block]') : null;
    event.preventDefault();
    event.stopPropagation();
    parent.postMessage({ source: 'codeca-preview', type: 'select', id: target ? target.id : null }, '*');
  }, true);

  // Dentro da previa, nenhum formulario e enviado de verdade.
  document.addEventListener('submit', function (event) { event.preventDefault(); }, true);
})();
</script>
</body></html>`;

export function SitePreviewFrame({
  data,
  device = 'desktop',
  loading = false,
  height = 680,
  /** Ocupa toda a altura disponivel, usado no editor em tela cheia. */
  fill = false,
  selectedSectionId,
  onSelectSection,
  hiddenSectionIds,
}: {
  data: PublicSiteData | null;
  device?: PreviewDevice;
  loading?: boolean;
  height?: number;
  fill?: boolean;
  selectedSectionId?: string | null;
  onSelectSection?: (sectionId: string | null) => void;
  hiddenSectionIds?: readonly string[];
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const interactive = typeof onSelectSection === 'function';

  const rendered = useMemo(() => {
    if (!data) return null;
    try {
      return renderSiteBody(data);
    } catch (error) {
      // Uma secao com dado invalido nao deve derrubar o editor.
      console.error('[previa] falha ao renderizar', error);
      return null;
    }
  }, [data]);

  // Escreve o conteudo no documento do iframe sem recarregar.
  useEffect(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!doc || !rendered) return;

    const style = doc.getElementById('ct-theme');
    const root = doc.getElementById('ct-root');
    if (!style || !root) return;

    if (style.textContent !== rendered.css) style.textContent = rendered.css;
    if (root.innerHTML !== rendered.body) root.innerHTML = rendered.body;

    doc.body.toggleAttribute('data-ct-pick', interactive);
  }, [rendered, interactive]);

  // Destaca a secao selecionada e marca as ocultas.
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;

    for (const element of Array.from(doc.querySelectorAll('[data-ct-selected]'))) {
      element.removeAttribute('data-ct-selected');
    }
    if (selectedSectionId) {
      const target = doc.getElementById(selectedSectionId);
      target?.setAttribute('data-ct-selected', 'true');
      target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    for (const element of Array.from(doc.querySelectorAll('[data-ct-hidden]'))) {
      element.removeAttribute('data-ct-hidden');
    }
    for (const id of hiddenSectionIds ?? []) {
      doc.getElementById(id)?.setAttribute('data-ct-hidden', 'true');
    }
  }, [selectedSectionId, hiddenSectionIds, rendered]);

  // Recebe a secao clicada dentro da previa.
  useEffect(() => {
    const notify = onSelectSection;
    if (!notify) return;
    // Arrow function em vez de declaracao: a declaracao e elevada e perderia
    // o estreitamento de tipo feito pelo guard acima.
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data as { source?: string; type?: string; id?: string | null } | null;
      if (payload?.source !== 'codeca-preview' || payload.type !== 'select') return;
      notify(payload.id ?? null);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSelectSection]);

  const width = DEVICE_WIDTH[device];

  return (
    <div
      className="relative grid h-full place-items-center overflow-auto bg-slate-100 p-4"
      style={fill ? undefined : { height }}
    >
      {loading && !rendered ? (
        <div className="absolute inset-0 grid place-items-center bg-slate-100">
          <Spinner label="Carregando previa" />
        </div>
      ) : null}

      {/* A largura do iframe define o breakpoint que o site enxerga. */}
      <div
        className="mx-auto h-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm"
        style={{ width: device === 'desktop' ? '100%' : `${width}px`, maxWidth: '100%' }}
      >
        <iframe
          ref={frameRef}
          title="Previa do site"
          srcDoc={SHELL}
          className="h-full w-full border-0"
          sandbox="allow-same-origin allow-scripts"
        />
      </div>
    </div>
  );
}
