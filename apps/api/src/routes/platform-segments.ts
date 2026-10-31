import { asc, eq, schema, sql, type Database, type Transaction } from '@codeca/database';
import {
  AppError,
  createSegmentSchema,
  isModuleKey,
  updateSegmentSchema,
  uuidSchema,
  type ModuleKey,
  type SegmentView,
} from '@codeca/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUDIT_ACTIONS } from '../lib/audit.js';
import { auditFromContext } from '../lib/audit-context.js';
import { created, noContent, ok, parseJsonBody, parseParams } from '../lib/http.js';
import { requirePlatform } from '../middleware/auth.js';
import type { AppBindings } from '../types.js';

/**
 * Segmentos: os conjuntos padrao de modulos que a CODECA IA mantem.
 *
 * A plataforma atende qualquer ramo, entao segmento e **dado**, nao codigo.
 * Cadastrar "Restaurante" com cardapio e horarios e uma linha aqui; antes era
 * um `ALTER TYPE` seguido de implantacao.
 *
 * Decisao que organiza o resto deste arquivo: **mudar um segmento nunca mexe
 * em site nenhum.** Ele e o ponto de partida de um projeto novo. Um site
 * configurado ha meses pode ter sido ajustado a mao, e um segmento editado
 * hoje nao pode apagar esse ajuste nem tirar do cliente uma tela que ele usa.
 * Aplicar o conjunto a um site existente e um ato separado e deliberado --
 * `POST /sites/:siteId/apply-segment`, com auditoria propria.
 */

const segmentParamSchema = z.object({ segmentId: uuidSchema });

/** Apenas os modulos que o registro ainda conhece. */
function modulosConhecidos(lista: string[] | null | undefined): ModuleKey[] {
  return (lista ?? []).filter(isModuleKey);
}

export function platformSegmentRoutes() {
  const app = new Hono<AppBindings>();

  app.get('/segments', requirePlatform('platform:tenants:read'), async (c) => {
    const ctx = c.get('ctx');

    const linhas = await ctx.db
      .select({
        id: schema.segments.id,
        code: schema.segments.code,
        name: schema.segments.name,
        description: schema.segments.description,
        defaultModules: schema.segments.defaultModules,
        isActive: schema.segments.isActive,
        isDefault: schema.segments.isDefault,
        createdAt: schema.segments.createdAt,
        /**
         * Sites que usam este segmento. A tela decide por ele se oferece
         * remover ou apenas desativar.
         *
         * `LEFT JOIN` com `count` da coluna, e nao subconsulta correlacionada:
         * num `sql` template o Drizzle renderiza a coluna sem qualificar a
         * tabela, e dentro da subconsulta `segments.id` resolvia contra
         * `sites.id` -- a comparacao nunca era verdadeira e a contagem vinha
         * zero para todo mundo.
         */
        siteCount: sql<number>`cast(count(${schema.sites.id}) as int)`,
      })
      .from(schema.segments)
      .leftJoin(schema.sites, eq(schema.sites.segmentId, schema.segments.id))
      .groupBy(schema.segments.id)
      .orderBy(asc(schema.segments.name));

    const items: SegmentView[] = linhas.map((linha) => ({
      ...linha,
      defaultModules: modulosConhecidos(linha.defaultModules),
      createdAt: linha.createdAt.toISOString(),
    }));

    return ok(c, { items });
  });

  app.post('/segments', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const input = await parseJsonBody(c, createSegmentSchema);

    const [existente] = await ctx.db
      .select({ id: schema.segments.id })
      .from(schema.segments)
      .where(eq(schema.segments.code, input.code));
    if (existente) {
      throw AppError.conflict(`Ja existe um segmento com o codigo "${input.code}".`);
    }

    const row = await ctx.db.transaction(async (tx) => {
      // O padrao e unico e o banco recusa o empate: desmarcar antes de marcar
      // evita que a gravacao falhe por um estado que a tela nao controla.
      if (input.isDefault) await limparPadrao(tx);

      const [criado] = await tx
        .insert(schema.segments)
        .values({
          code: input.code,
          name: input.name,
          description: input.description,
          defaultModules: input.defaultModules,
          isActive: input.isActive,
          isDefault: input.isDefault,
        })
        .returning();
      return criado;
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.segmentCreated,
      entityType: 'segment',
      entityId: row?.id ?? input.code,
      metadata: { code: input.code, defaultModules: input.defaultModules },
    });

    return created(c, { segment: row ?? null });
  });

  app.patch('/segments/:segmentId', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { segmentId } = parseParams(c, segmentParamSchema);
    const atual = await carregarSegmento(ctx.db, segmentId);
    const input = await parseJsonBody(c, updateSegmentSchema);

    if (atual.isDefault && !input.isDefault) {
      // Sem padrao, uma empresa nova nasceria com todos os modulos ligados.
      // Trocar o padrao e marcar outro, nao desmarcar este.
      throw AppError.badRequest(
        'Para deixar de ser o padrao, marque outro segmento como padrao: '
          + 'uma empresa nova precisa de um conjunto inicial.',
      );
    }
    if (input.isDefault && !input.isActive) {
      throw AppError.badRequest('Um segmento desativado nao pode ser o padrao de empresas novas.');
    }

    const row = await ctx.db.transaction(async (tx) => {
      if (input.isDefault && !atual.isDefault) await limparPadrao(tx);

      const [atualizado] = await tx
        .update(schema.segments)
        .set({
          name: input.name,
          description: input.description,
          defaultModules: input.defaultModules,
          isActive: input.isActive,
          isDefault: input.isDefault,
          updatedAt: ctx.now(),
        })
        .where(eq(schema.segments.id, segmentId))
        .returning();
      return atualizado;
    });

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.segmentUpdated,
      entityType: 'segment',
      entityId: segmentId,
      metadata: {
        code: atual.code,
        defaultModules: input.defaultModules,
        isActive: input.isActive,
        // Deixa explicito na trilha que a edicao nao alcancou site nenhum.
        appliedToExistingSites: false,
      },
    });

    return ok(c, { segment: row ?? null });
  });

  app.delete('/segments/:segmentId', requirePlatform('platform:tenants:write'), async (c) => {
    const ctx = c.get('ctx');
    const { segmentId } = parseParams(c, segmentParamSchema);
    const atual = await carregarSegmento(ctx.db, segmentId);

    const [uso] = await ctx.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(schema.sites)
      .where(eq(schema.sites.segmentId, segmentId));

    if ((uso?.total ?? 0) > 0) {
      // A chave estrangeira e `on delete set null`: remover aqui desligaria
      // em silencio o segmento de sites no ar. Desativar tira o segmento da
      // lista de projetos novos e preserva o que ja esta configurado.
      throw AppError.conflict(
        `${uso?.total} site(s) usam este segmento. Desative-o em vez de remover: `
          + 'os sites mantem a configuracao que ja tem.',
      );
    }
    if (atual.isDefault) {
      throw AppError.badRequest('Marque outro segmento como padrao antes de remover este.');
    }

    await ctx.db.delete(schema.segments).where(eq(schema.segments.id, segmentId));

    await auditFromContext(c, {
      action: AUDIT_ACTIONS.segmentDeleted,
      entityType: 'segment',
      entityId: segmentId,
      metadata: { code: atual.code },
    });

    return noContent(c);
  });

  return app;
}

/**
 * Desmarca o segmento padrao atual.
 *
 * Roda dentro da transacao, antes de marcar o novo: o indice unico parcial
 * recusa dois padroes, e gravar primeiro falharia por um estado que a tela
 * nao tem como consertar sozinha.
 */
async function limparPadrao(tx: Transaction): Promise<void> {
  await tx
    .update(schema.segments)
    .set({ isDefault: false })
    .where(eq(schema.segments.isDefault, true));
}

async function carregarSegmento(db: Database, segmentId: string) {
  const [row] = await db.select().from(schema.segments).where(eq(schema.segments.id, segmentId));
  if (!row) throw AppError.notFound('Segmento nao encontrado.');
  return row;
}
