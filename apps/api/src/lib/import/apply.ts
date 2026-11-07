import { and, eq, schema, type Database } from '@codeca/database';
import {
  AppError,
  DOCUMENT_SCHEMAS,
  MODULE_REGISTRY,
  bannerInputSchema,
  blockedFields,
  faqInputSchema,
  galleryInputSchema,
  isModuleKey,
  productInputSchema,
  projectInputSchema,
  propertyInputSchema,
  serviceInputSchema,
  teamMemberInputSchema,
  testimonialInputSchema,
  type DocumentModuleKey,
  type FieldPolicyOverrides,
  type ImportTarget,
  type ModuleKey,
} from '@codeca/shared';
import type { z } from 'zod';
import { assertContentLimit } from '../plan-limits.js';
import { buildUniqueSlug, type SluggableEntity } from '../slugs.js';
import { syncGallery } from '../media-refs.js';

/**
 * Gravacao do conteudo importado.
 *
 * Esta camada **nao tem schema proprio**. Cada registro passa pelo mesmo
 * schema Zod que a rota do painel usa (`serviceInputSchema`, `faqInputSchema`,
 * `DOCUMENT_SCHEMAS`...), pelo mesmo gerador de slug unico, pelo mesmo limite
 * de conteudo do plano e pela mesma politica de campos por site. Se um valor
 * extraido nao serve para o painel, nao serve aqui -- e o candidato falha com a
 * mensagem do proprio schema em vez de entrar meio validado.
 *
 * Duas regras do produto moram aqui:
 *
 * - **Tudo entra como rascunho.** Nenhum conteudo importado aparece no site do
 *   cliente antes de alguem abrir, conferir e publicar. Importar publicado
 *   trocaria o site de um cliente no ar pelo resultado de uma analise
 *   automatica.
 * - **Nada por cima do que ja existe sem autorizacao.** Campo preenchido so e
 *   substituido quando a revisao disse `substituir`, e o valor anterior e
 *   guardado antes da troca.
 */

export interface ApplyContext {
  db: Database;
  tenantId: string;
  siteId: string;
  userId: string;
  now: () => Date;
  /** Excecoes de campo deste site. Ver `lib/modules.ts`. */
  overrides: FieldPolicyOverrides;
  /** Modulos habilitados para este site. */
  enabled: ReadonlySet<ImportTarget>;
}

export interface AppliedRecord {
  /** Identificador do registro criado, para a reversao. */
  createdEntityId: string;
}

/** Erro de gravacao de um candidato, com mensagem para quem revisou. */
export class ApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyError';
  }
}

// ------------------------------------------------------ campo de documento

/**
 * `true` quando o valor atual conta como "ja preenchido".
 *
 * Decide se existe conflito. Texto vazio, lista vazia e nulo nao sao conteudo
 * -- tratar `''` como preenchido faria toda importacao parecer um conflito e
 * exigiria que a pessoa autorizasse a troca de nada por algo.
 */
export function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return value;
  return true;
}

/** Documento atual do modulo, ou `null` quando o site nao tem a linha. */
export async function loadDocument(
  db: Database,
  input: { tenantId: string; siteId: string; moduleKey: DocumentModuleKey },
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const [row] = await db
    .select({ id: schema.contentDocuments.id, data: schema.contentDocuments.data })
    .from(schema.contentDocuments)
    .where(
      and(
        eq(schema.contentDocuments.siteId, input.siteId),
        eq(schema.contentDocuments.tenantId, input.tenantId),
        eq(schema.contentDocuments.moduleKey, input.moduleKey),
      ),
    );
  return row ? { id: row.id, data: row.data ?? {} } : null;
}

/**
 * Grava varios campos de um documento de uma vez.
 *
 * Um documento so, uma validacao so: `institucional` tem onze campos, e validar
 * e gravar campo a campo faria onze consultas e onze chances de a linha ficar
 * num estado que o schema recusa no meio do caminho.
 *
 * Devolve os valores anteriores de cada campo gravado, que e o que a reversao
 * precisa para desfazer.
 */
export async function applyDocumentFields(
  ctx: ApplyContext,
  input: {
    moduleKey: DocumentModuleKey;
    /** Campo -> valor novo, apenas os que a revisao aprovou. */
    fields: Record<string, unknown>;
  },
): Promise<{ previous: Record<string, unknown> }> {
  const atual = await loadDocument(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    moduleKey: input.moduleKey,
  });

  const base = atual?.data ?? {};
  const chaves = Object.keys(input.fields);
  if (chaves.length === 0) return { previous: {} };

  /**
   * Campos que a CODECA IA mantem para este site.
   *
   * A mesma politica que recusa a edicao pelo painel vale aqui. Sem esta
   * conferencia a importacao seria uma porta lateral para mexer em campo
   * travado -- e travado costuma significar "mexer aqui quebra o layout do
   * site".
   */
  const travados = blockedFields(input.moduleKey, chaves, ctx.overrides);
  if (travados.length > 0) {
    const rotulos = travados.map((key) => {
      const campo = MODULE_REGISTRY[input.moduleKey].fields.find((field) => field.key === key);
      return campo?.label ?? key;
    });
    throw new ApplyError(
      `Estes campos são mantidos pela CODECA IA e não podem ser preenchidos pela importação: ${rotulos.join(', ')}.`,
    );
  }

  const previous: Record<string, unknown> = {};
  for (const key of chaves) previous[key] = base[key] ?? null;

  const combinado = { ...base, ...input.fields };
  const parsed = DOCUMENT_SCHEMAS[input.moduleKey].safeParse(combinado);
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    const caminho = primeiro?.path.join('.') ?? '';
    throw new ApplyError(
      caminho !== ''
        ? `O valor encontrado para "${caminho}" não é aceito: ${primeiro?.message ?? 'valor inválido'}.`
        : (primeiro?.message ?? 'O conteúdo encontrado não é aceito pelo módulo.'),
    );
  }

  const agora = ctx.now();
  const data = parsed.data as Record<string, unknown>;

  if (atual) {
    await ctx.db
      .update(schema.contentDocuments)
      .set({ data, updatedByUserId: ctx.userId, updatedAt: agora })
      .where(
        and(
          eq(schema.contentDocuments.id, atual.id),
          eq(schema.contentDocuments.tenantId, ctx.tenantId),
        ),
      );
  } else {
    await ctx.db.insert(schema.contentDocuments).values({
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      moduleKey: input.moduleKey,
      data,
      customFields: {},
      updatedByUserId: ctx.userId,
      createdAt: agora,
      updatedAt: agora,
    });
  }

  return { previous };
}

// ------------------------------------------------- registro de colecao

/**
 * Como cada modulo de colecao grava um registro importado.
 *
 * Tabela em vez de uma cadeia de `if`: sao nove modulos com o mesmo roteiro
 * -- validar pelo schema do painel, gerar slug onde ha slug, inserir -- e
 * acrescentar um modulo passa a ser uma entrada aqui. O `schema` de cada um e
 * **o mesmo objeto** que a rota do painel importa, nao uma copia.
 */
interface CollectionApplier {
  /** Schema de escrita do modulo, igual ao da rota do painel. */
  schema: z.ZodType;
  /** Entidade no gerador de slug, quando a tabela tem slug. */
  sluggable?: SluggableEntity;
  /** Campo de onde o slug e derivado. */
  slugFrom?: string;
  insert: (
    ctx: ApplyContext,
    input: { value: Record<string, unknown>; slug: string; mediaId: string | null; galleryIds: string[] },
  ) => Promise<string>;
}

/**
 * Valores que a importacao fixa, independente do que o site tinha.
 *
 * `publicationStatus: 'draft'` em tudo que tem publicacao, e `isActive: false`
 * nos banners: conteudo importado nao aparece no site antes de alguem olhar.
 */
function comoRascunho(value: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...value, publicationStatus: 'draft', ...extra };
}

const APPLIERS: Partial<Record<ImportTarget, CollectionApplier>> = {
  servicos: {
    schema: serviceInputSchema,
    sluggable: 'services',
    slugFrom: 'title',
    insert: async (ctx, { value, slug, mediaId }) => {
      const agora = ctx.now();
      const input = value as z.output<typeof serviceInputSchema>;
      const [row] = await ctx.db
        .insert(schema.services)
        .values({
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          slug,
          title: input.title,
          summary: input.summary,
          description: input.description,
          icon: input.icon,
          imageId: mediaId,
          highlights: input.highlights,
          publicationStatus: input.publicationStatus,
          sortOrder: input.sortOrder,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          customFields: {},
          createdAt: agora,
          updatedAt: agora,
        })
        .returning({ id: schema.services.id });
      return required(row?.id);
    },
  },

  faq: {
    schema: faqInputSchema,
    insert: async (ctx, { value }) => {
      const agora = ctx.now();
      const input = value as z.output<typeof faqInputSchema>;
      const [row] = await ctx.db
        .insert(schema.faqs)
        .values({
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          question: input.question,
          answer: input.answer,
          category: input.category,
          publicationStatus: input.publicationStatus,
          sortOrder: input.sortOrder,
          createdAt: agora,
          updatedAt: agora,
        })
        .returning({ id: schema.faqs.id });
      return required(row?.id);
    },
  },

  depoimentos: {
    schema: testimonialInputSchema,
    insert: async (ctx, { value, mediaId }) => {
      const agora = ctx.now();
      const input = value as z.output<typeof testimonialInputSchema>;
      const [row] = await ctx.db
        .insert(schema.testimonials)
        .values({
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          authorName: input.authorName,
          authorRole: input.authorRole,
          content: input.content,
          rating: input.rating,
          photoId: mediaId,
          relatedProjectId: input.relatedProjectId,
          authorizationConfirmed: input.authorizationConfirmed,
          authorizationNote: input.authorizationNote,
          publicationStatus: input.publicationStatus,
          sortOrder: input.sortOrder,
          customFields: {},
          createdAt: agora,
          updatedAt: agora,
        })
        .returning({ id: schema.testimonials.id });
      return required(row?.id);
    },
  },

  equipe: {
    schema: teamMemberInputSchema,
    insert: async (ctx, { value, mediaId }) => {
      const agora = ctx.now();
      const input = value as z.output<typeof teamMemberInputSchema>;
      const [row] = await ctx.db
        .insert(schema.teamMembers)
        .values({
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          name: input.name,
          role: input.role,
          bio: input.bio,
          photoId: mediaId,
          email: input.email,
          social: input.social,
          publicationStatus: input.publicationStatus,
          sortOrder: input.sortOrder,
          customFields: {},
          createdAt: agora,
          updatedAt: agora,
        })
        .returning({ id: schema.teamMembers.id });
      return required(row?.id);
    },
  },

  banners: {
    schema: bannerInputSchema,
    insert: async (ctx, { value, mediaId }) => {
      const agora = ctx.now();
      const input = value as z.output<typeof bannerInputSchema>;
      const [row] = await ctx.db
        .insert(schema.banners)
        .values({
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          title: input.title,
          subtitle: input.subtitle,
          imageId: mediaId,
          buttonLabel: input.buttonLabel,
          buttonUrl: input.buttonUrl,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          createdAt: agora,
          updatedAt: agora,
        })
        .returning({ id: schema.banners.id });
      return required(row?.id);
    },
  },

  produtos: {
    schema: productInputSchema,
    sluggable: 'products',
    slugFrom: 'title',
    insert: async (ctx, { value, slug, mediaId, galleryIds }) => {
      const agora = ctx.now();
      const input = value as z.output<typeof productInputSchema>;
      const [row] = await ctx.db
        .insert(schema.products)
        .values({
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          slug,
          title: input.title,
          summary: input.summary,
          description: input.description,
          code: input.code,
          categoryId: input.categoryId,
          price: input.price,
          priceOnRequest: input.priceOnRequest,
          currency: input.currency,
          unit: input.unit,
          isAvailable: input.isAvailable,
          coverImageId: mediaId,
          publicationStatus: input.publicationStatus,
          sortOrder: input.sortOrder,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          customFields: {},
          createdAt: agora,
          updatedAt: agora,
        })
        .returning({ id: schema.products.id });
      const id = required(row?.id);
      if (galleryIds.length > 0) {
        await syncGallery(ctx.db, 'product', {
          tenantId: ctx.tenantId,
          entityId: id,
          mediaIds: galleryIds,
        });
      }
      return id;
    },
  },

  galerias: {
    schema: galleryInputSchema,
    sluggable: 'galleries',
    slugFrom: 'title',
    insert: async (ctx, { value, slug, galleryIds }) => {
      const agora = ctx.now();
      const input = value as z.output<typeof galleryInputSchema>;
      const [row] = await ctx.db
        .insert(schema.galleries)
        .values({
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          slug,
          title: input.title,
          description: input.description,
          publicationStatus: input.publicationStatus,
          sortOrder: input.sortOrder,
          createdAt: agora,
          updatedAt: agora,
        })
        .returning({ id: schema.galleries.id });
      const id = required(row?.id);
      if (galleryIds.length > 0) {
        await syncGallery(ctx.db, 'gallery', {
          tenantId: ctx.tenantId,
          entityId: id,
          mediaIds: galleryIds,
        });
      }
      return id;
    },
  },

  obras: {
    schema: projectInputSchema,
    sluggable: 'projects',
    slugFrom: 'title',
    insert: async (ctx, { value, slug, mediaId, galleryIds }) => {
      const agora = ctx.now();
      const input = value as z.output<typeof projectInputSchema>;
      const [row] = await ctx.db
        .insert(schema.projects)
        .values({
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          slug,
          title: input.title,
          description: input.description,
          shortDescription: input.shortDescription,
          category: input.category,
          status: input.status,
          stage: input.stage,
          progressPercent: input.progressPercent,
          city: input.city,
          state: input.state,
          neighborhood: input.neighborhood,
          showLocation: input.showLocation,
          startDate: input.startDate,
          expectedCompletionDate: input.expectedCompletionDate,
          completedDate: input.completedDate,
          coverImageId: mediaId,
          publicationStatus: input.publicationStatus,
          featured: input.featured,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          sortOrder: input.sortOrder,
          customFields: {},
          createdAt: agora,
          updatedAt: agora,
        })
        .returning({ id: schema.projects.id });
      const id = required(row?.id);
      if (galleryIds.length > 0) {
        await syncGallery(ctx.db, 'project', {
          tenantId: ctx.tenantId,
          entityId: id,
          mediaIds: galleryIds,
        });
      }
      return id;
    },
  },

  imoveis: {
    schema: propertyInputSchema,
    sluggable: 'properties',
    slugFrom: 'title',
    insert: async (ctx, { value, slug, mediaId, galleryIds }) => {
      const agora = ctx.now();
      const input = value as z.output<typeof propertyInputSchema>;
      const [row] = await ctx.db
        .insert(schema.properties)
        .values({
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          slug,
          title: input.title,
          reference: input.reference,
          description: input.description,
          shortDescription: input.shortDescription,
          type: input.type,
          purpose: input.purpose,
          price: input.price,
          priceOnRequest: input.priceOnRequest,
          condoFee: input.condoFee,
          iptu: input.iptu,
          currency: input.currency,
          address: input.address,
          builtAreaM2: input.builtAreaM2,
          landAreaM2: input.landAreaM2,
          bedrooms: input.bedrooms,
          suites: input.suites,
          bathrooms: input.bathrooms,
          parkingSpots: input.parkingSpots,
          floor: input.floor,
          features: input.features,
          coverImageId: mediaId,
          videoUrl: input.videoUrl,
          publicationStatus: input.publicationStatus,
          commercialStatus: input.commercialStatus,
          featured: input.featured,
          deliveryDate: input.deliveryDate,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          sortOrder: input.sortOrder,
          customFields: {},
          createdAt: agora,
          updatedAt: agora,
        })
        .returning({ id: schema.properties.id });
      const id = required(row?.id);
      if (galleryIds.length > 0) {
        await syncGallery(ctx.db, 'property', {
          tenantId: ctx.tenantId,
          entityId: id,
          mediaIds: galleryIds,
        });
      }
      return id;
    },
  },
};

function required(id: string | undefined): string {
  if (id === undefined) throw new ApplyError('Não foi possível gravar o registro.');
  return id;
}

/** `true` quando a importacao sabe gravar registros neste modulo. */
export function canApplyCollection(target: ImportTarget): boolean {
  return APPLIERS[target] !== undefined;
}

/**
 * Grava um registro de colecao.
 *
 * `mediaId` e `galleryIds` chegam prontos: a imagem foi baixada antes, e o que
 * entra na coluna e um identificador da biblioteca da empresa -- nunca o
 * endereco no site antigo. E isso que faz o site novo parar de depender do
 * antigo.
 */
export async function applyCollectionRecord(
  ctx: ApplyContext,
  input: {
    target: ImportTarget;
    value: Record<string, unknown>;
    mediaId: string | null;
    galleryIds: string[];
  },
): Promise<AppliedRecord> {
  const applier = APPLIERS[input.target];
  if (!applier) {
    throw new ApplyError('A importação não grava registros neste módulo.');
  }

  if (!ctx.enabled.has(input.target)) {
    const nome = isModuleKey(input.target) ? MODULE_REGISTRY[input.target].name : input.target;
    throw new ApplyError(`O módulo ${nome} não está habilitado para este site.`);
  }

  // O mesmo limite que o painel aplica ao cadastrar um conteudo. Importar nao e
  // uma via de contornar o plano.
  await assertContentLimit(ctx.db, ctx.tenantId);

  // Banner nao tem `publicationStatus`; quem controla a exibicao e `isActive`.
  const comValores =
    input.target === 'banners'
      ? { ...input.value, isActive: false }
      : comoRascunho(input.value);

  // Remove as chaves internas do mapeamento (`__imageUrls`), que viraram
  // `galleryIds` antes de chegar aqui e nao pertencem a nenhum schema.
  const limpo = Object.fromEntries(
    Object.entries(comValores).filter(([key]) => !key.startsWith('__')),
  );

  if (input.target === 'galerias' && input.galleryIds.length > 0) {
    limpo['imageIds'] = input.galleryIds;
  }

  const parsed = applier.schema.safeParse(limpo);
  if (!parsed.success) {
    const issue = (parsed.error as z.ZodError).issues[0];
    const caminho = issue?.path.join('.') ?? '';
    throw new ApplyError(
      caminho !== ''
        ? `"${caminho}": ${issue?.message ?? 'valor inválido'}.`
        : (issue?.message ?? 'O conteúdo encontrado não é aceito pelo módulo.'),
    );
  }

  const value = parsed.data as Record<string, unknown>;

  let slug = '';
  if (applier.sluggable && applier.slugFrom) {
    const desejado = String(value[applier.slugFrom] ?? '');
    slug = await buildUniqueSlug(ctx.db, applier.sluggable, {
      tenantId: ctx.tenantId,
      desired: desejado,
    });
  }

  const createdEntityId = await applier.insert(ctx, {
    value,
    slug,
    mediaId: input.mediaId,
    galleryIds: input.galleryIds,
  });

  return { createdEntityId };
}

// ------------------------------------------------------------- reversao

/**
 * Apaga um registro criado pela importacao.
 *
 * Apaga **somente** o identificador anotado no candidato, e sempre com o
 * `tenant_id` da sessao na condicao: nada que a importacao nao tenha criado
 * pode ser alcancado por aqui, nem registro de outra empresa, mesmo que um
 * pedido forjado traga outro identificador.
 *
 * Um `switch` em vez de um mapa de tabelas: cada tabela do Drizzle tem tipo
 * proprio, e unifica-las num mapa exigiria apagar os tipos com conversao
 * forcada -- justamente na funcao que **apaga dado de cliente**, onde o tipo e
 * a ultima conferencia antes do `DELETE`.
 */
export async function revertCollectionRecord(
  ctx: Pick<ApplyContext, 'db' | 'tenantId'>,
  input: { target: ImportTarget; entityId: string },
): Promise<void> {
  const { db, tenantId } = ctx;
  const id = input.entityId;

  switch (input.target) {
    case 'servicos':
      await db.delete(schema.services).where(and(eq(schema.services.id, id), eq(schema.services.tenantId, tenantId)));
      return;
    case 'faq':
      await db.delete(schema.faqs).where(and(eq(schema.faqs.id, id), eq(schema.faqs.tenantId, tenantId)));
      return;
    case 'depoimentos':
      await db.delete(schema.testimonials).where(and(eq(schema.testimonials.id, id), eq(schema.testimonials.tenantId, tenantId)));
      return;
    case 'equipe':
      await db.delete(schema.teamMembers).where(and(eq(schema.teamMembers.id, id), eq(schema.teamMembers.tenantId, tenantId)));
      return;
    case 'banners':
      await db.delete(schema.banners).where(and(eq(schema.banners.id, id), eq(schema.banners.tenantId, tenantId)));
      return;
    case 'produtos':
      await db.delete(schema.products).where(and(eq(schema.products.id, id), eq(schema.products.tenantId, tenantId)));
      return;
    case 'galerias':
      await db.delete(schema.galleries).where(and(eq(schema.galleries.id, id), eq(schema.galleries.tenantId, tenantId)));
      return;
    case 'obras':
      await db.delete(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.tenantId, tenantId)));
      return;
    case 'imoveis':
      await db.delete(schema.properties).where(and(eq(schema.properties.id, id), eq(schema.properties.tenantId, tenantId)));
      return;
    default:
      /**
       * Imagem e os modulos sem gravacao nao sao apagados pela reversao.
       *
       * O arquivo fica na biblioteca de proposito: desfazer a importacao do
       * **conteudo** nao deveria apagar uma imagem que a pessoa pode ja ter
       * usado em outro lugar. A Biblioteca de imagens tem a propria exclusao,
       * que recusa apagar arquivo em uso.
       */
      return;
  }
}

/**
 * Devolve campos de documento aos valores anteriores.
 *
 * Grava o documento inteiro de novo, validado: a reversao nao pode deixar a
 * linha num estado que o schema recusaria, senao desfazer a importacao
 * quebraria a tela de edicao.
 */
export async function revertDocumentFields(
  ctx: ApplyContext,
  input: { moduleKey: DocumentModuleKey; previous: Record<string, unknown> },
): Promise<void> {
  const chaves = Object.keys(input.previous);
  if (chaves.length === 0) return;

  const atual = await loadDocument(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    moduleKey: input.moduleKey,
  });
  if (!atual) return;

  const combinado: Record<string, unknown> = { ...atual.data };
  for (const key of chaves) {
    const anterior = input.previous[key];
    // `null` no valor anterior significa "estava vazio": deixar o campo fora
    // do objeto faz o schema repor o padrao dele, que e o vazio certo para
    // aquele tipo (texto, lista ou nulo).
    if (anterior === null) delete combinado[key];
    else combinado[key] = anterior;
  }

  const parsed = DOCUMENT_SCHEMAS[input.moduleKey].safeParse(combinado);
  if (!parsed.success) {
    throw new ApplyError('Não foi possível restaurar os valores anteriores deste módulo.');
  }

  await ctx.db
    .update(schema.contentDocuments)
    .set({
      data: parsed.data as Record<string, unknown>,
      updatedByUserId: ctx.userId,
      updatedAt: ctx.now(),
    })
    .where(
      and(eq(schema.contentDocuments.id, atual.id), eq(schema.contentDocuments.tenantId, ctx.tenantId)),
    );
}

export { AppError };
export type { ModuleKey };
