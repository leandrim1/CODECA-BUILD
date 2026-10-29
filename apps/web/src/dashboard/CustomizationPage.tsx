import { useEffect, useMemo, useState } from 'react';
import { Monitor, RotateCcw, Save, Smartphone, Tablet } from 'lucide-react';
import {
  BUTTON_SHAPES,
  BUTTON_STYLES,
  CARD_STYLES,
  CONTENT_WIDTHS,
  FONT_FAMILIES,
  FOOTER_STYLES,
  HEADER_LAYOUTS,
  HEADER_STYLES,
  themeSchema,
  type Theme,
} from '@codeca/shared';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ColorInput,
  PageHeader,
  RangeInput,
  SegmentedControl,
  Select,
  Switch,
  Tabs,
  useToast,
} from '@codeca/ui';
import { useAuth, useTenantId } from '../hooks/useAuth.js';
import { useMutation, useResource } from '../hooks/useResource.js';
import { tenantApi } from '../services/endpoints.js';
import { ResourcePanel } from '../components/ResourcePanel.js';
import { ImageField } from '../components/MediaPicker.js';
import { SitePreviewFrame, useSitePreview } from '../editor/SitePreviewFrame.js';
import type { MediaRef } from '../types/index.js';

/**
 * Identidade visual da construtora.
 *
 * As alteracoes aparecem na previa ao lado antes de serem salvas; a previa usa
 * o mesmo renderizador do site publicado.
 */

const FONT_LABELS: Record<(typeof FONT_FAMILIES)[number], string> = {
  inter: 'Inter (moderna, neutra)',
  manrope: 'Manrope (geometrica)',
  'dm-sans': 'DM Sans (arredondada)',
  poppins: 'Poppins (geometrica, ampla)',
  montserrat: 'Montserrat (institucional)',
  'source-sans': 'Source Sans (legivel)',
  playfair: 'Playfair Display (serifada, elegante)',
  lora: 'Lora (serifada, editorial)',
  system: 'Fonte do sistema',
};

const COLOR_FIELDS: Array<{ key: keyof Theme['colors']; label: string; hint: string }> = [
  { key: 'primary', label: 'Cor primaria', hint: 'Botoes principais, links e destaques.' },
  { key: 'secondary', label: 'Cor secundaria', hint: 'Cabecalho escuro, rodape e faixas.' },
  { key: 'accent', label: 'Cor de destaque', hint: 'Selos, etiquetas e avaliacoes.' },
  { key: 'background', label: 'Cor de fundo', hint: 'Fundo das paginas.' },
  { key: 'surface', label: 'Cor de superficie', hint: 'Cartoes e blocos internos.' },
  { key: 'text', label: 'Cor dos textos', hint: 'Texto principal.' },
  { key: 'muted', label: 'Cor dos textos secundarios', hint: 'Legendas e apoio.' },
  { key: 'border', label: 'Cor das bordas', hint: 'Divisores e contornos.' },
  { key: 'inverse', label: 'Cor sobre fundo escuro', hint: 'Texto em faixas escuras.' },
];

export function CustomizationPage() {
  const tenantId = useTenantId();
  const toast = useToast();
  const { can } = useAuth();
  const readOnly = !can('site:edit');

  const tenant = useResource(() => tenantApi.detail(tenantId), [tenantId]);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [tab, setTab] = useState('cores');
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [logoPreview, setLogoPreview] = useState<Record<string, MediaRef | null>>({});

  useEffect(() => {
    if (tenant.data?.settings?.theme) setTheme(themeSchema.parse(tenant.data.settings.theme));
  }, [tenant.data]);

  const preview = useSitePreview({ tenantId, path: '/' });

  // A previa recebe o tema em edicao, sem precisar salvar antes.
  const previewData = useMemo(() => {
    if (!preview.data || !theme) return null;
    return { ...preview.data, theme };
  }, [preview.data, theme]);

  const save = useMutation((next: Theme) => tenantApi.updateTheme(tenantId, next), {
    onSuccess: () => {
      toast.success('Identidade visual salva', 'Publique as paginas para aplicar no site no ar.');
      tenant.reload();
    },
    onError: (error) => toast.error('Nao foi possivel salvar', error.message),
  });

  function update(patch: Partial<Theme>) {
    setTheme((current) => (current ? { ...current, ...patch } : current));
  }

  return (
    <div className="panel-shell grid gap-6">
      <PageHeader
        title="Personalizacao"
        description="Logo, cores, tipografia e formatos. A previa ao lado usa o mesmo renderizador do site publicado."
        actions={
          <>
            <Button
              variant="outline"
              icon={<RotateCcw aria-hidden="true" className="size-4" />}
              disabled={readOnly}
              onClick={() => {
                if (tenant.data?.settings?.theme) setTheme(themeSchema.parse(tenant.data.settings.theme));
              }}
            >
              Descartar
            </Button>
            <Button
              icon={<Save aria-hidden="true" className="size-4" />}
              loading={save.loading}
              disabled={readOnly || !theme}
              onClick={() => theme && void save.run(theme)}
            >
              Salvar
            </Button>
          </>
        }
      />

      {readOnly ? (
        <Alert tone="info" title="Somente leitura">
          Seu papel permite visualizar a identidade visual, mas nao alterar.
        </Alert>
      ) : null}

      <ResourcePanel resource={tenant}>
        {() =>
          theme ? (
            <div className="grid gap-6 xl:grid-cols-[26rem_1fr] xl:items-start">
              <Card>
                <Tabs
                  items={[
                    { id: 'cores', label: 'Cores' },
                    { id: 'tipografia', label: 'Tipografia' },
                    { id: 'formas', label: 'Formas' },
                    { id: 'marca', label: 'Marca' },
                  ]}
                  active={tab}
                  onChange={setTab}
                  className="px-3 pt-2"
                />

                <CardBody className="grid gap-5">
                  {tab === 'cores'
                    ? COLOR_FIELDS.map((field) => (
                        <ColorInput
                          key={field.key}
                          label={field.label}
                          hint={field.hint}
                          value={theme.colors[field.key]}
                          onChange={(value) => update({ colors: { ...theme.colors, [field.key]: value } })}
                        />
                      ))
                    : null}

                  {tab === 'tipografia' ? (
                    <>
                      <Select
                        label="Fonte dos titulos"
                        value={theme.typography.headingFont}
                        options={FONT_FAMILIES.map((font) => ({ value: font, label: FONT_LABELS[font] }))}
                        onChange={(event) =>
                          update({
                            typography: {
                              ...theme.typography,
                              headingFont: event.target.value as Theme['typography']['headingFont'],
                            },
                          })
                        }
                      />
                      <Select
                        label="Fonte do texto"
                        value={theme.typography.bodyFont}
                        options={FONT_FAMILIES.map((font) => ({ value: font, label: FONT_LABELS[font] }))}
                        onChange={(event) =>
                          update({
                            typography: {
                              ...theme.typography,
                              bodyFont: event.target.value as Theme['typography']['bodyFont'],
                            },
                          })
                        }
                      />
                      <RangeInput
                        label="Tamanho base do texto"
                        value={theme.typography.baseSizePx}
                        min={14}
                        max={20}
                        onChange={(value) =>
                          update({ typography: { ...theme.typography, baseSizePx: value } })
                        }
                      />
                      <RangeInput
                        label="Escala dos titulos"
                        value={theme.typography.headingScale}
                        min={1.1}
                        max={1.5}
                        step={0.01}
                        unit=""
                        onChange={(value) =>
                          update({ typography: { ...theme.typography, headingScale: value } })
                        }
                      />
                    </>
                  ) : null}

                  {tab === 'formas' ? (
                    <>
                      <Select
                        label="Estilo dos botoes"
                        value={theme.buttons.style}
                        options={[
                          { value: 'solid', label: 'Preenchido' },
                          { value: 'outline', label: 'Contornado' },
                          { value: 'soft', label: 'Suave' },
                          { value: 'link', label: 'Somente texto' },
                        ].filter((option) => BUTTON_STYLES.includes(option.value as never))}
                        onChange={(event) =>
                          update({ buttons: { ...theme.buttons, style: event.target.value as Theme['buttons']['style'] } })
                        }
                      />
                      <Select
                        label="Cantos dos botoes"
                        value={theme.buttons.shape}
                        options={[
                          { value: 'sharp', label: 'Reto' },
                          { value: 'rounded', label: 'Arredondado' },
                          { value: 'pill', label: 'Totalmente redondo' },
                        ].filter((option) => BUTTON_SHAPES.includes(option.value as never))}
                        onChange={(event) =>
                          update({ buttons: { ...theme.buttons, shape: event.target.value as Theme['buttons']['shape'] } })
                        }
                      />
                      <Switch
                        label="Botoes em caixa alta"
                        checked={theme.buttons.uppercase}
                        onChange={(checked) => update({ buttons: { ...theme.buttons, uppercase: checked } })}
                      />
                      <RangeInput
                        label="Cantos arredondados"
                        value={theme.radiusPx}
                        min={0}
                        max={32}
                        onChange={(value) => update({ radiusPx: value })}
                      />
                      <Select
                        label="Largura do conteudo"
                        value={theme.contentWidth}
                        options={[
                          { value: 'narrow', label: 'Estreita (960px)' },
                          { value: 'default', label: 'Padrao (1152px)' },
                          { value: 'wide', label: 'Ampla (1360px)' },
                          { value: 'full', label: 'Total' },
                        ].filter((option) => CONTENT_WIDTHS.includes(option.value as never))}
                        onChange={(event) =>
                          update({ contentWidth: event.target.value as Theme['contentWidth'] })
                        }
                      />
                      <Select
                        label="Estilo dos cards"
                        value={theme.cardStyle}
                        options={[
                          { value: 'flat', label: 'Plano' },
                          { value: 'outlined', label: 'Com borda' },
                          { value: 'elevated', label: 'Com sombra' },
                        ].filter((option) => CARD_STYLES.includes(option.value as never))}
                        onChange={(event) => update({ cardStyle: event.target.value as Theme['cardStyle'] })}
                      />
                      <Select
                        label="Aparencia do cabecalho"
                        value={theme.header.style}
                        options={[
                          { value: 'light', label: 'Claro' },
                          { value: 'dark', label: 'Escuro' },
                          { value: 'transparent', label: 'Transparente sobre o banner' },
                        ].filter((option) => HEADER_STYLES.includes(option.value as never))}
                        onChange={(event) =>
                          update({ header: { ...theme.header, style: event.target.value as Theme['header']['style'] } })
                        }
                      />
                      <Select
                        label="Posicao do logo"
                        value={theme.header.layout}
                        options={[
                          { value: 'logo-left', label: 'Logo a esquerda' },
                          { value: 'logo-center', label: 'Logo centralizado' },
                        ].filter((option) => HEADER_LAYOUTS.includes(option.value as never))}
                        onChange={(event) =>
                          update({ header: { ...theme.header, layout: event.target.value as Theme['header']['layout'] } })
                        }
                      />
                      <Switch
                        label="Cabecalho fixo ao rolar"
                        checked={theme.header.sticky}
                        onChange={(checked) => update({ header: { ...theme.header, sticky: checked } })}
                      />
                      <Select
                        label="Aparencia do rodape"
                        value={theme.footer.style}
                        options={[
                          { value: 'light', label: 'Claro' },
                          { value: 'dark', label: 'Escuro' },
                          { value: 'brand', label: 'Cor primaria' },
                        ].filter((option) => FOOTER_STYLES.includes(option.value as never))}
                        onChange={(event) =>
                          update({ footer: { ...theme.footer, style: event.target.value as Theme['footer']['style'] } })
                        }
                      />
                      <Switch
                        label="Mostrar redes sociais no rodape"
                        checked={theme.footer.showSocial}
                        onChange={(checked) => update({ footer: { ...theme.footer, showSocial: checked } })}
                      />
                    </>
                  ) : null}

                  {tab === 'marca' ? (
                    <>
                      <ImageField
                        label="Logo principal"
                        tag="marca"
                        value={null}
                        preview={logoPreview.logo ?? (theme.logoUrl ? { id: '', url: theme.logoUrl, alt: '', width: null, height: null } : null)}
                        hint="Usado no cabecalho claro. Prefira PNG ou SVG com fundo transparente."
                        onChange={(_id, asset) => {
                          update({ logoUrl: asset?.blobUrl ?? null });
                          setLogoPreview((current) => ({
                            ...current,
                            logo: asset ? { id: asset.id, url: asset.blobUrl, alt: asset.alt, width: asset.width, height: asset.height } : null,
                          }));
                        }}
                      />
                      <ImageField
                        label="Logo para fundo escuro"
                        tag="marca"
                        value={null}
                        preview={logoPreview.logoDark ?? (theme.logoDarkUrl ? { id: '', url: theme.logoDarkUrl, alt: '', width: null, height: null } : null)}
                        hint="Usado no cabecalho escuro e no rodape."
                        onChange={(_id, asset) => {
                          update({ logoDarkUrl: asset?.blobUrl ?? null });
                          setLogoPreview((current) => ({
                            ...current,
                            logoDark: asset ? { id: asset.id, url: asset.blobUrl, alt: asset.alt, width: asset.width, height: asset.height } : null,
                          }));
                        }}
                      />
                      <ImageField
                        label="Favicon"
                        tag="marca"
                        value={null}
                        preview={logoPreview.favicon ?? (theme.faviconUrl ? { id: '', url: theme.faviconUrl, alt: '', width: null, height: null } : null)}
                        hint="Icone exibido na aba do navegador. Use uma imagem quadrada."
                        onChange={(_id, asset) => {
                          update({ faviconUrl: asset?.blobUrl ?? null });
                          setLogoPreview((current) => ({
                            ...current,
                            favicon: asset ? { id: asset.id, url: asset.blobUrl, alt: asset.alt, width: asset.width, height: asset.height } : null,
                          }));
                        }}
                      />
                    </>
                  ) : null}
                </CardBody>
              </Card>

              <Card className="overflow-hidden">
                <CardHeader
                  title="Previa"
                  description="Rascunho da pagina inicial com o tema em edicao."
                  actions={
                    <SegmentedControl
                      label="Tamanho da tela"
                      value={device}
                      onChange={setDevice}
                      options={[
                        { value: 'desktop', label: 'Computador', icon: <Monitor aria-hidden="true" className="size-3.5" /> },
                        { value: 'tablet', label: 'Tablet', icon: <Tablet aria-hidden="true" className="size-3.5" /> },
                        { value: 'mobile', label: 'Celular', icon: <Smartphone aria-hidden="true" className="size-3.5" /> },
                      ]}
                    />
                  }
                />
                <SitePreviewFrame data={previewData} device={device} loading={preview.loading} height={760} />
              </Card>
            </div>
          ) : null
        }
      </ResourcePanel>
    </div>
  );
}
