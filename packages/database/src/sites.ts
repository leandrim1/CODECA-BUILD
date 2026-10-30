import { and, eq } from 'drizzle-orm';
import {
  DOCUMENT_SCHEMAS,
  MODULE_KEYS,
  isModuleKey,
  type DocumentModuleKey,
  type SegmentCode,
} from '@codeca/shared';
import type { Database } from './client.js';
import { contentDocuments, segments, siteModules, sites, tenants } from './schema.js';

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
    .select({ id: segments.id, defaultModules: segments.defaultModules })
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

  await provisionSiteModules(db, {
    tenantId: input.tenantId,
    siteId: created.id,
    moduleKeys: segmentModules(segment?.defaultModules),
    companyName: input.name,
  });

  return created;
}

/** Modulos do segmento, filtrados pelo registro: o banco pode estar adiante. */
function segmentModules(defaults: string[] | null | undefined): string[] {
  const lista = defaults && defaults.length > 0 ? defaults : [...MODULE_KEYS];
  return lista.filter(isModuleKey);
}

export interface ProvisionSiteModulesInput {
  tenantId: string;
  siteId: string;
  moduleKeys: string[];
  companyName: string;
}

/**
 * Habilita os modulos de um site e cria os documentos de instancia unica.
 *
 * Os documentos nascem **preenchidos** com o que a empresa ja informou no
 * cadastro. Um painel que abre vazio parece quebrado, e o cliente nao tem como
 * saber se e assim mesmo ou se o dado se perdeu.
 */
export async function provisionSiteModules(
  db: Database,
  input: ProvisionSiteModulesInput,
): Promise<void> {
  if (input.moduleKeys.length > 0) {
    await db
      .insert(siteModules)
      .values(
        input.moduleKeys.map((moduleKey) => ({
          tenantId: input.tenantId,
          siteId: input.siteId,
          moduleKey,
          enabled: true,
        })),
      )
      .onConflictDoNothing();
  }

  const documentos = input.moduleKeys.filter(
    (key): key is DocumentModuleKey => key === 'institucional' || key === 'contato',
  );
  if (documentos.length === 0) return;

  const [tenant] = await db
    .select({
      displayName: tenants.displayName,
      description: tenants.description,
      foundedYear: tenants.foundedYear,
      contactEmail: tenants.contactEmail,
      contactPhone: tenants.contactPhone,
      whatsapp: tenants.whatsapp,
      whatsappDefaultMessage: tenants.whatsappDefaultMessage,
      address: tenants.address,
      serviceArea: tenants.serviceArea,
      businessHours: tenants.businessHours,
      social: tenants.social,
    })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));

  const semente: Record<DocumentModuleKey, Record<string, unknown>> = {
    institucional: {
      companyName: tenant?.displayName ?? input.companyName,
      shortDescription: tenant?.description ?? '',
      foundedYear: tenant?.foundedYear ?? null,
    },
    contato: {
      email: tenant?.contactEmail ?? '',
      phone: tenant?.contactPhone ?? '',
      whatsapp: tenant?.whatsapp ?? '',
      whatsappMessage: tenant?.whatsappDefaultMessage ?? '',
      addressLine: [tenant?.address?.street, tenant?.address?.number]
        .filter(Boolean)
        .join(', '),
      city: tenant?.address?.city ?? '',
      state: tenant?.address?.state ?? '',
      postalCode: tenant?.address?.postalCode ?? '',
      businessHours: tenant?.businessHours ?? '',
      serviceArea: tenant?.serviceArea ?? '',
      social: tenant?.social ?? {},
    },
  };

  await db
    .insert(contentDocuments)
    .values(
      documentos.map((moduleKey) => ({
        tenantId: input.tenantId,
        siteId: input.siteId,
        moduleKey,
        data: DOCUMENT_SCHEMAS[moduleKey].parse(semente[moduleKey]) as Record<string, unknown>,
      })),
    )
    .onConflictDoNothing();
}

/** Site que o painel abre por padrao para esta empresa. */
export async function findPrimarySiteId(db: Database, tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isPrimary, true)));
  return row?.id ?? null;
}
