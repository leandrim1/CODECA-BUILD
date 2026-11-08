import { and, eq, schema, type Database } from '@codeca/database';
import {
  MEDIA_TARGET,
  syncTargetLabel,
  type DocumentModuleKey,
  type SyncApplyResult,
  type SyncTarget,
} from '@codeca/shared';
import type { BlobStorage } from '../blob.js';
import { enabledModuleKeys, loadSiteModules } from '../modules.js';
import {
  ApplyError,
  applyCollectionRecord,
  applyDocumentFields,
  canApplyCollection,
  loadDocument,
  revertCollectionRecord,
  revertDocumentFields,
  type ApplyContext,
} from '../import/apply.js';
import type { SiteFetcher } from '../import/fetcher.js';
import { ImageImportError, importImage } from '../import/images.js';
import { fingerprint } from './checker.js';
import { comparedFieldsOf, imageFieldOf, isDocumentTarget, loadCollection } from './codeca-side.js';
import {
  loadChangesByIds,
  listChanges,
  updateChangeOutcome,
  updateSource,
  upsertBaseline,
  type SyncChangeRow,
  type SyncSourceRow,
} from './store.js';

/**
 * Aplicacao das alteracoes aprovadas.
 *
 * Nenhum schema proprio: cada gravacao passa pelas **mesmas** funcoes que a
 * importacao usa (`applyDocumentFields`, `applyCollectionRecord`), que por sua
 * vez passam pelos mesmos schemas Zod do painel, pelo mesmo gerador de slug,
 * pelo mesmo limite de plano e pela mesma politica de campos. Se um valor nao
 * serve para o painel, nao serve aqui.
 *
 * Tres regras do produto moram nesta camada:
 *
 * - **So o aprovado entra.** `decision` diferente de `aprovada` nao grava
 *   nada -- nem o que esta em conflito sem escolha feita.
 * - **Remocao nunca apaga sozinha.** Sem `removalAction` explicito, uma
 *   remocao e ignorada. `excluir` so vem de um pedido que disse `excluir`.
 * - **O baseline avanca junto.** Depois de aplicar, o que a origem dizia
 *   passa a ser a nova referencia, e a CODECA passa a ter a mesma impressao.
 *   Sem isso a mesma alteracao voltaria na verificacao seguinte.
 */

export interface SyncApplyContext {
  db: Database;
  blob: BlobStorage;
  fetcher: SiteFetcher;
  now: () => Date;
  tenantId: string;
  siteId: string;
  userId: string;
}

interface Totals {
  applied: number;
  failed: number;
  skipped: number;
  archived: number;
  deleted: number;
  mediaCreated: number;
}

/**
 * Aplica o que o cliente aprovou.
 *
 * `targets` vazio aplica todos os aprovados; com valores, restringe aos
 * destinos escolhidos -- que e como a tela permite aplicar so "Contato" sem
 * desmarcar o resto item por item.
 */
export async function applyApproved(
  ctx: SyncApplyContext,
  input: { source: SyncSourceRow; targets: readonly SyncTarget[] },
): Promise<SyncApplyResult> {
  const todas = await listChanges(ctx.db, {
    sourceId: input.source.id,
    tenantId: ctx.tenantId,
  });

  const escolhidos = new Set(input.targets);
  const querDestino = (target: SyncTarget): boolean =>
    escolhidos.size === 0 || escolhidos.has(target);

  /**
   * Em conflito, a aprovacao **sozinha** nao basta.
   *
   * A escolha precisa dizer `usar_origem`. Sem esta trava, um pedido que
   * mandasse `aprovada` junto de `manter_codeca` sobrescreveria a edicao do
   * cliente -- exatamente o que a tela promete que nunca acontece. A regra
   * fica no servidor, e nao so na interface, porque a interface nao e o unico
   * caminho ate aqui.
   */
  const conflitoResolvido = (change: SyncChangeRow): boolean =>
    !change.conflict || change.conflictChoice === 'usar_origem';

  const aprovadas = todas.filter(
    (change) =>
      change.decision === 'aprovada'
      && change.outcome === 'pendente'
      && querDestino(change.target)
      && !change.targetDisabled
      && conflitoResolvido(change),
  );

  const totals: Totals = {
    applied: 0,
    failed: 0,
    skipped: 0,
    archived: 0,
    deleted: 0,
    mediaCreated: 0,
  };

  // Decisoes que nao sao "aprovada" saem do caminho, com o resultado anotado.
  for (const change of todas) {
    if (change.outcome !== 'pendente') continue;
    if (change.decision === 'pendente') continue;
    if (
      change.decision === 'aprovada'
      && querDestino(change.target)
      && !change.targetDisabled
      && conflitoResolvido(change)
    ) {
      continue;
    }

    totals.skipped += 1;
    await updateChangeOutcome(ctx.db, {
      tenantId: ctx.tenantId,
      changeId: change.id,
      outcome: 'ignorada',
      now: ctx.now(),
    });
  }

  if (aprovadas.length === 0) {
    return { ...totals, message: resultMessage(totals) };
  }

  const estado = await loadSiteModules(ctx.db, ctx.siteId);
  const habilitados = new Set<SyncTarget>(enabledModuleKeys(estado));
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

  /** Imagens baixadas nesta aplicacao: endereco na origem -> id na biblioteca. */
  const imagens = new Map<string, string>();
  /** Linhas de baseline a avancar depois de gravar. */
  const avancos: Parameters<typeof upsertBaseline>[1]['rows'][number][] = [];

  // ------------------------------------------------------------ imagens
  for (const change of aprovadas) {
    if (change.target !== MEDIA_TARGET) continue;

    if (change.changeType === 'imagem_removida') {
      await aplicarRemocao(ctx, change, totals);
      continue;
    }

    const payload = change.sourceValue as { url?: string; alt?: string } | null;
    const url = payload?.url ?? '';
    if (url === '') {
      await falhar(ctx, change, 'A alteração não trouxe o endereço da imagem.', totals);
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
        { url, alt: payload?.alt ?? '', tag: 'sincronizado' },
      );

      imagens.set(url, imagem.mediaId);
      if (!imagem.reused) totals.mediaCreated += 1;
      totals.applied += 1;

      await updateChangeOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        changeId: change.id,
        outcome: 'aplicada',
        entityId: imagem.mediaId,
        revertValue: change.codecaValue,
        appliedAt: ctx.now(),
        now: ctx.now(),
      });

      avancos.push({
        contentKey: change.contentKey,
        target: change.target,
        fieldKey: '',
        label: change.label,
        sourceValue: change.sourceValue,
        sourceFingerprint: fingerprint(change.sourceValue),
        codecaFingerprint: fingerprint({ url, alt: '', hash: imagem.hash }),
        entityId: imagem.mediaId,
        pageUrl: change.pageUrl,
        seen: true,
      });
    } catch (error) {
      const mensagem =
        error instanceof ImageImportError ? error.message : 'Não foi possível importar esta imagem.';
      await falhar(ctx, change, mensagem, totals);
    }
  }

  // ------------------------------------------- campos de documento
  /**
   * Agrupados por modulo, pela mesma razao da importacao: `institucional` tem
   * onze campos, e o schema valida o documento inteiro de qualquer forma.
   */
  const porDocumento = new Map<DocumentModuleKey, SyncChangeRow[]>();
  for (const change of aprovadas) {
    if (!isDocumentTarget(change.target)) continue;
    if (change.changeType === 'removido') {
      await aplicarRemocao(ctx, change, totals);
      continue;
    }
    const lista = porDocumento.get(change.target) ?? [];
    lista.push(change);
    porDocumento.set(change.target, lista);
  }

  for (const [moduleKey, lista] of porDocumento) {
    // O valor da CODECA **agora**, e nao o do momento da deteccao: entre
    // detectar e aplicar o cliente pode ter editado de novo, e e esse valor
    // que a reversao precisa devolver.
    const atual = await loadDocument(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      moduleKey,
    });
    const dados = atual?.data ?? {};

    const campos: Record<string, unknown> = {};
    for (const change of lista) campos[change.fieldKey] = change.sourceValue;

    try {
      await applyDocumentFields(applyCtx, { moduleKey, fields: campos });
      for (const change of lista) {
        totals.applied += 1;
        await updateChangeOutcome(ctx.db, {
          tenantId: ctx.tenantId,
          changeId: change.id,
          outcome: 'aplicada',
          revertValue: dados[change.fieldKey] ?? null,
          appliedAt: ctx.now(),
          now: ctx.now(),
        });
        avancos.push({
          contentKey: change.contentKey,
          target: change.target,
          fieldKey: change.fieldKey,
          label: change.label,
          sourceValue: change.sourceValue,
          sourceFingerprint: fingerprint(change.sourceValue),
          // A CODECA passa a ter o valor da origem: as duas impressoes ficam
          // iguais, e a proxima verificacao nao ve divergencia nenhuma.
          codecaFingerprint: fingerprint(change.sourceValue),
          entityId: null,
          pageUrl: change.pageUrl,
          seen: true,
        });
      }
    } catch (error) {
      const mensagem =
        error instanceof ApplyError
          ? error.message
          : `Não foi possível gravar ${syncTargetLabel(moduleKey)}.`;
      for (const change of lista) await falhar(ctx, change, mensagem, totals);
    }
  }

  // ------------------------------------------ registros de colecao
  for (const change of aprovadas) {
    if (change.target === MEDIA_TARGET || isDocumentTarget(change.target)) continue;

    if (change.changeType === 'removido') {
      await aplicarRemocao(ctx, change, totals);
      continue;
    }

    if (!canApplyCollection(change.target)) {
      await falhar(ctx, change, 'A sincronização não grava registros neste módulo.', totals);
      continue;
    }

    try {
      const resultado = await aplicarRegistro(ctx, applyCtx, change, imagens);
      totals.applied += 1;
      await updateChangeOutcome(ctx.db, {
        tenantId: ctx.tenantId,
        changeId: change.id,
        outcome: 'aplicada',
        entityId: resultado.entityId,
        revertValue: resultado.revertValue,
        appliedAt: ctx.now(),
        now: ctx.now(),
      });
      avancos.push({
        contentKey: change.contentKey,
        target: change.target,
        fieldKey: '',
        label: change.label,
        sourceValue: change.sourceValue,
        sourceFingerprint: fingerprint(change.sourceValue),
        codecaFingerprint: fingerprint(resultado.codecaValue),
        entityId: resultado.entityId,
        pageUrl: change.pageUrl,
        seen: true,
      });
    } catch (error) {
      const mensagem =
        error instanceof ApplyError || error instanceof Error
          ? error.message
          : 'Não foi possível gravar este conteúdo.';
      await falhar(ctx, change, mensagem.slice(0, 1000), totals);
    }
  }

  if (avancos.length > 0) {
    await upsertBaseline(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      sourceId: input.source.id,
      rows: avancos,
      now: ctx.now(),
    });
  }

  await updateSource(ctx.db, {
    sourceId: input.source.id,
    tenantId: ctx.tenantId,
    lastSyncedAt: ctx.now(),
    now: ctx.now(),
  });

  return { ...totals, message: resultMessage(totals) };
}

/**
 * Grava um registro de colecao vindo da origem.
 *
 * Conteudo novo entra pelo mesmo caminho da importacao. Conteudo **alterado**
 * atualiza o registro existente campo a campo, so nos campos que a origem de
 * fato traz -- um `UPDATE` com o registro inteiro apagaria o que o cliente
 * preencheu a mao em campos que a origem nunca conheceu.
 */
async function aplicarRegistro(
  ctx: SyncApplyContext,
  applyCtx: ApplyContext,
  change: SyncChangeRow,
  imagens: Map<string, string>,
): Promise<{ entityId: string; revertValue: unknown; codecaValue: unknown }> {
  const proposto = { ...((change.sourceValue ?? {}) as Record<string, unknown>) };
  const campos = comparedFieldsOf(change.target);

  // Imagem do registro, quando ela foi baixada nesta aplicacao.
  const urlDaImagem = typeof proposto['__imageUrl'] === 'string' ? proposto['__imageUrl'] : '';
  const mediaId = urlDaImagem !== '' ? (imagens.get(urlDaImagem) ?? null) : null;

  const indice = await loadCollection(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    target: change.target,
  });
  const existente = change.entityId ? indice.byId.get(change.entityId) : undefined;

  if (change.changeType === 'novo' || existente === undefined) {
    const { createdEntityId } = await applyCollectionRecord(applyCtx, {
      target: change.target,
      value: proposto,
      mediaId,
      galleryIds: [],
    });
    const recorte: Record<string, unknown> = {};
    for (const campo of campos) {
      if (proposto[campo] !== undefined) recorte[campo] = proposto[campo];
    }
    return { entityId: createdEntityId, revertValue: null, codecaValue: recorte };
  }

  // Alteracao: so os campos que a origem traz.
  const patch: Record<string, unknown> = {};
  const antes: Record<string, unknown> = {};
  for (const campo of campos) {
    if (proposto[campo] === undefined) continue;
    patch[campo] = proposto[campo];
    antes[campo] = existente.value[campo];
  }
  if (mediaId !== null) {
    const campoImagem = imageFieldOf(change.target);
    if (campoImagem !== null) {
      patch[campoImagem] = mediaId;
      antes[campoImagem] = existente.imageId;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { entityId: existente.id, revertValue: null, codecaValue: existente.value };
  }

  await atualizarRegistro(ctx.db, {
    tenantId: ctx.tenantId,
    target: change.target,
    entityId: existente.id,
    patch,
    now: ctx.now(),
  });

  return { entityId: existente.id, revertValue: antes, codecaValue: patch };
}

/**
 * `UPDATE` num registro de colecao.
 *
 * Um `switch` em vez de um mapa de tabelas, pela mesma razao da reversao da
 * importacao: cada tabela do Drizzle tem tipo proprio, e unifica-las exigiria
 * conversao forcada -- justamente numa funcao que **sobrescreve conteudo de
 * cliente**, onde o tipo e a ultima conferencia antes da gravacao.
 */
async function atualizarRegistro(
  db: Database,
  input: {
    tenantId: string;
    target: SyncTarget;
    entityId: string;
    patch: Record<string, unknown>;
    now: Date;
  },
): Promise<void> {
  const valores = { ...input.patch, updatedAt: input.now } as never;
  const { tenantId, entityId } = input;

  switch (input.target) {
    case 'servicos':
      await db.update(schema.services).set(valores)
        .where(and(eq(schema.services.id, entityId), eq(schema.services.tenantId, tenantId)));
      return;
    case 'produtos':
      await db.update(schema.products).set(valores)
        .where(and(eq(schema.products.id, entityId), eq(schema.products.tenantId, tenantId)));
      return;
    case 'obras':
      await db.update(schema.projects).set(valores)
        .where(and(eq(schema.projects.id, entityId), eq(schema.projects.tenantId, tenantId)));
      return;
    case 'imoveis':
      await db.update(schema.properties).set(valores)
        .where(and(eq(schema.properties.id, entityId), eq(schema.properties.tenantId, tenantId)));
      return;
    case 'banners':
      await db.update(schema.banners).set(valores)
        .where(and(eq(schema.banners.id, entityId), eq(schema.banners.tenantId, tenantId)));
      return;
    case 'galerias':
      await db.update(schema.galleries).set(valores)
        .where(and(eq(schema.galleries.id, entityId), eq(schema.galleries.tenantId, tenantId)));
      return;
    case 'depoimentos':
      await db.update(schema.testimonials).set(valores)
        .where(and(eq(schema.testimonials.id, entityId), eq(schema.testimonials.tenantId, tenantId)));
      return;
    case 'equipe':
      await db.update(schema.teamMembers).set(valores)
        .where(and(eq(schema.teamMembers.id, entityId), eq(schema.teamMembers.tenantId, tenantId)));
      return;
    case 'faq':
      await db.update(schema.faqs).set(valores)
        .where(and(eq(schema.faqs.id, entityId), eq(schema.faqs.tenantId, tenantId)));
      return;
    default:
      throw new ApplyError('A sincronização não grava registros neste módulo.');
  }
}

/**
 * Conteudo que saiu do ar na origem.
 *
 * Nunca apaga por conta propria. `manter` deixa como esta, `arquivar` tira do
 * site sem perder o registro, e `excluir` so acontece quando o pedido disse
 * `excluir` -- a tela pede confirmacao antes de montar esse pedido.
 */
async function aplicarRemocao(
  ctx: SyncApplyContext,
  change: SyncChangeRow,
  totals: Totals,
): Promise<void> {
  const acao = change.removalAction ?? 'manter';

  if (acao === 'manter' || change.entityId === null) {
    totals.skipped += 1;
    await updateChangeOutcome(ctx.db, {
      tenantId: ctx.tenantId,
      changeId: change.id,
      outcome: 'ignorada',
      now: ctx.now(),
    });
    return;
  }

  try {
    if (acao === 'arquivar') {
      /**
       * Arquivar e despublicar, nao apagar.
       *
       * O registro continua no painel, fora do site. E a opcao que resolve a
       * maioria dos casos sem risco: a pagina sumiu da origem, o cliente tira
       * do ar, e se foi engano basta republicar.
       */
      await atualizarRegistro(ctx.db, {
        tenantId: ctx.tenantId,
        target: change.target,
        entityId: change.entityId,
        patch: arquivamentoDe(change.target),
        now: ctx.now(),
      });
      totals.archived += 1;
    } else {
      await revertCollectionRecord(
        { db: ctx.db, tenantId: ctx.tenantId },
        { target: change.target, entityId: change.entityId },
      );
      totals.deleted += 1;
    }

    await updateChangeOutcome(ctx.db, {
      tenantId: ctx.tenantId,
      changeId: change.id,
      outcome: 'aplicada',
      entityId: change.entityId,
      revertValue: change.codecaValue,
      appliedAt: ctx.now(),
      now: ctx.now(),
    });
  } catch (error) {
    await falhar(
      ctx,
      change,
      error instanceof Error ? error.message : 'Não foi possível tratar este conteúdo.',
      totals,
    );
  }
}

/** Como cada modulo sai do site sem sair do painel. */
function arquivamentoDe(target: SyncTarget): Record<string, unknown> {
  // Banner nao tem `publicationStatus`; quem controla a exibicao e `isActive`.
  if (target === 'banners') return { isActive: false };
  return { publicationStatus: 'archived' };
}

async function falhar(
  ctx: SyncApplyContext,
  change: SyncChangeRow,
  mensagem: string,
  totals: Totals,
): Promise<void> {
  totals.failed += 1;
  await updateChangeOutcome(ctx.db, {
    tenantId: ctx.tenantId,
    changeId: change.id,
    outcome: 'falhou',
    error: mensagem,
    now: ctx.now(),
  });
}

/** Frase do resultado, com os numeros reais. */
export function resultMessage(totals: Totals): string {
  if (totals.applied === 0 && totals.failed === 0 && totals.archived === 0 && totals.deleted === 0) {
    return 'Nenhuma alteração foi aplicada: nada estava aprovado.';
  }

  const partes: string[] = [];
  if (totals.applied > 0) {
    partes.push(
      totals.applied === 1 ? '1 alteração aplicada' : `${totals.applied} alterações aplicadas`,
    );
  }
  if (totals.archived > 0) {
    partes.push(totals.archived === 1 ? '1 conteúdo arquivado' : `${totals.archived} conteúdos arquivados`);
  }
  if (totals.deleted > 0) {
    partes.push(totals.deleted === 1 ? '1 conteúdo excluído' : `${totals.deleted} conteúdos excluídos`);
  }
  if (totals.failed > 0) {
    partes.push(totals.failed === 1 ? '1 falhou' : `${totals.failed} falharam`);
  }
  if (totals.skipped > 0) {
    partes.push(totals.skipped === 1 ? '1 ignorada' : `${totals.skipped} ignoradas`);
  }

  return `${partes.join(', ')}.`;
}

/**
 * Desfaz uma alteracao ja aplicada.
 *
 * Devolve o valor que estava na CODECA no momento da gravacao
 * (`revert_value`). Nao e "voltar o site no tempo": uma edicao feita pelo
 * cliente depois da sincronizacao seria desfeita junto, e a tela avisa isso
 * antes de confirmar.
 */
export async function revertChange(
  ctx: SyncApplyContext,
  input: { source: SyncSourceRow; changeId: string },
): Promise<{ reverted: boolean; message: string }> {
  const [change] = await loadChangesByIds(ctx.db, {
    tenantId: ctx.tenantId,
    sourceId: input.source.id,
    ids: [input.changeId],
  });

  if (!change) return { reverted: false, message: 'Alteração não encontrada.' };
  if (change.outcome !== 'aplicada') {
    return { reverted: false, message: 'Só é possível desfazer uma alteração que foi aplicada.' };
  }

  const estado = await loadSiteModules(ctx.db, ctx.siteId);
  const habilitados = new Set<SyncTarget>(enabledModuleKeys(estado));
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

  try {
    if (isDocumentTarget(change.target)) {
      await revertDocumentFields(applyCtx, {
        moduleKey: change.target,
        previous: { [change.fieldKey]: change.revertValue ?? null },
      });
    } else if (change.target !== MEDIA_TARGET && change.entityId !== null) {
      const anterior = change.revertValue as Record<string, unknown> | null;
      if (anterior === null) {
        // Nao havia registro antes: a alteracao criou um, e desfazer e apagar.
        await revertCollectionRecord(
          { db: ctx.db, tenantId: ctx.tenantId },
          { target: change.target, entityId: change.entityId },
        );
      } else {
        await atualizarRegistro(ctx.db, {
          tenantId: ctx.tenantId,
          target: change.target,
          entityId: change.entityId,
          patch: anterior,
          now: ctx.now(),
        });
      }
    } else {
      /**
       * Imagem nao e desfeita.
       *
       * O arquivo fica na biblioteca de proposito: desfazer a sincronizacao
       * do conteudo nao deveria apagar um arquivo que a pessoa pode ja ter
       * usado em outro lugar -- a mesma regra da importacao.
       */
      return {
        reverted: false,
        message: 'Imagens importadas permanecem na biblioteca. Remova pela Biblioteca de imagens, se quiser.',
      };
    }

    await updateChangeOutcome(ctx.db, {
      tenantId: ctx.tenantId,
      changeId: change.id,
      outcome: 'revertida',
      now: ctx.now(),
    });

    return { reverted: true, message: 'Alteração desfeita.' };
  } catch (error) {
    return {
      reverted: false,
      message: error instanceof Error ? error.message : 'Não foi possível desfazer esta alteração.',
    };
  }
}
