import { readKnowledgeCoreIndex } from "./knowledge-core";
import { compatibleModificationOptions, specificationEvidenceComplete } from "./modification-matching";
import { hasModificationSelection, isModificationScenario, modificationBinding, withoutDeliveredPrice } from "./modification-contract";
import { catalogOfferVisibleRub } from "./public-priority";
import { hasCredibleOfferContent } from "./offer-quality";
import { classifySpecificationEvidence, SPECIFICATION_AUDIT_FIELDS } from "./specification-evidence-audit";
import { calculateOfferWithResolvedModification } from "./customs-pricing";
import type { VehicleOffer } from "./types";

const token = (value: unknown) => String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "");

export async function readCompatibleModifications(offer: VehicleOffer) {
  if (offer.market === "japan") return [];
  const index = await readKnowledgeCoreIndex();
  const modelId = index?.modelByCanonical.get(`${token(offer.make)}:${token(offer.model)}`);
  return modelId ? compatibleModificationOptions(offer, index!.variantsByModel.get(modelId) || [], modelId) : [];
}

export function conditionalModificationRub(offer: VehicleOffer) {
  if (!isModificationScenario(offer) || offer.calculationSnapshot?.customs?.status !== "ready"
    || offer.calculationSnapshot?.priceIncludesAllCustoms !== true
    || offer.calculationSnapshot?.priceIncludesUtilizationFee !== true) return 0;
  // Evaluate the complete calculation, with every public projection shortcut removed.
  return catalogOfferVisibleRub({ ...offer, modificationSelection: undefined, recoveryQualification: undefined,
    cardProjectionVersion: undefined, publicVisibleRub: undefined, publicSpecificationVerified: false,
    calculationSnapshot: { ...offer.calculationSnapshot, modificationScenario: undefined } });
}

export async function calculateSelectedModification(offer: VehicleOffer, variantId: string) {
  if (!hasModificationSelection(offer) || !offer.modificationSelection?.options.some(x => x.id === variantId)) return null;
  // Revalidate against current trusted knowledge. Neither IDs from another car
  // nor stale/withdrawn reference data can be supplied by query parameters.
  const option = (await readCompatibleModifications(offer)).find(x => x.id === variantId);
  if (!option) return null;
  const result = await calculateOfferWithResolvedModification(offer, option);
  return conditionalModificationRub(result) ? result : null;
}

/** Stage only; this function does not read a marketplace or write the catalog. */
export async function prepareModificationRecovery(offer: VehicleOffer): Promise<VehicleOffer> {
  if (offer.market === "japan") return offer;
  const reasons = SPECIFICATION_AUDIT_FIELDS.map(field => ({ field, ...classifySpecificationEvidence(offer, field) }))
    .filter(x => !["exact", "not_applicable"].includes(x.state)).map(x => `${x.field}:${x.reason}`);
  const qualify = (value: VehicleOffer, status: "automatic" | "selection_required" | "blocked") => ({ ...value,
    recoveryQualification: { version: 1 as const, status, reasons } });
  if (specificationEvidenceComplete(offer) && catalogOfferVisibleRub(offer) > 0 && hasCredibleOfferContent(offer)) return qualify(offer, "automatic");
  let safe: VehicleOffer = withoutDeliveredPrice({ ...offer, modificationSelection: undefined });
  // Ranges and old guessed fields are not listing constraints or visible facts.
  if (classifySpecificationEvidence(offer, "engineCc").state !== "exact") safe.engineCc = undefined;
  if (classifySpecificationEvidence(offer, "fuelPowertrain").state !== "exact") { safe.fuel = undefined; safe.powertrainKind = "unknown"; }
  if (classifySpecificationEvidence(offer, "powerHp").state !== "exact") { safe.powerHp = undefined; safe.powerKw = undefined; }
  if (classifySpecificationEvidence(offer, "certifiedPower").state !== "exact") {
    safe.power30MinKw = undefined; safe.power30MinKwByMotor = undefined; safe.utilizationPowerKw = undefined;
  }
  const semanticEvidence = { ...((offer.operational as any)?.semanticEvidence || {}) };
  for (const field of ["fuel", "powertrainKind", "engineCc", "powerHp", "powerKw", "peakPower", "certifiedPower"]) {
    if (semanticEvidence[field]?.status === "ambiguous") semanticEvidence[field] = { ...semanticEvidence[field], status: "missing" };
  }
  safe.operational = { ...safe.operational, semanticEvidence };
  if (offer.status !== "active" || offer.offerType !== "fixed" || offer.priceMode === "auction_start"
    || (offer.expiresAt && Date.parse(offer.expiresAt) < Date.now()) || !hasCredibleOfferContent(safe)) return qualify(safe, "blocked");
  const compatible = await readCompatibleModifications(offer);
  const options = [];
  for (const option of compatible) {
    const scenario = await calculateOfferWithResolvedModification(safe, option);
    if (conditionalModificationRub(scenario)) options.push(option);
  }
  if (!options.length) return qualify(safe, "blocked");
  safe.modificationSelection = { version: 1, status: "selection_required", binding: modificationBinding(safe), options };
  return qualify(safe, "selection_required");
}
