/**
 * Comparacao entre os tipos do SDK e os da API.
 *
 * Nao e um teste: e verificacao do compilador. `pnpm typecheck` inclui este
 * arquivo, entao um campo que mude de um lado so quebra o build -- antes de
 * qualquer site do cliente receber a versao errada.
 *
 * O SDK carrega uma copia dos tipos publicos porque precisa ser instalavel em
 * um site fora deste repositorio, sem depender de `@codeca/shared`. Esta e a
 * contrapartida dessa independencia.
 */
import type {
  PublicAddress as ApiAddress,
  PublicBanner as ApiBanner,
  PublicCategory as ApiCategory,
  PublicCustomFields as ApiCustomFields,
  PublicFaq as ApiFaq,
  PublicGallery as ApiGallery,
  PublicGallerySummary as ApiGallerySummary,
  PublicProduct as ApiProduct,
  PublicImage as ApiImage,
  PublicPage as ApiPage,
  PublicProject as ApiProject,
  PublicProperty as ApiProperty,
  PublicSeo as ApiSeo,
  PublicService as ApiService,
  PublicTeamMember as ApiTeamMember,
  PublicTestimonial as ApiTestimonial,
  institucionalDocumentSchema,
  contatoDocumentSchema,
} from '@codeca/shared';
import type {
  ContactContent,
  InstitutionalContent,
  PublicAddress as SdkAddress,
  PublicBanner as SdkBanner,
  PublicCategory as SdkCategory,
  PublicCustomFields as SdkCustomFields,
  PublicFaq as SdkFaq,
  PublicGallery as SdkGallery,
  PublicGallerySummary as SdkGallerySummary,
  PublicProduct as SdkProduct,
  PublicImage as SdkImage,
  PublicPage as SdkPage,
  PublicProject as SdkProject,
  PublicProperty as SdkProperty,
  PublicSeo as SdkSeo,
  PublicService as SdkService,
  PublicTeamMember as SdkTeamMember,
  PublicTestimonial as SdkTestimonial,
} from '@codeca/sdk';
import type { z } from 'zod';

/** Verdadeiro somente quando os dois tipos sao mutuamente atribuiveis. */
type Igual<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

type Confirma<T extends true> = T;

type _Image = Confirma<Igual<SdkImage, ApiImage>>;
type _Address = Confirma<Igual<SdkAddress, ApiAddress>>;
type _Seo = Confirma<Igual<SdkSeo, ApiSeo>>;
type _Property = Confirma<Igual<SdkProperty, ApiProperty>>;
type _Project = Confirma<Igual<SdkProject, ApiProject>>;
type _Service = Confirma<Igual<SdkService, ApiService>>;
type _Banner = Confirma<Igual<SdkBanner, ApiBanner>>;
type _Testimonial = Confirma<Igual<SdkTestimonial, ApiTestimonial>>;
type _TeamMember = Confirma<Igual<SdkTeamMember, ApiTeamMember>>;
type _Faq = Confirma<Igual<SdkFaq, ApiFaq>>;
type _Category = Confirma<Igual<SdkCategory, ApiCategory>>;
type _CustomFields = Confirma<Igual<SdkCustomFields, ApiCustomFields>>;
type _Product = Confirma<Igual<SdkProduct, ApiProduct>>;
type _GallerySummary = Confirma<Igual<SdkGallerySummary, ApiGallerySummary>>;
type _Gallery = Confirma<Igual<SdkGallery, ApiGallery>>;
type _Page = Confirma<Igual<SdkPage<SdkProperty>, ApiPage<ApiProperty>>>;

/**
 * Os documentos nascem de um schema Zod, entao a comparacao e com o tipo que
 * ele infere -- a mesma forma que a API valida e devolve.
 */
type _Institucional = Confirma<
  Igual<InstitutionalContent, z.infer<typeof institucionalDocumentSchema>>
>;

type _Contato = Confirma<Igual<ContactContent, z.infer<typeof contatoDocumentSchema>>>;

// Mantem o arquivo como modulo, sem exportar nada util em tempo de execucao.
export type ContratoVerificado =
  | _Image
  | _Address
  | _Seo
  | _Property
  | _Project
  | _Testimonial
  | _TeamMember
  | _Faq
  | _Category
  | _CustomFields
  | _Product
  | _GallerySummary
  | _Gallery
  | _Service
  | _Banner
  | _Page
  | _Institucional
  | _Contato;
