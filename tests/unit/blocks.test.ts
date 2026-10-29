import { describe, expect, it } from 'vitest';
import {
  BLOCK_DEFINITIONS,
  BLOCK_TYPES,
  addSection,
  canAddBlock,
  collectMediaIds,
  createSection,
  defaultBlockProps,
  duplicateSection,
  EMPTY_LAYOUT,
  moveSection,
  parsePageLayout,
  removeSection,
  safeHrefSchema,
  setSectionProps,
  toggleSectionVisibility,
  defaultPageTemplates,
} from '@codeca/shared';

describe('catalogo de blocos', () => {
  it('todo bloco tem propriedades padrao validas', () => {
    for (const type of BLOCK_TYPES) {
      expect(() => defaultBlockProps(type), `bloco ${type}`).not.toThrow();
      const definition = BLOCK_DEFINITIONS[type];
      expect(definition.type).toBe(type);
      expect(definition.label.length).toBeGreaterThan(0);
    }
  });

  it('cria secao valida para cada tipo de bloco', () => {
    for (const type of BLOCK_TYPES) {
      const layout = addSection(EMPTY_LAYOUT, createSection(type));
      const parsed = parsePageLayout(layout);
      expect(parsed.ok, `bloco ${type}: ${JSON.stringify(parsed.issues)}`).toBe(true);
    }
  });
});

describe('links seguros', () => {
  it('aceita caminhos internos, ancoras e URLs http(s), mailto e tel', () => {
    for (const href of ['/imoveis', '#contato', 'https://exemplo.com.br', 'mailto:a@b.com', 'tel:+5511999999999', '']) {
      expect(safeHrefSchema.safeParse(href).success, href).toBe(true);
    }
  });

  it('rejeita esquemas executaveis e protocol-relative', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox',
      '//evil.com',
      'file:///etc/passwd',
    ]) {
      expect(safeHrefSchema.safeParse(href).success, href).toBe(false);
    }
  });
});

describe('edicao de layout', () => {
  it('nao permite dois cabecalhos na mesma pagina', () => {
    const withHeader = addSection(EMPTY_LAYOUT, createSection('header'));
    expect(canAddBlock(withHeader, 'header')).toBe(false);
    expect(canAddBlock(withHeader, 'hero')).toBe(true);
  });

  it('reordena, duplica, oculta e remove secoes mantendo a ordem', () => {
    let layout = EMPTY_LAYOUT;
    const hero = createSection('hero');
    const text = createSection('text');
    layout = addSection(layout, hero);
    layout = addSection(layout, text);
    expect(layout.sections.map((s) => s.type)).toEqual(['hero', 'text']);

    layout = moveSection(layout, text.id, 0);
    expect(layout.sections.map((s) => s.type)).toEqual(['text', 'hero']);
    expect(layout.sections.map((s) => s.order)).toEqual([0, 1]);

    layout = duplicateSection(layout, hero.id);
    expect(layout.sections).toHaveLength(3);
    expect(new Set(layout.sections.map((s) => s.id)).size).toBe(3);

    layout = toggleSectionVisibility(layout, hero.id);
    expect(layout.sections.find((s) => s.id === hero.id)?.visible).toBe(false);

    layout = removeSection(layout, hero.id);
    expect(layout.sections.some((s) => s.id === hero.id)).toBe(false);
    expect(layout.sections.map((s) => s.order)).toEqual([0, 1]);
  });

  it('rejeita propriedades invalidas sem alterar o layout', () => {
    const hero = createSection('hero');
    const layout = addSection(EMPTY_LAYOUT, hero);
    const result = setSectionProps(layout, hero.id, {
      buttons: [{ label: 'Clique', href: 'javascript:alert(1)', variant: 'primary', newTab: false }],
    });
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.layout).toBe(layout);
  });

  it('descarta propriedades desconhecidas enviadas pelo editor', () => {
    const hero = createSection('hero');
    const layout = addSection(EMPTY_LAYOUT, { ...hero, props: { ...hero.props, __html: '<script>x</script>' } });
    const parsed = parsePageLayout(layout);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.layout.sections[0]?.props).not.toHaveProperty('__html');
  });

  it('coleta referencias de midia do layout', () => {
    const image = createSection('image');
    const id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const layout = addSection(EMPTY_LAYOUT, {
      ...image,
      props: { ...image.props, image: { mediaId: id, url: 'https://cdn.exemplo.com/a.jpg', alt: '', width: null, height: null } },
    });
    expect(collectMediaIds(layout)).toEqual([id]);
  });
});

describe('templates iniciais', () => {
  it('todas as paginas padrao sao validas e existe exatamente uma home', () => {
    const templates = defaultPageTemplates('Construtora Exemplo');
    expect(templates.filter((t) => t.isHome)).toHaveLength(1);
    for (const template of templates) {
      const parsed = parsePageLayout(template.layout);
      expect(parsed.ok, `${template.slug}: ${JSON.stringify(parsed.issues)}`).toBe(true);
    }
  });
});
