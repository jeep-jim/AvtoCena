import { catalogOfferVisibleRub } from "./public-priority";
import type { VehicleOffer } from "./types";

/** Call with retained rows only: confirmed removals and expired rows are already excluded. */
export function assertNoDeliveredPriceRegression(previous: VehicleOffer[], next: VehicleOffer[]) {
  const byId = new Map(next.map(offer => [offer.id, offer]));
  const lost = previous.filter(offer => catalogOfferVisibleRub(offer) > 0
    && (!byId.has(offer.id) || !(catalogOfferVisibleRub(byId.get(offer.id)) > 0)));
  if (lost.length) throw new Error(`catalog_delivered_price_regression:${lost.length}:${lost.slice(0,5).map(offer=>offer.id).join(",")}`);
}
