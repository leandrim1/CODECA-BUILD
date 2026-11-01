import { and, asc, desc, eq, inArray, provisionSiteModules, schema, type Database } from '@codeca/database';
import {
  API_KEY_KINDS,
  API_KEY_SCOPES,
  AppError,
  MAX_CUSTOM_FIELDS_PER_MODULE,
  MODULE_KEYS,
  MODULE_REGISTRY,
  SITE_STATUSES,
  customFieldDefinitionSchema,
  isModuleKey,
  maskApiKey,
  normalizeOrigin,
  uuidSchema,
  type ModuleKey,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { created, noContent, ok, parseJsonBody, parseParams } from '../lib/http.js';
import { issueApiKey, revokeApiKeyById, rotateApiKey } from '../lib/integration/keys.js';
import { generateWebhookSecret } from '@codeca/shared/server';
import { customFieldsOf, loadSiteModules } from '../lib/modules.js';
import { listDeliveries } from '../lib/integration/outbound.js';
import { requireAuth, requirePlatform, sessionOf } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Configuracao dos sites pelo painel mestre.
 *
 * E aqui que a CODECA IA diz o que cada projeto tem: quais modulos o cliente
 * enxerga e quais campos ele pode mexer. A permissao reaproveita
 * `platform:tenants:*` -- configurar um site e administrar a empresa dona
 * dele, e um papel novo so para isto separaria o que na pratica anda junto.
 */

const siteParamSchema = z.object({ siteId: uuidSchema });

const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(160),
  status: z.enum(SITE_STATUSES),
  internalNotes: z.string().trim().max(4_000).default(''),
  /**
   * Segmento do projeto. `null` desvincula.
   *
   * Trocar aqui **nao** mexe nos modulos do site: o segmento e o ponto de
   * partida de um projeto novo, e um site ja configurado pode ter sido
   * ajustado a mao. Aplicar o conjunto do segmento e um pedido separado.
   */
  segmentId: uuidSchema.nullable().default(null),
});

const keyParamSchema = z.object({ siteId: uuidSchema, keyId: uuidSchema });

const createKeySchema = z.object({
  kind: z.enum(API_KEY_KINDS),
  name: z.string().trim().max(120).default(''),
  /** Vazio usa o padrao do tipo. */
  scopes: z.array(z.enum(API_KEY_SCOPES)).default([]),
});

const rotateKeySchema = z.object({
  /** Quanto tempo a chave antiga continua valendo. Ate uma semana. */
  graceMinutes: z.number().int().min(0).max(10_080).default(60),
});

const originsSchema = z.object({
  origins: z
    .array(z.object({ origin: z.string().trim().min(1).max(240), note: z.string().trim().max(240).default('') }))
    .max(25),
});

/**
 * Endereco que recebe os avisos de publicacao.
 *
 * `https` obrigatorio, com uma excecao para `localhost`: o aviso vai assinado
 * mas o corpo viaja em claro, e um site de cliente em producao nao deveria
 * receber nada por HTTP. A excecao existe para integrar durante o
 * desenvolvimento, quando nao ha certificado.
 */
const webhookSchema = z.object({
  url: z
    .string()
    .trim()
    .url('Informe o endereco completo, como https://exemplo.com.br/api/revalidar.')
    .max(500)
    .refine(
      (valor) => {
        try {
          const url = new URL(valor);
          if (url.protocol === 'https:') return true;
          return url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
        } catch {
          return false;
        }
      },
      { message: 'Use https. Somente localhost pode usar http, para desenvolvimento.' },
    ),
  description: z.string().trim().max(240).default(''),
  isActive: z.boolean().default(true),
});

const webhookParamSchema = z.object({ siteId: uuidSchema, webhookId: uuidSchema });

const configureModulesSchema = z.object({
  modules: z
    .array(
      z.object({
        key: z.enum(MODULE_KEYS),
        enabled: z.boolean(),
        settings: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(MODULE_KEYS.length),
  fieldPolicies: z
    .array(
      z.object({
        moduleKey: z.enum(MODULE_KEYS),
        fieldKey: z.string().trim().min(1).max(80),
        editable: z.boolean(),
        note: z.string().trim().max(240).default(''),
      }),
    )
    .max(400)
    .default([]),
});

/** Recusa um segmento inexistente antes de apontar o site para ele. */
async function assertSegmentoExiste(db: Database, segmentId: string): Promise<void> {
  const [row] = await db
    .select({ id: schema.segments.id })
    .from(schema.segments)
    .where(eq(schema.segments.id, segmentId));
  if (!row) throw AppError.notFound('Segmento nao encontrado.');
}

/** Carrega o site garantindo que ele existe antes de qualquer escrita. */
async function loadSite(db: Parameters<typeof loadSiteModules>[0], siteId: string) {
  const [site] = await db
    .select({
      id: schema.sites.id,
      tenantId: schema.sites.tenantId,
      name: schema.sites.name,
      slug: schema.sites.slug,
      status: schema.sites.status,
      isPrimary: schema.sites.isPrimary,
      internalNotes: schema.sites.internalNotes,
      segmentId: schema.sites.segmentId,
    })
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId));
  if (!site) throw AppError.notFound('Site nao encontrado.');
  return site;
}

export function platformSiteRoutes() {
  const app = new Hono<AppBindings>();
  app.use('*', requireAuth());

  app.get('/sites', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const rows = await ctx.db
      .select({
        id: schema.sites.id,
        name: schema.sites.name,
        slug: schema.sites.slug,
        status: schema.sites.status,
        isPrimary: schema.sites.isPrimary,
        tenantId: schema.sites.tenantId,
        tenantName: schema.tenants.displayName,
        segment: schema.segments.code,
        createdAt: schema.sites.createdAt,
      })
      .from(schema.sites)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.sites.tenantId))
      .leftJoin(schema.segments, eq(schema.segments.id, schema.sites.segmentId))
      .orderBy(desc(schema.sites.createdAt));

    return ok(c, { items: rows });
  });

  app.get('/sites/:siteId', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    const site = await loadSite(ctx.db, siteId);
    const state = await loadSiteModules(ctx.db, siteId);
    return ok(c, { site, modules: state.modules });
  });

  app.patch('/sites/:siteId', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    const site = await loadSite(ctx.db, siteId);
    const input = await parseJsonBody(c, updateSiteSchema);

    if (input.segmentId !== null) await assertSegmentoExiste(ctx.db, input.segmentId);

    const [row] = await ctx.db
      .update(schema.sites)
      .set({ ...input, updatedAt: ctx.now() })
      .where(eq(schema.sites.id, siteId))
      .returning();

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteUpdated,
      entityType: 'site',
      entityId: siteId,
      tenantId: site.tenantId,
      metadata: {
        status: input.status,
        segmentId: input.segmentId,
        // A trilha diz explicitamente que trocar o segmento nao reconfigurou
        // o site: sem isto, quem le a auditoria depois teria de adivinhar.
        modulesChanged: false,
      },
    });

    return ok(c, { site: row ?? null });
  });

  /**
   * Aplica ao site o conjunto de modulos do segmento dele.
   *
   * Existe separado da troca de segmento de proposito. Reconfigurar um site
   * em producao pode esconder do cliente uma tela que ele usa hoje, e isso
   * nao pode acontecer como efeito colateral de corrigir a classificacao do
   * projeto. Aqui e um ato deliberado, com auditoria propria.
   *
   * **Nao desliga nada.** Habilita o que o segmento traz e deixa de fora o
   * resto: desligar modulos em uso e uma decisao site a site, na tela de
   * modulos, onde quem decide ve o que esta ligado.
   */
  app.post('/sites/:siteId/apply-segment', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    const site = await loadSite(ctx.db, siteId);

    if (!site.segmentId) {
      throw AppError.badRequest('Este site nao tem segmento. Escolha um antes de aplicar.');
    }

    const [segmento] = await ctx.db
      .select({
        code: schema.segments.code,
        name: schema.segments.name,
        defaultModules: schema.segments.defaultModules,
      })
      .from(schema.segments)
      .where(eq(schema.segments.id, site.segmentId));
    if (!segmento) throw AppError.notFound('Segmento nao encontrado.');

    const doSegmento = (segmento.defaultModules ?? []).filter(isModuleKey);
    if (doSegmento.length === 0) {
      throw AppError.badRequest(
        `O segmento ${segmento.name} nao tem nenhum modulo padrao definido.`,
      );
    }

    const antes = await loadSiteModules(ctx.db, siteId);
    const jaLigados = new Set(antes.modules.filter((m) => m.enabled).map((m) => m.key));
    const ligados = doSegmento.filter((key) => !jaLigados.has(key));

    if (ligados.length > 0) {
      // Reaproveita o provisionamento do cadastro: ele tambem cria os
      // documentos de instancia unica ja preenchidos, que e o que falta para
      // o modulo recem-ligado nao abrir vazio.
      await provisionSiteModules(ctx.db, {
        tenantId: site.tenantId,
        siteId,
        moduleKeys: ligados,
        companyName: site.name,
      });
      await ctx.db
        .update(schema.siteModules)
        .set({ enabled: true, updatedAt: ctx.now() })
        .where(
          and(
            eq(schema.siteModules.siteId, siteId),
            inArray(schema.siteModules.moduleKey, ligados),
          ),
        );
    }

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteSegmentApplied,
      entityType: 'site',
      entityId: siteId,
      tenantId: site.tenantId,
      metadata: { segment: segmento.code, enabled: ligados, alreadyEnabled: [...jaLigados] },
    });

    const depois = await loadSiteModules(ctx.db, siteId);
    return ok(c, { segment: segmento.code, enabled: ligados, modules: depois.modules });
  });

  /**
   * Define os modulos e a politica de campos do site.
   *
   * As duas partes se comportam de forma diferente, e vale ser exato:
   *
   * - **Modulos**: grava os que vierem no corpo e nao toca nos demais. A tela
   *   do painel mestre envia todos, mas a rota nao desliga por omissao -- um
   *   corpo incompleto desligaria modulos em uso em silencio, e um modulo
   *   acrescentado ao registro depois nao deve sumir de quem ja o tem.
   * - **Politica de campos**: substitui o conjunto inteiro. Aplicar diferencas
   *   faria duas edicoes simultaneas se mesclarem num estado que ninguem
   *   escolheu. Apenas as excecoes ao padrao do registro sao gravadas.
   */
  app.put('/sites/:siteId/modules', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    const site = await loadSite(ctx.db, siteId);
    const input = await parseJsonBody(c, configureModulesSchema);

    /**
     * O padrao de cada campo, para saber o que e excecao.
     *
     * Precisa considerar os campos personalizados do site: eles entram na
     * mesma lista que a tela desenha, entao a tela os reenvia junto com os do
     * registro. Recusa-los faria esta rota falhar em todo site que tivesse um
     * campo personalizado -- e ela e a rota que liga e desliga modulos.
     *
     * O padrao de um campo personalizado e o `editable` da definicao dele;
     * uma excecao gravada aqui prevalece, como ja acontece com o registro.
     */
    const estadoAtual = await loadSiteModules(ctx.db, siteId);
    const padraoDoCampo = (moduleKey: ModuleKey, fieldKey: string): boolean | undefined => {
      const doRegistro = MODULE_REGISTRY[moduleKey].fields.find((f) => f.key === fieldKey);
      if (doRegistro) return doRegistro.editableByDefault;
      const personalizado = customFieldsOf(estadoAtual, moduleKey).find(
        (campo) => campo.fieldKey === fieldKey,
      );
      return personalizado?.editable;
    };

    for (const politica of input.fieldPolicies) {
      if (padraoDoCampo(politica.moduleKey, politica.fieldKey) === undefined) {
        throw AppError.badRequest(
          `O campo ${politica.fieldKey} nao existe no modulo ${MODULE_REGISTRY[politica.moduleKey].name}.`,
        );
      }
    }

    await ctx.db.transaction(async (tx) => {
      for (const modulo of input.modules) {
        await tx
          .insert(schema.siteModules)
          .values({
            tenantId: site.tenantId,
            siteId,
            moduleKey: modulo.key,
            enabled: modulo.enabled,
            settings: modulo.settings,
          })
          .onConflictDoUpdate({
            target: [schema.siteModules.siteId, schema.siteModules.moduleKey],
            set: { enabled: modulo.enabled, settings: modulo.settings, updatedAt: ctx.now() },
          });
      }

      await tx.delete(schema.siteFieldPolicies).where(eq(schema.siteFieldPolicies.siteId, siteId));

      // So gravamos o que difere do padrao do registro: repetir o padrao
      // congelaria os campos de hoje e esconderia os que vierem depois.
      const excecoes = input.fieldPolicies.filter((politica) => {
        const padrao = padraoDoCampo(politica.moduleKey, politica.fieldKey);
        return padrao !== undefined && padrao !== politica.editable;
      });

      if (excecoes.length > 0) {
        await tx.insert(schema.siteFieldPolicies).values(
          excecoes.map((politica) => ({
            tenantId: site.tenantId,
            siteId,
            moduleKey: politica.moduleKey,
            fieldKey: politica.fieldKey,
            editable: politica.editable,
            note: politica.note,
          })),
        );
      }
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteModulesConfigured,
      entityType: 'site_modules',
      entityId: siteId,
      tenantId: site.tenantId,
      metadata: {
        enabled: input.modules.filter((m) => m.enabled).map((m) => m.key),
        excecoes: input.fieldPolicies.length,
      },
    });

    const depois = await loadSiteModules(ctx.db, siteId);
    return ok(c, { modules: depois.modules });
  });

  // ------------------------------------------------- credenciais do site

  // ------------------------------------------------- campos personalizados

  /**
   * Campos que a CODECA IA definiu para este site.
   *
   * Substitui o conjunto **de um modulo**, nao de todos: a tela do painel
   * mestre edita um modulo por vez, e um corpo que trouxesse todos os modulos
   * faria duas edicoes simultaneas apagarem uma a outra.
   */
  app.get('/sites/:siteId/custom-fields', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    await loadSite(ctx.db, siteId);

    const linhas = await ctx.db
      .select()
      .from(schema.siteCustomFields)
      .where(eq(schema.siteCustomFields.siteId, siteId))
      .orderBy(asc(schema.siteCustomFields.moduleKey), asc(schema.siteCustomFields.sortOrder));

    return ok(c, {
      items: linhas.map((linha) => ({
        moduleKey: linha.moduleKey,
        fieldKey: linha.fieldKey,
        label: linha.label,
        type: linha.type,
        required: linha.required,
        help: linha.help,
        options: linha.options ?? [],
        editable: linha.editable,
        sortOrder: linha.sortOrder,
      })),
    });
  });

  app.put(
    '/sites/:siteId/custom-fields/:moduleKey',
    requirePlatform('platform:tenants:write'),
    async (c) => {
      const ctx = c.get('ctx');
      const { siteId, moduleKey } = parseParams(
        c,
        z.object({ siteId: uuidSchema, moduleKey: z.string().trim().min(1) }),
      );
      const site = await loadSite(ctx.db, siteId);

      if (!isModuleKey(moduleKey)) throw AppError.notFound('Modulo nao encontrado.');
      const definicaoModulo = MODULE_REGISTRY[moduleKey];

      /**
       * Modulo que nao aceita campo personalizado e recusado aqui, no servidor.
       *
       * A tela do painel mestre so oferece os modulos que declaram
       * `customFields`, mas esconder nao e proteger: sem esta conferencia,
       * uma chamada direta definiria campo em `faq` ou `galerias` -- e o campo
       * ficaria gravado sem nenhum formulario que o mostrasse, porque esses
       * modulos nao passam os valores pelo caminho dos personalizados.
       */
      if (definicaoModulo.customFields !== true) {
        throw AppError.badRequest(
          `O modulo ${definicaoModulo.name} nao aceita campos personalizados.`,
        );
      }

      const input = await parseJsonBody(
        c,
        z.object({
          fields: z.array(customFieldDefinitionSchema).max(MAX_CUSTOM_FIELDS_PER_MODULE),
        }),
      );

      /**
       * Chave que ja existe no registro e recusada.
       *
       * Sem isto o formulario mostraria dois campos chamados "Titulo", um
       * gravando na coluna e outro no JSONB -- e o cliente nao teria como
       * saber qual dos dois o site le.
       */
      const doRegistro = new Set(definicaoModulo.fields.map((campo) => campo.key));
      for (const campo of input.fields) {
        if (doRegistro.has(campo.fieldKey)) {
          throw AppError.conflict(
            `O modulo ${definicaoModulo.name} ja tem um campo \`${campo.fieldKey}\`. `
              + 'Escolha outra chave para o campo personalizado.',
          );
        }
      }

      const repetidas = input.fields
        .map((campo) => campo.fieldKey)
        .filter((chave, indice, lista) => lista.indexOf(chave) !== indice);
      if (repetidas.length > 0) {
        throw AppError.badRequest(`Chave repetida: ${[...new Set(repetidas)].join(', ')}.`);
      }

      await ctx.db.transaction(async (tx) => {
        /**
         * Apaga e reinsere as **definicoes**, nunca os valores.
         *
         * Um campo removido aqui deixa de aparecer no painel e na API publica,
         * mas o que o cliente ja escreveu continua no JSONB do registro. Nao e
         * descuido: nenhum caminho desta plataforma apaga conteudo de cliente,
         * e redefinir o campo com a mesma chave traz os valores de volta.
         */
        await tx
          .delete(schema.siteCustomFields)
          .where(
            and(
              eq(schema.siteCustomFields.siteId, siteId),
              eq(schema.siteCustomFields.moduleKey, moduleKey),
            ),
          );

        if (input.fields.length > 0) {
          await tx.insert(schema.siteCustomFields).values(
            input.fields.map((campo, indice) => ({
              tenantId: site.tenantId,
              siteId,
              moduleKey,
              fieldKey: campo.fieldKey,
              label: campo.label,
              type: campo.type,
              required: campo.required,
              help: campo.help,
              options: campo.options,
              editable: campo.editable,
              sortOrder: campo.sortOrder || indice,
            })),
          );
        }
      });

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.siteCustomFieldsConfigured,
        entityType: 'site_custom_fields',
        entityId: siteId,
        tenantId: site.tenantId,
        metadata: {
          moduleKey,
          fields: input.fields.map((campo) => campo.fieldKey),
          // A trilha diz explicitamente que valor nenhum foi tocado.
          valuesDeleted: false,
        },
      });

      const estado = await loadSiteModules(ctx.db, siteId);
      return ok(c, { modules: estado.modules });
    },
  );

  app.get('/sites/:siteId/keys', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    await loadSite(ctx.db, siteId);

    const rows = await ctx.db
      .select()
      .from(schema.siteApiKeys)
      .where(eq(schema.siteApiKeys.siteId, siteId))
      .orderBy(desc(schema.siteApiKeys.createdAt));

    return ok(c, {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        scopes: row.scopes,
        // A publicavel aparece inteira: ela precisa ser copiada para o codigo
        // do site. Da secreta so resta a mascara -- o valor existiu uma vez.
        token: row.kind === 'publishable' ? row.token : maskApiKey(row.kind, row.lookup),
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
      })),
    });
  });

  app.post('/sites/:siteId/keys', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const { siteId } = parseParams(c, siteParamSchema);
    const site = await loadSite(ctx.db, siteId);
    const input = await parseJsonBody(c, createKeySchema);

    const emitida = await issueApiKey(ctx.db, {
      tenantId: site.tenantId,
      siteId,
      kind: input.kind,
      name: input.name,
      ...(input.scopes.length > 0 ? { scopes: input.scopes } : {}),
      createdByUserId: session.user.id,
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteKeyIssued,
      entityType: 'site_api_key',
      entityId: emitida.id,
      tenantId: site.tenantId,
      // Nunca o token: o log de auditoria e consultavel.
      metadata: { kind: emitida.kind, scopes: emitida.scopes },
    });

    return created(c, {
      key: {
        id: emitida.id,
        kind: emitida.kind,
        scopes: emitida.scopes,
        token: emitida.token,
      },
      // A secreta nao pode ser consultada depois; a publicavel sim.
      showOnce: emitida.kind === 'secret',
    });
  });

  app.post('/sites/:siteId/keys/:keyId/rotate', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId, keyId } = parseParams(c, keyParamSchema);
    const site = await loadSite(ctx.db, siteId);
    const input = await parseJsonBody(c, rotateKeySchema);

    const [atual] = await ctx.db
      .select({ id: schema.siteApiKeys.id })
      .from(schema.siteApiKeys)
      .where(and(eq(schema.siteApiKeys.id, keyId), eq(schema.siteApiKeys.siteId, siteId)));
    if (!atual) throw AppError.notFound('Chave nao encontrada.');

    const nova = await rotateApiKey(ctx.db, keyId, input.graceMinutes, ctx.now());

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteKeyRotated,
      entityType: 'site_api_key',
      entityId: nova.id,
      tenantId: site.tenantId,
      metadata: { rotatedFrom: keyId, graceMinutes: input.graceMinutes },
    });

    return ok(c, {
      key: { id: nova.id, kind: nova.kind, scopes: nova.scopes, token: nova.token },
      showOnce: nova.kind === 'secret',
      previousValidUntilMinutes: input.graceMinutes,
    });
  });

  app.delete('/sites/:siteId/keys/:keyId', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId, keyId } = parseParams(c, keyParamSchema);
    const site = await loadSite(ctx.db, siteId);

    const revogada = await revokeApiKeyById(ctx.db, siteId, keyId, ctx.now());
    if (!revogada) throw AppError.notFound('Chave nao encontrada.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteKeyRevoked,
      entityType: 'site_api_key',
      entityId: keyId,
      tenantId: site.tenantId,
      metadata: { revoked: true },
    });

    return noContent(c);
  });

  // ---------------------------------------------- origens autorizadas

  app.get('/sites/:siteId/origins', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    await loadSite(ctx.db, siteId);

    const rows = await ctx.db
      .select()
      .from(schema.siteOrigins)
      .where(eq(schema.siteOrigins.siteId, siteId));

    return ok(c, { items: rows });
  });

  /** Substitui o conjunto inteiro, pelo mesmo motivo dos modulos. */
  app.put('/sites/:siteId/origins', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    const site = await loadSite(ctx.db, siteId);
    const input = await parseJsonBody(c, originsSchema);

    const normalizadas: Array<{ origin: string; note: string }> = [];
    for (const entrada of input.origins) {
      const origin = normalizeOrigin(entrada.origin);
      if (!origin) {
        throw AppError.badRequest(
          `Endereco invalido: ${entrada.origin}. Informe o endereco completo do site, como https://exemplo.com.br.`,
        );
      }
      if (!normalizadas.some((o) => o.origin === origin)) {
        normalizadas.push({ origin, note: entrada.note });
      }
    }

    await ctx.db.transaction(async (tx) => {
      await tx.delete(schema.siteOrigins).where(eq(schema.siteOrigins.siteId, siteId));
      if (normalizadas.length > 0) {
        await tx.insert(schema.siteOrigins).values(
          normalizadas.map((o) => ({
            tenantId: site.tenantId,
            siteId,
            origin: o.origin,
            note: o.note,
          })),
        );
      }
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteOriginsUpdated,
      entityType: 'site_origins',
      entityId: siteId,
      tenantId: site.tenantId,
      metadata: { origins: normalizadas.map((o) => o.origin) },
    });

    return ok(c, { items: normalizadas });
  });

  // ------------------------------------------- avisos de publicacao

  /**
   * Enderecos cadastrados e as ultimas entregas.
   *
   * O segredo **nao** aparece: assinar exige guarda-lo em claro, e a
   * contrapartida e que ele nunca e lido de volta. Quem perdeu o valor
   * rotaciona.
   */
  app.get('/sites/:siteId/webhooks', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId } = parseParams(c, siteParamSchema);
    await loadSite(ctx.db, siteId);

    const rows = await ctx.db
      .select({
        id: schema.siteWebhooks.id,
        url: schema.siteWebhooks.url,
        description: schema.siteWebhooks.description,
        isActive: schema.siteWebhooks.isActive,
        lastStatus: schema.siteWebhooks.lastStatus,
        lastAttemptAt: schema.siteWebhooks.lastAttemptAt,
        lastError: schema.siteWebhooks.lastError,
        consecutiveFailures: schema.siteWebhooks.consecutiveFailures,
        createdAt: schema.siteWebhooks.createdAt,
      })
      .from(schema.siteWebhooks)
      .where(eq(schema.siteWebhooks.siteId, siteId))
      .orderBy(desc(schema.siteWebhooks.createdAt));

    return ok(c, { items: rows, deliveries: await listDeliveries(ctx.db, siteId) });
  });

  app.post('/sites/:siteId/webhooks', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const session = sessionOf(c);
    const { siteId } = parseParams(c, siteParamSchema);
    const site = await loadSite(ctx.db, siteId);
    const input = await parseJsonBody(c, webhookSchema);

    const secret = generateWebhookSecret();
    const [row] = await ctx.db
      .insert(schema.siteWebhooks)
      .values({
        tenantId: site.tenantId,
        siteId,
        url: input.url,
        description: input.description,
        secret,
        isActive: input.isActive,
        createdByUserId: session.user.id,
      })
      .onConflictDoNothing()
      .returning({ id: schema.siteWebhooks.id });

    if (!row) throw AppError.conflict('Este endereco ja esta cadastrado para o site.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteWebhookCreated,
      entityType: 'site_webhook',
      entityId: row.id,
      tenantId: site.tenantId,
      // Nunca o segredo: o log de auditoria e consultavel.
      metadata: { url: input.url, isActive: input.isActive },
    });

    return created(c, {
      webhook: { id: row.id, url: input.url },
      // Unica vez que o segredo aparece.
      secret,
      showOnce: true,
    });
  });

  app.patch('/sites/:siteId/webhooks/:webhookId', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId, webhookId } = parseParams(c, webhookParamSchema);
    const site = await loadSite(ctx.db, siteId);
    const input = await parseJsonBody(c, webhookSchema.partial());

    const [row] = await ctx.db
      .update(schema.siteWebhooks)
      .set({
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: ctx.now(),
      })
      .where(and(eq(schema.siteWebhooks.id, webhookId), eq(schema.siteWebhooks.siteId, siteId)))
      .returning({
        id: schema.siteWebhooks.id,
        url: schema.siteWebhooks.url,
        isActive: schema.siteWebhooks.isActive,
      });
    if (!row) throw AppError.notFound('Endereco nao encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteWebhookUpdated,
      entityType: 'site_webhook',
      entityId: webhookId,
      tenantId: site.tenantId,
      metadata: { url: row.url, isActive: row.isActive },
    });

    return ok(c, { webhook: row });
  });

  /** Rotaciona o segredo. O endereco continua o mesmo. */
  app.post(
    '/sites/:siteId/webhooks/:webhookId/rotate',
    requirePlatform('platform:tenants:write'),
    async (c) => {
      const ctx = c.get('ctx');
      const { siteId, webhookId } = parseParams(c, webhookParamSchema);
      const site = await loadSite(ctx.db, siteId);

      const secret = generateWebhookSecret();
      const [row] = await ctx.db
        .update(schema.siteWebhooks)
        .set({ secret, updatedAt: ctx.now() })
        .where(and(eq(schema.siteWebhooks.id, webhookId), eq(schema.siteWebhooks.siteId, siteId)))
        .returning({ id: schema.siteWebhooks.id, url: schema.siteWebhooks.url });
      if (!row) throw AppError.notFound('Endereco nao encontrado.');

      await auditFromContext(c, {
        action: AUDIT_ACTIONS.siteWebhookSecretRotated,
        entityType: 'site_webhook',
        entityId: webhookId,
        tenantId: site.tenantId,
        metadata: { url: row.url, rotated: true },
      });

      // Sem janela de sobreposicao, ao contrario das chaves de integracao: um
      // segredo de assinatura e conferido pelo site do cliente, e assinar com
      // dois ao mesmo tempo exigiria que ele aceitasse os dois. Trocar aqui e
      // publicar lá precisa ser combinado.
      return ok(c, { webhook: row, secret, showOnce: true });
    },
  );

  app.delete('/sites/:siteId/webhooks/:webhookId', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { siteId, webhookId } = parseParams(c, webhookParamSchema);
    const site = await loadSite(ctx.db, siteId);

    const removido = await ctx.db
      .delete(schema.siteWebhooks)
      .where(and(eq(schema.siteWebhooks.id, webhookId), eq(schema.siteWebhooks.siteId, siteId)))
      .returning({ id: schema.siteWebhooks.id });
    if (removido.length === 0) throw AppError.notFound('Endereco nao encontrado.');

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.siteWebhookDeleted,
      entityType: 'site_webhook',
      entityId: webhookId,
      tenantId: site.tenantId,
      metadata: { removed: true },
    });

    return noContent(c);
  });

  return app;
}

/** Chaves de modulo validas, para o painel mestre montar a tela. */
export const PLATFORM_MODULE_KEYS = MODULE_KEYS.filter(isModuleKey);
