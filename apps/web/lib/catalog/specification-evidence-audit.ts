import type { VehicleOffer } from "./types";
import { catalogPowerSanity } from "./power-sanity";

export const SPECIFICATION_AUDIT_FIELDS = [
  "year",
  "fuelPowertrain",
  "engineCc",
  "powerHp",
  "certifiedPower",
] as const;

export type SpecificationAuditField = typeof SPECIFICATION_AUDIT_FIELDS[number];
export type SpecificationEvidenceState = "exact" | "ambiguous" | "conflict" | "missing" | "not_applicable";

export type SpecificationEvidenceResult = {
  state: SpecificationEvidenceState;
  reason: string;
  provenance: "source_evidence" | "knowledge_core" | "stored_unclassified" | "none";
};

const KNOWN_KINDS = new Set(["combustion", "electric", "series_hybrid", "other_hybrid"]);
const COMBUSTION_FUELS = new Set(["petrol", "gasoline", "benzin", "diesel", "lpg", "cng", "gas"]);
const HYBRID_FUELS = new Set(["hybrid", "phev", "hev", "mhev", "reev", "erev"]);

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function positive(value: unknown, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? parsed : 0;
}

function evidence(offer: Partial<VehicleOffer>, keys: string[]) {
  const semantic = (offer.operational as any)?.semanticEvidence;
  if (!semantic || typeof semantic !== "object") return [];
  return keys.map((key) => semantic[key]).filter((value) => value && typeof value === "object");
}

function explicitEvidenceState(offer: Partial<VehicleOffer>, keys: string[]) {
  const states = evidence(offer, keys).map((value: any) => clean(value?.status));
  if (states.includes("conflict")) return "conflict" as const;
  if (states.includes("ambiguous")) return "ambiguous" as const;
  if (states.includes("missing")) return "missing" as const;
  if (states.includes("exact") || states.includes("verified")) return "exact" as const;
  return undefined;
}

function knowledgeCore(offer: Partial<VehicleOffer>) {
  const value = (offer.operational as any)?.knowledgeCore;
  const fields = Array.isArray(value?.fieldsApplied) ? value.fieldsApplied.map(clean) : [];
  return {
    fields: new Set(fields),
    status: clean(value?.variantStatus),
    variantId: clean(value?.variantId),
  };
}

function knowledgeApplied(offer: Partial<VehicleOffer>, fields: string[]) {
  const core = knowledgeCore(offer);
  return fields.some((field) => core.fields.has(clean(field)));
}

function unsafeKnowledgeState(offer: Partial<VehicleOffer>, fields: string[]) {
  const core = knowledgeCore(offer);
  if (!fields.some((field) => core.fields.has(clean(field)))) return undefined;
  if (core.status === "review") return { state: "ambiguous" as const, reason: "review_knowledge_variant" };
  if (!core.variantId) return { state: "ambiguous" as const, reason: "unidentified_knowledge_variant" };
  return undefined;
}

function provenance(offer: Partial<VehicleOffer>, evidenceKeys: string[], knowledgeFields: string[]) {
  if (explicitEvidenceState(offer, evidenceKeys) === "exact") return "source_evidence" as const;
  if (knowledgeApplied(offer, knowledgeFields)) return "knowledge_core" as const;
  return "stored_unclassified" as const;
}

function powerProvenance(offer: Partial<VehicleOffer>, evidenceKeys: string[], knowledgeFields: string[]) {
  const classified = provenance(offer, evidenceKeys, knowledgeFields);
  if (classified !== "stored_unclassified") return classified;
  const source = clean(offer.powerDataSource);
  const confidence = clean(offer.powerDataConfidence);
  if (/^encyclopedia_v2:/.test(source)) return "knowledge_core" as const;
  if (["documented", "source_exact", "verified"].includes(confidence)
    || /source|manufacturer|official|regulator|homolog|certificate|registration/.test(source)) return "source_evidence" as const;
  return "stored_unclassified" as const;
}

function evidenceGuard(offer: Partial<VehicleOffer>, evidenceKeys: string[], knowledgeFields: string[]) {
  const explicit = explicitEvidenceState(offer, evidenceKeys);
  if (explicit === "conflict") return { state: "conflict" as const, reason: "explicit_semantic_conflict", provenance: "source_evidence" as const };
  if (explicit === "ambiguous") return { state: "ambiguous" as const, reason: "explicit_semantic_ambiguity", provenance: "source_evidence" as const };
  const unsafeKnowledge = unsafeKnowledgeState(offer, knowledgeFields);
  if (unsafeKnowledge) return { ...unsafeKnowledge, provenance: "knowledge_core" as const };
  return undefined;
}

function fuelKindConflict(fuelValue: unknown, kindValue: unknown) {
  const fuel = clean(fuelValue);
  const kind = clean(kindValue);
  if (!fuel || !kind || !KNOWN_KINDS.has(kind)) return false;
  if (kind === "electric") return fuel !== "electric";
  if (kind === "series_hybrid" || kind === "other_hybrid") return !HYBRID_FUELS.has(fuel);
  return !COMBUSTION_FUELS.has(fuel);
}

function unsafePowerProvenance(offer: Partial<VehicleOffer>) {
  const source = clean(offer.powerDataSource);
  const confidence = clean(offer.powerDataConfidence);
  if (/vehicle-model-representative|model.?wide|fallback_100|customer_input|source_peak_estimate/.test(source)) return true;
  return confidence === "estimated" || confidence === "reference";
}

export function isElectrifiedSpecification(offer: Partial<VehicleOffer>) {
  const kind = clean(offer.powertrainKind);
  const fuel = clean(offer.fuel);
  return ["electric", "series_hybrid", "other_hybrid"].includes(kind)
    || fuel === "electric"
    || HYBRID_FUELS.has(fuel);
}

export function classifySpecificationEvidence(
  offer: Partial<VehicleOffer>,
  field: SpecificationAuditField,
): SpecificationEvidenceResult {
  if (field === "year") {
    const guard = evidenceGuard(offer, ["year", "modelYear", "productionYear"], []);
    if (guard) return guard;
    const year = positive(offer.year, new Date().getFullYear() + 1);
    return year >= 1900
      ? { state: "exact", reason: "valid_source_year", provenance: "source_evidence" }
      : { state: "missing", reason: "year_missing_or_invalid", provenance: "none" };
  }

  if (field === "fuelPowertrain") {
    const guard = evidenceGuard(offer, ["fuel", "powertrainKind"], ["fuel", "powertrainKind"]);
    if (guard) return guard;
    const fuel = clean(offer.fuel);
    const kind = clean(offer.powertrainKind);
    if (fuelKindConflict(fuel, kind)) return { state: "conflict", reason: "fuel_powertrain_mismatch", provenance: provenance(offer, ["fuel", "powertrainKind"], ["fuel", "powertrainKind"]) };
    if (!fuel || !KNOWN_KINDS.has(kind)) return { state: "missing", reason: "fuel_or_powertrain_missing", provenance: "none" };
    const fieldProvenance = provenance(offer, ["fuel", "powertrainKind"], ["fuel", "powertrainKind"]);
    return fieldProvenance === "stored_unclassified"
      ? { state: "ambiguous", reason: "unclassified_field_provenance", provenance: fieldProvenance }
      : { state: "exact", reason: "usable_fuel_powertrain", provenance: fieldProvenance };
  }

  if (field === "engineCc") {
    const guard = evidenceGuard(offer, ["engineCc"], ["engineCc"]);
    if (guard) return guard;
    const engineCc = positive(offer.engineCc, 10_000);
    if (clean(offer.powertrainKind) === "electric" && engineCc) return { state: "conflict", reason: "electric_with_engine_displacement", provenance: provenance(offer, ["engineCc"], ["engineCc"]) };
    if (clean(offer.powertrainKind) === "electric") return { state: "not_applicable", reason: "electric_vehicle", provenance: "none" };
    if (!engineCc) return { state: "missing", reason: "engine_cc_missing", provenance: "none" };
    const fieldProvenance = provenance(offer, ["engineCc"], ["engineCc"]);
    return fieldProvenance === "stored_unclassified"
      ? { state: "ambiguous", reason: "unclassified_field_provenance", provenance: fieldProvenance }
      : { state: "exact", reason: "usable_engine_cc", provenance: fieldProvenance };
  }

  if (field === "powerHp") {
    const guard = evidenceGuard(offer, ["powerHp", "powerKw", "peakPower"], ["powerHp", "powerKw"]);
    if (guard) return guard;
    const sanity = catalogPowerSanity(offer);
    if (sanity.suspicious) return { state: "conflict", reason: sanity.reason, provenance: provenance(offer, ["powerHp", "powerKw", "peakPower"], ["powerHp", "powerKw"]) };
    if (!positive(offer.powerHp, 2_500) && !positive(offer.powerKw, 2_000)) return { state: "missing", reason: "peak_power_missing", provenance: "none" };
    const fieldProvenance = powerProvenance(offer, ["powerHp", "powerKw", "peakPower"], ["powerHp", "powerKw"]);
    if (unsafePowerProvenance(offer)) return { state: "ambiguous", reason: "non_exact_power_provenance", provenance: fieldProvenance };
    return fieldProvenance === "stored_unclassified"
      ? { state: "ambiguous", reason: "unclassified_field_provenance", provenance: fieldProvenance }
      : { state: "exact", reason: "usable_peak_power", provenance: fieldProvenance };
  }

  if (!isElectrifiedSpecification(offer)) return { state: "not_applicable", reason: "combustion_vehicle", provenance: "none" };
  const guard = evidenceGuard(offer, ["power30MinKw", "power30MinKwByMotor", "certifiedPower"], ["power30MinKw", "power30MinKwByMotor"]);
  if (guard) return guard;
  const byMotor = Array.isArray(offer.power30MinKwByMotor)
    ? offer.power30MinKwByMotor.map((value) => positive(value, 2_000)).filter(Boolean)
    : [];
  const certified = positive(offer.power30MinKw, 2_000) || byMotor.reduce((sum, value) => sum + value, 0);
  if (!certified) return { state: "missing", reason: "certified_30min_power_missing", provenance: "none" };
  const fieldProvenance = powerProvenance(offer, ["power30MinKw", "power30MinKwByMotor", "certifiedPower"], ["power30MinKw", "power30MinKwByMotor"]);
  if (unsafePowerProvenance(offer)) return { state: "ambiguous", reason: "non_exact_certified_power_provenance", provenance: fieldProvenance };
  return fieldProvenance === "stored_unclassified"
    ? { state: "ambiguous", reason: "unclassified_field_provenance", provenance: fieldProvenance }
    : { state: "exact", reason: "usable_certified_30min_power", provenance: fieldProvenance };
}
