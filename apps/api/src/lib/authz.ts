import { and, eq, gt, isNull, schema, type Database } from '@codeca/database';
import {
  AppError,
  roleCan,
  platformRoleCan,
  tenantCapabilities,
  type PlatformCapability,
  type TenantCapability,
  type TenantRole,
  type TenantStatus,
} from '@codeca/shared';
import type { AuthenticatedSession } from './session.js';

/**
 * Isolamento multiempresa e autorizacao.
 *
 * Regras que este modulo garante:
 *
 * 1. O `tenantId` vem sempre da rota e e conferido contra os vinculos reais do
 *    usuario no banco. Um `tenantId` enviado no corpo da requisicao e ignorado.
 * 2. Quando o usuario nao tem vinculo com a empresa, a resposta e 404 -- e nao
 *    403 -- para nao revelar que a empresa existe.
 * 3. `platform_admin` nao recebe acesso ao conteudo de nenhuma empresa por
 *    padrao: e necessaria uma concessao de suporte explicita, temporaria,
 *    somente leitura e registrada em auditoria.
 * 4. Empresas suspensas ou canceladas ficam em modo leitura.
 */

export interface TenantContext {
  tenantId: string;
  slug: string;
  displayName: string;
  status: TenantStatus;
  planId: string;
  role: TenantRole;
  capabilities: ReadonlySet<TenantCapability>;
  /** Acesso obtido por concessao de suporte da plataforma. */
  viaSupportGrant: boolean;
  supportGrantId: string | null;
  /** Quando true, nenhuma escrita e permitida. */
  readOnly: boolean;
}

const WRITABLE_TENANT_STATUSES: readonly TenantStatus[] = ['trialing', 'active'];

/**
 * Resolve o acesso do usuario autenticado a uma empresa.
 * Lanca 404 quando nao existe vinculo valido.
 */
export async function resolveTenantContext(
  db: Database,
  session: AuthenticatedSession,
  tenantId: string,
  now = new Date(),
): Promise<TenantContext> {
  const [tenant] = await db
    .select({
      id: schema.tenants.id,
      slug: schema.tenants.slug,
      displayName: schema.tenants.displayName,
      status: schema.tenants.status,
      planId: schema.tenants.planId,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));

  if (!tenant) throw AppError.notFound('Empresa nao encontrada.');

  const [membership] = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.tenantId, tenantId),
        eq(schema.memberships.userId, session.user.id),
        eq(schema.memberships.status, 'active'),
      ),
    );

  const status = tenant.status as TenantStatus;
  const tenantIsWritable = WRITABLE_TENANT_STATUSES.includes(status);

  if (membership) {
    const role = membership.role as TenantRole;
    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
      status,
      planId: tenant.planId,
      role,
      capabilities: new Set(tenantCapabilities(role)),
      viaSupportGrant: false,
      supportGrantId: null,
      readOnly: !tenantIsWritable,
    };
  }

  // Sem vinculo: a unica porta restante e uma concessao de suporte valida.
  if (session.user.platformRole === 'platform_admin') {
    const [grant] = await db
      .select({ id: schema.supportAccessGrants.id })
      .from(schema.supportAccessGrants)
      .where(
        and(
          eq(schema.supportAccessGrants.tenantId, tenantId),
          eq(schema.supportAccessGrants.platformUserId, session.user.id),
          isNull(schema.supportAccessGrants.revokedAt),
          gt(schema.supportAccessGrants.expiresAt, now),
        ),
      );

    if (grant) {
      // Concessao de suporte e sempre somente leitura.
      const readCapabilities = tenantCapabilities('viewer');
      return {
        tenantId: tenant.id,
        slug: tenant.slug,
        displayName: tenant.displayName,
        status,
        planId: tenant.planId,
        role: 'viewer',
        capabilities: new Set(readCapabilities),
        viaSupportGrant: true,
        supportGrantId: grant.id,
        readOnly: true,
      };
    }
  }

  throw AppError.notFound('Empresa nao encontrada.');
}

/** Garante uma capacidade no escopo da empresa. */
export function assertTenantCapability(context: TenantContext, capability: TenantCapability): void {
  if (!context.capabilities.has(capability)) {
    throw AppError.forbidden(
      context.viaSupportGrant
        ? 'O acesso de suporte e somente leitura e nao permite esta operacao.'
        : `Seu papel (${context.role}) nao permite esta operacao.`,
    );
  }
  if (isWriteCapability(capability) && context.readOnly) {
    throw AppError.forbidden(
      context.viaSupportGrant
        ? 'O acesso de suporte e somente leitura.'
        : 'A conta desta empresa esta suspensa. Entre em contato com o suporte para reativar.',
    );
  }
}

export function isWriteCapability(capability: TenantCapability): boolean {
  return !capability.endsWith(':read');
}

export function tenantCan(context: TenantContext, capability: TenantCapability): boolean {
  if (!context.capabilities.has(capability)) return false;
  if (isWriteCapability(capability) && context.readOnly) return false;
  return true;
}

/** Garante uma capacidade global do painel mestre. */
export function assertPlatformCapability(
  session: AuthenticatedSession,
  capability: PlatformCapability,
): void {
  if (!platformRoleCan(session.user.platformRole, capability)) {
    throw AppError.forbidden('Esta area e restrita a administradores da plataforma.');
  }
}

export function isPlatformAdmin(session: AuthenticatedSession): boolean {
  return session.user.platformRole === 'platform_admin';
}

/**
 * Confere se um papel pode gerenciar outro. Usado na gestao de equipe para
 * impedir, por exemplo, que um `admin` promova alguem a `owner`.
 */
export function assertCanManageRole(context: TenantContext, targetRole: TenantRole): void {
  if (targetRole === 'owner' && context.role !== 'owner') {
    throw AppError.forbidden('Apenas o proprietario pode conceder o papel de proprietario.');
  }
  if (!roleCan(context.role, 'members:update') && !roleCan(context.role, 'members:invite')) {
    throw AppError.forbidden('Seu papel nao permite gerenciar a equipe.');
  }
}

/**
 * Verifica que um registro pertence a empresa do contexto.
 *
 * Todas as consultas desta API ja filtram por `tenant_id`, o que torna esta
 * funcao uma segunda barreira para o caso de um identificador chegar por outro
 * caminho. A mensagem e sempre 404, para nao confirmar a existencia do registro
 * em outra empresa.
 */
export function assertBelongsToTenant(
  row: { tenantId: string } | null | undefined,
  context: TenantContext,
  label = 'Registro',
): void {
  if (!row || row.tenantId !== context.tenantId) {
    throw AppError.notFound(`${label} nao encontrado.`);
  }
}

/** Registra o uso de uma concessao de suporte, quando aplicavel. */
export function supportGrantMetadata(context: TenantContext): Record<string, unknown> {
  return context.viaSupportGrant
    ? { viaSupportGrant: true, supportGrantId: context.supportGrantId }
    : {};
}
