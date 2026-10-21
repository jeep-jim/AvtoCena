import { catalogOfferVisibleRub } from "./public-priority";
import { isSellerPricedOffer } from "./seller-price-contract";
import type { VehicleOffer } from "./types";

/** Removals must come from an explicit per-ID pipeline decision, never a missing-ID diff. */
export function assertNoDeliveredPriceRegression(previous: VehicleOffer[], next: VehicleOffer[], policy: {
  allowSellerTransition?: boolean;
  auditedRemovals?: ReadonlyMap<string, string>;
} = {}) {
  const byId = new Map(next.map(offer => [offer.id, offer]));
  const lost = previous.filter(offer => {
    const replacement = byId.get(offer.id);
    if (!replacement) {
      const reason = policy.auditedRemovals?.get(offer.id);
      return !reason || !/^(audit|canonical|selection):[^:]+/.test(reason) || reason.includes("exception:");
    }
    if (replacement.market !== offer.market) return true;
    if (!(catalogOfferVisibleRub(offer) > 0)) return false;
    return !(catalogOfferVisibleRub(replacement) > 0)
      && !(policy.allowSellerTransition && offer.market !== "japan" && isSellerPricedOffer(replacement));
  });
  if (lost.length) throw new Error(`catalog_delivered_price_regression:${lost.length}:${lost.slice(0,5).map(offer=>offer.id).join(",")}`);
}
