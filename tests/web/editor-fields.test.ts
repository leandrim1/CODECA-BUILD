// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BLOCK_TYPES,
  addSection,
  createSection,
  defaultBlockProps,
  defaultBlockStyle,
  EMPTY_LAYOUT,
  parsePageLayout,
  responsiveOverrideSchema,
  type BlockType,
} from '@codeca/shared';
import { sectionCss, layoutCss } from '@codeca/site-renderer';
import {
  BLOCK_FIELDS,
  RESPONSIVE_FIELDS,
  STYLE_GROUPS,
  blockGroups,
} from '../../apps/web/src/editor/fields.js';
import { getByPath, setByPath } from '../../apps/web/src/editor/FieldRenderer.js';

/**
 * Os descritores do painel de propriedades apontam para caminhos dentro das
 * propriedades de cada bloco. Estes testes garantem que nenhum caminho esta
 * escrito errado -- um erro que, sem teste, so apareceria como um campo que
 * nunca salva nada.
 */

describe('leitura e escrita por caminho', () => {
  it('le valores aninhados', () => {
    const source = { filter: { city: 'Campinas', purpose: ['venda'] }, limit: 6 };
    expect(getByPath(source, 'limit')).toBe(6);
    expect(getByPath(source, 'filter.city')).toBe('Campinas');
    expect(getByPath(source, 'filter.purpose')).toEqual(['venda']);
    expect(getByPath(source, 'filter.inexistente')).toBeUndefined();
    expect(getByPath(source, 'nada.de.nada')).toBeUndefined();
  });

  it('escreve sem alterar o objeto original', () => {
    const source = { filter: { city: 'Campinas', neighborhood: 'Cambui' }, limit: 6 };
    const next = setByPath(source, 'filter.city', 'Valinhos');

    expect(next.filter.city).toBe('Valinhos');
    expect(next.filter.neighborhood).toBe('Cambui');
    expect(source.filter.city).toBe('Campinas');
    expect(next).not.toBe(source);
  });

  it('cria os niveis intermediarios quando faltam', () => {
    const next = setByPath({} as Record<string, unknown>, 'padding.top', 48);
    expect(next).toEqual({ padding: { top: 48 } });
  });
});

describe('descritores de campos do editor', () => {
  it('todo bloco do catalogo tem painel de propriedades', () => {
    for (const type of BLOCK_TYPES) {
      const groups = BLOCK_FIELDS[type];
      expect(groups, `bloco ${type}`).toBeDefined();
      expect(groups.length, `bloco ${type}`).toBeGreaterThan(0);
      for (const group of groups) {
        expect(group.title.length, `bloco ${type}`).toBeGreaterThan(0);
        expect(group.fields.length, `grupo ${group.title} do bloco ${type}`).toBeGreaterThan(0);
      }
    }
  });

  it('todo caminho de campo existe nas propriedades padrao do bloco', () => {
    for (const type of BLOCK_TYPES) {
      const props = defaultBlockProps(type);
      for (const group of BLOCK_FIELDS[type]) {
        for (const field of group.fields) {
          expect(
            getByPath(props, field.path),
            `o campo "${field.label}" (${field.path}) do bloco ${type} nao existe nas propriedades`,
          ).not.toBeUndefined();
        }
      }
    }
  });

  it('todo caminho de estilo existe no estilo padrao do bloco', () => {
    for (const type of BLOCK_TYPES) {
      const style = defaultBlockStyle(type);
      for (const group of STYLE_GROUPS) {
        for (const field of group.fields) {
          expect(
            getByPath(style, field.path),
            `o campo de estilo "${field.label}" (${field.path}) nao existe`,
          ).not.toBeUndefined();
        }
      }
    }
  });

  it('campos de tela sao aceitos pelo schema de variacao responsiva', () => {
    for (const field of RESPONSIVE_FIELDS) {
      const sample =
        field.kind === 'boolean' ? true : field.kind === 'range' ? (field.min ?? 0) : 'center';
      const patch = setByPath({} as Record<string, unknown>, field.path, sample);
      const parsed = responsiveOverrideSchema.safeParse(patch);
      expect(parsed.success, `campo responsivo ${field.path}: ${JSON.stringify(patch)}`).toBe(true);
    }
  });

  it('campos de selecao e icone sempre oferecem opcoes', () => {
    for (const type of BLOCK_TYPES) {
      for (const group of BLOCK_FIELDS[type]) {
        for (const field of group.fields) {
          if (field.kind === 'select' || field.kind === 'multiselect' || field.kind === 'icon') {
            expect(field.options?.length, `${type}.${field.path}`).toBeGreaterThan(0);
          }
          if (field.kind === 'items' || field.kind === 'links' || field.kind === 'buttons') {
            expect(field.itemFields?.length, `${type}.${field.path}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('o valor padrao de cada campo de selecao esta entre as opcoes', () => {
    for (const type of BLOCK_TYPES) {
      const props = defaultBlockProps(type);
      for (const group of BLOCK_FIELDS[type]) {
        for (const field of group.fields) {
          if (field.kind !== 'select' || field.nullable) continue;
          const current = getByPath(props, field.path);
          if (typeof current !== 'string' || current === '') continue;
          expect(
            field.options?.some((option) => option.value === current),
            `${type}.${field.path} = "${current}" nao esta nas opcoes oferecidas`,
          ).toBe(true);
        }
      }
    }
  });

  it('o catalogo de insercao agrupa todos os blocos', () => {
    const groups = blockGroups();
    const total = [...groups.values()].reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(BLOCK_TYPES.length);
  });
});

describe('aplicar valores do painel no layout', () => {
  it('uma edicao valida de propriedade mantem o layout valido', () => {
    for (const type of BLOCK_TYPES) {
      const section = createSection(type);
      const layout = addSection(EMPTY_LAYOUT, section);

      for (const group of BLOCK_FIELDS[type]) {
        for (const field of group.fields) {
          if (field.kind !== 'text' && field.kind !== 'textarea' && field.kind !== 'richtext') continue;
          const patch = setByPath({ ...section.props }, field.path, 'Texto de teste');
          const edited = {
            ...layout,
            sections: [{ ...section, props: patch }],
          };
          const parsed = parsePageLayout(edited);
          expect(
            parsed.ok,
            `editar ${type}.${field.path} invalidou o layout: ${JSON.stringify(parsed.issues)}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('estilo gerado para cada tamanho de tela', () => {
  it('gera media queries somente quando ha variacao definida', () => {
    const base = createSection('property_grid');

    const semVariacao = sectionCss(base);
    expect(semVariacao).toContain(`.ct-s-${base.id}{`);
    expect(semVariacao).not.toContain('@media');

    const comVariacao = sectionCss({
      ...base,
      responsive: {
        tablet: { columns: 2 },
        mobile: { columns: 1, hidden: false, align: 'center' },
      },
    });
    expect(comVariacao).toContain('@media (max-width:1024px)');
    expect(comVariacao).toContain('@media (max-width:640px)');
    expect(comVariacao).toContain('--ct-cols: 2');
    expect(comVariacao).toContain('--ct-cols: 1');
    expect(comVariacao).toContain('text-align: center');
  });

  it('a opcao de ocultar em um tamanho vira display:none na media query', () => {
    const section = createSection('hero');
    const css = sectionCss({ ...section, responsive: { tablet: {}, mobile: { hidden: true } } });
    expect(css).toContain('@media (max-width:640px)');
    expect(css).toContain('display: none');
  });

  it('o CSS da pagina cobre todas as secoes visiveis', () => {
    const hero = createSection('hero');
    const grid = createSection('property_grid');
    const css = layoutCss([hero, grid]);
    expect(css).toContain(`.ct-s-${hero.id}{`);
    expect(css).toContain(`.ct-s-${grid.id}{`);
  });

  it('nao permite que uma cor do editor injete CSS arbitrario', () => {
    const section = createSection('cta');
    // O schema do estilo recusaria o valor; aqui forcamos para conferir que o
    // gerador de CSS tambem descarta o que nao for cor valida.
    const css = sectionCss({
      ...section,
      style: {
        ...section.style,
        background: { ...section.style.background, kind: 'color', color: 'red;}body{display:none' },
      },
    });
    expect(css).not.toContain('body{display:none');
  });
});
