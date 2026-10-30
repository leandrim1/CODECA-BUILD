import { and, asc, desc, eq, gte, ilike, inArray, lte, or, schema, sql } from '@codeca/database';
import {
  AppError,
  DOCUMENT_SCHEMAS,
  MODULE_REGISTRY,
  isModuleKey,
  publicLeadSchema,
  publicListQuerySchema,
  publicProjectQuerySchema,
  publicPropertyQuerySchema,
  type DocumentModuleKey,
  type ModuleKey,
} from '@codeca/shared';
import { hashIp } from '@codeca/shared/server';
import { Hono } from 'hono';
import { z } from 'zod';
import { clientIp, created, ok, parseJsonBody, parseParams, parseQuery, userAgent } from '../lib/http.js';
import { RATE_LIMITS, enforceRateLimit, rateLimitSubjectFromIp } from '../lib/ratelimit.js';
import { assertScope } from '../lib/integration/keys.js';
import {
  loadGallery,
  loadMedia,
  toPublicBanner,
  toPublicProject,
  toPublicProperty,
  toPublicService,
} from '../lib/integration/public-view.js';
import { enabledModuleKeys, loadSiteModules } from '../lib/modules.js';
import { apiKeyMiddleware } from '../middleware/api-key.js';
import { enforcePublicSuspension } from '../middleware/suspension.js';
import type { AppBindings } from '../types.js';

/**
 * API publica consumida pelos sites desenvolvidos pela CODECA IA.
 *
 * Versionada em `/v1` desde a primeira rota: o site do cliente e codigo que
 * nao controlamos de perto, e quebrar o contrato quebra o site dele.
 *
 * O conteudo em si chega na proxima etapa. O que existe aqui ja prova o
 * caminho inteiro: credencial conferida, origem autorizada e escopo aplicado.
 */


const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(200) });
const moduleParamSchema = z.object({ moduleKey: z.string().trim().min(1).max(60) });

/**
 * Modulo habilitado para este site, ou 404.
 *
 * 404 e nao 403 de proposito: para quem le o site, um modulo que o projeto
 * dele nao tem simplesmente nao existe. Dizer "proibido" revelaria que a rota
 * existe em outros sites.
 */
async function assertModulo(
  db: Parameters<typeof loadSiteModules>[0],
  siteId: string,
  moduleKey: ModuleKey,
): Promise<void> {
  const state = await loadSiteModules(db, siteId);
  if (!enabledModuleKeys(state).includes(moduleKey)) {
    throw AppError.notFound('Recurso nao disponivel para este site.');
  }
}

/**
 * Inclui rascunhos somente quando a credencial tem escopo para isso.
 *
 * Pedir previa com chave publicavel nao e um engano a tolerar em silencio:
 * seria conteudo nao publicado chegando ao navegador de um visitante.
 */
function assertPreview(scopes: readonly string[], preview: boolean): boolean {
  if (!preview) return false;
  if (!scopes.includes('content:draft')) {
    throw AppError.forbidden('Esta credencial nao pode ler rascunhos.');
  }
  return true;
}

/** Filtro de publicacao conforme a previa pedida. */
function publicacao<T extends { publicationStatus: unknown }>(
  coluna: T['publicationStatus'],
  preview: boolean,
) {
  return preview
    ? inArray(coluna as never, ['published', 'draft'] as never)
    : eq(coluna as never, 'published' as never);
}

function paginado<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function publicApiRoutes() {
  const app = new Hono<AppBindings>();

  /**
   * Preflight.
   *
   * O navegador envia o OPTIONS **sem** o cabecalho de autorizacao, entao nao
   * ha o que autenticar aqui. Responder de forma permissiva nao abre nada: a
   * requisicao real que vem depois passa pela conferencia completa, e sem ela
   * o navegador nao entrega resposta nenhuma a pagina.
   */
  app.options('/*', (c) => {
    const origin = c.req.header('origin');
    if (origin) {
      c.header('access-control-allow-origin', origin);
      c.header('vary', 'origin');
    }
    c.header('access-control-allow-methods', 'GET, POST, OPTIONS');
    c.header('access-control-allow-headers', 'authorization, content-type');
    c.header('access-control-max-age', '600');
    return c.body(null, 204);
  });

  app.use('/*', apiKeyMiddleware());
  // A politica de suspensao do plano decide se este site continua respondendo.
  app.use('/*', enforcePublicSuspension());

  /** Identidade do site e modulos disponiveis. E o `getSite()` do SDK. */
  app.get('/site', async (c) => {
    const ctx = c.get('ctx');
    const credencial = c.get('apiKey');

    const [site] = await ctx.db
      .select({
        id: schema.sites.id,
        name: schema.sites.name,
        slug: schema.sites.slug,
        status: schema.sites.status,
        segment: schema.segments.code,
      })
      .from(schema.sites)
      .leftJoin(schema.segments, eq(schema.segments.id, schema.sites.segmentId))
      .where(eq(schema.sites.id, credencial.siteId));

    const state = await loadSiteModules(ctx.db, credencial.siteId);

    return ok(c, {
      site,
      // Nomes e tipos dos modulos, sem a politica de campos: ela diz o que o
      // cliente pode editar no painel, e nao interessa a quem le o site.
      modules: enabledModuleKeys(state).map((key) => ({
        key,
        name: MODULE_REGISTRY[key].name,
        kind: MODULE_REGISTRY[key].kind,
      })),
      scopes: credencial.scopes,
      /**
       * Aviso que o site pode exibir ao visitante.
       *
       * `null` quando nao ha nada a avisar. O texto e neutro de proposito:
       * esta resposta chega ao navegador por uma chave publicavel, e o
       * visitante nao tem parte na pendencia nem deve saber dela.
       */
      notice: c.get('publicNotice') ?? null,
    });
  });

  // ------------------------------------------------------------ conteudo

  /** Institucional e contato: um documento por site. */
  app.get('/content/:moduleKey', async (c) => {
    const ctx = c.get('ctx');
    const credencial = c.get('apiKey');
    const { moduleKey } = parseParams(c, moduleParamSchema);

    if (!isModuleKey(moduleKey) || MODULE_REGISTRY[moduleKey].kind !== 'document') {
      throw AppError.notFound('Recurso nao disponivel para este site.');
    }
    await assertModulo(ctx.db, credencial.siteId, moduleKey);

    const [row] = await ctx.db
      .select({ data: schema.contentDocuments.data, updatedAt: schema.contentDocuments.updatedAt })
      .from(schema.contentDocuments)
      .where(
        and(
          eq(schema.contentDocuments.siteId, credencial.siteId),
          eq(schema.contentDocuments.moduleKey, moduleKey),
        ),
      );

    const key = moduleKey as DocumentModuleKey;
    return ok(c, {
      moduleKey: key,
      // Validado tambem na leitura: o documento pode ter sido gravado por uma
      // versao anterior do schema, e o site do cliente espera a forma atual.
      data: DOCUMENT_SCHEMAS[key].parse(row?.data ?? (key === 'institucional' ? { companyName: '' } : {})),
      updatedAt: row?.updatedAt ?? null,
    });
  });

  app.get('/banners', async (c) => {
    const ctx = c.get('ctx');
    const credencial = c.get('apiKey');
    await assertModulo(ctx.db, credencial.siteId, 'banners');

    const agora = ctx.now();
    const rows = await ctx.db
      .select()
      .from(schema.banners)
      .where(
        and(
          eq(schema.banners.siteId, credencial.siteId),
          eq(schema.banners.isActive, true),
          // A janela de exibicao vale aqui, nao na tela do painel: o banner
          // entra e sai sozinho, sem ninguem lembrar de desligar.
          or(sql`${schema.banners.startsAt} is null`, lte(schema.banners.startsAt, agora)),
          or(sql`${schema.banners.endsAt} is null`, gte(schema.banners.endsAt, agora)),
        ),
      )
      .orderBy(asc(schema.banners.sortOrder), asc(schema.banners.createdAt));

    const media = await loadMedia(ctx.db, credencial.tenantId, rows.map((r) => r.imageId));
    return ok(c, { items: rows.map((row) => toPublicBanner(row, media)) });
  });

  // -------------------------------------------------------------- imoveis

  app.get('/properties', async (c) => {
    const ctx = c.get('ctx');
    const credencial = c.get('apiKey');
    await assertModulo(ctx.db, credencial.siteId, 'imoveis');

    const query = parseQuery(c, publicPropertyQuerySchema);
    const preview = assertPreview(credencial.scopes, query.preview);

    const filtros = [
      eq(schema.properties.siteId, credencial.siteId),
      publicacao(schema.properties.publicationStatus, preview),
      sql`${schema.properties.archivedAt} is null`,
    ];
    if (query.purpose) filtros.push(eq(schema.properties.purpose, query.purpose));
    if (query.type) filtros.push(eq(schema.properties.type, query.type));
    if (query.featured !== undefined) filtros.push(eq(schema.properties.featured, query.featured));
    if (query.bedrooms !== undefined) filtros.push(gte(schema.properties.bedrooms, query.bedrooms));
    if (query.minPrice !== undefined) filtros.push(gte(schema.properties.price, query.minPrice));
    if (query.maxPrice !== undefined) filtros.push(lte(schema.properties.price, query.maxPrice));
    if (query.city) filtros.push(sql`${schema.properties.address}->>'city' ilike ${query.city}`);
    if (query.neighborhood) {
      filtros.push(sql`${schema.properties.address}->>'neighborhood' ilike ${query.neighborhood}`);
    }
    if (query.search) filtros.push(ilike(schema.properties.title, `%${query.search}%`));

    const where = and(...filtros);
    const rows = await ctx.db
      .select()
      .from(schema.properties)
      .where(where)
      .orderBy(desc(schema.properties.featured), asc(schema.properties.sortOrder), desc(schema.properties.publishedAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totais] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.properties)
      .where(where);

    // Na listagem vai so a capa: carregar a galeria de cada item seria dezenas
    // de imagens que a tela de listagem nao usa.
    const media = await loadMedia(ctx.db, credencial.tenantId, rows.map((r) => r.coverImageId));
    return ok(
      c,
      paginado(
        rows.map((row) => toPublicProperty(row, media)),
        totais?.total ?? 0,
        query.page,
        query.pageSize,
      ),
    );
  });

  app.get('/properties/:slug', async (c) => {
    const ctx = c.get('ctx');
    const credencial = c.get('apiKey');
    await assertModulo(ctx.db, credencial.siteId, 'imoveis');

    const { slug } = parseParams(c, slugParamSchema);
    const query = parseQuery(c, publicListQuerySchema);
    const preview = assertPreview(credencial.scopes, query.preview);

    const [row] = await ctx.db
      .select()
      .from(schema.properties)
      .where(
        and(
          eq(schema.properties.siteId, credencial.siteId),
          eq(schema.properties.slug, slug),
          publicacao(schema.properties.publicationStatus, preview),
          sql`${schema.properties.archivedAt} is null`,
        ),
      );
    if (!row) throw AppError.notFound('Imovel nao encontrado.');

    const galeria = await loadGallery(ctx.db, 'property', credencial.tenantId, row.id);
    const media = await loadMedia(ctx.db, credencial.tenantId, [row.coverImageId, ...galeria]);
    return ok(c, { property: toPublicProperty(row, media, galeria) });
  });

  // ---------------------------------------------------------------- obras

  app.get('/projects', async (c) => {
    const ctx = c.get('ctx');
    const credencial = c.get('apiKey');
    await assertModulo(ctx.db, credencial.siteId, 'obras');

    const query = parseQuery(c, publicProjectQuerySchema);
    const preview = assertPreview(credencial.scopes, query.preview);

    const filtros = [
      eq(schema.projects.siteId, credencial.siteId),
      publicacao(schema.projects.publicationStatus, preview),
      sql`${schema.projects.archivedAt} is null`,
    ];
    if (query.status) filtros.push(eq(schema.projects.status, query.status));
    if (query.category) filtros.push(eq(schema.projects.category, query.category));
    if (query.featured !== undefined) filtros.push(eq(schema.projects.featured, query.featured));
    if (query.city) filtros.push(ilike(schema.projects.city, query.city));
    if (query.search) filtros.push(ilike(schema.projects.title, `%${query.search}%`));

    const where = and(...filtros);
    const rows = await ctx.db
      .select()
      .from(schema.projects)
      .where(where)
      .orderBy(desc(schema.projects.featured), asc(schema.projects.sortOrder), desc(schema.projects.publishedAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totais] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.projects)
      .where(where);

    const media = await loadMedia(ctx.db, credencial.tenantId, rows.map((r) => r.coverImageId));
    return ok(
      c,
      paginado(
        rows.map((row) => toPublicProject(row, media)),
        totais?.total ?? 0,
        query.page,
        query.pageSize,
      ),
    );
  });

  app.get('/projects/:slug', async (c) => {
    const ctx = c.get('ctx');
    const credencial = c.get('apiKey');
    await assertModulo(ctx.db, credencial.siteId, 'obras');

    const { slug } = parseParams(c, slugParamSchema);
    const query = parseQuery(c, publicListQuerySchema);
    const preview = assertPreview(credencial.scopes, query.preview);

    const [row] = await ctx.db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.siteId, credencial.siteId),
          eq(schema.projects.slug, slug),
          publicacao(schema.projects.publicationStatus, preview),
          sql`${schema.projects.archivedAt} is null`,
        ),
      );
    if (!row) throw AppError.notFound('Obra nao encontrada.');

    const galeria = await loadGallery(ctx.db, 'project', credencial.tenantId, row.id);
    const media = await loadMedia(ctx.db, credencial.tenantId, [row.coverImageId, ...galeria]);
    return ok(c, { project: toPublicProject(row, media, galeria) });
  });

  // ------------------------------------------------------------- servicos

  app.get('/services', async (c) => {
    const ctx = c.get('ctx');
    const credencial = c.get('apiKey');
    await assertModulo(ctx.db, credencial.siteId, 'servicos');

    const query = parseQuery(c, publicListQuerySchema);
    const preview = assertPreview(credencial.scopes, query.preview);

    const where = and(
      eq(schema.services.siteId, credencial.siteId),
      publicacao(schema.services.publicationStatus, preview),
    );
    const rows = await ctx.db
      .select()
      .from(schema.services)
      .where(where)
      .orderBy(asc(schema.services.sortOrder), asc(schema.services.title))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [totais] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.services)
      .where(where);

    const media = await loadMedia(ctx.db, credencial.tenantId, rows.map((r) => r.imageId));
    return ok(
      c,
      paginado(
        rows.map((row) => toPublicService(row, media)),
        totais?.total ?? 0,
        query.page,
        query.pageSize,
      ),
    );
  });

  // --------------------------------------------------------- interessados

  /**
   * Formulario de contato do site.
   *
   * A unica escrita aceita com chave publicavel. O formulario roda no
   * navegador do visitante, entao nao ha segredo a guardar -- a protecao vem
   * da origem autorizada, do limite por IP e do campo-armadilha.
   *
   * Nada e devolvido alem da confirmacao: quem envia nao consegue listar, e
   * uma resposta com o registro criado viraria um caminho para ler dado
   * pessoal de terceiros.
   */
  app.post('/leads', async (c) => {
    const ctx = c.get('ctx');
    const credencial = c.get('apiKey');
    assertScope(credencial, 'leads:write');

    const ip = clientIp(c);
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.publicLead,
      rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET),
      ctx.now(),
    );
    await enforceRateLimit(
      ctx.db,
      RATE_LIMITS.publicLeadDaily,
      rateLimitSubjectFromIp(ip, ctx.env.AUTH_SECRET),
      ctx.now(),
    );

    const input = await parseJsonBody(c, publicLeadSchema);

    // Campo oculto preenchido: envio automatizado. Respondemos como sucesso
    // para nao ensinar o robo a contornar a armadilha, e nao gravamos nada.
    if (input.honeypot) return created(c, { received: true });

    // Os vinculos vem do visitante: conferir que pertencem a este site impede
    // que um id de outra empresa seja anexado ao interessado.
    const propertyId = await idDoSite(ctx.db, schema.properties, credencial.siteId, input.propertyId);
    const projectId = await idDoSite(ctx.db, schema.projects, credencial.siteId, input.projectId);
    const serviceId = await idDoSite(ctx.db, schema.services, credencial.siteId, input.serviceId);

    await ctx.db.insert(schema.leads).values({
      tenantId: credencial.tenantId,
      siteId: credencial.siteId,
      name: input.name,
      phone: input.phone,
      email: input.email,
      interestType: input.interestType,
      message: input.message,
      propertyId,
      projectId,
      serviceId,
      sourcePath: input.sourcePath,
      consentAt: ctx.now(),
      // So o hash do IP: permite limitar e auditar sem guardar o endereco.
      ipHash: hashIp(ip, ctx.env.AUTH_SECRET),
      userAgent: userAgent(c),
    });

    return created(c, { received: true });
  });

  return app;
}

/** Devolve o id apenas se o registro pertencer a este site. */
async function idDoSite(
  db: Parameters<typeof loadSiteModules>[0],
  tabela: typeof schema.properties | typeof schema.projects | typeof schema.services,
  siteId: string,
  id: string | null,
): Promise<string | null> {
  if (!id) return null;
  const [row] = await db
    .select({ id: tabela.id })
    .from(tabela)
    .where(and(eq(tabela.id, id), eq(tabela.siteId, siteId)));
  return row?.id ?? null;
}
