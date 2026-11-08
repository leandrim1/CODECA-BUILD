import { and, eq, inArray, schema, type Database } from '@codeca/database';
import { MEDIA_TARGET, type DocumentModuleKey, type SyncTarget } from '@codeca/shared';

/**
 * O que esta na CODECA Build agora.
 *
 * A terceira ponta da comparacao. Le o conteudo **pelas tabelas do painel**,
 * nao por uma copia -- e por isso que uma edicao feita pelo cliente aparece
 * aqui no instante seguinte, que e exatamente o que a protecao contra
 * conflito precisa enxergar.
 *
 * Devolve `undefined` quando o conteudo nao existe do lado da CODECA. A
 * distincao entre "nao existe" e "existe vazio" importa: um campo que o
 * cliente esvaziou de proposito nao e a mesma coisa que um campo que nunca
 * foi preenchido.
 */

/** Campos de um registro de colecao que entram na comparacao. */
export interface CodecaSnapshot {
  /** Valor comparavel, no mesmo formato do que a origem produz. */
  value: unknown;
  /** Identificador do registro, quando o conteudo e um registro. */
  entityId: string | null;
  /** Endereco da imagem na biblioteca, para a tela comparar lado a lado. */
  imageUrl?: string;
}

const DOCUMENT_TARGETS: readonly SyncTarget[] = ['institucional', 'contato'];

export function isDocumentTarget(target: SyncTarget): target is DocumentModuleKey {
  return DOCUMENT_TARGETS.includes(target);
}

/** Conteudo atual dos dois modulos de documento. */
export async function loadDocuments(
  db: Database,
  input: { tenantId: string; siteId: string },
): Promise<Map<DocumentModuleKey, Record<string, unknown>>> {
  const rows = await db
    .select({ moduleKey: schema.contentDocuments.moduleKey, data: schema.contentDocuments.data })
    .from(schema.contentDocuments)
    .where(
      and(
        eq(schema.contentDocuments.tenantId, input.tenantId),
        eq(schema.contentDocuments.siteId, input.siteId),
        inArray(schema.contentDocuments.moduleKey, ['institucional', 'contato']),
      ),
    );

  const mapa = new Map<DocumentModuleKey, Record<string, unknown>>();
  for (const row of rows) {
    if (row.moduleKey !== 'institucional' && row.moduleKey !== 'contato') continue;
    mapa.set(row.moduleKey, (row.data ?? {}) as Record<string, unknown>);
  }
  return mapa;
}

/**
 * Registros de colecao da empresa, indexados por titulo normalizado.
 *
 * O indice por titulo e o que permite reconhecer "este servico ja existe"
 * quando o baseline ainda nao tem o identificador -- por exemplo numa fonte
 * conectada a um site que foi importado antes de a sincronizacao existir.
 */
export interface CollectionIndex {
  /** titulo normalizado -> registro. */
  byLabel: Map<string, { id: string; value: Record<string, unknown>; imageId: string | null }>;
  /** identificador -> registro. */
  byId: Map<string, { id: string; value: Record<string, unknown>; imageId: string | null }>;
}

/**
 * Campos de cada modulo que entram na comparacao.
 *
 * So os que a extracao de fato produz. Comparar o registro inteiro traria
 * colunas que a origem nunca preenche (`sortOrder`, `slug`, `currency`) e toda
 * verificacao acusaria alteracao em tudo.
 */
const COMPARED_FIELDS: Partial<Record<SyncTarget, readonly string[]>> = {
  servicos: ['title', 'summary', 'description'],
  produtos: ['title', 'summary', 'description', 'code', 'price'],
  obras: ['title', 'shortDescription', 'description', 'category'],
  imoveis: ['title', 'description', 'type', 'purpose', 'price', 'bedrooms', 'bathrooms'],
  banners: ['title', 'subtitle'],
  galerias: ['title', 'description'],
  depoimentos: ['authorName', 'authorRole', 'content'],
  equipe: ['name', 'role', 'bio'],
  faq: ['question', 'answer'],
};

/** Campo que guarda o titulo de cada modulo, para montar o indice. */
const LABEL_FIELD: Partial<Record<SyncTarget, string>> = {
  servicos: 'title',
  produtos: 'title',
  obras: 'title',
  imoveis: 'title',
  banners: 'title',
  galerias: 'title',
  depoimentos: 'authorName',
  equipe: 'name',
  faq: 'question',
};

/** Campo de imagem principal de cada modulo. */
const IMAGE_FIELD: Partial<Record<SyncTarget, string>> = {
  servicos: 'imageId',
  produtos: 'coverImageId',
  obras: 'coverImageId',
  imoveis: 'coverImageId',
  banners: 'imageId',
  depoimentos: 'photoId',
  equipe: 'photoId',
};

export function comparedFieldsOf(target: SyncTarget): readonly string[] {
  return COMPARED_FIELDS[target] ?? [];
}

export function labelFieldOf(target: SyncTarget): string | null {
  return LABEL_FIELD[target] ?? null;
}

export function imageFieldOf(target: SyncTarget): string | null {
  return IMAGE_FIELD[target] ?? null;
}

/** `true` quando a sincronizacao sabe comparar este modulo. */
export function canCompare(target: SyncTarget): boolean {
  return target === MEDIA_TARGET || isDocumentTarget(target) || COMPARED_FIELDS[target] !== undefined;
}

/**
 * Carrega os registros de um modulo de colecao.
 *
 * Um `switch` em vez de um mapa de tabelas pelo mesmo motivo da reversao da
 * importacao: cada tabela do Drizzle tem tipo proprio, e unifica-las exigiria
 * apagar os tipos com conversao forcada.
 */
export async function loadCollection(
  db: Database,
  input: { tenantId: string; siteId: string; target: SyncTarget },
): Promise<CollectionIndex> {
  const vazio: CollectionIndex = { byLabel: new Map(), byId: new Map() };
  const campos = COMPARED_FIELDS[input.target];
  const campoRotulo = LABEL_FIELD[input.target];
  if (!campos || !campoRotulo) return vazio;

  const linhas = await selecionar(db, input);
  const indice: CollectionIndex = { byLabel: new Map(), byId: new Map() };
  const campoImagem = IMAGE_FIELD[input.target];

  for (const linha of linhas) {
    const registro = linha as Record<string, unknown>;
    const id = String(registro['id'] ?? '');
    if (id === '') continue;

    const value: Record<string, unknown> = {};
    for (const campo of campos) {
      const bruto = registro[campo];
      // `price` vem como texto do Postgres (numeric); a origem produz numero.
      value[campo] = campo === 'price' && typeof bruto === 'string' ? Number(bruto) : bruto;
    }

    const entrada = {
      id,
      value,
      imageId: campoImagem ? ((registro[campoImagem] as string | null) ?? null) : null,
    };
    indice.byId.set(id, entrada);

    const rotulo = String(registro[campoRotulo] ?? '');
    if (rotulo !== '') indice.byLabel.set(chaveDeRotulo(rotulo), entrada);
  }

  return indice;
}

/** Mesma normalizacao de `normalizeKeyText`, para as chaves baterem. */
function chaveDeRotulo(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

async function selecionar(
  db: Database,
  input: { tenantId: string; siteId: string; target: SyncTarget },
): Promise<unknown[]> {
  const { tenantId, siteId } = input;
  switch (input.target) {
    case 'servicos':
      return db
        .select()
        .from(schema.services)
        .where(and(eq(schema.services.tenantId, tenantId), eq(schema.services.siteId, siteId)));
    case 'produtos':
      return db
        .select()
        .from(schema.products)
        .where(and(eq(schema.products.tenantId, tenantId), eq(schema.products.siteId, siteId)));
    case 'obras':
      return db
        .select()
        .from(schema.projects)
        .where(and(eq(schema.projects.tenantId, tenantId), eq(schema.projects.siteId, siteId)));
    case 'imoveis':
      return db
        .select()
        .from(schema.properties)
        .where(and(eq(schema.properties.tenantId, tenantId), eq(schema.properties.siteId, siteId)));
    case 'banners':
      return db
        .select()
        .from(schema.banners)
        .where(and(eq(schema.banners.tenantId, tenantId), eq(schema.banners.siteId, siteId)));
    case 'galerias':
      return db
        .select()
        .from(schema.galleries)
        .where(and(eq(schema.galleries.tenantId, tenantId), eq(schema.galleries.siteId, siteId)));
    case 'depoimentos':
      return db
        .select()
        .from(schema.testimonials)
        .where(and(eq(schema.testimonials.tenantId, tenantId), eq(schema.testimonials.siteId, siteId)));
    case 'equipe':
      return db
        .select()
        .from(schema.teamMembers)
        .where(and(eq(schema.teamMembers.tenantId, tenantId), eq(schema.teamMembers.siteId, siteId)));
    case 'faq':
      return db
        .select()
        .from(schema.faqs)
        .where(and(eq(schema.faqs.tenantId, tenantId), eq(schema.faqs.siteId, siteId)));
    default:
      return [];
  }
}

/** Endereco publico de varias imagens da biblioteca, de uma vez. */
export async function loadMediaUrls(
  db: Database,
  input: { tenantId: string; ids: readonly string[] },
): Promise<Map<string, string>> {
  const unicos = [...new Set(input.ids.filter((id) => id !== ''))];
  const mapa = new Map<string, string>();
  if (unicos.length === 0) return mapa;

  const rows = await db
    .select({ id: schema.mediaAssets.id, url: schema.mediaAssets.blobUrl })
    .from(schema.mediaAssets)
    .where(
      and(eq(schema.mediaAssets.tenantId, input.tenantId), inArray(schema.mediaAssets.id, unicos)),
    );

  for (const row of rows) mapa.set(row.id, row.url);
  return mapa;
}

/** Arquivo da biblioteca que veio de um endereco da origem, se houver. */
export async function findImportedMedia(
  db: Database,
  input: { tenantId: string; sourceUrls: readonly string[] },
): Promise<Map<string, { mediaId: string; url: string; hash: string }>> {
  const mapa = new Map<string, { mediaId: string; url: string; hash: string }>();
  if (input.sourceUrls.length === 0) return mapa;

  /**
   * A ponte entre a origem e a biblioteca passa pelos candidatos da
   * importacao: e la que ficou guardado "este arquivo veio daquele endereco",
   * junto do resumo do conteudo. Sem isso nao daria para dizer se a imagem do
   * site mudou ou se apenas nunca foi importada.
   */
  const rows = await db
    .select({
      value: schema.siteImportItems.value,
      createdEntityId: schema.siteImportItems.createdEntityId,
    })
    .from(schema.siteImportItems)
    .where(
      and(
        eq(schema.siteImportItems.tenantId, input.tenantId),
        eq(schema.siteImportItems.kind, 'imagem'),
        eq(schema.siteImportItems.outcome, 'importado'),
      ),
    );

  const procurados = new Set(input.sourceUrls);
  const porId = new Map<string, { url: string; hash: string }>();
  for (const row of rows) {
    const payload = row.value as { url?: string; hash?: string } | null;
    const url = payload?.url ?? '';
    if (url === '' || !procurados.has(url) || row.createdEntityId === null) continue;
    porId.set(row.createdEntityId, { url, hash: payload?.hash ?? '' });
  }

  if (porId.size === 0) return mapa;
  const urls = await loadMediaUrls(db, { tenantId: input.tenantId, ids: [...porId.keys()] });

  for (const [mediaId, info] of porId) {
    const blobUrl = urls.get(mediaId);
    // Arquivo apagado da biblioteca depois: nao serve como lado da comparacao.
    if (blobUrl === undefined) continue;
    mapa.set(info.url, { mediaId, url: blobUrl, hash: info.hash });
  }

  return mapa;
}
