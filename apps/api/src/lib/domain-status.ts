import type { DomainStatus } from '@codeca/shared';
import type { DomainProviderStatus } from './vercel-domains.js';

/**
 * Traduz o estado do provedor para o estado exibido no painel.
 * Sem provedor configurado, o dominio nunca passa de "aguardando DNS".
 */
export function mapProviderStatus(
  status: DomainProviderStatus,
  providerConfigured: boolean,
): { status: DomainStatus } {
  if (!providerConfigured) return { status: 'awaiting_dns' };
  if (status.ownershipVerified && status.dnsConfigured) return { status: 'active' };
  if (status.ownershipVerified && !status.dnsConfigured) return { status: 'misconfigured' };
  if (status.challenges.length > 0) return { status: 'verifying_ownership' };
  return { status: 'awaiting_dns' };
}

/**
 * Os campos de `domains` que uma verificacao regrava.
 *
 * Em um lugar so porque o botao "Verificar novamente" e a reverificacao
 * automatica tem que gravar exatamente o mesmo: se divergirem, o mesmo dominio
 * apareceria em estados diferentes conforme quem olhou por ultimo.
 */
export function verificationPatch(
  current: { verifiedAt: Date | null; vercelDomainId: string | null },
  provider: DomainProviderStatus,
  status: DomainStatus,
  now: Date,
) {
  return {
    status,
    dnsConfigured: provider.dnsConfigured,
    ownershipVerified: provider.ownershipVerified,
    sslStatus: provider.sslActive ? ('active' as const) : ('pending' as const),
    vercelDomainId: provider.providerDomainId ?? current.vercelDomainId,
    verificationRecordName: provider.challenges[0]?.domain ?? '',
    verificationRecordValue: provider.challenges[0]?.value ?? '',
    lastError: status === 'misconfigured' ? provider.message : '',
    lastCheckedAt: now,
    verifiedAt: status === 'active' ? (current.verifiedAt ?? now) : null,
    updatedAt: now,
  };
}
