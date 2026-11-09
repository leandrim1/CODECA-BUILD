import {
  MEDIA_TARGET,
  importTargetLabel,
  type DocumentModuleKey,
  type ImportResultView,
  type ImportTarget,
  MODULE_REGISTRY,
} from '@codeca/shared';
import type { Database } from '@codeca/database';
import type { BlobStorage } from '../blob.js';
import { enabledModuleKeys, loadSiteModules } from '../modules.js';
import {
  ApplyError,
  applyCollectionRecord,
  applyDocumentFields,
  canApplyCollection,
  revertCollectionRecord,
  revertDocumentFields,
  type ApplyContext,
} from './apply.js';
import type { SiteFetcher } from './fetcher.js';
import { ImageImportError, importImage } from './images.js';
import {
  loadItems,
  loadRun,
  toRunView,
  updateItemOutcome,
  updateRun,
  type ImportItemRow,
  type ImportRunRow,
} from './store.js';

/**
 * Gravacao do que foi confirmado.
 *
 * Ordem: imagens primeiro, conteudo depois. Nao e arbitraria -- um banner, um
 * servico ou um profissional referenciam a imagem por identificador da
 * biblioteca, entao a imagem precisa existir antes do registro que aponta para
 * ela. Imagem que falha nao derruba o registro: ele entra sem imagem, com o
 * motivo anotado no candidato, porque um servico sem foto e util e um servico
 * que nao entrou nao e.
 *
 * Cada candidato e gravado de forma independente. Uma transacao unica para
 * tudo seria pior em dois sentidos: uma falha no candidato 80 desfaria os 79
 * que deram certo, e a gravacao de dezenas de registros com download de
 * imagens no meio nao cabe numa transacao dentro do tempo da funcao.
 * A reversao existe justamente para dar o desfazer sem precisar disso.
 */

export interface ImportRunContext {
  db: Database;
  blob: BlobStorage;
  fetcher: SiteFetcher;
  now: () => Date;
  tenantId: string;
  siteId: string;
  userId: string;
}

export interface ImportOutcomeTotals {
  imported: number;
  failed: number;
  skipped: number;
  mediaCreated: number;
}

/**
 * Executa a importacao de uma analise revisada.
 *
 * `targets` vazio importa todos os candidatos selecionados; com valores,
 * restringe aos destinos escolhidos -- que e como a tela permite importar so
 * "Serviços e Contato" sem desmarcar o resto item por item.
 */
export async function runImport(
  ctx: ImportRunContext,
  input: { run: ImportRunRow; targets: readonly ImportTarget[] },
): Promise<ImportResultView> {
  const agora = ctx.now();

  await updateRun(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    importId: input.run.id,
    state: 'importando',
    message: 'Importando as informações selecionadas.',
    now: agora,
  });

  const items = await loadItems(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    importId: input.run.id,
  });

  const estado = await loadSiteModules(ctx.db, ctx.siteId);
  const habilitados = new Set<ImportTarget>(enabledModuleKeys(estado));
  habilitados.add(MEDIA_TARGET);

  const applyCtx: ApplyContext = {
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    userId: ctx.userId,
    now: ctx.now,
    overrides: estado.overrides,
    enabled: habilitados,
  };

  const escolhidos = new Set(input.targets);
  const querDestino = (target: ImportTarget): boolean =>
    escolhidos.size === 0 || escolhidos.has(target);

  const totals: ImportOutcomeTotals = { imported: 0, failed: 0, skipped: 0, mediaCreated: 0 };

  /** Endereco da imagem no site antigo -> identificador na biblioteca. */
  const imagensPorUrl = new Map<string, string>();

  // ------------------------------------------------------------ imagens
  await updateRun(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    importId: input.run.id,
    state: 'processando_imagens',
    message: 'Processando as imagens encontradas.',
    now: ctx.now(),
  });

  for (const item of items) {
    if (item.kind !== 'imagem') continue;
    if (item.decision !== 'selecionado' || !querDestino(item.target)) {
      totals.skipped += 1;
      await updateItemOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        itemId: item.id,
        outcome: 'ignorado',
        now: ctx.now(),
      });
      continue;
    }

    const payload = item.value as { url?: string; alt?: string; tag?: string } | null;
    const url = payload?.url ?? '';
    if (url === '') {
      totals.failed += 1;
      await updateItemOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        itemId: item.id,
        outcome: 'falhou',
        error: 'O candidato não trouxe o endereço da imagem.',
        now: ctx.now(),
      });
      continue;
    }

    try {
      const imagem = await importImage(
        {
          db: ctx.db,
          blob: ctx.blob,
          fetcher: ctx.fetcher,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          userId: ctx.userId,
          now: ctx.now,
        },
        { url, alt: payload?.alt ?? '', tag: payload?.tag ?? 'conteudo' },
      );

      imagensPorUrl.set(url, imagem.mediaId);
      if (!imagem.reused) totals.mediaCreated += 1;
      totals.imported += 1;

      await updateItemOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        itemId: item.id,
        outcome: 'importado',
        // O resumo do conteudo fica guardado no candidato: e por ele que uma
        // analise futura reconhece a mesma imagem sem baixar de novo.
        previousValue: null,
        createdEntityId: imagem.mediaId,
        now: ctx.now(),
      });
      await marcarHash(ctx.db, item.id, ctx.tenantId, imagem.hash, url, payload?.alt ?? '', payload?.tag ?? '');
    } catch (error) {
      totals.failed += 1;
      const mensagem =
        error instanceof ImageImportError
          ? error.message
          : 'Não foi possível importar esta imagem.';
      await updateItemOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        itemId: item.id,
        outcome: 'falhou',
        error: mensagem,
        now: ctx.now(),
      });
    }
  }

  // ------------------------------------------------- campos de documento
  /**
   * Agrupados por modulo.
   *
   * `institucional` tem onze campos; gravar um por um faria onze leituras e
   * onze gravacoes do mesmo documento, e o schema valida o objeto inteiro de
   * qualquer forma. Agrupar tambem e o que permite reverter o modulo todo com
   * um unico estado consistente.
   */
  const porDocumento = new Map<DocumentModuleKey, { fields: Record<string, unknown>; items: ImportItemRow[] }>();

  for (const item of items) {
    if (item.kind !== 'documento_campo') continue;

    const aceito =
      item.decision === 'selecionado'
      && querDestino(item.target)
      // Conflito so passa quando a revisao autorizou a substituicao.
      && (!item.conflict || item.resolution === 'substituir')
      && !item.targetDisabled;

    if (!aceito) {
      totals.skipped += 1;
      await updateItemOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        itemId: item.id,
        outcome: 'ignorado',
        now: ctx.now(),
      });
      continue;
    }

    const moduleKey = item.target as DocumentModuleKey;
    const grupo = porDocumento.get(moduleKey) ?? { fields: {}, items: [] };
    grupo.fields[item.fieldKey] = resolverImagens(
      moduleKey,
      item.fieldKey,
      item.value,
      imagensPorUrl,
    );
    grupo.items.push(item);
    porDocumento.set(moduleKey, grupo);
  }

  for (const [moduleKey, grupo] of porDocumento) {
    try {
      const { previous } = await applyDocumentFields(applyCtx, { moduleKey, fields: grupo.fields });
      for (const item of grupo.items) {
        totals.imported += 1;
        await updateItemOutcome(ctx.db, {
          tenantId: ctx.tenantId,
          itemId: item.id,
          outcome: 'importado',
          previousValue: previous[item.fieldKey] ?? null,
          now: ctx.now(),
        });
      }
    } catch (error) {
      const mensagem =
        error instanceof ApplyError
          ? error.message
          : `Não foi possível gravar ${importTargetLabel(moduleKey)}.`;
      for (const item of grupo.items) {
        totals.failed += 1;
        await updateItemOutcome(ctx.db, {
          tenantId: ctx.tenantId,
          itemId: item.id,
          outcome: 'falhou',
          error: mensagem,
          now: ctx.now(),
        });
      }
    }
  }

  // ------------------------------------------- registros de colecao
  for (const item of items) {
    if (item.kind !== 'colecao_registro') continue;

    const aceito =
      item.decision === 'selecionado'
      && querDestino(item.target)
      && !item.targetDisabled
      && canApplyCollection(item.target);

    if (!aceito) {
      totals.skipped += 1;
      await updateItemOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        itemId: item.id,
        outcome: 'ignorado',
        now: ctx.now(),
      });
      continue;
    }

    const value = { ...((item.value ?? {}) as Record<string, unknown>) };

    // A imagem principal e a galeria do site antigo viram identificadores da
    // biblioteca; o que nao foi baixado simplesmente nao entra.
    const mediaId = resolverImagemPrincipal(value, imagensPorUrl);
    const galleryIds = resolverGaleria(value, imagensPorUrl);

    try {
      const { createdEntityId } = await applyCollectionRecord(applyCtx, {
        target: item.target,
        value,
        mediaId,
        galleryIds,
      });
      totals.imported += 1;
      await updateItemOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        itemId: item.id,
        outcome: 'importado',
        createdEntityId,
        now: ctx.now(),
      });
    } catch (error) {
      totals.failed += 1;
      const mensagem =
        error instanceof ApplyError || error instanceof Error
          ? error.message
          : 'Não foi possível gravar este registro.';
      await updateItemOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        itemId: item.id,
        outcome: 'falhou',
        error: mensagem.slice(0, 1000),
        now: ctx.now(),
      });
    }
  }

  const fim = ctx.now();
  await updateRun(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    importId: input.run.id,
    state: 'importada',
    message: resultMessage(totals),
    importedAt: fim,
    finishedAt: fim,
    now: fim,
  });

  const atualizada = await loadRun(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    importId: input.run.id,
  });

  return {
    run: toRunView(atualizada ?? input.run),
    imported: totals.imported,
    failed: totals.failed,
    skipped: totals.skipped,
    mediaCreated: totals.mediaCreated,
  };
}

/**
 * Guarda o resumo criptografico da imagem no candidato.
 *
 * Fica no `value` e nao numa coluna nova porque o resumo e dado **da
 * importacao**, nao do arquivo: serve para reconhecer a mesma imagem numa
 * analise futura, e `media_assets` nao precisa saber disso.
 */
async function marcarHash(
  db: Database,
  itemId: string,
  tenantId: string,
  hash: string,
  url: string,
  alt: string,
  tag: string,
): Promise<void> {
  const { and, eq, schema } = await import('@codeca/database');
  await db
    .update(schema.siteImportItems)
    .set({ value: { url, alt, tag, hash } })
    .where(and(eq(schema.siteImportItems.id, itemId), eq(schema.siteImportItems.tenantId, tenantId)));
}

/** `true` para endereco que aponta um arquivo de imagem. */
const ENDERECO_DE_IMAGEM = /^https?:\/\/.*\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/i;

/**
 * Troca endereco de imagem por identificador da biblioteca.
 *
 * Vale para os campos de documento que guardam imagem: um so (`logoImageId`,
 * `coverImageId`) ou uma lista (`galleryImageIds`). Quando a imagem nao foi
 * importada, o campo fica **nulo** em vez de apontar para o site antigo -- e
 * o requisito de o site novo parar de depender do antigo. Gravar a URL de
 * terceiro ali seria pior que gravar nada: o site do cliente continuaria
 * servindo imagem de um dominio que ele nao controla e que pode sair do ar.
 */
function resolverImagens(
  moduleKey: DocumentModuleKey,
  fieldKey: string,
  value: unknown,
  imagens: Map<string, string>,
): unknown {
  /**
   * Quem decide e o **tipo declarado do campo**, nao a forma do valor.
   *
   * Adivinhar pela forma ja custou caro: tratar toda lista como lista de
   * imagens zerou `values` -- que e uma lista de palavras ("Cuidado",
   * "Transparência") -- porque nenhuma delas estava no mapa de imagens. O
   * registro de modulos sabe o tipo de cada campo; perguntar a ele e exato
   * e nao depende de heuristica nenhuma.
   */
  const tipo = MODULE_REGISTRY[moduleKey].fields.find((campo) => campo.key === fieldKey)?.type;

  if (tipo === 'imageList') {
    if (!Array.isArray(value)) return value;
    const ids: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const id = imagens.get(item);
      if (id !== undefined && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  if (tipo !== 'image') return value;

  if (typeof value !== 'string') return value;
  const id = imagens.get(value);
  if (id !== undefined) return id;
  // Endereco de imagem que nao virou arquivo da biblioteca nao serve como
  // valor de campo de imagem.
  if (ENDERECO_DE_IMAGEM.test(value)) return null;
  return value;
}

/** Identificador da imagem principal de um registro, quando ela foi importada. */
function resolverImagemPrincipal(
  value: Record<string, unknown>,
  imagens: Map<string, string>,
): string | null {
  const url = typeof value['__imageUrl'] === 'string' ? value['__imageUrl'] : '';
  if (url === '') return null;
  delete value['__imageUrl'];
  return imagens.get(url) ?? null;
}

/** Identificadores da galeria de um registro, na ordem do site antigo. */
function resolverGaleria(value: Record<string, unknown>, imagens: Map<string, string>): string[] {
  const urls = Array.isArray(value['__imageUrls']) ? (value['__imageUrls'] as unknown[]) : [];
  delete value['__imageUrls'];
  const ids: string[] = [];
  for (const url of urls) {
    if (typeof url !== 'string') continue;
    const id = imagens.get(url);
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Frase do resultado, com os numeros reais. */
export function resultMessage(totals: ImportOutcomeTotals): string {
  if (totals.imported === 0 && totals.failed === 0) {
    return 'Nenhum conteúdo foi importado: nada estava selecionado.';
  }

  const partes = [`${totals.imported} ${totals.imported === 1 ? 'item importado' : 'itens importados'}`];
  if (totals.failed > 0) {
    partes.push(`${totals.failed} ${totals.failed === 1 ? 'falhou' : 'falharam'}`);
  }
  if (totals.skipped > 0) {
    partes.push(`${totals.skipped} ${totals.skipped === 1 ? 'ignorado' : 'ignorados'}`);
  }

  return `${partes.join(', ')}. O conteúdo entrou como rascunho: confira e publique quando quiser.`;
}

/**
 * Desfaz uma importacao.
 *
 * Apaga os registros criados e devolve os campos de documento ao valor que
 * tinham **no momento da gravacao** (`previous_value`). Nao e um
 * "voltar o site no tempo": uma edicao feita pelo cliente depois da importacao
 * seria desfeita junto, e por isso a tela avisa isso antes de confirmar.
 */
export async function revertImport(
  ctx: ImportRunContext,
  input: { run: ImportRunRow },
): Promise<{ reverted: number; failed: number }> {
  const items = await loadItems(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    importId: input.run.id,
  });

  const estado = await loadSiteModules(ctx.db, ctx.siteId);
  const habilitados = new Set<ImportTarget>(enabledModuleKeys(estado));
  habilitados.add(MEDIA_TARGET);

  const applyCtx: ApplyContext = {
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    userId: ctx.userId,
    now: ctx.now,
    overrides: estado.overrides,
    enabled: habilitados,
  };

  let reverted = 0;
  let failed = 0;

  // Documentos primeiro, agrupados: a mesma razao da gravacao.
  const porDocumento = new Map<DocumentModuleKey, { previous: Record<string, unknown>; items: ImportItemRow[] }>();
  for (const item of items) {
    if (item.kind !== 'documento_campo' || item.outcome !== 'importado') continue;
    const moduleKey = item.target as DocumentModuleKey;
    const grupo = porDocumento.get(moduleKey) ?? { previous: {}, items: [] };
    grupo.previous[item.fieldKey] = item.previousValue ?? null;
    grupo.items.push(item);
    porDocumento.set(moduleKey, grupo);
  }

  for (const [moduleKey, grupo] of porDocumento) {
    try {
      await revertDocumentFields(applyCtx, { moduleKey, previous: grupo.previous });
      for (const item of grupo.items) {
        reverted += 1;
        await updateItemOutcome(ctx.db, {
          tenantId: ctx.tenantId,
          itemId: item.id,
          outcome: 'revertido',
          now: ctx.now(),
        });
      }
    } catch (error) {
      for (const item of grupo.items) {
        failed += 1;
        await updateItemOutcome(ctx.db, {
          tenantId: ctx.tenantId,
          itemId: item.id,
          outcome: 'importado',
          error: error instanceof Error ? error.message : 'Não foi possível desfazer este campo.',
          now: ctx.now(),
        });
      }
    }
  }

  for (const item of items) {
    if (item.kind !== 'colecao_registro' || item.outcome !== 'importado') continue;
    if (item.createdEntityId === null) continue;
    try {
      await revertCollectionRecord(
        { db: ctx.db, tenantId: ctx.tenantId },
        { target: item.target, entityId: item.createdEntityId },
      );
      reverted += 1;
      await updateItemOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        itemId: item.id,
        outcome: 'revertido',
        now: ctx.now(),
      });
    } catch (error) {
      failed += 1;
      await updateItemOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        itemId: item.id,
        outcome: 'importado',
        error: error instanceof Error ? error.message : 'Não foi possível desfazer este registro.',
        now: ctx.now(),
      });
    }
  }

  const fim = ctx.now();
  await updateRun(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    importId: input.run.id,
    state: 'revertida',
    message:
      failed === 0
        ? `Importação desfeita: ${reverted} ${reverted === 1 ? 'item removido' : 'itens removidos'}.`
        : `Importação desfeita em parte: ${reverted} desfeitos, ${failed} não puderam ser desfeitos.`,
    finishedAt: fim,
    now: fim,
  });

  return { reverted, failed };
}
