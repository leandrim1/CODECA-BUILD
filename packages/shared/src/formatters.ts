/** Formatadores de exibicao usados no painel e no site publico. */

export function formatCurrency(value: number | null | undefined, currency = 'BRL'): string {
  if (value === null || value === undefined) return '';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value}`;
  }
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return new Intl.NumberFormat('pt-BR').format(value);
}

export function formatArea(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)} m2`;
}

const MONTHS = [
  'janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro',
];

/** Formata `AAAA-MM-DD` sem depender de fuso horario. */
export function formatIsoDate(value: string | null | undefined, style: 'short' | 'long' | 'month' = 'short'): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return '';
  const [, y, m, d] = match;
  const month = Number(m) - 1;
  if (style === 'short') return `${d}/${m}/${y}`;
  if (style === 'month') return `${MONTHS[month] ?? m}/${y}`;
  return `${Number(d)} de ${MONTHS[month] ?? m} de ${y}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `ha ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `ha ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `ha ${days} d`;
  return formatDateTime(date);
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** Resume o endereco respeitando a opcao de exibicao publica. */
export function formatPublicAddress(address: {
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  showFullAddress?: boolean;
}): string {
  const city = [address.city, address.state].filter(Boolean).join(' - ');
  if (address.showFullAddress === false) {
    return [address.neighborhood, city].filter(Boolean).join(', ');
  }
  const street = [address.street, address.number].filter(Boolean).join(', ');
  return [street, address.neighborhood, city].filter(Boolean).join(' - ');
}
