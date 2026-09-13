import { chinaInventoryAgeDecision } from './china-owner-policy';
import type { VehicleOffer } from './types';

export const AUTOHOME_NEW_MIN_YEAR = 2026;

/** Autohome is a new-model catalog, never the used-car inventory of China. */
export function sourceInventoryInScope(offer: Partial<VehicleOffer>): boolean {
  if (offer.market === 'china' && !chinaInventoryAgeDecision(offer).eligible) return false;
  return offer.sourceId !== 'autohome_new_china_open'
    || (Number(offer.year) >= AUTOHOME_NEW_MIN_YEAR && !(Number(offer.mileageKm) > 0));
}
