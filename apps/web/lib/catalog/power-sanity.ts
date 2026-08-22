import type { VehicleOffer } from "./types";

export type CatalogPowerSanity = {
  powerHp?: number;
  suspicious: boolean;
  reason: string;
};

function positive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Marketplace pages frequently format horsepower with thousands separators.
 * Parse the complete token so `1,997 HP` can never silently become `997 HP`.
 */
export function parseCatalogHorsepowerToken(value: unknown) {
  const text = String(value || "");
  const match = text.match(/(?:^|[^0-9])([0-9]{1,3}(?:[,\s][0-9]{3})+|[0-9]{2,4}(?:\.[0-9]+)?)\s*(?:hp|ps|bhp)\b/i);
  if (!match?.[1]) return undefined;
  const number = Number(match[1].replace(/[,\s]/g, ""));
  return Number.isFinite(number) && number >= 20 && number <= 2_500 ? number : undefined;
}

function regulatoryPowerEvidence(offer: Partial<VehicleOffer>) {
  const source = clean((offer as any).powerDataSource);
  const confidence = clean((offer as any).powerDataConfidence);
  // A marketplace field labelled "Horsepower" is source-exact, but it is not
  // homologation evidence. Only regulatory/official provenance bypasses the
  // physical sanity gate.
  return /homolog|type.?approval|coc|certificate|registration|government|manufacturer.?official|official.?spec/.test(`${source} ${confidence}`);
}

function combustionLike(offer: Partial<VehicleOffer>) {
  const kind = clean(offer.powertrainKind);
  const fuel = clean(offer.fuel);
  if (/electric|bev|phev|hev|hybrid|erev|series_hybrid|other_hybrid/.test(`${kind} ${fuel}`)) return false;
  return Boolean(positive(offer.engineCc)) || /combustion|petrol|gasoline|diesel|бенз|диз/.test(`${kind} ${fuel}`);
}

/**
 * This is intentionally a fail-closed plausibility guard, not a specification
 * database. It only rejects gross physical/source-parsing outliers. Exact model
 * correction belongs to Knowledge CORE; if CORE cannot resolve the value, the
 * public site is better off showing no horsepower than a confidently false one.
 */
export function catalogPowerSanity(offer: Partial<VehicleOffer>, candidate = offer.powerHp): CatalogPowerSanity {
  const powerHp = positive(candidate);
  if (!powerHp) return { suspicious: false, reason: "missing" };
  if (regulatoryPowerEvidence(offer)) return { powerHp, suspicious: false, reason: "regulatory_or_official" };

  if (powerHp > 2_500) return { suspicious: true, reason: "absolute_power_outlier" };

  const engineCc = positive(offer.engineCc);
  if (combustionLike(offer) && engineCc >= 500) {
    const hpPerLiter = powerHp / (engineCc / 1_000);
    if (powerHp >= 700 && hpPerLiter > 260) return { suspicious: true, reason: "combustion_power_density_outlier" };
    if (hpPerLiter > 350) return { suspicious: true, reason: "combustion_power_density_outlier" };
  }

  // Extremely large combustion values without displacement are too dangerous
  // to publish from a marketplace alone. V2/official knowledge may repopulate
  // them later with provenance.
  if (combustionLike(offer) && !engineCc && powerHp > 1_200) {
    return { suspicious: true, reason: "unverified_combustion_power_outlier" };
  }

  return { powerHp, suspicious: false, reason: "plausible" };
}

export function publicCatalogPowerHp(offer: Partial<VehicleOffer>) {
  const result = catalogPowerSanity(offer);
  return result.suspicious ? undefined : result.powerHp;
}
