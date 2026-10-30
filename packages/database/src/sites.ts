import { and, eq } from 'drizzle-orm';
import type { SegmentCode } from '@codeca/shared';
import type { Database } from './client.js';
import { segments, sites } from './schema.js';

/**
 * Criacao e resolucao de sites.
 *
 * Um site e o projeto de um cliente: tem segmento, modulos, dominio e
 * credenciais proprios. Uma empresa pode ter mais de um, e por isso toda
 * tabela de conteudo aponta para o site, nao so para a empresa.
 */

export interface CreatePrimarySiteInput {
  tenantId: string;
  name: string;
  /** Segmento inicial. O painel mestre ajusta depois. */
  segmentCode?: SegmentCode;
  slug?: string;
}

/**
 * Cria o site principal de uma empresa recem-cadastrada.
 *
 * Nasce como `draft` de proposito: o site ainda nao foi desenvolvido nem
 * integrado. Quem o coloca em `active` e a CODECA IA, ao concluir a
 * integracao. Os sites existentes na migracao nasceram `active` porque ja
 * estavam no ar -- a diferenca e informacao, nao inconsistencia.
 */
export async function createPrimarySite(
  db: Database,
  input: CreatePrimarySiteInput,
): Promise<{ id: string }> {
  const code = input.segmentCode ?? 'construtora';
  const [segment] = await db
    .select({ id: segments.id })
    .from(segments)
    .where(eq(segments.code, code));

  const [created] = await db
    .insert(sites)
    .values({
      tenantId: input.tenantId,
      segmentId: segment?.id ?? null,
      name: input.name,
      slug: input.slug ?? 'principal',
      status: 'draft',
      isPrimary: true,
    })
    .returning({ id: sites.id });

  if (!created) throw new Error('Nao foi possivel criar o site da empresa.');
  return created;
}

/** Site que o painel abre por padrao para esta empresa. */
export async function findPrimarySiteId(db: Database, tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isPrimary, true)));
  return row?.id ?? null;
}
