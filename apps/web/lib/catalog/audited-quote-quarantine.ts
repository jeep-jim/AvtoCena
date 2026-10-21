import audit from '../../../../data/catalog/research/public-quote-quarantine-20260916.json';
import type { SpecificationAuditField } from './specification-evidence-audit';

/** Old compact projections omit the evidence which rejected these exact IDs.
 * Preserve the audit verdict until a newer source refresh replaces the row. */
export function auditedQuoteRejections(offer: {id?: string; updatedAt?: string}): SpecificationAuditField[] {
  if (!offer.id || Date.parse(offer.updatedAt || '') > Date.parse(audit.checkedAt)) return [];
  return ((audit.records as Record<string, string[]>)[offer.id] || []) as SpecificationAuditField[];
}
