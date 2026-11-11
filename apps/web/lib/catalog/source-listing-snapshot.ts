import type { VehicleOffer } from "./types";

/** A research/collection record, deliberately separate from publishable offers. */
export function sourceListingSnapshot(offer: VehicleOffer, stage: "listing" | "detail") {
  // No guessing and no reuse of a previously calculated price. Unknown technical
  // fields do not disqualify an observed listing from the collection artifact.
  const snapshot = structuredClone(offer);
  snapshot.totalRub = null;
  delete snapshot.previousTotalRub;
  delete snapshot.priceDeltaRub;
  delete snapshot.priceChangedAt;
  delete snapshot.calculationSnapshot;
  delete snapshot.modificationSelection;
  delete snapshot.recoveryQualification;
  snapshot.calculationStatus = "needs_data";
  return { version: 1 as const, stage, publicationReady: false as const, offer: snapshot };
}
