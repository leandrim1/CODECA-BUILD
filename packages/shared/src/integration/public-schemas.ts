import { z } from 'zod';

/**
 * Forma das respostas de `/api/v1`, como schema.
 *
 * Existe por um motivo so: gerar o OpenAPI. JSON Schema precisa de um **valor**
 * em tempo de execucao, e `interface` do TypeScript nao deixa nada no bundle.
 *
 * Sim, isto duplica as interfaces de `public-content.ts` -- e a duplicacao e
 * segura porque o compilador a fecha: `tests/types/openapi-contract.types.ts`
 * confere `z.infer` de cada schema contra a interface correspondente, e um
 * campo que mude de um lado so quebra o `typecheck`. E o mesmo arranjo do SDK,
 * que tambem carrega uma copia por precisar ser instalavel sozinho.
 *
 * Os `.describe()` nao sao enfeite: eles viram a descricao do campo no
 * documento, que e onde quem integra le. Comentario de codigo nao chega lá.
 */

const descrever = <T extends z.ZodType>(schema: T, texto: string): T =>
  schema.describe(texto) as unknown as T;

export const publicImageSchema = z.object({
  id: z.string(),
  url: z.string().describe('URL publica no Vercel Blob, pronta para o atributo src.'),
  alt: z.string().describe('Texto alternativo escrito pelo cliente na biblioteca de imagens.'),
  width: z.number().nullable(),
  height: z.number().nullable(),
});

export const publicAddressSchema = z.object({
  street: z.string().describe('Vazio quando o cliente escolheu esconder o endereco completo.'),
  number: z.string(),
  complement: z.string(),
  neighborhood: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
});

/**
 * Campos definidos para o site, como chave e valor.
 *
 * Sem forma declarada de proposito: as definicoes sao dados, e cada site tem
 * as suas. Quem integra sabe as chaves porque quem desenvolveu o site e a
 * plataforma foi a mesma equipe.
 */
export const publicCustomFieldsSchema = descrever(
  z.record(z.string(), z.unknown()),
  'Valores dos campos personalizados deste site, por chave. Vazio quando nao ha.',
);

export const publicSeoSchema = z.object({
  title: z.string(),
  description: z.string(),
});

export const publicPropertySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  reference: z.string(),
  description: z.string(),
  shortDescription: z.string(),
  type: z.string(),
  purpose: z.string(),
  price: descrever(
    z.number().nullable(),
    'Preco anunciado, em reais -- valor de vitrine, nao calculo financeiro. '
      + '`null` quando nao informado ou quando `priceOnRequest` esta ligado.',
  ),
  priceOnRequest: z.boolean(),
  condoFee: z.number().nullable(),
  iptu: z.number().nullable(),
  currency: z.string(),
  address: publicAddressSchema,
  builtAreaM2: z.number().nullable(),
  landAreaM2: z.number().nullable(),
  bedrooms: z.number().nullable(),
  suites: z.number().nullable(),
  bathrooms: z.number().nullable(),
  parkingSpots: z.number().nullable(),
  floor: z.number().nullable(),
  features: z.array(z.string()),
  cover: publicImageSchema.nullable(),
  gallery: descrever(
    z.array(publicImageSchema),
    'Vazia na listagem; preenchida em `GET /api/v1/properties/{slug}`.',
  ),
  commercialStatus: z.string(),
  featured: z.boolean(),
  deliveryDate: z.string().nullable(),
  videoUrl: z.string(),
  seo: publicSeoSchema,
  publishedAt: z.string().nullable(),
  customFields: publicCustomFieldsSchema,
});

export const publicProjectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  shortDescription: z.string(),
  category: z.string(),
  status: z.string(),
  stage: z.string(),
  progressPercent: z.number().nullable(),
  city: descrever(z.string(), 'Vazio quando o cliente escolheu nao divulgar a localizacao.'),
  state: z.string(),
  neighborhood: z.string(),
  startDate: z.string().nullable(),
  expectedCompletionDate: z.string().nullable(),
  completedDate: z.string().nullable(),
  cover: publicImageSchema.nullable(),
  gallery: z.array(publicImageSchema),
  featured: z.boolean(),
  seo: publicSeoSchema,
  publishedAt: z.string().nullable(),
  customFields: publicCustomFieldsSchema,
});

export const publicServiceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  description: z.string(),
  icon: z.string(),
  image: publicImageSchema.nullable(),
  highlights: z.array(z.string()),
  sortOrder: z.number(),
  seo: publicSeoSchema,
  customFields: publicCustomFieldsSchema,
});

export const publicBannerSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  image: publicImageSchema.nullable(),
  buttonLabel: z.string(),
  buttonUrl: z.string(),
  sortOrder: z.number(),
});

export const publicCategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  sortOrder: z.number(),
});

export const publicProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  description: z.string(),
  code: descrever(z.string(), 'SKU ou referencia interna. Vazio quando nao usado.'),
  price: descrever(
    z.number().nullable(),
    '`null` quando nao ha preco publicado **ou** quando `priceOnRequest` esta '
      + 'ligado: o valor guardado nao viaja. O texto exibido e escolha do projeto.',
  ),
  priceOnRequest: z.boolean(),
  currency: z.string(),
  unit: descrever(z.string(), 'Unidade exibida ao lado do preco: `un`, `kg`, `porcao`.'),
  isAvailable: descrever(
    z.boolean(),
    '`false` e produto no ar porem esgotado -- ele continua na resposta de '
      + 'proposito. Riscar, esmaecer ou esconder e decisao do projeto; use '
      + '`availableOnly=true` para nao receber.',
  ),
  category: publicCategorySchema.nullable(),
  cover: publicImageSchema.nullable(),
  gallery: descrever(
    z.array(publicImageSchema),
    'Vazia na listagem; preenchida em `GET /api/v1/products/{slug}`.',
  ),
  sortOrder: z.number(),
  seo: publicSeoSchema,
  customFields: publicCustomFieldsSchema,
});

export const publicGallerySummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  cover: descrever(
    publicImageSchema.nullable(),
    'Primeira imagem da ordem. Nao existe campo de capa separado.',
  ),
  imageCount: z.number(),
  sortOrder: z.number(),
});

export const publicGallerySchema = publicGallerySummarySchema.extend({
  images: z.array(publicImageSchema),
});

export const publicTestimonialSchema = z.object({
  id: z.string(),
  authorName: z.string(),
  authorRole: z.string(),
  content: z.string(),
  rating: z.number().nullable(),
  photo: publicImageSchema.nullable(),
  relatedProjectId: z.string().nullable(),
  sortOrder: z.number(),
  customFields: publicCustomFieldsSchema,
});

export const publicTeamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  bio: z.string(),
  email: descrever(z.string(), 'Vazio quando o cliente escolheu nao exibir.'),
  photo: publicImageSchema.nullable(),
  social: z.record(z.string(), z.string()),
  sortOrder: z.number(),
  customFields: publicCustomFieldsSchema,
});

export const publicFaqSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  category: descrever(z.string(), 'Agrupamento livre do cliente. Vazio quando nao usado.'),
  sortOrder: z.number(),
});

/** Envelope de listagem paginada. */
export function publicPageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  });
}

export const siteInfoSchema = z.object({
  site: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.string(),
    segment: descrever(
      z.string().nullable(),
      'Ramo do projeto, texto livre definido pela CODECA IA. Nao e lista '
        + 'fechada: trate qualquer valor desconhecido como caso padrao.',
    ),
  }),
  modules: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      kind: z.enum(['document', 'collection']),
    }),
  ),
  scopes: z.array(z.string()),
  notice: descrever(
    z.string().nullable(),
    'Aviso pronto para exibir ao visitante, ou `null`. Vem preenchido quando o '
      + 'plano pede aviso durante pendencia da assinatura; nao descreve a '
      + 'pendencia nem cita valores.',
  ),
});

export const leadReceivedSchema = z.object({
  received: descrever(
    z.boolean(),
    'Confirmacao. Quem envia nao le de volta: exiba o que ja tem no formulario.',
  ),
});
