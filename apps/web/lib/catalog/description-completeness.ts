import type { VehicleOffer } from "./types";

// This checks completeness only. Source evidence and calculation checks remain
// the responsibility of the existing quality/calculation gates.
export function catalogDescriptionRejectionReason(offer: Pick<VehicleOffer, "market" | "bodyType" | "drive" | "transmission">): string {
  if (offer.market === "japan") return "";
  for (const field of ["bodyType", "drive", "transmission"] as const) {
    const value = String(offer[field] || "").trim();
    if (!value || /^(?:unknown|undefined|null|none|n\/?a|other|неизвестно|не указано|уточняется|-)$/iu.test(value)) {
      return `description_${field}_missing`;
    }
  }
  return "";
}
