import { asc, eq, lt, schema, sql, type Database } from '@codeca/database';
import type { BlobStorage } from './blob.js';

/**
 * Arquivos que precisam sair do Blob e ainda nao sairam.
 *
 * ## O defeito que isto corrige
 *
 * A exclusao de midia apaga a linha do banco e depois o arquivo. A ordem esta
 * certa: se o banco caisse primeiro, perderiamos a URL e o arquivo ficaria
 * orfao para sempre. O que faltava era a outra metade -- quando a remocao no
 * Blob falhava, o erro so ia para o `console.error`. O arquivo continuava
 * ocupando o balde e **deixava de ser cobrado**: custo nosso, crescente e
 * invisivel, porque a cota que o painel mostra e a soma do banco.
 *
 * ## Desistir faz parte
 *
 * Depois de `MAX_TENTATIVAS` a tarefa para de ser tentada, mas **nao e
 * apagada**: uma URL que o provedor recusa dez vezes seguidas quase sempre e
 * arquivo que ja nao existe, e insistir para sempre transformaria a fila num
 * laco infinito. A linha fica como registro, para quem opera poder olhar.
 */

const MAX_TENTATIVAS = 10;

/** Quantas tarefas o job tenta por execucao. */
const LOTE = 100;

/**
 * Registra que um arquivo precisa sair do Blob.
 *
 * Nunca lanca: ela e chamada no caminho de erro de outra operacao, e falhar
 * aqui derrubaria uma exclusao que ja deu certo do lado do banco.
 */
export async function agendarRemocaoDoBlob(
  db: Database,
  entrada: { tenantId: string | null; blobUrl: string; pathname?: string; erro?: unknown },
): Promise<void> {
  try {
    const motivo =
      entrada.erro instanceof Error ? entrada.erro.message : entrada.erro ? String(entrada.erro) : '';
    await db
      .insert(schema.blobCleanupQueue)
      .values({
        tenantId: entrada.tenantId,
        blobUrl: entrada.blobUrl,
        pathname: entrada.pathname ?? '',
        lastError: motivo.slice(0, 500),
      })
      // Mesmo arquivo falhando de novo e a mesma tarefa, nao uma nova.
      .onConflictDoUpdate({
        target: schema.blobCleanupQueue.blobUrl,
        set: { lastError: motivo.slice(0, 500) },
      });
  } catch (error) {
    console.error(
      '[blob] nao consegui agendar a remocao',
      entrada.blobUrl,
      error instanceof Error ? error.message : error,
    );
  }
}

export interface RelatorioDeLimpeza {
  /** Arquivos que sairam do Blob nesta execucao. */
  removidos: number;
  /** Tentativas que falharam de novo e continuam na fila. */
  pendentes: number;
  /** Tarefas que esgotaram as tentativas e pararam de ser tentadas. */
  desistidas: number;
}

/** Tenta de novo o que ficou para tras. Chamada pelo job diario. */
export async function drenarFilaDoBlob(
  db: Database,
  blob: BlobStorage,
  now = new Date(),
): Promise<RelatorioDeLimpeza> {
  if (!blob.configured) return { removidos: 0, pendentes: 0, desistidas: 0 };

  const tarefas = await db
    .select()
    .from(schema.blobCleanupQueue)
    .where(lt(schema.blobCleanupQueue.attempts, MAX_TENTATIVAS))
    .orderBy(asc(schema.blobCleanupQueue.createdAt))
    .limit(LOTE);

  let removidos = 0;
  let pendentes = 0;
  let desistidas = 0;

  for (const tarefa of tarefas) {
    try {
      await blob.remove(tarefa.blobUrl);
      await db.delete(schema.blobCleanupQueue).where(eq(schema.blobCleanupQueue.id, tarefa.id));
      removidos += 1;
    } catch (error) {
      const tentativas = tarefa.attempts + 1;
      await db
        .update(schema.blobCleanupQueue)
        .set({
          attempts: tentativas,
          lastAttemptAt: now,
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        })
        .where(eq(schema.blobCleanupQueue.id, tarefa.id));
      if (tentativas >= MAX_TENTATIVAS) desistidas += 1;
      else pendentes += 1;
    }
  }

  return { removidos, pendentes, desistidas };
}

/** Quantas tarefas aguardam, para o painel mestre poder mostrar. */
export async function tarefasDeLimpezaPendentes(db: Database): Promise<{ aguardando: number; desistidas: number }> {
  const [linha] = await db
    .select({
      aguardando: sql<number>`cast(count(*) filter (where ${schema.blobCleanupQueue.attempts} < ${MAX_TENTATIVAS}) as int)`,
      desistidas: sql<number>`cast(count(*) filter (where ${schema.blobCleanupQueue.attempts} >= ${MAX_TENTATIVAS}) as int)`,
    })
    .from(schema.blobCleanupQueue);
  return { aguardando: Number(linha?.aguardando ?? 0), desistidas: Number(linha?.desistidas ?? 0) };
}
