import type { VehicleOffer } from "./types";
import { validatePublishableOffer } from "./validation";
export function isPublicCatalogOffer(offer: VehicleOffer) {
  return validatePublishableOffer(offer).ok && offer.availability === "live" && offer.importEligibility !== "blocked" && !!offer.sourceUrl && !!offer.priceLocal && !!offer.year && (!!offer.mileageKm || offer.condition === "new") && (!!offer.engineCc || !!offer.trim) && (!!offer.advertisedPower || !!offer.icePowerHp || !!offer.systemPowerHp) && (offer.imageMode === "source_page_only" || !!offer.coverImage);
}
