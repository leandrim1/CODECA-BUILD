import { z } from 'zod';
import { BLOCK_DEFINITIONS, BLOCK_TYPES, type BlockType, defaultBlockProps, defaultBlockStyle } from './catalog.js';
import { blockStyleSchema, responsiveSchema } from './primitives.js';

/**
 * Estrutura de uma pagina: um JSON versionado com a lista de secoes.
 * As propriedades de cada secao sao validadas pelo schema do bloco
 * correspondente, portanto nunca ha conteudo executavel persistido.
 */

export const LAYOUT_SCHEMA_VERSION = 1 as const;

const SECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const sectionSchema = z.object({
  id: z.string().regex(SECTION_ID, 'Id de secao invalido.'),
  type: z.enum(BLOCK_TYPES),
  /** Validado contra `BLOCK_DEFINITIONS[type].propsSchema` em `parsePageLayout`. */
  props: z.record(z.string(), z.unknown()).prefault({}),
  style: blockStyleSchema.prefault({}),
  responsive: responsiveSchema.prefault({}),
  visible: z.boolean().default(true),
  order: z.number().int().min(0).default(0),
  /** Nome opcional exibido na arvore do editor. */
  name: z.string().trim().max(80).default(''),
});
export type PageSection = z.infer<typeof sectionSchema>;

export const pageLayoutSchema = z.object({
  schemaVersion: z.literal(LAYOUT_SCHEMA_VERSION).default(LAYOUT_SCHEMA_VERSION),
  sections: z.array(sectionSchema).max(80).default([]),
});
export type PageLayout = z.infer<typeof pageLayoutSchema>;

export const EMPTY_LAYOUT: PageLayout = { schemaVersion: LAYOUT_SCHEMA_VERSION, sections: [] };

export interface LayoutIssue {
  sectionId: string | null;
  sectionIndex: number | null;
  path: string;
  message: string;
}

export type LayoutParseResult =
  | { ok: true; layout: PageLayout; issues: [] }
  | { ok: false; layout: null; issues: LayoutIssue[] };

function issuesFrom(error: z.ZodError, sectionId: string | null, index: number | null): LayoutIssue[] {
  return error.issues.map((issue) => ({
    sectionId,
    sectionIndex: index,
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Valida a estrutura completa, incluindo as propriedades especificas de cada
 * bloco. Propriedades desconhecidas sao descartadas pelos schemas.
 */
export function parsePageLayout(value: unknown): LayoutParseResult {
  const outer = pageLayoutSchema.safeParse(value ?? EMPTY_LAYOUT);
  if (!outer.success) {
    return { ok: false, layout: null, issues: issuesFrom(outer.error, null, null) };
  }

  const issues: LayoutIssue[] = [];
  const sections: PageSection[] = [];
  const seenIds = new Set<string>();

  outer.data.sections.forEach((section, index) => {
    if (seenIds.has(section.id)) {
      issues.push({
        sectionId: section.id,
        sectionIndex: index,
        path: 'id',
        message: 'Existe mais de uma secao com o mesmo identificador.',
      });
      return;
    }
    seenIds.add(section.id);

    const definition = BLOCK_DEFINITIONS[section.type];
    const props = definition.propsSchema.safeParse(section.props);
    if (!props.success) {
      issues.push(...issuesFrom(props.error, section.id, index));
      return;
    }
    sections.push({ ...section, props: props.data, order: index });
  });

  if (issues.length > 0) return { ok: false, layout: null, issues };
  return { ok: true, layout: { schemaVersion: LAYOUT_SCHEMA_VERSION, sections }, issues: [] };
}

/**
 * Layout validado secao por secao, incluindo as propriedades especificas de
 * cada bloco. Usado na escrita (salvar rascunho) para que conteudo invalido --
 * um link `javascript:`, uma cor fora do padrao, uma propriedade desconhecida --
 * nunca chegue ao banco, e nao apenas seja barrado na publicacao.
 */
export const strictPageLayoutSchema = z.custom<unknown>().transform((value, ctx) => {
  const result = parsePageLayout(value);
  if (!result.ok) {
    for (const issue of result.issues) {
      const path: Array<string | number> =
        issue.sectionIndex === null
          ? issue.path.split('.').filter(Boolean)
          : ['sections', issue.sectionIndex, ...issue.path.split('.').filter(Boolean)];
      ctx.addIssue({ code: 'custom', message: issue.message, path });
    }
    return z.NEVER;
  }
  return result.layout;
});

/** Versao tolerante: descarta secoes invalidas em vez de falhar. Usada na leitura. */
export function coercePageLayout(value: unknown): PageLayout {
  const parsed = parsePageLayout(value);
  if (parsed.ok) return parsed.layout;
  const outer = pageLayoutSchema.safeParse(value ?? EMPTY_LAYOUT);
  if (!outer.success) return EMPTY_LAYOUT;
  const sections: PageSection[] = [];
  const seen = new Set<string>();
  for (const section of outer.data.sections) {
    if (seen.has(section.id)) continue;
    const definition = BLOCK_DEFINITIONS[section.type];
    const props = definition.propsSchema.safeParse(section.props);
    if (!props.success) continue;
    seen.add(section.id);
    sections.push({ ...section, props: props.data, order: sections.length });
  }
  return { schemaVersion: LAYOUT_SCHEMA_VERSION, sections };
}

// ------------------------------------------------------------------ edicao

function randomId(): string {
  const bytes = new Uint8Array(8);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createSectionId(type: BlockType): string {
  return `${type.replace(/_/g, '-')}-${randomId()}`;
}

export function createSection(type: BlockType, overrides: Partial<PageSection> = {}): PageSection {
  return {
    id: overrides.id ?? createSectionId(type),
    type,
    props: overrides.props ?? defaultBlockProps(type),
    style: overrides.style ?? defaultBlockStyle(type),
    responsive: overrides.responsive ?? responsiveSchema.parse({}),
    visible: overrides.visible ?? true,
    order: overrides.order ?? 0,
    name: overrides.name ?? '',
  };
}

function withOrder(sections: PageSection[]): PageSection[] {
  return sections.map((section, index) => ({ ...section, order: index }));
}

export function normalizeLayout(layout: PageLayout): PageLayout {
  return { schemaVersion: LAYOUT_SCHEMA_VERSION, sections: withOrder([...layout.sections]) };
}

/** Quantas vezes um tipo de bloco aparece na pagina. */
export function countBlockType(layout: PageLayout, type: BlockType): number {
  return layout.sections.reduce((total, section) => (section.type === type ? total + 1 : total), 0);
}

export function canAddBlock(layout: PageLayout, type: BlockType): boolean {
  const definition = BLOCK_DEFINITIONS[type];
  if (definition.singleton && countBlockType(layout, type) > 0) return false;
  return layout.sections.length < 80;
}

export function addSection(layout: PageLayout, section: PageSection, index?: number): PageLayout {
  const sections = [...layout.sections];
  const at = index === undefined ? sections.length : Math.max(0, Math.min(index, sections.length));
  sections.splice(at, 0, section);
  return { schemaVersion: LAYOUT_SCHEMA_VERSION, sections: withOrder(sections) };
}

export function removeSection(layout: PageLayout, sectionId: string): PageLayout {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    sections: withOrder(layout.sections.filter((s) => s.id !== sectionId)),
  };
}

export function duplicateSection(layout: PageLayout, sectionId: string): PageLayout {
  const index = layout.sections.findIndex((s) => s.id === sectionId);
  if (index < 0) return layout;
  const original = layout.sections[index] as PageSection;
  if (!canAddBlock(layout, original.type)) return layout;
  const copy: PageSection = {
    ...structuredCloneSafe(original),
    id: createSectionId(original.type),
    name: original.name ? `${original.name} (copia)` : '',
  };
  const sections = [...layout.sections];
  sections.splice(index + 1, 0, copy);
  return { schemaVersion: LAYOUT_SCHEMA_VERSION, sections: withOrder(sections) };
}

export function moveSection(layout: PageLayout, sectionId: string, toIndex: number): PageLayout {
  const from = layout.sections.findIndex((s) => s.id === sectionId);
  if (from < 0) return layout;
  const sections = [...layout.sections];
  const [moved] = sections.splice(from, 1);
  if (!moved) return layout;
  const at = Math.max(0, Math.min(toIndex, sections.length));
  sections.splice(at, 0, moved);
  return { schemaVersion: LAYOUT_SCHEMA_VERSION, sections: withOrder(sections) };
}

export function toggleSectionVisibility(layout: PageLayout, sectionId: string, visible?: boolean): PageLayout {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    sections: layout.sections.map((s) => (s.id === sectionId ? { ...s, visible: visible ?? !s.visible } : s)),
  };
}

export function updateSection(
  layout: PageLayout,
  sectionId: string,
  updater: (section: PageSection) => PageSection,
): PageLayout {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    sections: layout.sections.map((s) => (s.id === sectionId ? updater(s) : s)),
  };
}

/** Atualiza propriedades revalidando contra o schema do bloco. */
export function setSectionProps(
  layout: PageLayout,
  sectionId: string,
  patch: Record<string, unknown>,
): { layout: PageLayout; issues: LayoutIssue[] } {
  const section = layout.sections.find((s) => s.id === sectionId);
  if (!section) return { layout, issues: [] };
  const merged = { ...section.props, ...patch };
  const parsed = BLOCK_DEFINITIONS[section.type].propsSchema.safeParse(merged);
  if (!parsed.success) {
    return { layout, issues: issuesFrom(parsed.error, sectionId, section.order) };
  }
  return { layout: updateSection(layout, sectionId, (s) => ({ ...s, props: parsed.data })), issues: [] };
}

export function setSectionStyle(
  layout: PageLayout,
  sectionId: string,
  patch: Record<string, unknown>,
): { layout: PageLayout; issues: LayoutIssue[] } {
  const section = layout.sections.find((s) => s.id === sectionId);
  if (!section) return { layout, issues: [] };
  const parsed = blockStyleSchema.safeParse({ ...section.style, ...patch });
  if (!parsed.success) {
    return { layout, issues: issuesFrom(parsed.error, sectionId, section.order) };
  }
  return { layout: updateSection(layout, sectionId, (s) => ({ ...s, style: parsed.data })), issues: [] };
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

// ------------------------------------------------------- referencias de midia

/** Coleta todos os `mediaId` referenciados na pagina, usados na publicacao. */
export function collectMediaIds(layout: PageLayout): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const mediaId = record.mediaId;
      if (typeof mediaId === 'string' && mediaId.length > 0) ids.add(mediaId);
      Object.values(record).forEach(visit);
    }
  };
  layout.sections.forEach((section) => {
    visit(section.props);
    visit(section.style);
  });
  return [...ids];
}

/** Ids de imoveis referenciados diretamente (bloco de destaque). */
export function collectPropertyIds(layout: PageLayout): string[] {
  const ids = new Set<string>();
  for (const section of layout.sections) {
    if (section.type !== 'property_featured') continue;
    const id = (section.props as { propertyId?: unknown }).propertyId;
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  }
  return [...ids];
}

export const BLOCK_TYPES_USED = (layout: PageLayout): BlockType[] => [
  ...new Set(layout.sections.map((s) => s.type)),
];
