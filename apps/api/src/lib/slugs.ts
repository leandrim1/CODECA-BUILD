import { and, eq, ne, schema, type Database } from '@codeca/database';
import { slugify, uniqueSlug } from '@codeca/shared';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

/**
 * Geracao de slugs unicos dentro do escopo de uma empresa.
 * O indice unico `(tenant_id, slug)` garante a regra tambem no banco.
 */

interface SluggableTable {
  table: PgTable;
  tenantId: PgColumn;
  slug: PgColumn;
  id: PgColumn;
}

const TABLES = {
  properties: {
    table: schema.properties,
    tenantId: schema.properties.tenantId,
    slug: schema.properties.slug,
    id: schema.properties.id,
  },
  projects: {
    table: schema.projects,
    tenantId: schema.projects.tenantId,
    slug: schema.projects.slug,
    id: schema.projects.id,
  },
  services: {
    table: schema.services,
    tenantId: schema.services.tenantId,
    slug: schema.services.slug,
    id: schema.services.id,
  },
  pages: {
    table: schema.pages,
    tenantId: schema.pages.tenantId,
    slug: schema.pages.slug,
    id: schema.pages.id,
  },
} satisfies Record<string, SluggableTable>;

export type SluggableEntity = keyof typeof TABLES;

export async function buildUniqueSlug(
  db: Database,
  entity: SluggableEntity,
  input: { tenantId: string; desired: string; excludeId?: string },
): Promise<string> {
  const config = TABLES[entity];
  const base = slugify(input.desired) || entity;

  const conditions = [eq(config.tenantId, input.tenantId)];
  if (input.excludeId) conditions.push(ne(config.id, input.excludeId));

  const rows = await db
    .select({ slug: config.slug })
    .from(config.table)
    .where(and(...conditions));

  return uniqueSlug(base, rows.map((row) => String(row.slug)));
}
