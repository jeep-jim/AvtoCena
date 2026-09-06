import type { KnowledgeCoreVariant } from "./knowledge-core";
import type { VehicleOffer } from "./types";
import { classifySpecificationEvidence, SPECIFICATION_AUDIT_FIELDS } from "./specification-evidence-audit";
import { isCalculableModificationOption, type CatalogModificationOption } from "./modification-contract";

const token = (value: unknown) => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const number = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : undefined;
const fuelName = (value: unknown) => ({ gasoline: "petrol", petrol: "petrol", diesel: "diesel", electric: "electric", hybrid: "hybrid", hev: "hybrid", phev: "hybrid", lpg: "lpg", cng: "cng" }[token(value)]);
const kindName = (value: unknown): CatalogModificationOption["powertrainKind"] | undefined => ({ ice: "combustion", combustion: "combustion", bev: "electric", electric: "electric", erev: "series_hybrid", reev: "series_hybrid", serieshybrid: "series_hybrid", hev: "other_hybrid", phev: "other_hybrid", otherhybrid: "other_hybrid" } as const)[token(value) as "ice"];

function evidenced(variant: KnowledgeCoreVariant, field: string) {
  return variant.status === "verified" && (variant.evidence || []).some(x => x.sourceId
    && x.status === "verified" && ["official", "high"].includes(String(x.confidence)) && x.fields?.includes(field));
}

export function unprovenEnginePrecision(offer: Partial<VehicleOffer>) {
  const item = (offer.operational as any)?.semanticEvidence?.engineCc;
  const values = (Array.isArray(item?.rawValues) ? item.rawValues : item?.rawValue ? [item.rawValue] : []).map(String);
  return values.length > 0 && values.every(value => /\b\d+[.,]\d{1,2}\s*[lt]\b/i.test(value)
    && !/\b\d{3,5}\s*(?:cc|ccm|cm3|cm³|ml)\b/i.test(value));
}

export function specificationEvidenceComplete(offer: Partial<VehicleOffer>) {
  if (unprovenEnginePrecision(offer)) return false;
  return SPECIFICATION_AUDIT_FIELDS.every(field => ["exact", "not_applicable"].includes(classifySpecificationEvidence(offer, field).state));
}

/** No ranking winner: an incomplete listing gets conditional, compatible choices. */
export function compatibleModificationOptions(offer: VehicleOffer, variants: KnowledgeCoreVariant[], modelId: string): CatalogModificationOption[] {
  if (offer.market === "japan" || !modelId || !Number.isInteger(offer.year)) return [];
  if (SPECIFICATION_AUDIT_FIELDS.some(field => classifySpecificationEvidence(offer, field).state === "conflict")) return [];
  const exact = (field: typeof SPECIFICATION_AUDIT_FIELDS[number]) => classifySpecificationEvidence(offer, field).state === "exact";
  const semantic = (offer.operational as any)?.semanticEvidence || {};
  const knownFuel = exact("fuelPowertrain") || ["exact", "verified"].includes(semantic.fuel?.status);
  const knownKind = exact("fuelPowertrain") || ["exact", "verified"].includes(semantic.powertrainKind?.status);
  const options: CatalogModificationOption[] = [];
  for (const variant of variants) {
    if (variant.modelId !== modelId || variant.status !== "verified" || /japan|^jp$/i.test(String(variant.market))) continue;
    // Open year ranges and unspecified reference markets cannot attest applicability.
    if (!["market", "yearFrom", "yearTo", "fuel", "powertrainKind"].every(field => evidenced(variant, field))) continue;
    if (!variant.yearFrom || !variant.yearTo || offer.year < variant.yearFrom || offer.year > variant.yearTo) continue;
    const specificationMarket = (offer.operational as any)?.specificationMarket;
    if (specificationMarket && token(variant.market) !== token(specificationMarket) && token(variant.market) !== "global") continue;
    const fuel = fuelName(variant.fuel);
    const powertrainKind = kindName(variant.powertrainKind);
    if (!fuel || !powertrainKind) continue;
    const engineCc = evidenced(variant, "engineCc") ? number(variant.engineCc) : undefined;
    const powerKw = evidenced(variant, "powerKw") ? number(variant.powerKw) : undefined;
    const powerHp = evidenced(variant, "powerHp") ? number(variant.powerHp) : undefined;
    if (!powerHp && !powerKw) continue;
    if (knownFuel && fuelName(offer.fuel) !== fuel) continue;
    if (knownKind && offer.powertrainKind !== powertrainKind) continue;
    if (unprovenEnginePrecision(offer)) {
      if (!engineCc || Math.abs(Number(offer.engineCc) - engineCc) > 50) continue;
    } else if (exact("engineCc") && offer.engineCc !== engineCc) continue;
    if (exact("powerHp") && Math.abs(Number(offer.powerHp || Number(offer.powerKw) / 0.73549875) - Number(powerHp || Number(powerKw) / 0.73549875)) > 1) continue;
    // Known gearbox, drive and generation are constraints, never score penalties.
    if (["transmission", "drive"].some(field => {
      const current = (offer as any)[field];
      return current && token(current) !== "unknown" && (!evidenced(variant, field) || token(current) !== token((variant as any)[field]));
    })) continue;
    if (offer.generation && token(offer.generation) !== token(variant.generationId)) continue;
    const option: CatalogModificationOption = {
      id: variant.id, label: String(variant.name || variant.id), market: String(variant.market || ""), fuel, powertrainKind,
      engineCc, powerHp: powerHp || Number((Number(powerKw) / 0.73549875).toFixed(2)),
      powerKw: powerKw || Number((Number(powerHp) * 0.73549875).toFixed(4)),
      icePowerKw: evidenced(variant, "icePowerKw") ? number(variant.icePowerKw) : undefined,
      power30MinKw: evidenced(variant, "power30MinKw") ? number(variant.power30MinKw) : undefined,
      transmission: evidenced(variant, "transmission") ? variant.transmission || undefined : undefined,
      drive: evidenced(variant, "drive") ? variant.drive || undefined : undefined,
      evidenceIds: [...new Set((variant.evidence || []).filter(x => x.status === "verified" && ["official", "high"].includes(String(x.confidence))).map(x => String(x.sourceId || "")).filter(Boolean))],
    };
    if (isCalculableModificationOption(option) && !options.some(x => x.id === option.id)) options.push(option);
  }
  // Too many possibilities means the identity is insufficient for a useful selector.
  return options.length <= 40 ? options.sort((a, b) => a.id.localeCompare(b.id)) : [];
}
