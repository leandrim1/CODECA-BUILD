import type { BlockType, PageSection } from '@codeca/shared';
import type { ComponentType } from 'react';
import { DividerBlock, FooterBlock, HeaderBlock, NavigationBlock, SpacerBlock } from './structure.js';
import {
  AboutBlock,
  DifferentialsBlock,
  FaqBlock,
  GalleryBlock,
  HeroBlock,
  ImageBlock,
  ImageTextBlock,
  TextBlock,
} from './content.js';
import { ProjectsBlock, PropertyFeaturedBlock, PropertyGridBlock, ServicesBlock } from './listings.js';
import { TeamBlock, TestimonialsBlock } from './social.js';
import { ContactFormBlock, CtaBlock, WhatsAppButtonBlock } from './conversion.js';

/**
 * Registro de blocos.
 *
 * Cada tipo do catalogo em `@codeca/shared` tem exatamente uma implementacao.
 * O mapa e completo por construcao: faltar um tipo e erro de compilacao.
 */
export const BLOCK_COMPONENTS: Record<BlockType, ComponentType<{ section: PageSection }>> = {
  header: HeaderBlock,
  navigation: NavigationBlock,
  hero: HeroBlock,
  text: TextBlock,
  image: ImageBlock,
  image_text: ImageTextBlock,
  gallery: GalleryBlock,
  property_grid: PropertyGridBlock,
  property_featured: PropertyFeaturedBlock,
  projects: ProjectsBlock,
  services: ServicesBlock,
  about: AboutBlock,
  differentials: DifferentialsBlock,
  team: TeamBlock,
  testimonials: TestimonialsBlock,
  faq: FaqBlock,
  whatsapp_button: WhatsAppButtonBlock,
  contact_form: ContactFormBlock,
  cta: CtaBlock,
  footer: FooterBlock,
  spacer: SpacerBlock,
  divider: DividerBlock,
};

export function BlockRenderer({ section }: { section: PageSection }) {
  const Component = BLOCK_COMPONENTS[section.type];
  if (!Component) return null;
  return <Component section={section} />;
}

export * from './structure.js';
export * from './content.js';
export * from './listings.js';
export * from './social.js';
export * from './conversion.js';
