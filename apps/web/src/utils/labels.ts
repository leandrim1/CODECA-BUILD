import {
  LEAD_INTEREST_LABELS,
  LEAD_STATUS_LABELS,
  PROJECT_CATEGORY_LABELS,
  PROJECT_STAGE_LABELS,
  PROJECT_STATUS_LABELS,
  PROPERTY_COMMERCIAL_STATUS_LABELS,
  PROPERTY_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  PUBLICATION_STATUS_LABELS,
  SITE_STATUS_LABELS,
  TENANT_ROLE_LABELS,
  TENANT_STATUS_LABELS,
  type LeadStatus,
  type ProjectStatus,
  type PropertyCommercialStatus,
  type PublicationStatus,
  type SiteStatus,
  type TenantStatus,
} from '@codeca/shared';
import type { BadgeTone } from '@codeca/ui';

/** Rotulos e cores usados nas listagens do painel. */

export const labels = {
  publication: PUBLICATION_STATUS_LABELS,
  propertyType: PROPERTY_TYPE_LABELS,
  propertyPurpose: PROPERTY_PURPOSE_LABELS,
  propertyCommercial: PROPERTY_COMMERCIAL_STATUS_LABELS,
  projectStatus: PROJECT_STATUS_LABELS,
  projectStage: PROJECT_STAGE_LABELS,
  projectCategory: PROJECT_CATEGORY_LABELS,
  leadStatus: LEAD_STATUS_LABELS,
  leadInterest: LEAD_INTEREST_LABELS,
  tenantStatus: TENANT_STATUS_LABELS,
  tenantRole: TENANT_ROLE_LABELS,
  siteStatus: SITE_STATUS_LABELS,
} as const;

export function publicationTone(status: PublicationStatus): BadgeTone {
  if (status === 'published') return 'success';
  if (status === 'archived') return 'neutral';
  return 'warning';
}

export function commercialTone(status: PropertyCommercialStatus): BadgeTone {
  if (status === 'disponivel') return 'success';
  if (status === 'vendido' || status === 'alugado') return 'neutral';
  if (status === 'reservado') return 'warning';
  return 'info';
}

export function projectTone(status: ProjectStatus): BadgeTone {
  if (status === 'concluida') return 'success';
  if (status === 'em_andamento') return 'info';
  if (status === 'pausada') return 'warning';
  return 'neutral';
}

export function leadTone(status: LeadStatus): BadgeTone {
  if (status === 'novo') return 'brand';
  if (status === 'convertido') return 'success';
  if (status === 'perdido') return 'neutral';
  if (status === 'qualificado') return 'info';
  return 'warning';
}

export function tenantTone(status: TenantStatus): BadgeTone {
  if (status === 'active') return 'success';
  if (status === 'trialing') return 'info';
  if (status === 'suspended') return 'danger';
  return 'neutral';
}

export function siteTone(status: SiteStatus): BadgeTone {
  if (status === 'active') return 'success';
  if (status === 'suspended') return 'danger';
  if (status === 'draft') return 'warning';
  return 'neutral';
}

export function domainTone(status: string): BadgeTone {
  if (status === 'active') return 'success';
  if (status === 'misconfigured') return 'danger';
  if (status === 'unlinked') return 'neutral';
  return 'warning';
}

/** Converte um mapa de rotulos em opcoes para <select>. */
export function toOptions<T extends string>(
  map: Record<T, string>,
  values?: readonly T[],
): Array<{ value: T; label: string }> {
  const keys = values ?? (Object.keys(map) as T[]);
  return keys.map((value) => ({ value, label: map[value] }));
}
