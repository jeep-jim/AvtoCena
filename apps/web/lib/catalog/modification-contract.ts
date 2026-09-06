import type { VehicleOffer } from "./types";

export type CatalogModificationOption = {
  id: string;
  label: string;
  market: string;
  fuel: string;
  powertrainKind: Exclude<VehicleOffer["powertrainKind"], "unknown" | undefined>;
  engineCc?: number;
  powerHp: number;
  powerKw: number;
  icePowerKw?: number;
  power30MinKw?: number;
  transmission?: string;
  drive?: string;
  evidenceIds: string[];
};

export type CatalogModificationSelection = {
  version: 1;
  status: "selection_required";
  binding: string;
  options: CatalogModificationOption[];
};

// This is a binding to the saved listing, not a signature or user authorization.
// Options are produced on the server; request parameters contain only an ID.
export function modificationBinding(offer: any) {
  return JSON.stringify([offer?.id, offer?.market, offer?.make, offer?.model,
    offer?.year, offer?.sourcePrice, offer?.sourceCurrency]);
}

export function isModificationScenario(offer: any) {
  return offer?.calculationSnapshot?.modificationScenario?.source === "customer_selection";
}

export function hasModificationSelection(offer: any): boolean {
  const selection = offer?.modificationSelection;
  return offer?.market !== "japan"
    && selection?.version === 1 && selection.status === "selection_required"
    && selection.binding === modificationBinding(offer)
    && Array.isArray(selection.options) && selection.options.length > 0
    && selection.options.length <= 40
    && selection.options.every(isCalculableModificationOption);
}

export function isCalculableModificationOption(option: CatalogModificationOption) {
  if (!option?.id || !option.label || !option.market || !option.evidenceIds?.length
    || !Number.isFinite(option.powerHp) || option.powerHp < 20 || option.powerHp > 2500
    || !Number.isFinite(option.powerKw) || option.powerKw <= 0
    || Math.abs(option.powerHp * 0.73549875 - option.powerKw) > 1) return false;
  if (option.powertrainKind === "combustion") {
    return ["petrol", "diesel", "lpg", "cng"].includes(option.fuel)
      && Number.isInteger(option.engineCc) && Number(option.engineCc) >= 300 && Number(option.engineCc) <= 10000;
  }
  if (!Number.isFinite(option.power30MinKw) || Number(option.power30MinKw) <= 0) return false;
  if (option.powertrainKind === "electric") return option.fuel === "electric" && !option.engineCc;
  return ["series_hybrid", "other_hybrid"].includes(option.powertrainKind)
    && option.fuel === "hybrid" && Number(option.engineCc) >= 300 && Number(option.icePowerKw) > 0;
}

export function withoutDeliveredPrice<T extends VehicleOffer>(offer: T): T {
  return { ...offer, totalRub: null, previousTotalRub: null, priceDeltaRub: null,
    calculationStatus: "needs_modification", calculationSnapshot: {},
    publicVisibleRub: undefined, publicSpecificationVerified: false } as T;
}

/** Input is already deduplicated. A personal scenario never counts as automatic. */
export function limitModificationInventory<T extends VehicleOffer>(offers: T[], visiblePrice: (offer: T) => number) {
  const automatic = new Map<string, number>();
  const selected = new Map<string, number>();
  const retained: T[] = [];
  for (const offer of offers) {
    if (offer.market !== "japan" && !hasModificationSelection(offer) && !isModificationScenario(offer)
      && visiblePrice(offer) > 0) automatic.set(offer.market, (automatic.get(offer.market) || 0) + 1);
  }
  for (const offer of offers) {
    if (offer.market === "japan") { retained.push(offer); continue; }
    if (isModificationScenario(offer)) continue;
    if (!hasModificationSelection(offer)) { if (visiblePrice(offer) > 0) retained.push(offer); continue; }
    const used = selected.get(offer.market) || 0;
    if (used < Math.floor((automatic.get(offer.market) || 0) / 4)) {
      selected.set(offer.market, used + 1); retained.push(offer);
    }
  }
  return retained;
}
