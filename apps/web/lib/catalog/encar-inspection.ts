import type { VehicleOffer } from './types';
import type { KnowledgeCoreVariant } from './knowledge-core';
import { compatibleModificationOptions } from './modification-matching';

const clean = (value: unknown) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
export function parseEncarInspection(html: string, offer: Pick<VehicleOffer, 'sourceOfferId' | 'year' | 'vin' | 'operational'>) {
  if (!/^\d+$/.test(String(offer.sourceOfferId))) return null;
  const ids = [...html.matchAll(/"carid"\s*:\s*"(\d+)"/g)].map(match => match[1]);
  if (!ids.length || ids.some(id => id !== String(offer.sourceOfferId))) return null;
  const table = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(match => match[0])
    .find(value => /<caption[^>]*>\s*성능기록부\s*<\/caption>/.test(value));
  if (!table) return null;
  const fields = new Map<string, string[]>();
  for (const match of table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
    const key = clean(match[1]); fields.set(key, [...(fields.get(key) || []), clean(match[2])]);
  }
  const one = (key: string) => { const values = [...new Set(fields.get(key) || [])]; return values.length === 1 ? values[0] : ''; };
  const engineCode = one('원동기형식').toUpperCase();
  const year = Number(one('연식').match(/^(\d{4})년$/)?.[1]);
  const vin = one('차대번호').toUpperCase();
  const knownVin = String(offer.vin || offer.operational?.vin || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{2,19}$/.test(engineCode) || year !== offer.year || (knownVin && knownVin !== vin)) return null;
  return { sourceOfferId: String(offer.sourceOfferId), engineCode, year, identityVerified: true as const };
}

/** A code is a lookup key. Only one fully evidenced, applicable variant may be applied. */
export function matchEncarInspectionVariant(offer: VehicleOffer, variants: KnowledgeCoreVariant[], modelId: string) {
  const inspection = (offer.operational as any)?.inspection;
  if (offer.sourceId !== 'encar_direct' || offer.market !== 'korea' || !inspection?.identityVerified
    || inspection.sourceOfferId !== String(offer.sourceOfferId) || inspection.year !== offer.year) return null;
  const code = String(inspection.engineCode || '').toUpperCase();
  if (!code) return null;
  const applicable = variants.filter(variant => variant.modelId === modelId
    && ['korea', 'kr', 'southkorea'].includes(String(variant.market || '').toLowerCase())
    && String(variant.engineCode || '').toUpperCase() === code
    && variant.status === 'verified'
    && variant.evidence?.some(item => item.sourceId && item.status === 'verified'
      && ['official', 'high'].includes(String(item.confidence)) && item.fields?.includes('engineCode')));
  const compatible = compatibleModificationOptions(offer, applicable, modelId);
  return compatible.length === 1 ? applicable.find(variant => variant.id === compatible[0].id) || null : null;
}
