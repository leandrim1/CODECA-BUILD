import { and, eq, schema } from '@codeca/database';
import { AppError, type AnalyticsConnectionStatus, type AnalyticsConnectionView } from '@codeca/shared';
import { AUDIT_ACTIONS, recordAudit } from '../audit.js';
import type { AppContext } from '../../context.js';
import { parseEncryptionKey, decryptSecret, encryptSecret } from '../secret-box.js';
import { AnalyticsGoogleError, refreshAnalyticsAccessToken } from './google.js';

/**
 * Conexao de um site com o Google Analytics: leitura, renovacao do acesso e
 * invalidacao.
 *
 * ## Isolamento
 *
 * Toda consulta filtra por `tenant_id` E `site_id` vindos do contexto da
 * requisicao (nunca do corpo). Alem disso, o token cifrado so decifra com o par
 * (empresa, site) a que pertence (AAD): uma linha copiada para outra empresa
 * falha ao decifrar.
 */

export type AnalyticsConnectionRow = typeof schema.analyticsConnections.$inferSelect;

export interface TenantSite {
  tenantId: string;
  siteId: string;
}

/** Contexto autenticado da cifra: empresa + site. */
export const connectionAad = (scope: TenantSite): string => `ga4:${scope.tenantId}:${scope.siteId}`;

export function encryptionKey(ctx: AppContext): Buffer {
  const key = parseEncryptionKey(ctx.env.INTEGRATIONS_ENCRYPTION_KEY);
  if (!key || !ctx.features.googleAnalytics) {
    throw AppError.notConfigured(
      'A integração com o Google Analytics não está configurada. Defina GOOGLE_CLIENT_ID, '
        + 'GOOGLE_CLIENT_SECRET e INTEGRATIONS_ENCRYPTION_KEY no ambiente do servidor.',
    );
  }
  return key;
}

export function sealRefreshToken(ctx: AppContext, scope: TenantSite, refreshToken: string): string {
  return encryptSecret(encryptionKey(ctx), refreshToken, connectionAad(scope));
}

export async function loadConnection(ctx: AppContext, scope: TenantSite): Promise<AnalyticsConnectionRow | null> {
  const [row] = await ctx.db
    .select()
    .from(schema.analyticsConnections)
    .where(
      and(
        eq(schema.analyticsConnections.tenantId, scope.tenantId),
        eq(schema.analyticsConnections.siteId, scope.siteId),
      ),
    );
  return row ?? null;
}

/** O que o painel recebe: nunca o token, nem cifrado. */
export function connectionView(row: AnalyticsConnectionRow): AnalyticsConnectionView {
  return {
    status: row.status as AnalyticsConnectionStatus,
    propertyId: row.propertyId,
    propertyName: row.propertyName,
    accountName: row.accountName,
    connectedAt: row.connectedAt.toISOString(),
    lastError: row.lastError,
  };
}

/** Descarta o que esta instancia guarda sobre a conexao (token de acesso e relatorios). */
export function dropConnectionCaches(ctx: AppContext, row: Pick<AnalyticsConnectionRow, 'id' | 'tenantId' | 'siteId'>): void {
  ctx.caches.analyticsToken.delete(row.id);
  ctx.caches.analyticsReport.deleteWhere((key) => key.startsWith(`${row.tenantId}:${row.siteId}:`));
}

async function markNeedsReconnect(ctx: AppContext, row: AnalyticsConnectionRow, reason: string): Promise<void> {
  await ctx.db
    .update(schema.analyticsConnections)
    .set({ status: 'needs_reconnect', lastError: reason.slice(0, 300), updatedAt: ctx.now() })
    .where(eq(schema.analyticsConnections.id, row.id));
  dropConnectionCaches(ctx, row);
  await recordAudit(ctx.db, ctx.env, {
    tenantId: row.tenantId,
    action: AUDIT_ACTIONS.analyticsNeedsReconnect,
    entityType: 'analytics_connection',
    entityId: row.id,
    metadata: { propertyId: row.propertyId },
  });
}

/**
 * Token de acesso valido para a conexao.
 *
 * Renova com o refresh token quando nao ha um em memoria. Renovacoes
 * simultaneas da mesma conexao se juntam em uma (dedupe do cache). Se o Google
 * recusar a renovacao (acesso revogado), a conexao passa a `needs_reconnect` e
 * a requisicao recebe 409 com o motivo -- o painel mostra "Reconectar".
 */
export async function getAccessToken(ctx: AppContext, row: AnalyticsConnectionRow): Promise<string> {
  if (row.status === 'needs_reconnect') throw reconnectError();
  const key = encryptionKey(ctx);

  try {
    return await ctx.caches.analyticsToken.getOrLoad(row.id, async () => {
      const refreshToken = decryptSecret(key, row.refreshTokenEnc, connectionAad(row));
      const fresh = await refreshAnalyticsAccessToken(ctx.fetch, {
        clientId: ctx.env.GOOGLE_CLIENT_ID!,
        clientSecret: ctx.env.GOOGLE_CLIENT_SECRET!,
        refreshToken,
      });
      await ctx.db
        .update(schema.analyticsConnections)
        .set({ lastRefreshAt: ctx.now(), lastError: '' })
        .where(eq(schema.analyticsConnections.id, row.id));
      return fresh.accessToken;
    });
  } catch (error) {
    if (error instanceof AnalyticsGoogleError && error.code === 'revoked') {
      await markNeedsReconnect(ctx, row, 'O acesso ao Google foi revogado ou expirou.');
      throw reconnectError();
    }
    throw mapGoogleError(error);
  }
}

export function reconnectError(): AppError {
  return AppError.conflict('A conexão com o Google Analytics foi revogada ou expirou. Reconecte.', {
    reason: 'needs_reconnect',
  });
}

/** Traduz falhas do Google para erros da API, sem vazar corpo de resposta alheia. */
export function mapGoogleError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof AnalyticsGoogleError) {
    switch (error.code) {
      case 'api_disabled':
        return new AppError('upstream_error', 'A API do Google Analytics não está ativada no projeto do Google Cloud. Ative a Analytics Data API e a Analytics Admin API.', { reason: error.code });
      case 'no_access':
        return AppError.forbidden('A conta Google conectada não tem acesso a esta propriedade.');
      case 'quota':
        return AppError.unavailable('O Google Analytics limitou as consultas. Tente novamente em instantes.', 30);
      case 'revoked':
        return reconnectError();
      default:
        return new AppError('upstream_error', 'O Google Analytics não respondeu como esperado. Tente novamente.', { reason: error.code });
    }
  }
  console.error('[analytics] erro inesperado:', error instanceof Error ? error.name : 'desconhecido');
  return AppError.internal('Não foi possível consultar o Google Analytics.');
}
