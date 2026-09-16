import type { VehicleOffer } from "./types";
import { catalogMarketRetentionMs } from "./refresh-policy";
import { isAllowedCatalogSourceUrl } from "./required-catalog-sources";
import { catalogOfferWithdrawnByReport } from "./source-retention";

export type UnavailableOffer = {
  id: string;
  market: VehicleOffer["market"];
  make: string;
  model: string;
  sourceUrl?: string;
  reason: "sold" | "removed" | "unavailable";
  removedAt: string;
};

// Missing from a publication (including expiry/quota) is not proof of a sale.
// Only identity-matched, newer source evidence can supply an explicit reason.
export function unavailableOfferRecord(offer: VehicleOffer, withdrawals = new Map<string, Record<string, unknown>>(), now = new Date()): UnavailableOffer {
  const evidence = catalogOfferWithdrawnByReport(offer, withdrawals) ? withdrawals.get(offer.id) : undefined;
  const reason = evidence?.status === "sold" ? "sold" : evidence?.status === "removed" ? "removed" : "unavailable";
  const url = offer.operational?.sourceUrl;
  return {id: offer.id, market: offer.market, make: offer.make, model: offer.model,
    sourceUrl: isAllowedCatalogSourceUrl(offer.market, offer.sourceId, url) ? String(url) : undefined,
    reason, removedAt: now.toISOString()};
}

// Metadata lives inside immutable generations, subject to the existing cleanup.
// Carry it for the same 14-day window, never prolong it at every refresh.
export function mergeUnavailableOffers(previous: UnavailableOffer[], incoming: UnavailableOffer[], activeIds: Set<string>, now = Date.now()) {
  const rows = new Map<string, UnavailableOffer>();
  for (const row of [...previous, ...incoming]) {
    const timestamp = Date.parse(row.removedAt);
    if (!row.id || row.market === "japan" || activeIds.has(row.id) || !Number.isFinite(timestamp)
      || timestamp > now || now - timestamp > catalogMarketRetentionMs(row.market)) continue;
    rows.set(row.id, row);
  }
  return [...rows.values()];
}
