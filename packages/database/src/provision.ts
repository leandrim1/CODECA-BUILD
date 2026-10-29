import { DEFAULT_NAVIGATION, DEFAULT_THEME, defaultPageTemplates, slugify, updateSeoSchema, updateSiteSectionsSchema } from '@codeca/shared';
import type { Database } from './client.js';
import { navigationMenus, pages, siteSettings } from './schema.js';

/**
 * Cria o conteudo inicial de uma construtora: configuracoes do site, paginas
 * padrao (em rascunho) e o menu principal. Usado tanto no cadastro de uma nova
 * empresa quanto no seed, garantindo que ambos produzam o mesmo estado.
 */
export async function provisionTenantDefaults(
  db: Database,
  input: { tenantId: string; companyName: string },
): Promise<void> {
  const { tenantId, companyName } = input;

  await db.insert(siteSettings).values({
    tenantId,
    theme: DEFAULT_THEME,
    sections: updateSiteSectionsSchema.parse({}),
    seo: updateSeoSchema.parse({
      defaultTitle: companyName,
      titleTemplate: `%s | ${companyName}`,
      defaultDescription: `Conheca os imoveis, as obras e os servicos da ${companyName}.`,
    }),
  });

  const templates = defaultPageTemplates(companyName);
  await db.insert(pages).values(
    templates.map((template, index) => ({
      tenantId,
      slug: template.slug === 'home' ? 'home' : slugify(template.slug),
      title: template.title,
      isHome: template.isHome,
      status: 'draft' as const,
      draftLayout: template.layout,
      seoTitle: template.seoTitle ?? '',
      seoDescription: template.seoDescription ?? '',
      showInNavigation: template.slug !== 'home',
      sortOrder: index,
    })),
  );

  await db.insert(navigationMenus).values({
    tenantId,
    key: 'principal',
    label: 'Menu principal',
    items: DEFAULT_NAVIGATION.map((item) => ({ ...item, children: [] })),
  });
}
