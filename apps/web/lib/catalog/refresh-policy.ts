import policy from "../../../../data/catalog/refresh-policy-v1.json";
import type { VehicleOffer } from "./types";

export const CATALOG_REFRESH_POLICY = policy;
export const CATALOG_DAY_MS = 24 * 60 * 60 * 1_000;
export function catalogMarketLifecycle(market: string) {
  return market === "japan" ? policy.japan : policy.nonJapan;
}
export function catalogMarketRetentionMs(market: string) {
  return catalogMarketLifecycle(market).retentionDays * CATALOG_DAY_MS;
}
/** Source candidate JSON chunks must survive the owner's weekly/fortnightly cycle. */
export function catalogCandidateObjectExpired(key: string, modifiedAt: string, now = Date.now()) {
  const market = key.match(/^catalog\/source-candidates\/(korea|europe|china|uae|georgia|japan)\//)?.[1];
  const timestamp = Date.parse(modifiedAt);
  return Boolean(market && Number.isFinite(timestamp) && now - timestamp > catalogMarketRetentionMs(market));
}
export function catalogOfferConfirmedWithdrawn(offer: Partial<VehicleOffer>) {
  return offer.market !== "japan" && ["sold", "removed"].includes(String(offer.status));
}
export function catalogOfferFreshness(offer: Partial<VehicleOffer>) {
  const value = offer.market === "japan"
    ? offer.auctionDate || offer.operational?.sourcePublishedAt || offer.firstSeenAt || offer.updatedAt
    : offer.operational?.lastSeenAt || offer.updatedAt || offer.operational?.sourcePublishedAt || offer.firstSeenAt;
  return Date.parse(String(value || "")) || 0;
}
/** Freeze the existing observation before a serializer/repricer changes updatedAt. */
export function preserveCatalogOfferObservation<T extends VehicleOffer>(offer: T): T {
  if (offer.market === "japan" || offer.operational?.lastSeenAt) return offer;
  const previous = catalogOfferFreshness(offer);
  return previous > 0 ? observeCatalogOffer(offer, new Date(previous).toISOString()) : offer;
}
export function catalogOfferWithinRetention(offer: Partial<VehicleOffer>, now = Date.now()) {
  const freshness = catalogOfferFreshness(offer);
  return !catalogOfferConfirmedWithdrawn(offer) && freshness > 0 && now - freshness <= catalogMarketRetentionMs(String(offer.market));
}
/** Only call after receiving this listing from its source, never during repricing. */
export function observeCatalogOffer<T extends VehicleOffer>(offer: T, observedAt: string): T {
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("catalog_observation_date_invalid");
  return { ...offer, operational: { ...offer.operational, lastSeenAt: observedAt } };
}
