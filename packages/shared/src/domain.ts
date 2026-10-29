/** Normalizacao, validacao e instrucoes de DNS para dominios proprios. */

export const DOMAIN_STATUSES = [
  'pending',
  'awaiting_dns',
  'verifying_ownership',
  'active',
  'misconfigured',
  'unlinked',
] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const DOMAIN_STATUS_LABELS: Record<DomainStatus, string> = {
  pending: 'Pendente',
  awaiting_dns: 'Aguardando DNS',
  verifying_ownership: 'Verificando propriedade',
  active: 'Ativo',
  misconfigured: 'Erro de configuracao',
  unlinked: 'Desvinculado',
};

/**
 * Remove protocolo, porta, caminho, ponto final e caixa alta.
 * Retorna `null` quando o valor nao puder ser interpretado como hostname.
 */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  value = value.split('/')[0] ?? '';
  value = value.split('?')[0] ?? '';
  value = value.split('#')[0] ?? '';
  // Remove credenciais e porta.
  const at = value.lastIndexOf('@');
  if (at >= 0) value = value.slice(at + 1);
  value = value.split(':')[0] ?? '';
  value = value.replace(/\.+$/, '');
  if (!value) return null;
  return isValidDomain(value) ? value : null;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidDomain(value: string): boolean {
  if (value.length > 253 || value.length < 4) return false;
  if (value.includes('..') || value.startsWith('.') || value.endsWith('.')) return false;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1] ?? '';
  if (!/^[a-z]{2,}$/.test(tld)) return false;
  return labels.every((label) => LABEL.test(label));
}

/** `true` quando o dominio e um apex (exemplo.com.br) e nao um subdominio. */
export function isApexDomain(value: string): boolean {
  const labels = value.split('.');
  // Trata sufixos de dois niveis comuns no Brasil (com.br, net.br, ...).
  const twoLevel = /\.(com|net|org|gov|edu|ind|art|esp|eco|emp|tur|adv|srv)\.[a-z]{2}$/.test(value);
  return twoLevel ? labels.length === 3 : labels.length === 2;
}

export function apexOf(value: string): string {
  const labels = value.split('.');
  const take = isApexDomain(value) ? labels.length : /\.[a-z]{2,}\.[a-z]{2}$/.test(value) ? 3 : 2;
  return labels.slice(Math.max(0, labels.length - take)).join('.');
}

export interface DnsRecordInstruction {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  value: string;
  note?: string;
}

export interface DnsInstructions {
  domain: string;
  apex: boolean;
  records: DnsRecordInstruction[];
}

/**
 * Instrucoes de DNS para apontar o dominio ao host da plataforma.
 * `aRecordIp` e `cnameTarget` vem da configuracao do ambiente (Vercel).
 */
export function dnsInstructions(
  domain: string,
  options: { aRecordIp: string; cnameTarget: string; verificationTxt?: { name: string; value: string } | null },
): DnsInstructions {
  const apex = isApexDomain(domain);
  const records: DnsRecordInstruction[] = apex
    ? [
        {
          type: 'A',
          name: '@',
          value: options.aRecordIp,
          note: 'Registro A na raiz do dominio.',
        },
      ]
    : [
        {
          type: 'CNAME',
          name: domain.split('.')[0] ?? 'www',
          value: options.cnameTarget,
          note: 'Registro CNAME para o subdominio.',
        },
      ];
  if (options.verificationTxt) {
    records.push({
      type: 'TXT',
      name: options.verificationTxt.name,
      value: options.verificationTxt.value,
      note: 'Registro temporario para comprovar a propriedade do dominio.',
    });
  }
  return { domain, apex, records };
}

/**
 * Hostnames que pertencem a propria plataforma e nunca podem ser vinculados a
 * uma construtora. Aceita a lista configurada no ambiente.
 */
export function isPlatformHost(host: string, platformHosts: readonly string[]): boolean {
  const normalized = host.trim().toLowerCase().split(':')[0] ?? '';
  return platformHosts.some((candidate) => {
    const c = candidate.trim().toLowerCase();
    if (!c) return false;
    if (c.startsWith('*.')) {
      const suffix = c.slice(1); // ".exemplo.com"
      return normalized === c.slice(2) || normalized.endsWith(suffix);
    }
    return normalized === c;
  });
}

/** Hostnames que a plataforma reserva mesmo quando o dominio base e do cliente. */
export const RESERVED_SUBDOMAIN_LABELS = new Set(['app', 'painel', 'admin', 'api', 'blob', 'mail', 'smtp']);
