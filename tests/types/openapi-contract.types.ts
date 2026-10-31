/**
 * Os schemas do OpenAPI e as interfaces da API sao a mesma coisa.
 *
 * Nao e um teste: e verificacao do compilador. `pnpm typecheck` inclui este
 * arquivo, entao um campo que mude de um lado so quebra o build.
 *
 * Por que existem os dois: JSON Schema precisa de um **valor** em tempo de
 * execucao, e `interface` nao deixa nada no bundle. Os mapeadores da API
 * devolvem as interfaces; o documento OpenAPI nasce dos schemas. Sem a
 * comparacao abaixo, a plataforma documentaria uma forma e entregaria outra --
 * e quem integra confiaria na documentacao.
 */
import type {
  PublicBanner,
  PublicCategory,
  PublicFaq,
  PublicGallery,
  PublicGallerySummary,
  PublicImage,
  PublicProduct,
  PublicProject,
  PublicProperty,
  PublicSeo,
  PublicService,
  PublicTeamMember,
  PublicTestimonial,
} from '@codeca/shared';
import type {
  publicBannerSchema,
  publicCategorySchema,
  publicFaqSchema,
  publicGallerySchema,
  publicGallerySummarySchema,
  publicImageSchema,
  publicProductSchema,
  publicProjectSchema,
  publicPropertySchema,
  publicSeoSchema,
  publicServiceSchema,
  publicTeamMemberSchema,
  publicTestimonialSchema,
} from '@codeca/shared';
import type { SiteInfo } from '@codeca/sdk';
import type { siteInfoSchema } from '@codeca/shared';
import type { z } from 'zod';

type Igual<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

type Confirma<T extends true> = T;

type _Image = Confirma<Igual<z.infer<typeof publicImageSchema>, PublicImage>>;
type _Seo = Confirma<Igual<z.infer<typeof publicSeoSchema>, PublicSeo>>;
type _Property = Confirma<Igual<z.infer<typeof publicPropertySchema>, PublicProperty>>;
type _Project = Confirma<Igual<z.infer<typeof publicProjectSchema>, PublicProject>>;
type _Service = Confirma<Igual<z.infer<typeof publicServiceSchema>, PublicService>>;
type _Banner = Confirma<Igual<z.infer<typeof publicBannerSchema>, PublicBanner>>;
type _Category = Confirma<Igual<z.infer<typeof publicCategorySchema>, PublicCategory>>;
type _Product = Confirma<Igual<z.infer<typeof publicProductSchema>, PublicProduct>>;
type _GallerySummary = Confirma<
  Igual<z.infer<typeof publicGallerySummarySchema>, PublicGallerySummary>
>;
type _Gallery = Confirma<Igual<z.infer<typeof publicGallerySchema>, PublicGallery>>;
type _Testimonial = Confirma<
  Igual<z.infer<typeof publicTestimonialSchema>, PublicTestimonial>
>;
type _TeamMember = Confirma<Igual<z.infer<typeof publicTeamMemberSchema>, PublicTeamMember>>;
type _Faq = Confirma<Igual<z.infer<typeof publicFaqSchema>, PublicFaq>>;

/** `SiteInfo` vive no SDK, que e quem o site consome. */
type _SiteInfo = Confirma<Igual<z.infer<typeof siteInfoSchema>, SiteInfo>>;

export type ContratoOpenApiVerificado =
  | _Image
  | _Seo
  | _Property
  | _Project
  | _Service
  | _Banner
  | _Category
  | _Product
  | _GallerySummary
  | _Gallery
  | _Testimonial
  | _TeamMember
  | _Faq
  | _SiteInfo;
