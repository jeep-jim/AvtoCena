import type { VehicleOffer } from "./types";

/** Editable missing specifications do not reject an otherwise valid listing.
 * Price, provenance, identity, freshness and calculation gates remain separate.
 * Never fill absent values just to make a calculation appear complete.
 */
export function catalogDescriptionRejectionReason(_offer: Pick<VehicleOffer, "market" | "bodyType" | "drive" | "transmission">): string {
  return "";
}
