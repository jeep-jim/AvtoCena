import type { VehicleOffer } from "./types";

// Stock without source fuel uses the configured petrol calculation default.
// Never replace a recorded fuel or an electric/hybrid powertrain.
export function withGreenCornerFuel(offer: VehicleOffer): VehicleOffer {
 if (offer.fuel?.trim()) return offer;
 const fuel = offer.powertrainKind === "electric" ? "electric"
  : ["series_hybrid", "other_hybrid"].includes(offer.powertrainKind || "") ? "hybrid" : "petrol";
 return {...offer, fuel};
}
